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
//
// The reading itself is in task-client.js, which packages that ask for tasks
// carry a copy of; this file adds what only a worker needs.

import { parseAutomergeImport } from './task-client.js';

export { inSamePackage, packageOf, parseAutomergeImport } from './task-client.js';
export type { AutomergeImport } from './task-client.js';

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
