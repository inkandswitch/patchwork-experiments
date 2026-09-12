// Build
// Reading a repo out of Automerge, running its own build system over it, and writing the result
// back into a document. No DOM in here, so the parts worth testing can be.

/** Directories a repo has that a build has no use for. */
export const SKIP = new Set(["node_modules", ".git", ".pushwork", "dist", "public", "public-memory", ".cache"]);

const MIME = {
  html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", xml: "application/xml", txt: "text/plain", md: "text/markdown",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", pdf: "application/pdf",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  webmanifest: "application/manifest+json",
};

/** The content type to serve a built file as, from its extension. */
export const mimeTypeFor = (path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // "_headers" and "CNAME" have no extension and are read as text by whatever consumes them.
  if (dot <= 0) return "text/plain";
  return MIME[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
};

// Keys a repo document carries about itself rather than about its contents.
const RESERVED = new Set(["@patchwork", "lastSyncAt", "title"]);

/**
 * Which of pushwork's two shapes is this, if either?
 *
 * `patchwork-folder` is a document per directory, each listing its children in `docs`.
 * `vfs` — the default for `pushwork init` — is one root document whose keys are full
 * repo-relative paths and whose values are the URLs of the file documents. Both keep one
 * document per file; they differ only in how the structure is stored.
 */
export function repoShape(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (Array.isArray(doc.docs)) return "folder";
  if (doc["@patchwork"]?.type === "directory") return "vfs";
  return null;
}

/** What to call this repo. The two shapes keep their title in different places. */
export const repoTitle = (doc) => doc?.["@patchwork"]?.title ?? doc?.title ?? undefined;

/**
 * Read a repo out of Automerge into a flat map of path → file.
 *
 * Returns the sources, the origin of each binary file (see outputEntries), and an index from
 * file document URL back to its path — which is what lets a tool work out, given the document
 * someone is editing, which page of the site it becomes.
 */
export async function collectSources(repo, rootUrl, { skip = SKIP } = {}) {
  const root = (await repo.find(rootUrl)).doc();
  const shape = repoShape(root);
  if (!shape) {
    throw new Error(
      `That document is not a pushwork repo. It has ${describeShape(root)}, and this tool reads ` +
        `either shape pushwork writes: "vfs" (one document keyed by path) or "patchwork-folder" ` +
        `(a document per directory).`
    );
  }

  const sources = {};
  const origins = new Map();
  const index = new Map();

  const readFile = async (path, url) => {
    const doc = (await repo.find(url)).doc();
    if (!doc || !("content" in doc)) return;
    // Automerge hands text back as a string or an ImmutableString; only bytes stay bytes.
    const raw = doc.content;
    const content = raw instanceof Uint8Array ? raw : String(raw);
    sources[path] = { content };
    index.set(url, path);
    if (raw instanceof Uint8Array) origins.set(raw, url);
  };

  if (shape === "vfs") {
    // One document, keys are whole paths. Enumerating the repo is a single read.
    await Promise.all(
      Object.entries(root).map(([path, url]) => {
        if (RESERVED.has(path) || path.startsWith("@")) return;
        if (typeof url !== "string" || !url.startsWith("automerge:")) return;
        const segments = path.split("/").filter(Boolean);
        if (!segments.length || skip.has(segments[0])) return;
        return readFile(segments.join("/"), url);
      })
    );
  } else {
    const walk = async (url, prefix) => {
      const doc = (await repo.find(url)).doc();
      if (!Array.isArray(doc?.docs)) return;
      await Promise.all(
        doc.docs.map(async (link) => {
          if (!link?.name || !link.url) return;
          if (!prefix && skip.has(link.name)) return;
          const path = prefix ? `${prefix}/${link.name}` : link.name;
          const childDoc = (await repo.find(link.url)).doc();
          if (Array.isArray(childDoc?.docs)) return walk(link.url, path);
          return readFile(path, link.url);
        })
      );
    };
    await walk(rootUrl, "");
  }

  // A repo with no pages in it builds to a sitemap and an empty feed rather than failing, which
  // looks like a working build of nothing. Say what was read, and refuse the obvious mistake.
  if (!Object.keys(sources).some((path) => path.startsWith("content/"))) {
    throw new Error(
      `Read ${Object.keys(sources).length} files from that repo, but none under content/. ` +
        `A CakeWalk site keeps its pages there, so there is nothing to build.`
    );
  }

  return { sources, origins, index };
}

/** A short description of what a document looks like, for an error message. */
function describeShape(doc) {
  if (!doc || typeof doc !== "object") return "no content at all";
  const keys = Object.keys(doc).filter((k) => !k.startsWith("@"));
  return keys.length ? `keys ${keys.slice(0, 4).join(", ")}…` : "no keys";
}

/**
 * What to put in the output document for each built file.
 *
 * A built site is mostly bytes the build never looked at — images, video, fonts — which arrived
 * as source documents and were hardlinked through untouched. Those go in as their source
 * document's URL rather than as a second copy of the bytes: the resolver behind the service
 * worker follows an automerge URL wherever a file is expected, so it serves identically. For a
 * repo whose assets outweigh its prose (the Ink & Switch website is 150MB of them), that is the
 * difference between a document that works and one that does not.
 *
 * The link is by object identity, not by comparing bytes: the in-memory build aliases a
 * hardlinked file rather than copying it, so the array that comes out is the one that went in.
 */
export function outputEntries(files, origins, { immutable = (text) => text } = {}) {
  const entries = {};
  for (const [path, file] of Object.entries(files)) {
    const origin = file.content instanceof Uint8Array ? origins.get(file.content) : undefined;
    if (origin) {
      entries[path] = origin;
      continue;
    }
    // Generated text goes in as an ImmutableString rather than a plain string, because a plain
    // string in Automerge is a text CRDT — machinery for collaborative editing that built output
    // has no use for. pushwork draws the same line for its artifact directories. `immutable` is
    // injected so this module needs no Automerge dependency of its own.
    const content = typeof file.content === "string" ? immutable(file.content) : file.content;
    entries[path] = { content, mimeType: mimeTypeFor(path) };
  }
  return entries;
}

/**
 * The changes to turn `existing` into `entries` — what to write and what to drop.
 *
 * Writing every file on every build would work, and would put a full copy of the site into the
 * document's history each time. Only what moved is written.
 */
export function changesFor(existing, entries) {
  const set = {};
  for (const [path, entry] of Object.entries(entries)) {
    if (!same(existing?.[path], entry)) set[path] = entry;
  }
  const remove = Object.keys(existing ?? {}).filter(
    (path) => path !== "@patchwork" && !(path in entries)
  );
  return { set, remove };
}

const same = (a, b) => {
  if (typeof b === "string") return a === b; // a reference to a source document
  if (!a || typeof a !== "object" || typeof b !== "object") return false;
  if (a.mimeType !== b.mimeType) return false;
  return sameContent(a.content, b.content);
};

// Text may arrive as a string on one side and an ImmutableString on the other — they read the
// same and should compare the same, so that switching between them is not a whole-site rewrite
// on every build.
const sameContent = (a, b) => {
  const aBytes = a instanceof Uint8Array;
  const bBytes = b instanceof Uint8Array;
  if (aBytes !== bBytes) return false;
  if (!aBytes) return String(a) === String(b);
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * How many builds may write into one output document before it is replaced with a fresh one.
 *
 * Writing only what changed is the cheap thing to do — a one-page edit is one or two entries,
 * not a whole site — but every such write leaves a version behind in the document's history,
 * and nobody wants the built site's history. Replacing the document occasionally bounds that
 * without paying a full rewrite on every keystroke.
 *
 * Measured on the ARIA notebook: mutating in place costs ~0.3kb of history per rebuild, a fresh
 * document ~205kb written. At 50, the accumulated history stays well under a tenth of the
 * document, and a full rewrite happens about once per editing session rather than continuously.
 */
export const COMPACT_EVERY = 50;

/**
 * What the output document needs, given what was built and what it already holds.
 *
 *   skip    — nothing changed; do not touch the document at all
 *   update  — write only the entries that moved, into the document that exists
 *   replace — start a fresh document from the finished state, discarding the old history
 *
 * Pure, so the decision can be tested without a repo.
 */
export function planWrite({ existing, entries, buildsSinceFresh = 0, compactEvery = COMPACT_EVERY }) {
  if (!existing) return { action: "replace", set: entries, remove: [] };

  const { set, remove } = changesFor(existing, entries);
  if (!Object.keys(set).length && !remove.length) return { action: "skip", set: {}, remove: [] };

  if (buildsSinceFresh >= compactEvery) return { action: "replace", set: entries, remove: [] };
  return { action: "update", set, remove };
}
