import type { AutomergeUrl, Repo, DocHandle } from '@automerge/automerge-repo';
import { parseAutomergeUrl, stringifyAutomergeUrl, updateText } from '@automerge/automerge-repo';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import type { WorkspaceDoc } from './types';

/**
 * Filesystem API backed by a WorkspaceDoc.
 *
 * Resolves paths by walking FolderDoc.docs arrays from the workspace's root
 * folder. All reads go through the COW overlay so cloned docs are returned
 * transparently. All writes clone the target doc on first mutation.
 */
export class AutomergeFS {
  constructor(private repo: Repo, private workspaceHandle: DocHandle<WorkspaceDoc>) {}

  private get rootFolderUrl(): AutomergeUrl {
    return this.workspaceHandle.doc()!.rootFolderUrl;
  }

  /**
   * Check the workspace overlay mappings. If a clone exists for the given URL,
   * return the clone URL; otherwise return the original.
   */
  private resolveOverlayUrl(url: AutomergeUrl): AutomergeUrl {
    const ws = this.workspaceHandle.doc();
    if (!ws || !ws.mappings) return url;
    const entry = ws.mappings[url];
    return entry ? entry.cloneUrl : url;
  }

  /**
   * Get a writable handle for the given original URL.
   * The root folder is workspace-owned and mutated directly (no COW).
   * For all other docs, if a clone already exists in the workspace mappings,
   * returns the clone. Otherwise clones via repo.clone(), records the mapping,
   * and returns the clone handle.
   */
  private async getWritableHandle(originalUrl: AutomergeUrl): Promise<DocHandle<any>> {
    // Root folder is workspace-owned — mutate directly, no COW
    if (originalUrl === this.rootFolderUrl) {
      const handle = await this.repo.find(originalUrl);
      return handle;
    }

    const existingCloneUrl = this.resolveOverlayUrl(originalUrl);
    if (existingCloneUrl !== originalUrl) {
      const handle = await this.repo.find(existingCloneUrl);
      return handle;
    }

    const originalHandle = await this.repo.find(originalUrl);
    const heads = originalHandle.heads();
    const cloneHandle = this.repo.clone(originalHandle);

    const { documentId } = parseAutomergeUrl(originalUrl);
    const originalUrlWithHeads = stringifyAutomergeUrl({ documentId, heads });

    this.workspaceHandle.change((ws: any) => {
      if (!ws.mappings) ws.mappings = {};
      ws.mappings[originalUrl] = { cloneUrl: cloneHandle.url, originalUrlWithHeads };
    });

    return cloneHandle;
  }

  /**
   * Resolve a path like "/src/index.js" to a DocHandle by walking folders.
   * At every step, URLs are resolved through the COW overlay.
   * Returns the handle and the matching DocLink, or null if not found.
   */
  private async resolvePath(
    pathStr: string
  ): Promise<{ handle: DocHandle<any>; link: DocLink } | null> {
    const parts = pathStr.split('/').filter((p) => p.length > 0);

    if (parts.length === 0) {
      const effectiveUrl = this.resolveOverlayUrl(this.rootFolderUrl);
      const handle = await this.repo.find<FolderDoc>(effectiveUrl);

      return {
        handle,
        link: {
          name: '',
          type: 'folder',
          url: this.rootFolderUrl,
        },
      };
    }

    let currentFolderUrl = this.resolveOverlayUrl(this.rootFolderUrl);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const folderHandle = await this.repo.find<FolderDoc>(currentFolderUrl);

      const folderDoc = folderHandle.doc();

      if (!folderDoc || !folderDoc.docs) {
        return null;
      }

      const match = folderDoc.docs.find((d: DocLink) => d.name === part);
      if (!match) {
        return null;
      }

      if (i === parts.length - 1) {
        const effectiveUrl = this.resolveOverlayUrl(match.url);
        const handle = await this.repo.find(effectiveUrl);

        return { handle, link: match };
      }

      if (match.type !== 'folder') {
        return null;
      }
      currentFolderUrl = this.resolveOverlayUrl(match.url);
    }

    return null;
  }

  /**
   * Resolve the parent folder for a given path.
   * Returns a writable handle (cloned via COW) and the target name.
   */
  private async resolveParent(pathStr: string): Promise<{
    folderHandle: DocHandle<FolderDoc>;
    folderOriginalUrl: AutomergeUrl;
    targetName: string;
  } | null> {
    const parts = pathStr.split('/').filter((p) => p.length > 0);

    if (parts.length === 0) {
      return null;
    }

    const targetName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);

    let currentFolderUrl = this.rootFolderUrl;

    for (const part of parentParts) {
      const effectiveUrl = this.resolveOverlayUrl(currentFolderUrl);
      const folderHandle = await this.repo.find<FolderDoc>(effectiveUrl);
      const folderDoc = folderHandle.doc();

      if (!folderDoc || !folderDoc.docs) {
        return null;
      }

      const match = folderDoc.docs.find((d: DocLink) => d.name === part && d.type === 'folder');
      if (!match) {
        return null;
      }
      currentFolderUrl = match.url;
    }

    const writableHandle = (await this.getWritableHandle(currentFolderUrl)) as DocHandle<FolderDoc>;
    return { folderHandle: writableHandle, folderOriginalUrl: currentFolderUrl, targetName };
  }

  /**
   * Get the DocHandle for a document at the given path.
   * Resolves through the COW overlay transparently.
   */
  async getDocHandle(pathStr: string): Promise<DocHandle<any>> {
    const resolved = await this.resolvePath(pathStr);
    if (!resolved) {
      throw new Error(`Not found: ${pathStr}`);
    }
    return resolved.handle;
  }

  /**
   * Read a file's content as a string.
   * For patchwork file docs, returns the content field.
   * For any other Automerge document, returns its JSON representation.
   */
  async readFile(pathStr: string): Promise<string> {
    const resolved = await this.resolvePath(pathStr);
    if (!resolved) {
      throw new Error(`File not found: ${pathStr}`);
    }

    const doc = resolved.handle.doc();
    if (!doc) {
      throw new Error(`Document not found: ${pathStr}`);
    }

    // Patchwork file docs have a content field
    const content = (doc as any).content;
    if (content !== undefined) {
      if (typeof content === 'string') return content;
      if (content instanceof Uint8Array) return new TextDecoder().decode(content);
      return String(content);
    }

    // For any other Automerge document, return its data as JSON
    return JSON.stringify(doc, null, 2);
  }

  /**
   * Write content to a file. Creates the file if it doesn't exist.
   * Existing files are cloned via COW before mutation.
   */
  async writeFile(pathStr: string, content: string): Promise<void> {
    const resolved = await this.resolvePath(pathStr);

    if (resolved) {
      const writable = await this.getWritableHandle(resolved.link.url);
      writable.change((doc: any) => {
        updateText(doc, ['content'], content);
      });
      return;
    }

    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    const name = parent.targetName;
    const extension = name.includes('.') ? name.split('.').pop() || '' : '';
    const mimeType = guessMimeType(extension);

    const fileHandle = this.repo.create<any>();
    fileHandle.change((doc: any) => {
      doc['@patchwork'] = { type: 'file' };
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
        type: 'file',
      });
    });

    this.workspaceHandle.change((ws: any) => {
      if (!ws.createdUrls) ws.createdUrls = [];
      ws.createdUrls.push(fileHandle.url);
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
   * Parent folder is cloned via COW before mutation.
   */
  async mkdir(pathStr: string): Promise<void> {
    const existing = await this.resolvePath(pathStr);
    if (existing) {
      return;
    }

    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    const folderHandle = this.repo.create<any>();
    folderHandle.change((doc: any) => {
      doc['@patchwork'] = { type: 'folder' };
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
        type: 'folder',
      });
    });
  }

  /**
   * Link an existing Automerge document into a folder at the given path.
   * Reads the type from the document's @patchwork metadata.
   * The root folder is mutated directly (no COW) so linked docs don't
   * appear as changes unless subsequently modified.
   */
  async linkDoc(pathStr: string, automergeUrl: AutomergeUrl): Promise<void> {
    const parent = await this.resolveParent(pathStr);
    if (!parent) {
      throw new Error(`Parent directory not found for: ${pathStr}`);
    }

    const targetHandle = await this.repo.find(automergeUrl);
    const targetDoc = targetHandle.doc() as any;
    const type: string = targetDoc?.['@patchwork']?.type || 'file';

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
   * Parent folder is cloned via COW before mutation.
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

    const idx = parentDoc.docs.findIndex((d) => d.name === parent.targetName);
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
    js: 'application/javascript',
    ts: 'application/typescript',
    json: 'application/json',
    md: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
  };
  return map[ext] || 'application/octet-stream';
}
