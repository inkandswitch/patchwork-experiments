import { getHeads } from "@automerge/automerge";
import {
  type AutomergeUrl,
  type DocHandle,
  encodeHeads,
  parseAutomergeUrl,
  type Repo,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo";
import type { DocLink, FolderDoc, UnixFileEntry } from "@inkandswitch/patchwork-filesystem";

// ─── Types ──────────────────────────────────────────────────────────

/** FolderDoc extended with sync metadata set by flush(). */
type FolderDocWithMeta = FolderDoc & {
  lastSyncAt?: number;
  "@patchwork"?: { type: string };
};

// ─── Internal helpers ───────────────────────────────────────────────

/**
 * Pin a URL to the current document heads.
 * The returned URL includes encoded heads so it references a specific version.
 */
function getUrlWithHeads(handle: DocHandle<unknown>): AutomergeUrl {
  const doc = handle.docSync();
  if (!doc) {
    throw new Error("Document not ready");
  }
  const { documentId } = parseAutomergeUrl(handle.url);
  return stringifyAutomergeUrl({
    documentId,
    heads: encodeHeads(getHeads(doc)),
  });
}

/** Strip heads from an AutomergeUrl, returning the base document URL. */
function getBaseUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}

// ─── Folder class ───────────────────────────────────────────────────

class Folder {
  /** The underlying Automerge document handle for this folder. */
  readonly handle: DocHandle<FolderDocWithMeta>;

  private readonly repo: Repo;
  private readonly parent: Folder | null;
  private readonly nameInParent: string | null;

  /** File names that have been written since the last flush. */
  private readonly dirtyFiles = new Set<string>();

  /** Child Folder instances obtained via cd() or mkdir(). */
  private readonly children = new Map<string, Folder>();

  /** Cached file handles for files we've created or opened. */
  private readonly fileHandles = new Map<string, DocHandle<UnixFileEntry>>();

  constructor(
    handle: DocHandle<FolderDocWithMeta>,
    repo: Repo,
    parent: Folder | null = null,
    nameInParent: string | null = null,
  ) {
    this.handle = handle;
    this.repo = repo;
    this.parent = parent;
    this.nameInParent = nameInParent;
  }

  // ── Traversal ───────────────────────────────────────────────────

  /** List all entries (files and subfolders) in this folder. */
  ls(): DocLink[] {
    const doc = this.handle.doc();
    if (!doc) throw new Error("Folder document not ready");
    return doc.docs ?? [];
  }

  /**
   * Navigate to a subfolder by path.
   *
   * Supports filesystem-style paths:
   *  - `cd("subdir")`        — descend into a child folder
   *  - `cd("..")`            — go up to the parent
   *  - `cd("../../other")`   — go up two levels, then into "other"
   *  - `cd("a/b/c")`         — descend through multiple levels
   */
  async cd(path: string): Promise<Folder> {
    const segments = path.split("/").filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Folder = this;

    for (const segment of segments) {
      if (segment === "..") {
        if (!current.parent) {
          throw new Error("Already at root folder, cannot cd('..')");
        }
        current = current.parent;
        continue;
      }

      // Return cached child if we already visited it
      if (current.children.has(segment)) {
        current = current.children.get(segment)!;
        continue;
      }

      // Find the DocLink for this subfolder
      const doc = current.handle.doc();
      if (!doc) throw new Error("Folder document not ready");

      const link = doc.docs?.find(
        (d) => d.name === segment && d.type === "folder",
      );
      if (!link) {
        throw new Error(
          `Subfolder "${segment}" not found in "${doc.title ?? "folder"}"`,
        );
      }

      const childHandle = await current.repo.find<FolderDocWithMeta>(
        getBaseUrl(link.url),
      );
      const child = new Folder(childHandle, current.repo, current, segment);
      current.children.set(segment, child);
      current = child;
    }

    return current;
  }

  // ── File access ─────────────────────────────────────────────────

  /**
   * Open a file by name and return its DocHandle.
   * The handle is cached so subsequent calls for the same name are fast.
   */
  async open(name: string): Promise<DocHandle<UnixFileEntry>> {
    // Return cached handle if available
    if (this.fileHandles.has(name)) {
      return this.fileHandles.get(name)!;
    }

    const doc = this.handle.doc();
    if (!doc) throw new Error("Folder document not ready");

    const link = doc.docs?.find((d) => d.name === name);
    if (!link) {
      throw new Error(
        `File "${name}" not found in "${doc.title ?? "folder"}"`,
      );
    }

    const fileHandle = await this.repo.find<UnixFileEntry>(
      getBaseUrl(link.url),
    );
    this.fileHandles.set(name, fileHandle);
    return fileHandle;
  }

  /**
   * Read the content of a file by name.
   * Returns string for text files, Uint8Array for binary files.
   */
  async read(name: string): Promise<string | Uint8Array> {
    const fileHandle = await this.open(name);
    const fileDoc = fileHandle.doc();
    if (!fileDoc) throw new Error(`File "${name}" document not ready`);
    return fileDoc.content as string | Uint8Array;
  }

  // ── Mutation ────────────────────────────────────────────────────

  /**
   * Write a file into this folder.
   *
   * If the file already exists its content is replaced.
   * If it does not exist a new UnixFileEntry document is created and
   * a DocLink is added to the folder.
   *
   * The file is marked dirty — call flush() to pin heads and propagate
   * timestamps upward.
   */
  async write(
    name: string,
    content: string,
    opts?: { extension?: string; mimeType?: string },
  ): Promise<void> {
    const doc = this.handle.doc();
    if (!doc) throw new Error("Folder document not ready");

    const existingIndex = doc.docs?.findIndex((d) => d.name === name) ?? -1;

    if (existingIndex !== -1) {
      // ── Update existing file ──────────────────────────────────
      const fileHandle = await this.open(name);
      fileHandle.change((file) => {
        file.content = content;
      });
    } else {
      // ── Create new file ───────────────────────────────────────
      const ext = opts?.extension ?? name.split(".").pop() ?? "";
      const mime = opts?.mimeType ?? "application/octet-stream";

      const fileHandle = this.repo.create<UnixFileEntry>();
      fileHandle.change((file) => {
        file.content = content;
        file.name = name;
        file.extension = ext;
        file.mimeType = mime;
        (file as any)["@patchwork"] = { type: "file" };
      });

      // Add a DocLink to this folder (unpinned URL for now — flush() pins it)
      this.handle.change((folder) => {
        if (!folder.docs) folder.docs = [];
        folder.docs.push({
          name,
          type: "file",
          url: fileHandle.url,
        });
      });

      this.fileHandles.set(name, fileHandle);
    }

    this.dirtyFiles.add(name);
  }

  /**
   * Create a new subfolder and return a Folder wrapping it.
   * The subfolder is registered as a child and tracked for flush().
   */
  mkdir(name: string): Folder {
    const childHandle = this.repo.create<FolderDocWithMeta>();
    childHandle.change((folder) => {
      folder.title = name;
      folder.docs = [];
      folder["@patchwork"] = { type: "folder" };
    });

    this.handle.change((folder) => {
      if (!folder.docs) folder.docs = [];
      folder.docs.push({
        name,
        type: "folder",
        url: childHandle.url,
      });
    });

    const child = new Folder(childHandle, this.repo, this, name);
    this.children.set(name, child);
    return child;
  }

  // ── Sync ────────────────────────────────────────────────────────

  /**
   * Flush dirty state bottom-up.
   *
   * 1. Recursively flush all child Folder instances (leaf-first).
   * 2. In a single change, update the pinned URLs for every dirty file
   *    and every child folder whose heads changed, then set `lastSyncAt`.
   * 3. Clear the dirty set.
   *
   * Because setting `lastSyncAt` changes this folder's heads, the parent
   * will detect the change on its own flush pass and update our URL in
   * its docs — cascading all the way to the root.
   */
  flush(): void {
    // 1. Depth-first: flush children
    for (const child of this.children.values()) {
      child.flush();
    }

    const doc = this.handle.doc();
    if (!doc) return;

    // 2. Collect URL updates
    const updates: { index: number; url: AutomergeUrl }[] = [];

    // Child folder URLs that may have changed after their flush
    for (const [name, child] of this.children) {
      const linkIndex = doc.docs.findIndex(
        (d) => d.name === name && d.type === "folder",
      );
      if (linkIndex === -1) continue;

      const pinnedUrl = getUrlWithHeads(child.handle);
      if (doc.docs[linkIndex].url !== pinnedUrl) {
        updates.push({ index: linkIndex, url: pinnedUrl });
      }
    }

    // Dirty file URLs
    for (const fileName of this.dirtyFiles) {
      const fileHandle = this.fileHandles.get(fileName);
      if (!fileHandle) continue;

      const linkIndex = doc.docs.findIndex((d) => d.name === fileName);
      if (linkIndex === -1) continue;

      updates.push({ index: linkIndex, url: getUrlWithHeads(fileHandle) });
    }

    // 3. Apply all updates + timestamp in a single change
    if (updates.length > 0) {
      this.handle.change((folder) => {
        for (const { index, url } of updates) {
          folder.docs[index].url = url;
        }
        (folder as FolderDocWithMeta).lastSyncAt = Date.now();
      });
    }

    // 4. Clear dirty state
    this.dirtyFiles.clear();
  }
}

// ─── Factory functions ──────────────────────────────────────────────

/**
 * Open an existing folder from its DocHandle.
 *
 * @param handle - A DocHandle for an existing FolderDoc
 * @param repo   - The Automerge repo (needed to resolve child documents)
 * @returns A Folder instance wrapping the handle
 */
export function openFolder(
  handle: DocHandle<FolderDoc>,
  repo: Repo,
): Folder {
  return new Folder(handle as DocHandle<FolderDocWithMeta>, repo);
}

/**
 * Create a brand-new empty folder.
 *
 * @param repo  - The Automerge repo to create the document in
 * @param title - Optional title for the folder (defaults to "folder")
 * @returns A Folder instance wrapping the newly created FolderDoc
 */
export function createFolder(repo: Repo, title?: string): Folder {
  const handle = repo.create<FolderDocWithMeta>();
  handle.change((folder) => {
    folder.title = title ?? "folder";
    folder.docs = [];
    folder["@patchwork"] = { type: "folder" };
  });
  return new Folder(handle, repo);
}
