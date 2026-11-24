// The stages a view has open (STAGE.md, "Views, stages and links"): each with
// its number (0 the outermost, given in the order they open) and its path
// (the links from the outermost in, ./paths.js), and every question the view
// asks of them. Adding and removing are its only changes; what follows from
// them (starting a stage, announcing, packages, ambients) is the view's.

import { comparePaths, keyOf, parseKey, pathOf, samePath, startsWith, within } from "./paths.js";

// outermost first, then by path: a doc's structure, never the order its links' docs arrived in
const byPath = (a, b) => comparePaths(a.path, b.path) || a.n - b.n;
const deepestFirst = (a, b) => b.path.length - a.path.length;

export function createTree() {
  const stages = new Map(); // number → stage, in the order they opened
  let next = 0;
  const all = () => [...stages.values()];
  return {
    /** Give a stage the next number and keep it: `make(n)` → the stage. */
    add(make) {
      const n = next++;
      const s = make(n);
      stages.set(n, s);
      return s;
    },
    remove(s) {
      if (stages.get(s.n) === s) stages.delete(s.n);
    },
    /** Is `s` open here? */
    has: (s) => stages.get(s?.n) === s,
    get: (n) => stages.get(n) ?? null,
    all,
    outermost: () => stages.get(0) ?? null,
    /** The acting stage whose path is `p` exactly, or null. */
    at: (p) => all().find((s) => s.acts && samePath(s.path, p)) ?? null,
    /** The open stage whose path is `p` exactly, acting or drawn, or null. */
    under: (p) => all().find((s) => samePath(s.path, p)) ?? null,
    /** The stages that act, in path order; a pin is drawn and never acts, so it is never among them. */
    acting: () => all().filter((s) => s.acts).sort(byPath),
    /** Every open stage, acting or drawn, in path order. */
    inOrder: () => all().sort(byPath),
    /** The stages that act on a path, innermost first, out to the outermost (a pin on it is passed over: it is drawn, never acted on). */
    onPath: (path) => all().filter((s) => s.acts && within(path, s.path)).sort(deepestFirst),
    /** Stage `s` and every stage under it, innermost first: what closing it closes. */
    closing: (s) => all().filter((x) => startsWith(x.path, s.path)).sort(deepestFirst),
    /** The full path a viewport key names (its stage's path, then its id), or null. */
    pathOfKey(key) {
      const p = parseKey(key);
      const s = p ? stages.get(p.n) : null;
      return s ? pathOf([...s.path, p.id]) : null;
    },
    /** The viewport key of a path (the stage whose path leads to its last entry), or null. */
    keyOfPath(p) {
      if (!Array.isArray(p) || !p.length) return null;
      const s = all().find((x) => x.path.length === p.length - 1 && startsWith(p, x.path));
      return s ? keyOf(s.n, p.at(-1)) : null;
    },
  };
}
