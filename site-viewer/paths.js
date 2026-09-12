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
