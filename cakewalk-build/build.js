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

/**
 * Walk a pushwork folder document into a flat map of path → file.
 *
 * A folder doc lists a document per entry ({name, url}); a directory is an entry whose document
 * has its own `docs`. Binary files keep their source document's URL alongside the bytes — see
 * outputEntries() for what that is for.
 */
export async function collectSources(repo, rootUrl, { skip = SKIP } = {}) {
  const sources = {};
  const origins = new Map();

  const root = (await repo.find(rootUrl)).doc();
  if (!Array.isArray(root?.docs)) {
    // pushwork writes one of two document shapes, and `init` defaults to the one this does not
    // read. Reported from real use: against a vfs repo the walk found nothing, returned {}, and
    // the build cheerfully produced a sitemap and an empty feed — two files, no error. A repo
    // this cannot read has to say so.
    throw new Error(
      `That document is not a pushwork folder repo. It has ${describeShape(root)}, ` +
        `and this tool reads the "patchwork-folder" shape — a document per entry, listed in \`docs\`. ` +
        `Re-run pushwork with \`--shape patchwork-folder\`, which is not the default.`
    );
  }

  const walk = async (url, prefix) => {
    const handle = await repo.find(url);
    const doc = handle.doc();
    if (!Array.isArray(doc?.docs)) return;

    await Promise.all(
      doc.docs.map(async (link) => {
        if (!link?.name || !link.url) return;
        if (!prefix && skip.has(link.name)) return;
        const path = prefix ? `${prefix}/${link.name}` : link.name;

        const child = await repo.find(link.url);
        const childDoc = child.doc();
        if (Array.isArray(childDoc?.docs)) return walk(link.url, path);
        if (!childDoc || !("content" in childDoc)) return;

        // Automerge hands text back as an ImmutableString, which is not a string.
        const raw = childDoc.content;
        const content = raw instanceof Uint8Array ? raw : String(raw);
        sources[path] = { content };
        if (raw instanceof Uint8Array) origins.set(raw, link.url);
      })
    );
  };

  await walk(rootUrl, "");

  // A repo with no pages in it builds to a sitemap and an empty feed rather than failing, which
  // looks like a working build of nothing. Say what was read, and refuse the obvious mistake.
  if (!Object.keys(sources).some((path) => path.startsWith("content/"))) {
    throw new Error(
      `Read ${Object.keys(sources).length} files from that repo, but none under content/. ` +
        `A CakeWalk site keeps its pages there, so there is nothing to build.`
    );
  }

  return { sources, origins };
}

/** A short description of what a document looks like, for an error message. */
function describeShape(doc) {
  if (!doc || typeof doc !== "object") return "no content at all";
  const keys = Object.keys(doc).filter((k) => !k.startsWith("@"));
  if (doc["@patchwork"]?.type === "directory") return `the "vfs" shape (a directory document keyed by name: ${keys.slice(0, 4).join(", ")}…)`;
  return `keys ${keys.slice(0, 4).join(", ")}…`;
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
export function outputEntries(files, origins) {
  const entries = {};
  for (const [path, file] of Object.entries(files)) {
    const origin = file.content instanceof Uint8Array ? origins.get(file.content) : undefined;
    entries[path] = origin ?? { content: file.content, mimeType: mimeTypeFor(path) };
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
  if (!a || typeof a !== "object" || typeof a.content !== typeof b.content) return false;
  if (a.mimeType !== b.mimeType) return false;
  return sameContent(a.content, b.content);
};

const sameContent = (a, b) => {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return String(a) === String(b);
};
