// Linearity (STAGE.md, "Views, stages and links", invariant I11): runtime state has at most one
// writable holder among the docs a view reaches. A live link shares the one
// holder, a pin can't write, and copy, extract and bundle leave runtime
// state behind (src/transfer.js cleanObject, src/extract.js), so nothing
// ever makes a second.
//
// Checked over three docs on real Automerge: A and C (empty scenes) and B,
// holding one bound object x (a keeper's binding: a runtime trait field)
// with a claimed object y attached under it. The operations: link A→B live,
// pin A→B, link C→B, copy x from B into A and into C, extract x from B, and
// bundle the first link in A or in C. Every sequence of up to three, and
// every way up to three can interleave: run one after another, or from the
// same state on two or three replicas and merged (a ‖ b, a ; (b ‖ c),
// (a ‖ b) ; c, a ‖ (b ; c), a ‖ b ‖ c), over every ordered choice of
// operations. After each: across every doc in the world, live (a pin's past
// value is read-only), at most one holds runtime state, and it is B.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { emptyScene } from "./test/empty-scene.js";
import { bundlePlan, extractHost, extractPlan } from "./extract.js";
import { cleanObject, describesOf, refsOf, runtimeOf, RUNTIME_FIELDS } from "./transfer.js";
import { LINK, atOf, isLink } from "./native/link-graph.js";
import { orderedIds } from "./ops.js";

const DESCRIBES = describesOf([{ id: "t", describes: { "t.keep": { name: "Keeper", runtime: ["bound"] } } }]);
const RUNTIME = runtimeOf(DESCRIBES);
const REFS = refsOf(DESCRIBES);

const obj = (name, extra = {}) => ({ name, sourceUrl: null, providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });

const A = "automerge:A";
let bundles = 0; // how many bundles ran, over the whole test
const B_ = "automerge:B";
const C = "automerge:C";

/** The world: url → Automerge doc. Each replica has its own copy; ids and urls are made per replica, so two replicas never make the same one. */
function base() {
  const B = emptyScene({
    title: "B",
    objects: {
      x: obj("Deck", { traits: { "t.keep": { bound: "k1", pile: "draw" } } }),
      y: obj("Chair", { parent: "x", claims: { seat: { viewer: "v1", session: "s1" } } }),
    },
    order: ["x", "y"],
  });
  return new Map([
    [A, Automerge.from(emptyScene({ title: "A" }))],
    [B_, Automerge.from(B)],
    [C, Automerge.from(emptyScene({ title: "C" }))],
  ]);
}
const plainDoc = (d) => JSON.parse(JSON.stringify(d));
const fork = (world) => new Map([...world].map(([u, d]) => [u, Automerge.clone(d)]));
function merge(a, b) {
  const out = new Map(a);
  for (const [u, d] of b) out.set(u, out.has(u) ? Automerge.merge(Automerge.clone(out.get(u)), d) : d);
  return out;
}

const addLink = (world, from, to, pinned, r) => {
  const heads = Automerge.getHeads(world.get(to));
  world.set(
    from,
    Automerge.change(world.get(from), (d) => {
      const id = `L-${r.tag}-${++r.n}`;
      d.objects[id] = obj(to, { providerId: LINK, sourceUrl: to, ...(pinned ? { at: { heads: [...heads] } } : {}) });
      d.order.push(id);
    }),
  );
};

// each operation, on one replica (`r`: its tag and counter, for fresh ids and urls)
const OPS = {
  "link A→B": (w, r) => addLink(w, A, B_, false, r),
  "pin A→B": (w, r) => addLink(w, A, B_, true, r),
  "link C→B": (w, r) => addLink(w, C, B_, false, r),
  "copy x→A": (w, r) => copyInto(w, A, r),
  "copy x→C": (w, r) => copyInto(w, C, r),
  "extract x": (w, r) => {
    const b = plainDoc(w.get(B_));
    if (!b.objects.x) return;
    const plan = extractPlan(b, ["x"], { runtime: RUNTIME, refs: REFS });
    const url = `automerge:T${r.tag}${++r.n}`;
    w.set(url, Automerge.from(plan.doc()));
    const host = extractHost(b, plan, { link: `L-${r.tag}-${++r.n}`, url, refs: REFS });
    w.set(B_, Automerge.change(w.get(B_), host.change));
  },
  "bundle in A": (w, r) => bundleFirst(w, A, r),
  "bundle in C": (w, r) => bundleFirst(w, C, r),
};

// paste's copy: the subtree of x, each object as cleanObject leaves it (runtime state behind), with new ids
function copyInto(w, to, r) {
  const b = plainDoc(w.get(B_));
  if (!b.objects.x) return;
  const ids = ["x", ...Object.keys(b.objects).filter((id) => b.objects[id].parent === "x")];
  const map = new Map(ids.map((id) => [id, `c-${r.tag}-${++r.n}`]));
  w.set(
    to,
    Automerge.change(w.get(to), (d) => {
      for (const id of ids) {
        const o = cleanObject(b.objects[id], RUNTIME);
        o.parent = o.parent ? map.get(o.parent) : null;
        d.objects[map.get(id)] = o;
        d.order.push(map.get(id));
      }
    }),
  );
}

function bundleFirst(w, at, r) {
  const host = plainDoc(w.get(at));
  const id = orderedIds(host).find((k) => isLink(host.objects[k]));
  if (!id) return;
  const L = host.objects[id];
  const pin = atOf(L);
  const src = w.get(L.sourceUrl);
  const linked = plainDoc(pin ? Automerge.view(src, pin.heads) : src);
  const plan = bundlePlan(host, id, linked, { runtime: RUNTIME, refs: REFS, newId: (p) => `${p}-${r.tag}-${++r.n}` });
  expect(plan.ok).toBe(true);
  w.set(at, Automerge.change(w.get(at), plan.change));
  bundles++;
}

/** The docs holding runtime state now: a stage field on an object, or a runtime trait field. */
function holders(world) {
  const out = [];
  for (const [u, d] of world) {
    const doc = plainDoc(d);
    const holds = Object.values(doc.objects ?? {}).some((o) => RUNTIME_FIELDS.some((f) => o[f] !== undefined) || o.traits?.["t.keep"]?.bound !== undefined);
    if (holds) out.push(u);
  }
  return out;
}

/** Run operations on a world in turn, on replica `r` ({ tag, n }: its counter goes on from where it is). */
const runOn = (world, names, r) => {
  for (const n of names) OPS[n](world, r);
  return world;
};
const run = (world, names, tag) => runOn(world, names, { tag, n: 0 });

describe("linearity (I11): every sequence and interleaving of up to three operations", () => {
  it(
    "at most one doc holds runtime state, and it is B",
    () => {
      const names = Object.keys(OPS);
      const at = (n) => (n === 1 ? names.map((a) => [a]) : at(n - 1).flatMap((xs) => names.map((a) => [...xs, a])));
      let cases = 0;
      const check = (world, label) => {
        cases++;
        const h = holders(world);
        expect(h.length <= 1 && h.every((u) => u === B_), `${label}: ${h.join(", ")}`).toBe(true);
      };
      const W = base();
      // one after another: each sequence a node of their tree, run once from its parent's world (forked) and checked
      const visit = (world, r, seq) => {
        for (const a of names) {
          const w = fork(world);
          const rr = { ...r };
          runOn(w, [a], rr);
          check(w, [...seq, a].join(" ; "));
          if (seq.length < 2) visit(w, rr, [...seq, a]);
        }
      };
      visit(W, { tag: "s", n: 0 }, []);
      // interleaved: from the same state on two or three replicas, merged. What a replica does from W
      // is the same every time (its ids and urls are its tag's), so each is run once and forked
      // wherever it is written to again; a merge writes only into copies of its left side's docs.
      const memo = new Map();
      const once = (seq, tag) => {
        const key = `${tag}:${seq.join(",")}`;
        if (!memo.has(key)) memo.set(key, run(fork(W), seq, tag));
        return memo.get(key);
      };
      for (const [a, b] of at(2)) check(merge(once([a], "p"), once([b], "q")), `${a} ‖ ${b}`);
      for (const [a, b, c] of at(3)) {
        check(merge(merge(once([a], "p"), once([b], "q")), once([c], "r")), `${a} ‖ ${b} ‖ ${c}`);
        const first = once([a], "p");
        check(merge(run(fork(first), [b], "q"), run(fork(first), [c], "r")), `${a} ; (${b} ‖ ${c})`);
        check(run(fork(merge(once([a], "p"), once([b], "q"))), [c], "r"), `(${a} ‖ ${b}) ; ${c}`);
        check(merge(once([a], "p"), once([b, c], "q")), `${a} ‖ (${b} ; ${c})`);
      }
      const k = names.length;
      expect(cases).toBe(k + k ** 2 + k ** 3 + k ** 2 + 4 * k ** 3);
      expect(bundles).toBeGreaterThan(0);
    },
    120_000,
  );
});
