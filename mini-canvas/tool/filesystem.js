import {
  automergeUrlToServiceWorkerUrl,
  findFileHandleInFolderHandle,
} from '@inkandswitch/patchwork-filesystem';
import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  updateText,
} from '@automerge/automerge-repo';

/** @param {string} relativePath */
function splitPath(relativePath) {
  return String(relativePath).split('/').filter(Boolean);
}

/** @param {import('@automerge/automerge-repo').DocHandle<any>} handle */
function withHeads(handle) {
  const { documentId } = parseAutomergeUrl(handle.url);
  return stringifyAutomergeUrl({ documentId, heads: handle.heads() });
}

/** @param {import('@automerge/automerge-repo').AutomergeUrl} automergeUrl */
function stripHeads(automergeUrl) {
  const { documentId } = parseAutomergeUrl(automergeUrl);
  return stringifyAutomergeUrl({ documentId });
}

/** @param {string} filename */
function extensionOf(filename) {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

/** @param {string} ext */
function mimeFromExtension(ext) {
  if (!ext) return 'text/plain';
  const m = {
    md: 'text/markdown',
    js: 'text/javascript',
    mjs: 'text/javascript',
    cjs: 'text/javascript',
    ts: 'text/typescript',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    svg: 'image/svg+xml',
    xml: 'application/xml',
    txt: 'text/plain',
  };
  return m[ext] || 'text/plain';
}

/**
 * @param {import('@automerge/automerge-repo').Repo} repo
 * @param {import('@automerge/automerge-repo').AutomergeUrl} rootFolderUrl
 */
export function createFilesystem(repo, rootFolderUrl) {
  /** @type {Promise<import('@automerge/automerge-repo').DocHandle<import('@inkandswitch/patchwork-filesystem').FolderDoc>> | null} */
  let rootPromise = null;

  function rootFolder() {
    if (!rootPromise) rootPromise = repo.find(rootFolderUrl);
    return rootPromise;
  }

  /** @param {string[]} parts path segments from root; empty = root folder handle */
  async function resolveFolderByParts(parts) {
    const folder = await rootFolder();
    if (!parts.length) return folder;
    const handle = await findFileHandleInFolderHandle(repo, folder, parts);
    if (!handle) throw new Error(`${parts.join('/')}: No such file or directory`);
    const doc = handle.doc();
    if (!('docs' in doc)) {
      throw new Error(`${parts.join('/')}: Not a directory`);
    }
    return handle;
  }

  /** @param {string} relativePath full path to file or folder from root */
  async function resolvePath(relativePath) {
    const parts = splitPath(relativePath);
    const folder = await rootFolder();
    if (!parts.length) return folder;
    const handle = await findFileHandleInFolderHandle(repo, folder, parts);
    if (!handle) throw new Error(`${relativePath}: No such file or directory`);
    return handle;
  }

  function buildFetchUrl(relativePath = '') {
    const baseHref = new URL(automergeUrlToServiceWorkerUrl(rootFolderUrl), window.location.origin)
      .href;
    if (!relativePath || !String(relativePath).trim()) return baseHref;
    const suffix = splitPath(relativePath).map(encodeURIComponent).join('/');
    return new URL(suffix, baseHref).href;
  }

  return {
    /**
     * Read file contents as a string (UTF-8 for byte content).
     * @param {string} path
     */
    async readFile(path) {
      const h = await resolvePath(path);
      const doc = h.doc();
      if ('docs' in doc) {
        throw new Error(`readFile: ${path}: is a directory`);
      }
      const c = doc.content;
      if (typeof c === 'string') return c;
      if (c instanceof Uint8Array) return new TextDecoder('utf-8').decode(c);
      if (c != null && typeof c.toString === 'function') return c.toString();
      return String(c);
    },

    /**
     * Write text to a file. Creates a `file` Patchwork entry if missing.
     * Replaces existing text with {@link updateText} on `content` when it is a string field.
     * @param {string} path
     * @param {string} content
     */
    async writeFile(path, content) {
      const text = String(content);
      const parts = splitPath(path);
      if (!parts.length) throw new Error('writeFile: path must include a file name');
      const name = parts[parts.length - 1];
      const parentParts = parts.slice(0, -1);
      const parentFolder = await resolveFolderByParts(parentParts);
      const parentDoc = parentFolder.doc();
      const link = parentDoc.docs?.find((d) => d.name === name);

      if (link) {
        const fileHandle = await repo.find(stripHeads(link.url));
        if (typeof fileHandle.whenReady === 'function') await fileHandle.whenReady();
        const doc = fileHandle.doc();
        if ('docs' in doc) {
          throw new Error(`writeFile: ${path}: is a directory`);
        }
        const cur = doc.content;
        if (typeof cur !== 'string') {
          throw new Error(`writeFile: ${path}: content is not text (use string Automerge text)`);
        }
        fileHandle.change((d) => {
          updateText(d, ['content'], text);
        });
        parentFolder.change((folder) => {
          const idx = folder.docs.findIndex((e) => e.name === name);
          if (idx !== -1) folder.docs[idx].url = withHeads(fileHandle);
        });
        return;
      }

      const newHandle = repo.create();
      newHandle.change((d) => {
        d.content = text;
        d.name = name;
        d.extension = extensionOf(name);
        d.mimeType = mimeFromExtension(d.extension);
        d['@patchwork'] = { type: 'file' };
      });
      parentFolder.change((folder) => {
        if (!folder.docs) folder.docs = [];
        folder.docs.push({
          name,
          type: 'file',
          url: withHeads(newHandle),
        });
      });
    },

    /**
     * List file entries in a folder (excludes subfolders). Throws if `path` is not a directory.
     * @param {string} [path] empty = system root
     * @returns {Promise<import('@inkandswitch/patchwork-filesystem').DocLink[]>}
     */
    async listFiles(path = '') {
      const h =
        path.trim() === '' ? await rootFolder() : await resolvePath(path);
      const doc = h.doc();
      if (!('docs' in doc)) {
        throw new Error(`listFiles: ${path || '.'}: not a folder`);
      }
      return doc.docs.filter((link) => link.type !== 'folder');
    },

    /**
     * Dynamic `import()` of a module under this folder (Patchwork / service-worker URL, same idea as `/${encodeURIComponent(automergeUrl)}/…`).
     * @param {string} path relative path to the module file
     */
    async importFile(path) {
      const url = buildFetchUrl(path);
      return import(/* @vite-ignore */ url);
    },

    /**
     * Handoff-style URL for a path under this folder (service worker / fetch).
     * @param {string} [path]
     */
    getUrlOfFile(path) {
      return buildFetchUrl(path);
    },
  };
}
