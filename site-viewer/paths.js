// Paths
// Turning a document URL and a path inside it into somewhere the browser can go, and back.
//
// Patchwork's service worker traps same-origin requests whose first path segment is itself a
// URL: /automerge%3Aabc/sub/page.html is the file "sub/page.html" inside that document. All of
// this file is that encoding, kept separate from the DOM so it can be tested on its own.
//
// One wrinkle shows up everywhere below. Asking for a document by its bare URL gets a 307 to
// the same URL with its current heads pinned on — automerge:abc becomes automerge:abc#<heads>
// — so the address the iframe ends up at is never the one it was given, and the heads move
// every time the document changes. Reading a location therefore has to cope with both forms,
// and getting fresh content means going back to the bare URL and letting it re-pin.

/** The bare document URL, with any pinned heads removed. */
export const withoutHeads = (url) => String(url).split("#")[0];

/** Where the service worker serves `subpath` of the document at `url`. */
export const servedAt = (url, subpath = "index.html") => {
  const segments = String(subpath)
    .split("/")
    .filter((s) => s !== "")
    .map(encodeURIComponent);
  return "/" + encodeURIComponent(url) + (segments.length ? "/" + segments.join("/") : "");
};

/**
 * Split a served location back into the document and the path inside it.
 * Returns null for anything that is not one of ours — an about:blank iframe, say.
 */
export const splitServed = (pathname) => {
  const [first, ...rest] = String(pathname).replace(/^\//, "").split("/");
  if (!first) return null;
  let url;
  try {
    url = decodeURIComponent(first);
  } catch {
    return null;
  }
  if (!url.startsWith("automerge:")) return null;
  return { url, subpath: rest.map(decodeURIComponent).join("/") };
};

// Keys a document carries about itself rather than about its contents. pushwork writes
// lastSyncAt on a root document to say a sync finished; listing it as a file is how this was
// noticed, in a message that told someone their repo contained a file called "lastSyncAt".
const NOT_A_FILE = new Set(["lastSyncAt", "title", "@patchwork"]);

/**
 * The top-level names in a document full of files, whichever shape it uses: a directory doc
 * keys files by path, a folder doc lists a document per entry. Used only to say what is in
 * there when the site has no index.html to open.
 */
export const topLevelNames = (doc) => {
  if (!doc || typeof doc !== "object") return [];
  if (Array.isArray(doc.docs)) return doc.docs.map((d) => d?.name).filter(Boolean).sort();
  const names = new Set();
  for (const key of Object.keys(doc)) {
    if (key.startsWith("@") || NOT_A_FILE.has(key)) continue;
    names.add(key.split("/")[0]);
  }
  return [...names].sort();
};

/**
 * Where a host wants this viewer to start, if it said.
 *
 * A tool embedding this one via `<patchwork-view tool-id="site-viewer">` has no way to pass
 * arguments, so `data-path` on that element is the convention: cakewalk-build sets it to the
 * page for the file being edited. Reading an attribute rather than requiring a shared module
 * keeps the two tools late-bound — neither depends on the other, and the attribute is simply
 * absent when nobody sets it.
 */
export function requestedPath(element) {
  const host = element?.closest?.("patchwork-view") ?? element;
  const path = host?.getAttribute?.("data-path");
  return path ? path.replace(/^\/+/, "") : undefined;
}

/**
 * Where the site lives inside this document, as a path prefix ("" when it is at the root).
 *
 * A built site has index.html at its root. A pushworked *repo* does not — its site is under
 * `public/`, because that is where `site build` and the Patchwork builder both write it. Both
 * are the same automerge type, so the only way to tell is to look.
 *
 * This works at all because the build emits relative URLs: a page served from
 * `/<url>/public/index.html` resolves `../static/base.css` to `/<url>/public/static/base.css`.
 * Mounting a site at a depth would be impossible if its paths were root-relative.
 *
 * Returns undefined when there is no index.html anywhere, which is how the viewer knows to show
 * the document's contents instead of a blank frame.
 */
export function siteRootIn(doc) {
  if (!doc || typeof doc !== "object") return undefined;

  const paths = Array.isArray(doc.docs)
    ? doc.docs.map((d) => d?.name).filter(Boolean)
    : Object.keys(doc).filter((k) => !k.startsWith("@") && !NOT_A_FILE.has(k));

  if (paths.includes("index.html")) return "";

  // A repo keeps its site where the CLI put it. Prefer that over guessing.
  const named = ["public", "dist", "_site", "build"].find((dir) =>
    paths.some((p) => p === dir || p.startsWith(dir + "/"))
  );
  if (named && (Array.isArray(doc.docs) || paths.includes(`${named}/index.html`))) return named;

  // Otherwise the shallowest index.html wins, if there is exactly one at that depth.
  const indexes = paths.filter((p) => p.endsWith("/index.html"));
  if (!indexes.length) return undefined;
  const depth = (p) => p.split("/").length;
  const shallowest = Math.min(...indexes.map(depth));
  const candidates = indexes.filter((p) => depth(p) === shallowest);
  if (candidates.length !== 1) return undefined;
  return candidates[0].slice(0, -"/index.html".length);
}
