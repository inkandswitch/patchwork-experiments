import type { AutomergeUrl, Repo, DocHandle } from "@automerge/automerge-repo";
import type {
  FolderDoc,
  DocLink,
  UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

/**
 * Filesystem API that wraps Automerge doc operations.
 * Resolves paths by walking FolderDoc.docs arrays from a root folder.
 */
export class AutomergeFS {
  constructor(
    private repo: Repo,
    private rootFolderUrl: AutomergeUrl
  ) {}

  /**
   * Resolve a path like "/src/index.js" to a DocHandle by walking folders.
   * Returns the handle and the matching DocLink, or null if not found.
   */
  private async resolvePath(
    pathStr: string
  ): Promise<{ handle: DocHandle<any>; link: DocLink } | null> {
    const parts = pathStr
      .split("/")
      .filter((p) => p.length > 0);

    if (parts.length === 0) {
      // Root folder itself
      const handle = await this.repo.find<FolderDoc>(this.rootFolderUrl);
      await handle.whenReady();
      return {
        handle,
        link: {
          name: "",
          type: "folder",
          url: this.rootFolderUrl,
        },
      };
    }

    let currentFolderUrl = this.rootFolderUrl;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const folderHandle = await this.repo.find<FolderDoc>(currentFolderUrl);
      await folderHandle.whenReady();
      const folderDoc = folderHandle.doc();

      if (!folderDoc || !folderDoc.docs) {
        return null;
      }

      const match = folderDoc.docs.find((d: DocLink) => d.name === part);
      if (!match) {
        return null;
      }

      if (i === parts.length - 1) {
        // This is the target
        const handle = await this.repo.find(match.url);
        await handle.whenReady();
        return { handle, link: match };
      }

      // Must be a folder to continue traversal
      if (match.type !== "folder") {
        return null;
      }
      currentFolderUrl = match.url;
    }

    return null;
  }

  /**
   * Resolve the parent folder for a given path.
   * Returns the folder handle and the target name.
   */
  private async resolveParent(
    pathStr: string
  ): Promise<{
    folderHandle: DocHandle<FolderDoc>;
    targetName: string;
  } | null> {
    const parts = pathStr
      .split("/")
      .filter((p) => p.length > 0);

    if (parts.length === 0) {
      return null;
    }

    const targetName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);

    let currentFolderUrl = this.rootFolderUrl;

    for (const part of parentParts) {
      const folderHandle = await this.repo.find<FolderDoc>(currentFolderUrl);
      await folderHandle.whenReady();
      const folderDoc = folderHandle.doc();

      if (!folderDoc || !folderDoc.docs) {
        return null;
      }

      const match = folderDoc.docs.find(
        (d: DocLink) => d.name === part && d.type === "folder"
      );
      if (!match) {
        return null;
      }
      currentFolderUrl = match.url;
    }

    const folderHandle = await this.repo.find<FolderDoc>(currentFolderUrl);
    await folderHandle.whenReady();
    return { folderHandle, targetName };
  }

  /**
   * Read a file's content as a string.
   */
  async readFile(pathStr: string): Promise<string> {
    const resolved = await this.resolvePath(pathStr);
    if (!resolved) {
      throw new Error(`File not found: ${pathStr}`);
    }

    const doc = resolved.handle.doc() as UnixFileEntry | null;
    if (!doc || doc.content === undefined) {
      throw new Error(`Not a readable file: ${pathStr}`);
    }

    if (typeof doc.content === "string") {
      return doc.content;
    }

    if (doc.content instanceof Uint8Array) {
      return new TextDecoder().decode(doc.content);
    }

    // ImmutableString — convert to string
    return String(doc.content);
  }

  /**
   * Write content to a file. Creates the file if it doesn't exist.
   */
  async writeFile(pathStr: string, content: string): Promise<void> {
    const resolved = await this.resolvePath(pathStr);

    if (resolved) {
      // File exists, update it
      resolved.handle.change((doc: any) => {
        doc.content = content;
      });
      return;
    }

    // File doesn't exist, create it
    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    const name = parent.targetName;
    const extension = name.includes(".") ? name.split(".").pop() || "" : "";
    const mimeType = guessMimeType(extension);

    const fileHandle = this.repo.create<UnixFileEntry>();
    fileHandle.change((doc) => {
      doc.name = name;
      doc.extension = extension;
      doc.mimeType = mimeType;
      doc.content = content;
    });

    parent.folderHandle.change((doc) => {
      if (!doc.docs) {
        doc.docs = [];
      }
      doc.docs.push({
        url: fileHandle.url,
        name,
        type: "file",
      });
    });
  }

  /**
   * List the contents of a directory.
   * Returns an array of { name, type } entries.
   */
  async listDir(pathStr: string): Promise<{ name: string; type: string }[]> {
    const resolved = await this.resolvePath(pathStr);
    if (!resolved) {
      throw new Error(`Directory not found: ${pathStr}`);
    }

    const doc = resolved.handle.doc() as FolderDoc | null;
    if (!doc || !doc.docs) {
      throw new Error(`Not a directory: ${pathStr}`);
    }

    return doc.docs.map((d) => ({ name: d.name, type: d.type }));
  }

  /**
   * Create a directory. Creates the folder doc and links it into the parent.
   */
  async mkdir(pathStr: string): Promise<void> {
    // Check if it already exists
    const existing = await this.resolvePath(pathStr);
    if (existing) {
      return; // Already exists
    }

    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    const folderHandle = this.repo.create<FolderDoc>();
    folderHandle.change((doc) => {
      doc.title = parent.targetName;
      doc.docs = [];
    });

    parent.folderHandle.change((doc) => {
      if (!doc.docs) {
        doc.docs = [];
      }
      doc.docs.push({
        url: folderHandle.url,
        name: parent.targetName,
        type: "folder",
      });
    });
  }

  /**
   * Link an existing Automerge document into a folder at the given path.
   * Does not create a new doc — just adds a reference to an existing one.
   */
  async linkDoc(
    pathStr: string,
    automergeUrl: AutomergeUrl,
    type: string = "file"
  ): Promise<void> {
    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    parent.folderHandle.change((doc) => {
      if (!doc.docs) {
        doc.docs = [];
      }
      doc.docs.push({
        url: automergeUrl,
        name: parent.targetName,
        type,
      });
    });
  }

  /**
   * Remove a file or directory from its parent folder.
   * Does not delete the underlying Automerge doc, just unlinks it.
   */
  async rm(pathStr: string): Promise<void> {
    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Cannot remove: ${pathStr}`);
    }

    const parentDoc = parent.folderHandle.doc();
    if (!parentDoc || !parentDoc.docs) {
      throw new Error(`Parent is not a directory: ${pathStr}`);
    }

    const idx = parentDoc.docs.findIndex(
      (d) => d.name === parent.targetName
    );
    if (idx === -1) {
      throw new Error(`Not found: ${pathStr}`);
    }

    parent.folderHandle.change((doc) => {
      doc.docs.splice(idx, 1);
    });
  }
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    js: "application/javascript",
    ts: "application/typescript",
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
  };
  return map[ext] || "application/octet-stream";
}
