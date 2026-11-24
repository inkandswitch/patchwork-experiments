// A document at a version: its heads, a scene object's fixed version (`at`), a
// read-only view of a doc at heads, and a repo that finds some docs at fixed
// heads. What a fixed object (README.md, "Fixed versions") and a pinned link
// (NATIVE.md, "Links") are read through.

export function sortedHeads(heads) {
  return [...(heads ?? [])].map(String).sort();
}

export function sameHeads(a, b) {
  const x = sortedHeads(a);
  const y = sortedHeads(b);
  return x.length === y.length && x.every((h, i) => h === y[i]);
}

/** { url: sorted heads } from anything shaped like it; junk entries dropped. */
export function normalizeDeps(deps) {
  const out = {};
  if (!deps || typeof deps !== "object") return out;
  for (const url of Object.keys(deps).sort()) {
    const heads = deps[url];
    if (typeof url === "string" && url && (Array.isArray(heads) || heads == null)) out[url] = sortedHeads(heads);
  }
  return out;
}

/** A stable string for a deps map; "" when there are none. */
export function depsKey(deps) {
  const d = normalizeDeps(deps);
  return Object.keys(d)
    .map((u) => `${u}=${d[u].join(",")}`)
    .join(";");
}

// ─── fixed versions (`at`) ───────────────────────────────────────────────────
// A scene object may carry `at: { heads, deps? }`: build from the source AT
// those heads (and from each dependency listed in `deps` at its heads) instead
// of the latest. Absent/null follows the latest. A dependency recorded by key
// (["fp:<key>"]) has no heads to view, so it can't be listed.

export const isFpKey = (heads) => heads.length === 1 && String(heads[0]).startsWith("fp:");

/**
 * A scene object's `at`, cleaned: { heads: sorted, deps: { url: sorted heads } },
 * or null when it follows the latest (absent, null, or no usable heads).
 */
export function normalizeAt(at) {
  if (!at || typeof at !== "object") return null;
  const heads = sortedHeads(Array.isArray(at.heads) ? at.heads.filter((h) => typeof h === "string" && h) : []);
  if (!heads.length) return null;
  const deps = {};
  const nd = normalizeDeps(at.deps);
  for (const url of Object.keys(nd)) if (nd[url].length && !isFpKey(nd[url])) deps[url] = nd[url];
  return { heads, deps };
}

/** A stable string for an `at`; "" when it follows the latest. */
export function atKey(at) {
  const a = normalizeAt(at);
  if (!a) return "";
  const deps = depsKey(a.deps);
  return `${a.heads.join(",")}${deps ? `|d:${deps}` : ""}`;
}

/**
 * Does the handle's doc have every one of these changes (DocHandle's
 * containsHeads)? False: a peer recorded a version of it this replica hasn't
 * synced yet. A dependency recorded by key (`fp:`) names no change.
 */
export function knowsHeads(handle, heads) {
  const list = (heads ?? []).filter((h) => typeof h === "string" && h && !h.startsWith("fp:"));
  return !handle || !list.length || handle.containsHeads(list);
}

/**
 * A read-only handle on `handle`'s doc at `heads` (DocHandle.view), or null
 * when this replica doesn't have those heads yet (automerge-repo then gives
 * an empty doc rather than throwing, so an empty view of a non-empty doc
 * counts as missing). With no heads, the handle itself.
 */
export function viewAt(handle, heads) {
  if (!handle) return null;
  if (!heads?.length) return handle;
  try {
    const v = handle.view([...heads]);
    const d = v?.doc();
    if (!d) return null;
    if (Object.keys(d).length === 0 && Object.keys(handle.doc?.() ?? {}).length > 0) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * A repo whose find(url) gives a read-only view at the listed heads for every
 * doc in `deps` ({ url: heads }), so a fixed OpenSCAD part's imports are fixed
 * too. Unlisted URLs, and everything else on the repo (create2, peerId…), are
 * the repo's own. With nothing listed, the repo itself.
 */
export function pinnedRepo(repo, deps) {
  const fixed = {};
  const nd = normalizeDeps(deps);
  for (const url of Object.keys(nd)) if (nd[url].length) fixed[url] = nd[url];
  if (!repo || !Object.keys(fixed).length) return repo;
  const headsFor = (url) => {
    const s = String(url ?? "");
    if (fixed[s]) return fixed[s];
    if (s.includes("#")) return null; // asks for a version of its own
    return fixed[s.split("/")[0]] ?? null; // a path inside a fixed doc
  };
  async function find(url, ...rest) {
    const handle = await repo.find(url, ...rest);
    const heads = headsFor(url);
    return heads && typeof handle?.view === "function" ? handle.view([...heads]) : handle;
  }
  return new Proxy(repo, {
    get(target, prop) {
      if (prop === "find") return find;
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
