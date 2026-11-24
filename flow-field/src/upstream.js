// Module memory for a body that is a source doc (doc.body.url is, say, a
// camber hull or an OpenSCAD part, not its scene render or a GLB file). No
// imports; shared by both scene providers and the editor, which all load the
// same module.
//
// 1. An LRU of upstream builds. For a source doc, section.js builds it itself
//    with its provider's defaults. The slice and the streamlines providers
//    both do that after every edit of the source, so without this one edit
//    cost two (or, with the editor open, three) upstream builds. Entries are
//    promises, so two builds that start together share one.
// 2. The upstream provider's dependencies(sourceDoc), from the last
//    acquisition per body url. dependencies(flowDoc) has to be synchronous
//    and can't load the source, so flowDependencies() lists what was seen
//    last time (an OpenSCAD part's imports, say). See README "Linking a body"
//    for the limits; linking the scene render instead has none of them.

const MAX_BUILDS = 8;
const builds = new Map(); // key → Promise<Uint8Array>, oldest first

/**
 * The cached result for `key`, or run() (and cache it). A null key isn't
 * cached. A rejected run is forgotten, so the next call tries again.
 * @template T
 * @param {string|null} key
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export function cachedUpstream(key, run) {
  if (key == null) return run();
  const hit = builds.get(key);
  if (hit) {
    builds.delete(key);
    builds.set(key, hit); // most recently used last
    return hit;
  }
  const p = Promise.resolve().then(run);
  builds.set(key, p);
  while (builds.size > MAX_BUILDS) builds.delete(builds.keys().next().value);
  p.catch(() => {
    if (builds.get(key) === p) builds.delete(key);
  });
  return p;
}

/** How many upstream builds are cached (tests). */
export function upstreamCacheSize() {
  return builds.size;
}

const depsByBody = new Map(); // body url → AutomergeUrl[]

/** Remember the upstream provider's dependencies(sourceDoc) for this body url. */
export function rememberUpstreamDeps(bodyUrl, deps) {
  const list = Array.isArray(deps) ? [...new Set(deps.filter((u) => typeof u === "string" && u && u !== bodyUrl))].sort() : [];
  if (list.length) depsByBody.set(bodyUrl, list);
  else depsByBody.delete(bodyUrl);
}

/** What the upstream provider said it reads, the last time this body was acquired here ([] if never). */
export function upstreamDepsOf(bodyUrl) {
  return depsByBody.get(bodyUrl) ?? [];
}

/** Tests: forget everything. */
export function clearUpstream() {
  builds.clear();
  depsByBody.clear();
}
