import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import type { DocLink, FolderDoc, UnixFileEntry } from "@inkandswitch/patchwork-filesystem";
import { updateText } from "@automerge/automerge-repo";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";

function splitPath(relativePath: string): string[] {
  return String(relativePath).split("/").filter(Boolean);
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i + 1).toLowerCase();
}

function mimeFromExtension(ext: string): string {
  if (!ext) return "text/plain";
  const m: Record<string, string> = {
    md: "text/markdown",
    js: "text/javascript",
    mjs: "text/javascript",
    cjs: "text/javascript",
    ts: "text/typescript",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    svg: "image/svg+xml",
    xml: "application/xml",
    txt: "text/plain",
  };
  return m[ext] || "text/plain";
}

export type Filesystem = {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path?: string): Promise<DocLink[]>;
  /** All entries in a folder (files and subfolders). */
  listEntries(path?: string): Promise<DocLink[]>;
  importFile(path: string): Promise<unknown>;
  getUrlOfFile(path?: string): string;
  /** Watch files matching a glob pattern. Calls `fn` on initial match and whenever the matched set or file contents change. */
  watch(pattern: string, fn: (matches: string[]) => void): () => void;
};

function isFolderDoc(d: unknown): d is FolderDoc {
  return typeof d === "object" && d !== null && "docs" in d;
}

async function findFileHandleInFolderHandle(
  repo: Repo,
  folder: DocHandle<FolderDoc>,
  parts: string[],
): Promise<DocHandle<unknown> | null> {
  let current: DocHandle<FolderDoc> = folder;
  for (let i = 0; i < parts.length; i++) {
    const doc = current.doc();
    if (!doc?.docs) return null;
    const link = doc.docs.find((d) => d.name === parts[i]);
    if (!link) return null;
    const handle = await repo.find(link.url as AutomergeUrl);
    if (typeof handle.whenReady === "function") await handle.whenReady();
    if (i < parts.length - 1) {
      const inner = handle.doc();
      if (!isFolderDoc(inner)) return null;
      current = handle as unknown as DocHandle<FolderDoc>;
    } else {
      return handle as DocHandle<unknown>;
    }
  }
  return current as unknown as DocHandle<unknown>;
}

export function createFilesystem(repo: Repo, rootFolderUrl: AutomergeUrl): Filesystem {
  let rootPromise: Promise<DocHandle<FolderDoc>> | null = null;

  function rootFolder(): Promise<DocHandle<FolderDoc>> {
    if (!rootPromise) rootPromise = repo.find(rootFolderUrl) as Promise<DocHandle<FolderDoc>>;
    return rootPromise;
  }

  async function resolveFolderByParts(parts: string[]): Promise<DocHandle<FolderDoc>> {
    const folder = await rootFolder();
    if (!parts.length) return folder;
    const handle = await findFileHandleInFolderHandle(repo, folder, parts);
    if (!handle) throw new Error(`${parts.join("/")}: No such file or directory`);
    const doc = handle.doc();
    if (!isFolderDoc(doc)) {
      throw new Error(`${parts.join("/")}: Not a directory`);
    }
    return handle as unknown as DocHandle<FolderDoc>;
  }

  async function resolvePath(relativePath: string): Promise<DocHandle<unknown>> {
    const parts = splitPath(relativePath);
    const folder = await rootFolder();
    if (!parts.length) return folder;
    const handle = await findFileHandleInFolderHandle(repo, folder, parts);
    if (!handle) throw new Error(`${relativePath}: No such file or directory`);
    return handle;
  }

  function buildFetchUrl(relativePath = ""): string {
    const baseHref = new URL(automergeUrlToServiceWorkerUrl(rootFolderUrl), window.location.origin)
      .href;
    if (!relativePath || !String(relativePath).trim()) return baseHref;
    const suffix = splitPath(relativePath).map(encodeURIComponent).join("/");
    return new URL(suffix, baseHref).href;
  }

  return {
    async readFile(path: string): Promise<string> {
      const h = await resolvePath(path);
      const doc = h.doc();
      if (isFolderDoc(doc)) {
        throw new Error(`readFile: ${path}: is a directory`);
      }
      const c = (doc as UnixFileEntry).content;
      if (typeof c === "string") return c;
      if (c instanceof Uint8Array) return new TextDecoder("utf-8").decode(c);
      if (c != null && typeof (c as { toString(): string }).toString === "function") {
        return (c as { toString(): string }).toString();
      }
      return String(c);
    },

    async writeFile(path: string, content: string): Promise<void> {
      const text = String(content);
      const parts = splitPath(path);
      if (!parts.length) throw new Error("writeFile: path must include a file name");
      const name = parts[parts.length - 1]!;
      const parentParts = parts.slice(0, -1);
      const parentFolder = await resolveFolderByParts(parentParts);
      const parentDoc = parentFolder.doc();
      const link = parentDoc.docs?.find((d) => d.name === name);

      if (link) {
        const fileHandle = await repo.find(link.url);
        if (typeof fileHandle.whenReady === "function") await fileHandle.whenReady();
        const doc = fileHandle.doc();
        if (isFolderDoc(doc)) {
          throw new Error(`writeFile: ${path}: is a directory`);
        }
        const cur = (doc as UnixFileEntry).content;
        if (typeof cur !== "string") {
          throw new Error(`writeFile: ${path}: content is not text (use string Automerge text)`);
        }
        fileHandle.change((d) => {
          updateText(d as UnixFileEntry, ["content"], text);
        });
        parentFolder.change((folder) => {
          const idx = folder.docs.findIndex((e) => e.name === name);
          if (idx !== -1) folder.docs[idx].url = fileHandle.url;
        });
        return;
      }

      const newHandle = repo.create();
      newHandle.change((d) => {
        const u = d as UnixFileEntry & Record<string, unknown>;
        u.content = text;
        u.name = name;
        u.extension = extensionOf(name);
        u.mimeType = mimeFromExtension(String(u.extension));
        u["@patchwork"] = { type: "file" };
      });
      parentFolder.change((folder) => {
        if (!folder.docs) folder.docs = [];
        folder.docs.push({
          name,
          type: "file",
          url: newHandle.url,
        });
      });
    },

    async listFiles(path = ""): Promise<DocLink[]> {
      const h = path.trim() === "" ? await rootFolder() : await resolvePath(path);
      const doc = h.doc();
      if (!isFolderDoc(doc)) {
        throw new Error(`listFiles: ${path || "."}: not a folder`);
      }
      return doc.docs.filter((link) => link.type !== "folder");
    },

    async listEntries(path = ""): Promise<DocLink[]> {
      const h = path.trim() === "" ? await rootFolder() : await resolvePath(path);
      const doc = h.doc();
      if (!isFolderDoc(doc)) {
        throw new Error(`listEntries: ${path || "."}: not a folder`);
      }
      return doc.docs ?? [];
    },

    async importFile(path: string): Promise<unknown> {
      const url = buildFetchUrl(path);
      return import(/* @vite-ignore */ url);
    },

    getUrlOfFile(path?: string): string {
      return buildFetchUrl(path);
    },

    watch(pattern: string, fn: (matches: string[]) => void): () => void {
      let disposed = false;
      let rebuildScheduled = false;
      let initialized = false;
      const folderWatchers = new Map<string, () => void>();
      const fileWatchers = new Map<string, () => void>();
      let lastMatchedPaths: string[] = [];

      function scheduleRebuild(): void {
        if (disposed || rebuildScheduled) return;
        rebuildScheduled = true;
        queueMicrotask(() => {
          rebuildScheduled = false;
          if (disposed) return;
          void rebuild();
        });
      }

      function notifyFileChanged(): void {
        if (disposed) return;
        fn(lastMatchedPaths);
      }

      async function rebuild(): Promise<void> {
        if (disposed) return;
        const root = await rootFolder();
        if (disposed) return;

        const discoveredFolders = new Map<string, DocHandle<FolderDoc>>();
        const discoveredFiles = new Map<string, string>();
        await walkForWatch(repo, root, "", discoveredFolders, discoveredFiles);
        if (disposed) return;

        reconcileFolderWatchers(discoveredFolders, folderWatchers, scheduleRebuild);

        const allPaths = Array.from(discoveredFiles.keys());
        const matchedPaths = matchGlob(allPaths, pattern).sort();

        await reconcileFileWatchers(
          repo,
          matchedPaths,
          discoveredFiles,
          fileWatchers,
          notifyFileChanged,
          () => disposed,
        );
        if (disposed) return;

        if (!initialized || !pathListsEqual(lastMatchedPaths, matchedPaths)) {
          initialized = true;
          lastMatchedPaths = matchedPaths;
          fn(matchedPaths);
        } else {
          lastMatchedPaths = matchedPaths;
        }
      }

      scheduleRebuild();

      return () => {
        disposed = true;
        for (const cleanup of folderWatchers.values()) cleanup();
        for (const cleanup of fileWatchers.values()) cleanup();
        folderWatchers.clear();
        fileWatchers.clear();
      };
    },
  };
}

async function walkForWatch(
  repo: Repo,
  folder: DocHandle<FolderDoc>,
  prefix: string,
  folders: Map<string, DocHandle<FolderDoc>>,
  files: Map<string, string>,
): Promise<void> {
  folders.set(prefix, folder);
  const doc = folder.doc();
  if (!doc?.docs) return;

  for (const link of doc.docs) {
    const childPath = prefix ? `${prefix}/${link.name}` : link.name;
    if (link.type === "folder") {
      try {
        const handle = await repo.find(link.url as AutomergeUrl);
        if (typeof handle.whenReady === "function") await handle.whenReady();
        const childDoc = handle.doc();
        if (isFolderDoc(childDoc)) {
          await walkForWatch(
            repo,
            handle as unknown as DocHandle<FolderDoc>,
            childPath,
            folders,
            files,
          );
        }
      } catch {
        // skip inaccessible folders
      }
    } else {
      files.set(childPath, link.url);
    }
  }
}

function reconcileFolderWatchers(
  discovered: Map<string, DocHandle<FolderDoc>>,
  watchers: Map<string, () => void>,
  onFolderChange: () => void,
): void {
  for (const [path, cleanup] of watchers) {
    if (!discovered.has(path)) {
      cleanup();
      watchers.delete(path);
    }
  }
  for (const [path, handle] of discovered) {
    if (!watchers.has(path)) {
      const handler = () => onFolderChange();
      handle.on("change", handler);
      watchers.set(path, () => handle.off("change", handler));
    }
  }
}

async function reconcileFileWatchers(
  repo: Repo,
  matchedPaths: string[],
  discoveredFiles: Map<string, string>,
  watchers: Map<string, () => void>,
  onFileChange: () => void,
  isDisposed: () => boolean,
): Promise<void> {
  const matchedSet = new Set(matchedPaths);
  for (const [path, cleanup] of watchers) {
    if (!matchedSet.has(path)) {
      cleanup();
      watchers.delete(path);
    }
  }
  for (const path of matchedPaths) {
    if (watchers.has(path)) continue;
    const url = discoveredFiles.get(path);
    if (!url) continue;
    try {
      const handle = await repo.find(url as AutomergeUrl);
      if (isDisposed()) return;
      const handler = () => onFileChange();
      handle.on("change", handler);
      watchers.set(path, () => handle.off("change", handler));
    } catch {
      // file may be inaccessible
    }
  }
}

function pathListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Minimal glob matcher for patterns like `** /name`, `prefix/** /name`, or exact paths.
 * Supports `**` as a recursive wildcard segment only.
 */
function matchGlob(paths: string[], pattern: string): string[] {
  if (!pattern.includes("*")) {
    return paths.filter((p) => p === pattern);
  }
  const segments = pattern.split("/");
  const test = buildGlobTest(segments);
  return paths.filter(test);
}

function buildGlobTest(patternSegments: string[]): (path: string) => boolean {
  const doubleStarIndex = patternSegments.indexOf("**");
  if (doubleStarIndex === -1) {
    return (path) => {
      const parts = path.split("/");
      if (parts.length !== patternSegments.length) return false;
      return patternSegments.every((seg, i) => seg === "*" || seg === parts[i]);
    };
  }

  const prefix = patternSegments.slice(0, doubleStarIndex);
  const suffix = patternSegments.slice(doubleStarIndex + 1);

  return (path) => {
    const parts = path.split("/");
    if (parts.length < prefix.length + suffix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== "*" && prefix[i] !== parts[i]) return false;
    }
    for (let i = 0; i < suffix.length; i++) {
      const partIndex = parts.length - suffix.length + i;
      if (suffix[i] !== "*" && suffix[i] !== parts[partIndex]) return false;
    }
    return true;
  };
}
