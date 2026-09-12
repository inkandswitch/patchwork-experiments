// Build
// Reading a repo out of Automerge, and shaping what its build system produced for writing back.
// No DOM in here, so the parts worth testing can be.

/** Directories a repo has that a build has no use for. */
export const SKIP = new Set(["node_modules", ".git", ".pushwork", "dist", "public", "public-memory", ".cache"]);

/** Keys a repo document carries about itself rather than about its contents. */
const RESERVED = new Set(["@patchwork", "lastSyncAt", "title"]);

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
 * Which of pushwork's two shapes is this, if either?
 *
 * `patchwork-folder` is a document per directory, each listing its children in `docs`. `vfs` —
 * the default for `pushwork init` — is one root document whose keys are full repo-relative paths
 * and whose values are the URLs of the file documents. Both keep one document per file; they
 * differ only in how the structure is stored.
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
 * Read a repo into one map: path → `{content, url}`.
 *
 * One map rather than several keyed different ways. Everything anyone needs is a view of it —
 * what to feed the build, which document a path came from, and which path a document is — and
 * a single structure cannot disagree with itself.
 */
export async function readRepo(repo, rootUrl, { skip = SKIP } = {}) {
  const root = (await repo.find(rootUrl)).doc();
  const shape = repoShape(root);
  if (!shape) {
    throw new Error(
      `That document is not a pushwork repo. It has ${describeShape(root)}, and this tool reads ` +
        `either shape pushwork writes: "vfs" (one document keyed by path) or "patchwork-folder" ` +
        `(a document per directory).`
    );
  }

  const files = new Map();

  const readFile = async (path, url) => {
    const doc = (await repo.find(url)).doc();
    if (!doc || !("content" in doc)) return;
    // Automerge hands text back as a string or an ImmutableString; only bytes stay bytes.
    const raw = doc.content;
    files.set(path, { content: raw instanceof Uint8Array ? raw : String(raw), url });
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
  if (![...files.keys()].some((path) => path.startsWith("content/"))) {
    throw new Error(
      `Read ${files.size} files from that repo, but none under content/. ` +
        `A CakeWalk site keeps its pages there, so there is nothing to build.`
    );
  }

  return { files, shape, title: repoTitle(root) };
}

/** A short description of what a document looks like, for an error message. */
function describeShape(doc) {
  if (!doc || typeof doc !== "object") return "no content at all";
  const keys = Object.keys(doc).filter((k) => !k.startsWith("@"));
  return keys.length ? `keys ${keys.slice(0, 4).join(", ")}…` : "no keys";
}

/** What the build wants: path → {content}. */
export const sourcesFrom = (files) => Object.fromEntries([...files].map(([path, f]) => [path, { content: f.content }]));

/** Which source path a document is — for working out which page someone is editing. */
export const pathsByDocument = (files) => new Map([...files].map(([path, f]) => [f.url, path]));

/**
 * What to put in the repo's `public/` for each built file — see site-doc.js, which writes it.
 *
 * A built site is mostly bytes the build never looked at: images, video, fonts, hardlinked
 * straight through. The build says so, per file, with `from` — the source path it was copied
 * from — and those stay as a reference to the source's document rather than becoming a second
 * copy of the bytes. `public/x.png` and `content/x.png` end up as two names for one document,
 * which is what the CLI's hardlink amounts to. For a repo whose assets outweigh its prose (the
 * Ink & Switch website is 150MB of them) that is the difference between a repo that works and
 * one that does not.
 *
 * Provenance comes from the build by path rather than being inferred from object identity. An
 * answer given by identity is only true inside one JavaScript heap; an answer given by path
 * survives a structured clone, a worker, or a document.
 */
export function outputEntries(built, documentFor, { immutable = (text) => text } = {}) {
  const entries = {};
  for (const [path, file] of Object.entries(built)) {
    const source = file.from ? documentFor(file.from) : undefined;
    if (source) {
      entries[path] = source;
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
