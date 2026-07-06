import {
  isImmutableString,
  isValidAutomergeUrl,
  updateText,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { DocLink, FolderDoc } from "../folder";
import type { CardDocLike } from "./types";

// The files-as-text API handed to the LLM's script blocks. It hides the two
// package shapes (a patchwork "folder" doc with a `docs` list, or a pushwork
// "directory" doc with flat path keys) behind plain read/write/edit-by-path,
// so generated scripts never touch folder or file doc internals.
export type Files = {
  // Every file path in the package, e.g. ["spec.md", "dist/card.js"].
  list(): Promise<string[]>;
  // A file's content as text. Throws for binary content.
  read(path: string): Promise<string>;
  // Create (linking a new file doc into the package) or overwrite.
  write(path: string, text: string): Promise<void>;
  // Exact string replacement; `oldText` must occur exactly once.
  edit(path: string, oldText: string, newText: string): Promise<void>;
};

// A pushwork file doc. `content` is a plain string for collaborative text,
// an ImmutableString for synced build artifacts, or bytes for binary files.
type FileDoc = {
  "@patchwork"?: { type: string };
  name: string;
  extension: string;
  mimeType: string;
  content: unknown;
};

// A pushwork vfs "directory" doc: flat full-path keys ("dist/card.js") mapped
// to automerge url strings (artifact entries carry a `#heads` suffix).
type DirectoryDoc = {
  "@patchwork": { type: string };
  lastSyncAt?: number;
  [path: string]: unknown;
};

export function createFilesApi(repo: Repo, packageUrl: AutomergeUrl): Files {
  return {
    async list() {
      return listPaths(repo, packageUrl, "");
    },

    async read(path) {
      const handle = await resolveFile(repo, packageUrl, path);
      if (!handle) throw new Error(`File not found: ${path}`);
      return textOf(handle.doc()?.content, path);
    },

    async write(path, text) {
      const existing = await resolveFile(repo, packageUrl, path);
      if (existing) {
        writeContent(existing, text);
      } else {
        await createFile(repo, packageUrl, path, text);
      }
      await bumpPackage(repo, packageUrl);
    },

    async edit(path, oldText, newText) {
      const handle = await resolveFile(repo, packageUrl, path);
      if (!handle) throw new Error(`File not found: ${path}`);
      const current = textOf(handle.doc()?.content, path);

      const matches = countOccurrences(current, oldText);
      if (matches === 0) {
        throw new Error(
          `edit failed: oldText not found in ${path}. Read the file again and retry with the exact current text.`,
        );
      }
      if (matches > 1) {
        throw new Error(
          `edit failed: oldText occurs ${matches} times in ${path}. Provide more surrounding context to make it unique.`,
        );
      }

      writeContent(handle, current.replace(oldText, newText));
      await bumpPackage(repo, packageUrl);
    },
  };
}

// The API for the one non-file edit a regeneration needs: pointing the card
// document's `src` at a package file. Wrapping it here keeps url-encoding and
// the card doc shape out of the LLM's hands. `sourceWasSet` lets the runner
// warn when a run rewrote files but never repointed the card (the module
// would not reload — dynamic imports are cached by URL).
export type Card = {
  setSource(path: string): void;
};

export function createCardApi(
  cardHandle: DocHandle<CardDocLike>,
  packageUrl: AutomergeUrl,
): { card: Card; sourceWasSet: () => boolean } {
  let set = false;
  return {
    card: {
      setSource(path: string) {
        const clean = normalizePath(path);
        cardHandle.change((d) => {
          d.src = `/${encodeURIComponent(packageUrl)}/${clean}`;
        });
        set = true;
      },
    },
    sourceWasSet: () => set,
  };
}

// --- path resolution over both package shapes --------------------------------

// The url a package entry points at, without any `#heads` pin — edits must land
// on the live document, not a pinned historical view.
function asEntryUrl(value: unknown): AutomergeUrl | undefined {
  if (typeof value !== "string") return undefined;
  const base = value.split("#")[0];
  return isValidAutomergeUrl(base) ? (base as AutomergeUrl) : undefined;
}

function isFolderShape(doc: unknown): doc is FolderDoc {
  return Array.isArray((doc as FolderDoc | undefined)?.docs);
}

function isDirectoryShape(doc: unknown): doc is DirectoryDoc {
  return (
    (doc as DirectoryDoc | undefined)?.["@patchwork"]?.type === "directory"
  );
}

// Path keys of a directory doc: everything except the metadata fields.
function directoryKeys(doc: DirectoryDoc): string[] {
  return Object.keys(doc).filter(
    (key) => key !== "@patchwork" && key !== "lastSyncAt",
  );
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

// Resolve a slash path to its file doc handle, following the same rules as the
// service worker: folder docs match one `docs[].name` segment at a time;
// directory docs match the longest joined-path prefix among their flat keys.
async function resolveFile(
  repo: Repo,
  rootUrl: AutomergeUrl,
  path: string,
): Promise<DocHandle<FileDoc> | null> {
  const segments = normalizePath(path).split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const url = await resolveEntry(repo, rootUrl, segments);
  return url ? await repo.find<FileDoc>(url) : null;
}

async function resolveEntry(
  repo: Repo,
  nodeUrl: AutomergeUrl,
  segments: string[],
): Promise<AutomergeUrl | null> {
  const handle = await repo.find(nodeUrl);
  const doc = handle.doc();

  if (isFolderShape(doc)) {
    const entry = doc.docs.find((link) => link.name === segments[0]);
    const url = asEntryUrl(entry?.url);
    if (!url) return null;
    return segments.length === 1 ? url : resolveEntry(repo, url, segments.slice(1));
  }

  if (isDirectoryShape(doc)) {
    for (let take = segments.length; take >= 1; take--) {
      const key = segments.slice(0, take).join("/");
      const url = asEntryUrl(doc[key]);
      if (!url) continue;
      return take === segments.length
        ? url
        : resolveEntry(repo, url, segments.slice(take));
    }
    return null;
  }

  return null;
}

// All file paths under a package node. Directory docs already carry full paths
// as flat keys; folder docs recurse one level per subfolder.
async function listPaths(
  repo: Repo,
  nodeUrl: AutomergeUrl,
  prefix: string,
): Promise<string[]> {
  const handle = await repo.find(nodeUrl);
  const doc = handle.doc();

  if (isDirectoryShape(doc)) {
    return directoryKeys(doc).map((key) => prefix + key);
  }

  if (isFolderShape(doc)) {
    const paths: string[] = [];
    for (const link of doc.docs) {
      const url = asEntryUrl(link.url);
      if (!url) continue;
      if (link.type === "folder") {
        paths.push(...(await listPaths(repo, url, `${prefix}${link.name}/`)));
      } else {
        paths.push(prefix + link.name);
      }
    }
    return paths;
  }

  return [];
}

// --- reading & writing file content -------------------------------------------

function textOf(content: unknown, path: string): string {
  if (typeof content === "string") return content;
  if (isImmutableString(content)) return String(content);
  throw new Error(`Cannot read ${path} as text (binary content).`);
}

// Overwrite a file doc's content. Plain-string content is diffed via
// updateText so the automerge history stays minimal; anything else (an
// ImmutableString artifact, bytes) is replaced wholesale with an editable
// plain string.
function writeContent(handle: DocHandle<FileDoc>, text: string): void {
  handle.change((d) => {
    if (typeof d.content === "string") {
      updateText(d, ["content"], text);
    } else {
      d.content = text;
    }
  });
}

// Create a new file doc and link it into the package. Directory-shaped
// packages take a flat path key on the root; folder-shaped packages get any
// missing subfolders minted along the way.
async function createFile(
  repo: Repo,
  rootUrl: AutomergeUrl,
  path: string,
  text: string,
): Promise<void> {
  const clean = normalizePath(path);
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("write requires a file path");
  const name = segments[segments.length - 1];

  const file = repo.create<FileDoc>({
    "@patchwork": { type: "file" },
    name,
    extension: extensionOf(name),
    mimeType: mimeTypeOf(name),
    content: text,
  });

  const rootHandle = await repo.find(rootUrl);
  const rootDoc = rootHandle.doc();

  if (isDirectoryShape(rootDoc)) {
    (rootHandle as DocHandle<DirectoryDoc>).change((d) => {
      d[clean] = file.url;
    });
    return;
  }

  if (isFolderShape(rootDoc)) {
    let parentUrl = rootUrl;
    for (const segment of segments.slice(0, -1)) {
      parentUrl = await ensureSubfolder(repo, parentUrl, segment);
    }
    const parent = await repo.find<FolderDoc>(parentUrl);
    parent.change((d) => {
      d.docs.push({ name, type: "file", url: file.url });
    });
    return;
  }

  throw new Error("Package root is neither a folder nor a directory doc.");
}

async function ensureSubfolder(
  repo: Repo,
  parentUrl: AutomergeUrl,
  name: string,
): Promise<AutomergeUrl> {
  const parent = await repo.find<FolderDoc>(parentUrl);
  const existing = parent.doc()?.docs.find((link: DocLink) => link.name === name);
  const existingUrl = asEntryUrl(existing?.url);
  if (existingUrl) return existingUrl;

  const folder = repo.create<FolderDoc>({
    "@patchwork": { type: "folder" },
    title: name,
    docs: [],
  });
  parent.change((d) => {
    d.docs.push({ name, type: "folder", url: folder.url });
  });
  return folder.url;
}

// Advance the package root's heads after a change so anything keyed off the
// folder version (service-worker caching) sees fresh content.
async function bumpPackage(repo: Repo, rootUrl: AutomergeUrl): Promise<void> {
  const handle = await repo.find<{ lastSyncAt?: number }>(rootUrl);
  handle.change((d) => {
    d.lastSyncAt = Date.now();
  });
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

const MIME_TYPES: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  json: "application/json",
  md: "text/markdown",
  css: "text/css",
  html: "text/html",
  svg: "image/svg+xml",
  txt: "text/plain",
};

function mimeTypeOf(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? "text/plain";
}
