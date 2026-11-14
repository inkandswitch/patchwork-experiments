// Occurrence paths and the keys the view gives them (COMPOSITION.md §2):
// the one place their grammar lives. Pure.
//
// A view shows one stage per open doc. Every stage works in its own ids;
// the view names an object by where it occurs: the stage it is in (a small
// number the view gives each stage it opens, 0 for the outermost) and its id
// there. One key grammar names both an object in the viewport and an
// extension at the router:
//
//   key(0, id) = id                    the outermost stage's names are its own
//   key(n, id) = SEP n SEP id          any other's (n > 0)
//
// An id of the outermost stage that itself begins with SEP is written as
// stage 0's long form (SEP 0 SEP id), so the grammar is injective: every key
// parses back to the one (stage, id) it was made from, whatever a doc puts in
// its ids. Keys are never stored or sent: the wire and the docs carry local
// ids only.
//
// A path is the list of ids from the outermost stage in: the links it goes
// through, then the object. Stage S's path is the links that lead to it ([]
// for the outermost); S's element of a path is the entry just past S's own
// path, when the path goes through S, else null. Hovering a card aboard
// (path [L, c]), the boat's stage sees L and the game's sees c.

export const SEP = "\u001f";

/** The key of `id` in stage `n`. */
export function keyOf(n, id) {
  const s = String(id);
  return n === 0 && !s.startsWith(SEP) ? s : `${SEP}${n}${SEP}${s}`;
}

/** The (stage, id) a key names: { n, id }, or null for a malformed key. */
export function parseKey(key) {
  if (typeof key !== "string") return null;
  if (!key.startsWith(SEP)) return { n: 0, id: key };
  const end = key.indexOf(SEP, 1);
  if (end < 0) return null;
  const digits = key.slice(1, end);
  if (!/^(0|[1-9]\d*)$/.test(digits)) return null;
  return { n: Number(digits), id: key.slice(end + 1) };
}

/** Does `path` go through `prefix` (a stage's own path), with something past it? */
export function within(path, prefix) {
  if (!Array.isArray(path) || path.length <= prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}

/** A stage's element of a path: the entry just past its own path, else null. */
export function elementOf(path, prefix) {
  return within(path, prefix) ? path[prefix.length] : null;
}

/** Are two paths the same (both null, or the same entries)? */
export function samePath(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A frozen path (null stays null). */
export function pathOf(list) {
  return Array.isArray(list) ? Object.freeze([...list]) : null;
}
