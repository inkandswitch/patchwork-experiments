// A task's code is wherever its import URL says: anything `import()` takes.
//
// Two kinds matter here. A `data:` URL is the code itself, for work that
// lives nowhere else. And code kept in automerge is reached the way the site
// reaches it, through the service worker, whose URLs look like
//
//   https://patchwork.example/automerge%3A<package>%23<heads>/dist/task.js
//
// that is: a package's folder doc (at those heads, when it says which), then
// a path within it. `new URL("./task.js", import.meta.url)` in a package's own
// code makes one. This file reads such a URL, for the three things done with
// it: deciding whether a worker accepts code from that package (acceptance.ts
// has the rule), moving it to the origin a worker is actually on, and, where
// there is no service worker (src/node), fetching the files it names.

/** An import URL that names a file in a package kept in automerge. */
export interface AutomergeImport {
  /** The package's folder doc, as the URL names it: `automerge:<id>`, with `#<heads>` if it says. */
  docUrl: string;
  /** The package, whatever its version: `automerge:<id>`. */
  packageUrl: string;
  /** The heads it is pinned to, if it is. */
  heads: string | null;
  /** The file within the package: `dist/task.js`. */
  path: string;
  /** Anything after the path (`?retry=1`), kept as it was. */
  search: string;
}

const AUTOMERGE_DOC = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}(#[^/?#]+)?$/;

/**
 * Reads an import URL as a file in an automerge package, or null if it isn't
 * one. The origin is not looked at, nor needed: a URL without one
 * (`/automerge%3A…/dist/task.js`) reads the same, and means "on whatever site
 * this is".
 */
export function parseAutomergeImport(importUrl: string): AutomergeImport | null {
  let url: URL;
  try {
    url = new URL(importUrl, 'https://nowhere.invalid');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  const slash = url.pathname.indexOf('/', 1);
  if (slash < 0) {
    return null; // a package, but no file in it
  }
  let docUrl: string;
  try {
    docUrl = decodeURIComponent(url.pathname.slice(1, slash));
  } catch {
    return null;
  }
  const path = url.pathname.slice(slash + 1);
  if (!AUTOMERGE_DOC.test(docUrl) || !path) {
    return null;
  }
  const hash = docUrl.indexOf('#');
  return {
    docUrl,
    packageUrl: hash < 0 ? docUrl : docUrl.slice(0, hash),
    heads: hash < 0 ? null : docUrl.slice(hash + 1),
    path,
    search: url.search,
  };
}

/** The package an import URL's code is in (`automerge:<id>`), or null: a `data:` URL, or code from elsewhere. */
export function packageOf(importUrl: string): string | null {
  return parseAutomergeImport(importUrl)?.packageUrl ?? null;
}

/**
 * The same import, for a worker on `origin`. Code in automerge is served by
 * each site's own service worker, so a URL made on one site (or made with no
 * origin at all) is rewritten to this one's; anything else is left alone.
 */
export function onOrigin(importUrl: string, origin: string): string {
  const found = parseAutomergeImport(importUrl);
  if (!found) {
    return importUrl;
  }
  return `${origin}/${encodeURIComponent(found.docUrl)}/${found.path}${found.search}`;
}

/** The URL of `path` in the same package as `fromUrl` (a module's `import.meta.url`), with no origin; null if that isn't in a package. */
export function inSamePackage(fromUrl: string, path: string): string | null {
  const found = parseAutomergeImport(fromUrl);
  return found ? `/${encodeURIComponent(found.docUrl)}/${path}` : null;
}
