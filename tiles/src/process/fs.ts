import type { AutomergeUrl, Repo, DocHandle } from '@automerge/automerge-repo';
import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  updateText,
} from '@automerge/automerge-repo';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import type { WorkspaceDoc, WorkspaceEntry } from './types';

/**
 * Filesystem API backed by a WorkspaceDoc with flat entry list.
 *
 * Top-level items are looked up by name from workspace.entries[].
 * Deep access into folder entries uses path-based traversal.
 * All reads go through the COW overlay. All writes clone via deep COW,
 * cloning intermediate folders up to the entry root.
 */
export class AutomergeFS {
  constructor(
    private repo: Repo,
    private workspaceHandle: DocHandle<WorkspaceDoc>,
  ) {}

  // --- Entry lookup ---

  private findEntry(name: string): WorkspaceEntry {
    const ws = this.workspaceHandle.doc();
    if (!ws?.entries) throw new Error(`Workspace has no entries`);
    const entry = ws.entries.find((e) => e.name === name);
    if (!entry) {
      const available = ws.entries.map((e) => e.name).join(', ');
      throw new Error(`Entry not found: "${name}". Available: [${available}]`);
    }
    return entry;
  }

  // --- COW overlay ---

  private resolveOverlayUrl(url: AutomergeUrl): AutomergeUrl {
    const ws = this.workspaceHandle.doc();
    if (!ws?.mappings) return url;
    const entry = ws.mappings[url];
    return entry ? entry.cloneUrl : url;
  }

  /**
   * Get a writable handle for the given original URL.
   * If a clone already exists, returns it. Otherwise clones the doc,
   * records the mapping, and returns the clone handle.
   * Agent-created docs are already writable.
   */
  private async getWritableHandle(originalUrl: AutomergeUrl): Promise<DocHandle<any>> {
    const existingCloneUrl = this.resolveOverlayUrl(originalUrl);
    if (existingCloneUrl !== originalUrl) {
      return this.repo.find(existingCloneUrl);
    }

    const ws = this.workspaceHandle.doc();
    if (ws?.createdUrls?.includes(originalUrl)) {
      return this.repo.find(originalUrl);
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

  // --- Path resolution within a folder hierarchy ---

  /**
   * Walk a path within a folder doc, resolving through COW overlay at each step.
   * Returns the handle and DocLink for the target, or null if not found.
   */
  private async resolvePathInFolder(
    folderUrl: AutomergeUrl,
    pathStr: string,
  ): Promise<{ handle: DocHandle<any>; link: DocLink } | null> {
    const parts = pathStr.split('/').filter((p) => p.length > 0);

    if (parts.length === 0) {
      const effectiveUrl = this.resolveOverlayUrl(folderUrl);
      const handle = await this.repo.find<FolderDoc>(effectiveUrl);
      return {
        handle,
        link: { name: '', type: 'folder', url: folderUrl },
      };
    }

    let currentFolderUrl = this.resolveOverlayUrl(folderUrl);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const folderHandle = await this.repo.find<FolderDoc>(currentFolderUrl);
      const folderDoc = folderHandle.doc();

      if (!folderDoc?.docs) return null;

      const match = folderDoc.docs.find((d: DocLink) => d.name === part);
      if (!match) return null;

      if (i === parts.length - 1) {
        const effectiveUrl = this.resolveOverlayUrl(match.url);
        const handle = await this.repo.find(effectiveUrl);
        return { handle, link: match };
      }

      if (match.type !== 'folder') return null;
      currentFolderUrl = this.resolveOverlayUrl(match.url);
    }

    return null;
  }

  /**
   * Deep COW: get a writable handle for a file at `path` within a folder at `rootUrl`.
   * Clones all intermediate folders from root down to the target's parent,
   * updating each cloned folder to point to the cloned child.
   * Returns the writable handle for the leaf file/folder.
   */
  private async getDeepWritableHandle(
    rootUrl: AutomergeUrl,
    pathStr: string,
  ): Promise<DocHandle<any>> {
    const parts = pathStr.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) {
      return this.getWritableHandle(rootUrl);
    }

    // Collect the chain of (originalUrl, docLink) from root to target
    type ChainLink = { folderUrl: AutomergeUrl; childName: string; childLink: DocLink };
    const chain: ChainLink[] = [];

    let currentFolderUrl = rootUrl;
    for (let i = 0; i < parts.length; i++) {
      const effectiveUrl = this.resolveOverlayUrl(currentFolderUrl);
      const folderHandle = await this.repo.find<FolderDoc>(effectiveUrl);
      const folderDoc = folderHandle.doc();

      if (!folderDoc?.docs) {
        throw new Error(`Not a directory at step "${parts[i]}" in path "${pathStr}"`);
      }

      const match = folderDoc.docs.find((d: DocLink) => d.name === parts[i]);
      if (!match) {
        const available = folderDoc.docs.map((d: DocLink) => d.name).join(', ');
        throw new Error(
          `"${parts[i]}" not found in folder. Available: [${available}]`,
        );
      }

      chain.push({ folderUrl: currentFolderUrl, childName: parts[i], childLink: match });

      if (i < parts.length - 1) {
        if (match.type !== 'folder') {
          throw new Error(`"${parts[i]}" is not a folder in path "${pathStr}"`);
        }
        currentFolderUrl = match.url;
      }
    }

    // Clone from leaf up to root, updating parent folder links
    const leafLink = chain[chain.length - 1].childLink;
    let childWritableHandle = await this.getWritableHandle(leafLink.url);
    let childCloneUrl = childWritableHandle.url;

    for (let i = chain.length - 1; i >= 0; i--) {
      const { folderUrl, childName } = chain[i];
      const folderWritable = await this.getWritableHandle(folderUrl);

      // Update the folder's docs array to point to the cloned child
      folderWritable.change((doc: any) => {
        if (!doc.docs) return;
        const idx = doc.docs.findIndex((d: any) => d.name === childName);
        if (idx !== -1) {
          doc.docs[idx].url = childCloneUrl;
        }
      });

      childCloneUrl = folderWritable.url;
    }

    return childWritableHandle;
  }

  // --- Public API: top-level document access ---

  listEntries(): WorkspaceEntry[] {
    const ws = this.workspaceHandle.doc();
    return ws?.entries ?? [];
  }

  /**
   * Read a top-level document's content as a string.
   * For patchwork file docs, returns the content field.
   * For any other doc, returns its JSON representation.
   */
  async readDoc(name: string): Promise<string> {
    const entry = this.findEntry(name);
    const effectiveUrl = this.resolveOverlayUrl(entry.url);
    const handle = await this.repo.find(effectiveUrl);
    const doc = handle.doc();
    if (!doc) throw new Error(`Document not loaded: ${name}`);
    return extractContent(doc);
  }

  async writeDoc(name: string, content: string): Promise<void> {
    const entry = this.findEntry(name);
    const writable = await this.getWritableHandle(entry.url);
    writable.change((doc: any) => {
      try {
        updateText(doc, ['content'], content);
      } catch {
        doc.content = content;
      }
    });
  }

  async patchDoc(name: string, oldStr: string, newStr: string): Promise<void> {
    const content = await this.readDoc(name);
    const idx = content.indexOf(oldStr);
    if (idx === -1) {
      const preview = oldStr.length > 120 ? oldStr.slice(0, 120) + '…' : oldStr;
      throw new Error(`patchDoc: oldStr not found in "${name}". Searched for: ${preview}`);
    }
    const patched = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    await this.writeDoc(name, patched);
  }

  // --- Public API: deep access into folder entries ---

  async readFile(name: string, path: string): Promise<string> {
    const entry = this.findEntry(name);
    const resolved = await this.resolvePathInFolder(entry.url, path);
    if (!resolved) throw new Error(`File not found: ${name}/${path}`);

    const doc = resolved.handle.doc();
    if (!doc) throw new Error(`Document not loaded: ${name}/${path}`);
    return extractContent(doc);
  }

  async writeFile(name: string, path: string, content: string): Promise<void> {
    const entry = this.findEntry(name);

    const resolved = await this.resolvePathInFolder(entry.url, path);
    if (resolved) {
      const writable = await this.getDeepWritableHandle(entry.url, path);
      writable.change((doc: any) => {
        try {
          updateText(doc, ['content'], content);
        } catch {
          doc.content = content;
        }
      });
      return;
    }

    // File doesn't exist -- create it in the parent folder
    const parts = path.split('/').filter((p) => p.length > 0);
    const fileName = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const parentWritable = parentPath
      ? await this.getDeepWritableHandle(entry.url, parentPath)
      : await this.getWritableHandle(entry.url);

    const extension = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
    const mimeType = guessMimeType(extension);

    const fileHandle = this.repo.create<any>();
    fileHandle.change((doc: any) => {
      doc['@patchwork'] = { type: 'file' };
      doc.name = fileName;
      doc.extension = extension;
      doc.mimeType = mimeType;
      doc.content = content;
    });

    parentWritable.change((doc: any) => {
      if (!doc.docs) doc.docs = [];
      doc.docs.push({ url: fileHandle.url, name: fileName, type: 'file' });
    });

    this.workspaceHandle.change((ws: any) => {
      if (!ws.createdUrls) ws.createdUrls = [];
      ws.createdUrls.push(fileHandle.url);
    });
  }

  async patchFile(name: string, path: string, oldStr: string, newStr: string): Promise<void> {
    const content = await this.readFile(name, path);
    const idx = content.indexOf(oldStr);
    if (idx === -1) {
      const preview = oldStr.length > 120 ? oldStr.slice(0, 120) + '…' : oldStr;
      throw new Error(`patchFile: oldStr not found in ${name}/${path}. Searched for: ${preview}`);
    }
    const patched = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    await this.writeFile(name, path, patched);
  }

  async listFolder(name: string, path?: string): Promise<{ name: string; type: string; url: AutomergeUrl }[]> {
    const entry = this.findEntry(name);
    const targetPath = path || '';

    const resolved = await this.resolvePathInFolder(entry.url, targetPath);
    if (!resolved) throw new Error(`Directory not found: ${name}/${targetPath}`);

    const doc = resolved.handle.doc() as FolderDoc | null;
    if (!doc?.docs) throw new Error(`Not a directory: ${name}/${targetPath}`);

    return doc.docs.map((d) => ({
      name: d.name,
      type: d.type,
      url: this.resolveOverlayUrl(d.url),
    }));
  }

  async createFolder(name: string, path: string): Promise<void> {
    const entry = this.findEntry(name);
    const resolved = await this.resolvePathInFolder(entry.url, path);
    if (resolved) return; // Already exists

    const parts = path.split('/').filter((p) => p.length > 0);
    const folderName = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const parentWritable = parentPath
      ? await this.getDeepWritableHandle(entry.url, parentPath)
      : await this.getWritableHandle(entry.url);

    const folderHandle = this.repo.create<any>();
    folderHandle.change((doc: any) => {
      doc['@patchwork'] = { type: 'folder' };
      doc.title = folderName;
      doc.docs = [];
    });

    parentWritable.change((doc: any) => {
      if (!doc.docs) doc.docs = [];
      doc.docs.push({ url: folderHandle.url, name: folderName, type: 'folder' });
    });
  }

  // --- Public API: tool-specific shortcuts ---

  async readToolSource(name: string): Promise<string> {
    const entry = this.findEntry(name);
    if (entry.type !== 'tool') {
      throw new Error(`"${name}" is not a tool entry`);
    }
    return this.readFile(name, entry.path);
  }

  // --- Public API: snapshot ---

  /**
   * Snapshot a document: returns the URL with current heads baked in.
   * This is a cheap point-in-time reference -- no cloning needed.
   */
  async snapshot(name: string): Promise<AutomergeUrl> {
    const entry = this.findEntry(name);
    const effectiveUrl = this.resolveOverlayUrl(entry.url);
    const handle = await this.repo.find(effectiveUrl);
    const heads = handle.heads();
    const { documentId } = parseAutomergeUrl(effectiveUrl);
    return stringifyAutomergeUrl({ documentId, heads });
  }

  /**
   * Snapshot a folder: recursively create a fixed version where each sub-doc
   * is cloned and intermediate folder docs are cloned to point to the clones.
   * Returns the URL of the new root folder clone.
   */
  async snapshotFolder(name: string): Promise<AutomergeUrl> {
    const entry = this.findEntry(name);
    const effectiveUrl = this.resolveOverlayUrl(entry.url);
    return this.deepSnapshotFolder(effectiveUrl);
  }

  private async deepSnapshotFolder(folderUrl: AutomergeUrl): Promise<AutomergeUrl> {
    const handle = await this.repo.find<FolderDoc>(folderUrl);
    const doc = handle.doc();
    if (!doc?.docs) {
      // Not a folder, just clone
      const clone = this.repo.clone(handle);
      return clone.url;
    }

    // Clone child docs/folders recursively
    const clonedDocs: DocLink[] = [];
    for (const child of doc.docs) {
      const childEffective = this.resolveOverlayUrl(child.url);
      const childHandle = await this.repo.find<FolderDoc>(childEffective);
      const childDoc = childHandle.doc();

      let clonedUrl: AutomergeUrl;
      if (childDoc && (childDoc as any).docs) {
        clonedUrl = await this.deepSnapshotFolder(childEffective);
      } else {
        const clone = this.repo.clone(childHandle);
        clonedUrl = clone.url;
      }

      clonedDocs.push({ name: child.name, type: child.type, url: clonedUrl });
    }

    // Create a new folder pointing to cloned children
    const newFolder = this.repo.create<any>();
    newFolder.change((d: any) => {
      d['@patchwork'] = { type: 'folder' };
      d.title = (doc as any).title || '';
      d.docs = clonedDocs;
    });

    return newFolder.url;
  }

  // --- Public API: doc handle access ---

  async createOrGetDocHandle(name: string, path?: string): Promise<DocHandle<any>> {
    const entry = this.findEntry(name);
    if (path) {
      return this.getDeepWritableHandle(entry.url, path);
    }
    return this.getWritableHandle(entry.url);
  }

  async getDocUrl(name: string): Promise<AutomergeUrl> {
    const entry = this.findEntry(name);
    return entry.url;
  }

  async importModule(name: string, path: string): Promise<any> {
    const entry = this.findEntry(name);
    const effectiveUrl = this.resolveOverlayUrl(entry.url);
    return import(`/${effectiveUrl}/${path}`);
  }
}

function extractContent(doc: any): string {
  const content = doc.content;
  if (content !== undefined) {
    if (typeof content === 'string') return content;
    if (content instanceof Uint8Array) return new TextDecoder().decode(content);
    return String(content);
  }
  return JSON.stringify(doc, null, 2);
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
