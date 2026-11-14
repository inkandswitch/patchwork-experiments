// I3, expansion is finite and fixed by the graph (COMPOSITION.md,
// Invariants), checked over every link graph of a few finite families and
// every order its docs arrive in: it terminates, no identity repeats on a
// path, each live doc has exactly one acting occurrence (the first in path
// order) and the rest are mirrors, the closed reasons are exact, and the
// final expansion doesn't depend on the arrival order.

import { describe, expect, it } from "vitest";
import { CLOSED, LINK, atOf, expand, identityOf, isLink, linksOf } from "./links.js";

const URL = (i) => `automerge:doc${i}`;
const H = ["h1"]; // the one older version a pin names

/** A scene doc whose objects are these links: [{ to, kind: "live" | "pinned", deps? }]. */
function docWith(links) {
  const objects = {};
  links.forEach((l, i) => {
    objects[`L${i}`] = { name: `link ${i}`, sourceUrl: URL(l.to), providerId: LINK, ...(l.kind === "pinned" ? { at: { heads: [...H], ...(l.deps ? { deps: l.deps } : {}) } } : {}) };
  });
  return { objects };
}

/** docOf over a graph: docs[i] (the same links at every version), `gone` can't be opened, only `arrived` are here. */
const docOfGraph = (docs, { gone = new Set(), arrived = null } = {}) => (url, heads) => {
  const i = Number(url.slice("automerge:doc".length));
  if (gone.has(i)) return null;
  if (arrived && !arrived.has(i)) return undefined;
  return docs[i] ?? null;
};

const lexLess = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a.length < b.length;
};

/** Every invariant of one expansion, against the graph it came from. Throws saying which failed. */
function check(out, docOf) {
  const fail = (what, o) => {
    throw new Error(`${what}: ${JSON.stringify(o)}`);
  };
  const live = new Map(); // url → occurrences (open, live)
  out.forEach((o, n) => {
    // path order: by depth, then lexicographically
    if (n > 0) {
      const p = out[n - 1];
      if (p.depth > o.depth || (p.depth === o.depth && !lexLess(p.path, o.path))) fail("out of path order", [p.path, o.path]);
    }
    // its parent came first, and its path is the parent's and its link
    if (o.depth === 0) {
      if (o.parent !== null) fail("the root has a parent", o);
    } else {
      const par = out[o.parent];
      if (!(o.parent < n) || !par || par.path.length !== o.depth - 1 || par.path.some((x, i) => x !== o.path[i]) || o.path.at(-1) !== o.link) fail("parent", o);
      if (par.role === "closed") fail("under a closed occurrence", o);
    }
    // the identities on its path, outermost first
    const ids = [];
    for (let q = o.parent; q != null; q = out[q].parent) ids.unshift(identityOf(out[q].url, out[q].heads));
    const ident = identityOf(o.url, o.heads);
    if (o.role === "closed") {
      if (!CLOSED.includes(o.reason)) fail("a closed reason that isn't one", o);
      const par = o.parent == null ? null : out[o.parent];
      const unpinned = !!par && !!par.heads && !o.heads;
      if ((o.reason === "unpinned") !== unpinned) fail("unpinned, exactly", o);
      if (o.reason === "cycle" && !ids.includes(ident)) fail("a cycle with no repeat", o);
      if (o.reason === "unavailable" && docOf(o.url, o.heads) !== null) fail("unavailable, but it opens", o);
      if (o.reason !== "cycle" && o.reason !== "unpinned" && ids.includes(ident)) fail("a repeat not closed as a cycle", o);
      return;
    }
    if (ids.includes(ident)) fail("an identity repeats on a path", o);
    if (docOf(o.url, o.heads) === null) fail("open, but it can't be opened", o);
    if (o.heads) {
      if (o.role !== "pinned") fail("a pin that isn't pinned", o);
    } else {
      if (!live.has(o.url)) live.set(o.url, []);
      live.get(o.url).push(o);
    }
    // its children are exactly its doc's links, in id order
    const doc = docOf(o.url, o.heads);
    const kids = out.filter((k) => k.parent === n).map((k) => k.link);
    const want = doc ? linksOf(doc).map((l) => l.id) : [];
    if (JSON.stringify(kids) !== JSON.stringify(want)) fail("children aren't its links", { o, kids, want });
  });
  // each live doc acts once, at its first occurrence; the rest mirror
  for (const occs of live.values()) {
    if (occs[0].role !== "acting") fail("the first live occurrence doesn't act", occs[0]);
    for (const x of occs.slice(1)) if (x.role !== "mirror") fail("a second live occurrence that isn't a mirror", x);
  }
}

function* perms(list) {
  if (list.length <= 1) return yield [...list];
  for (let i = 0; i < list.length; i++) for (const rest of perms([...list.slice(0, i), ...list.slice(i + 1)])) yield [list[i], ...rest];
}

/** Every graph on `k` docs where each ordered pair (self included) has one of `choices` (lists of link kinds). */
function* graphs(k, choices) {
  const pairs = [];
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) pairs.push([a, b]);
  const n = choices.length ** pairs.length;
  for (let code = 0; code < n; code++) {
    const links = Array.from({ length: k }, () => []);
    let c = code;
    for (const [a, b] of pairs) {
      for (const kind of choices[c % choices.length]) links[a].push({ to: b, kind, ...(kind === "pinned" ? { deps: Object.fromEntries(Array.from({ length: k }, (_, i) => [URL(i), [...H]])) } : {}) });
      c = Math.floor(c / choices.length);
    }
    yield links.map(docWith);
  }
}

/** Run every arrival order of a graph's docs: each prefix keeps the invariants, and the end is the one-shot expansion. */
function everyArrival(docs, { gone = new Set(), orders = true } = {}) {
  const root = { url: URL(0) };
  const full = expand(root, docOfGraph(docs, { gone }));
  check(full, docOfGraph(docs, { gone }));
  const order0 = docs.map((_, i) => i);
  for (const order of orders ? perms(order0) : [order0]) {
    const arrived = new Set();
    let last = null;
    for (const i of order) {
      arrived.add(i);
      const docOf = docOfGraph(docs, { gone, arrived });
      last = expand(root, docOf);
      check(last, docOf);
    }
    expect(last).toEqual(full);
  }
  return full;
}

describe("links: what a link is", () => {
  it("an object whose source is a scene doc through scene.link; `at` makes it a value", () => {
    expect(isLink({ providerId: LINK, sourceUrl: URL(1) })).toBe(true);
    expect(isLink({ providerId: "file-glb", sourceUrl: URL(1) })).toBe(false);
    expect(isLink({ providerId: LINK, sourceUrl: "nope" })).toBe(false);
    expect(atOf({ at: { heads: ["a"] } })).toEqual({ heads: ["a"], deps: null });
    expect(atOf({ at: { heads: [] } })).toBe(null);
    expect(atOf({})).toBe(null);
    expect(linksOf({ objects: { b: { providerId: LINK, sourceUrl: URL(2) }, a: { providerId: LINK, sourceUrl: URL(1) }, c: { name: "crate" } } }).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("the worked cases: one game in a boat and a room (two placements, one acting); a doc holding itself live is a cycle, its own past is not", () => {
    // root 0 links the boat 1 and the room 2, each of which links game 3
    const docs = [docWith([{ to: 1, kind: "live" }, { to: 2, kind: "live" }]), docWith([{ to: 3, kind: "live" }]), docWith([{ to: 3, kind: "live" }]), docWith([])];
    const out = expand({ url: URL(0) }, docOfGraph(docs));
    expect(out.map((o) => [o.path.join("/"), o.role])).toEqual([
      ["", "acting"],
      ["L0", "acting"],
      ["L1", "acting"],
      ["L0/L0", "acting"],
      ["L1/L0", "mirror"],
    ]);
    const self = expand({ url: URL(0) }, docOfGraph([docWith([{ to: 0, kind: "live" }, { to: 0, kind: "pinned", deps: {} }])]));
    expect(self.map((o) => [o.path.join("/"), o.role, o.reason ?? null])).toEqual([
      ["", "acting", null],
      ["L0", "closed", "cycle"],
      ["L1", "pinned", null],
      // inside the pin of itself: the live link has no deps to be held at (unpinned), the pin of the same version is a cycle
      ["L1/L0", "closed", "unpinned"],
      ["L1/L1", "closed", "cycle"],
    ]);
  });

  it("a doc that can't be opened is closed unavailable; one not here yet is open with nothing under it", () => {
    const docs = [docWith([{ to: 1, kind: "live" }, { to: 2, kind: "live" }]), docWith([{ to: 2, kind: "live" }]), docWith([])];
    const out = expand({ url: URL(0) }, docOfGraph(docs, { gone: new Set([1]), arrived: new Set([0, 1]) }));
    expect(out.map((o) => [o.path.join("/"), o.role, o.reason ?? null])).toEqual([
      ["", "acting", null],
      ["L0", "closed", "unavailable"],
      ["L1", "acting", null],
    ]);
  });

  it("the budget opens the nearest first", () => {
    const docs = [docWith([{ to: 1, kind: "live" }, { to: 1, kind: "live" }]), docWith([{ to: 2, kind: "live" }]), docWith([])];
    expect(expand({ url: URL(0) }, docOfGraph(docs), { budget: 3 }).map((o) => o.path.join("/"))).toEqual(["", "L0", "L1"]);
  });
});

describe("I3: expansion is finite and fixed by the graph", () => {
  it("every graph on 2 docs with up to two links per ordered pair (live, pinned, both, two live), every unavailable doc, every arrival order", () => {
    const choices = [[], ["live"], ["pinned"], ["live", "live"], ["live", "pinned"]];
    let n = 0;
    for (const docs of graphs(2, choices))
      for (const gone of [new Set(), new Set([1])]) {
        everyArrival(docs, { gone });
        n++;
      }
    expect(n).toBe(5 ** 4 * 2);
  });

  it("every graph on 3 docs with at most one link per ordered pair (live or pinned), every arrival order", () => {
    let n = 0;
    for (const docs of graphs(3, [[], ["live"], ["pinned"]])) {
      everyArrival(docs);
      n++;
    }
    expect(n).toBe(3 ** 9);
  }, 60_000);

  it("every graph on 4 docs with at most one live link per ordered pair", () => {
    let n = 0;
    for (const docs of graphs(4, [[], ["live"]])) {
      everyArrival(docs, { orders: false });
      n++;
    }
    expect(n).toBe(2 ** 16);
  }, 60_000);

  it("pins whose deps miss docs: every subset of deps on 3 docs, a pin from the root to each", () => {
    for (let to = 0; to < 3; to++)
      for (let mask = 0; mask < 8; mask++) {
        const deps = Object.fromEntries([0, 1, 2].filter((i) => mask & (1 << i)).map((i) => [URL(i), [...H]]));
        const docs = [docWith([{ to, kind: "pinned", deps }, { to: 1, kind: "live" }]), docWith([{ to: 2, kind: "live" }]), docWith([{ to: 0, kind: "live" }])];
        everyArrival(docs);
      }
  });
});
