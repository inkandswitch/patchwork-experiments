// Extract and bundle (STAGE.md, "Extract and bundle"), invariant I9: each is one host
// change and writes no other existing doc, and bundle(extract(S, K), K) is
// the original on every field but runtime state and render doc identity
// when S has no edge outside it. Checked over every set of roots of a fixed
// seven-object scene in two clusters (a table with a lamp and a card on it;
// a shelf with a crate and a wheel on it, the two filed in a group), with
// traits, references of both kinds, dimensions, a start placed on the crate
// and a seats map, × every K ⊆ the root's three traits: 127 × 8 cases, each
// extracted and bundled back, and every exact one again with the host
// holding T's ids when it comes back. The order mixes the clusters, so S is
// one block of it in some cases and not in others.
import { describe, it, expect } from "vitest";
import { FakeRepo, fakeUrl } from "./test/fake-repo.js";
import { emptyScene } from "./test/empty-scene.js";
import { newRenderDoc } from "./datatype.js";
import { boxIn, bundleLink, bundlePlan, composeTransforms, extractHost, extractObjects, extractPlan, extractable } from "./extract.js";
import { describesOf, entryText, lostText, refsOf, runtimeOf, RUNTIME_FIELDS } from "./transfer.js";
import { resolveAnchor } from "./anchors.js";
import { isLink } from "./stage/links.js";
import { isGroup, resolveGroups } from "./groups.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";
import { applyMatrix, composeMatrix, invertMatrix, multiplyMatrices } from "./transform.js";

// ─── the rules the scene's extensions describe ─────────────────────────────

const META = {
  id: "t.parts",
  traits: ["seats", "t.sea", "t.rule", "t.lever", "t.zone", "t.keep"],
  describes: {
    seats: { name: "Seats", on: "scene" },
    "t.sea": { name: "Sea", on: "scene", runtime: ["phase"] },
    "t.rule": { name: "Rule", on: "scene" },
    "t.lever": { name: "Lever", fields: [{ key: "target", kind: "object", label: "Target" }] },
    "t.zone": { name: "Zone", fields: [{ key: "seat", kind: "entry", of: "seats", label: "Seat" }] },
    "t.keep": { name: "Keeper", runtime: ["bound"], fields: [{ key: "doc", copy: "drop", label: "Doc" }] },
  },
};
const DESCRIBES = describesOf([META]);
const RUNTIME = runtimeOf(DESCRIBES);
const REFS = refsOf(DESCRIBES);
const ROOT_TRAITS = ["seats", "t.sea", "t.rule"];
const LOST = `warn: ${lostText({ name: "Lever", label: "Target" })}`;
const ENTRY = `warn: ${entryText({ name: "Zone", label: "Seat", ofName: "Seats" })}`;

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const obj = (name, extra = {}) => ({ name, sourceUrl: null, providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false, transform: T(), ...extra });
const box = { bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } };

/** The fixture host, its render doc and files in `repo`. */
function fixture(repo) {
  const file = fakeUrl();
  const other = fakeUrl();
  const lampSource = fakeUrl();
  const render = repo.add(newRenderDoc({ title: "Lamp", parent: lampSource, providerId: "t.lampgen", params: { glow: 2 } }));
  render.change((d) => {
    d.glbUrl = fakeUrl();
    d.builtFrom = { heads: ["h1"] };
    d.builtAt = 5;
  });
  const objects = {
    table: obj("Table", { sourceUrl: file, hint: box, transform: T([1, 0, 2], [0, 0.5, 0]) }),
    lamp: obj("Lamp", { sourceUrl: lampSource, providerId: "t.lampgen", renderUrl: render.url, parent: "table", transform: T([0.2, 1, 0], [0, 0, 0], 0.5), traits: { "t.lever": { target: "card" } } }),
    card: obj("Card", { sourceUrl: file, parent: "table", transform: T([0, 1, 0.1]), traits: { "t.zone": { seat: "p1" }, "t.keep": { bound: "k7", pile: "draw", doc: fakeUrl() } }, claims: { carry: { viewer: "v", session: "s" } } }),
    shelf: obj("Shelf", { sourceUrl: other, hint: box, transform: T([-3, 0, 0], [0, 1, 0], 2) }),
    cargo: { kind: "group", name: "Cargo", group: null, visible: true, opacity: 1 },
    crate: obj("Crate", { sourceUrl: other, parent: "shelf", group: "cargo", hint: box, transform: T([0, 1, 0]), traits: { "t.lever": { target: "wheel" } } }),
    wheel: obj("Wheel", { sourceUrl: other, parent: "shelf", group: "cargo", transform: T([0, 1, 2], [0.3, 0, 0]), saved: 12 }),
  };
  const fresh = (objectId, local) => ({ objectId, local, world: resolveAnchor({ objectId, local, world: [0, 0, 0] }, objects).world });
  const doc = emptyScene({
    title: "Host",
    objects,
    order: ["table", "shelf", "lamp", "card", "crate", "cargo", "wheel"],
    traits: { seats: { p1: { name: "One" }, p2: { name: "Two" } }, "t.sea": { level: 0, phase: 3 }, "t.rule": { game: "x" } },
    dimensions: {
      d1: { a: fresh("table", [0, 1, 0]), b: fresh("lamp", [0, 0, 0]), label: "rise" },
      d2: { a: fresh("crate", [0, 0, 0]), b: fresh("wheel", [0, 0, 0]), label: "gap" },
    },
    assets: { table: { url: file }, crate: { url: other } },
    view: { units: "cm", start: { body: "t.walk", place: "crate", home: { position: [5, 5, 5], target: [0, 0, 0] } } },
  });
  return repo.add(doc);
}

const IDS = ["table", "lamp", "card", "shelf", "crate", "wheel", "cargo"];
const subsets = (xs) => Array.from({ length: 2 ** xs.length }, (_, m) => xs.filter((_, i) => m & (1 << i)));

/** A stage's own api, enough for extract and bundle, over a fake repo; counts every write to every doc. */
function fakeApi(repo, handle) {
  const writes = new Map(); // url → changes
  const count = (h) => {
    if (h.counted) return;
    h.counted = true;
    const change = h.change.bind(h);
    h.change = (fn, o) => {
      writes.set(h.url, (writes.get(h.url) ?? 0) + 1);
      return change(fn, o);
    };
  };
  for (const h of repo.handles.values()) count(h);
  let n = 0;
  const notices = [];
  let selected = null;
  const api = {
    url: handle.url,
    repo,
    signal: { aborted: false },
    writable: () => true,
    doc: () => handle.doc(),
    newId: (prefix = "x") => `${prefix}~${++n}`,
    registry: async () => ({ filter: () => [META] }),
    edits: () => ({ change: (fn) => handle.change(fn), end() {} }),
    notify: (text, kind) => notices.push(`${kind}: ${text}`),
    view: { select: (id) => (selected = id) },
    box: () => null,
  };
  return { api, writes, notices, selected: () => selected, count };
}

// ─── what the round trip must give back, said independently of extract.js ──

/** Every described reference in an object's traits: [{ kind, trait, key, of?, value }]. */
function refsIn(o) {
  const out = [];
  for (const [k, v] of Object.entries(o?.traits ?? {})) for (const f of REFS.get(k) ?? []) if (!f.drop && v?.[f.key] != null) out.push({ kind: f.kind, trait: k, key: f.key, of: f.of, value: v[f.key] });
  return out;
}

/** Every edge S has outside it (what the round trip may not give back), each with where it is. */
function edgesOutside(doc, S, K) {
  const objects = doc.objects;
  const groups = resolveGroups(objects);
  const out = [];
  for (const [id, o] of Object.entries(objects)) {
    for (const r of refsIn(o)) {
      if (r.kind === "object" && S.has(id) !== S.has(r.value)) out.push({ kind: "object", from: id, trait: r.trait, key: r.key });
      if (r.kind === "entry" && S.has(id) !== K.includes(r.of)) out.push({ kind: "entry", from: id, trait: r.trait, key: r.key });
    }
  }
  const outerGroups = new Set([...S].filter((id) => !S.has(groups.get(id) ?? "")).map((id) => groups.get(id) ?? null));
  if (outerGroups.size > 1) out.push({ kind: "group" });
  for (const [did, dim] of Object.entries(doc.dimensions)) {
    const on = ["a", "b"].filter((e) => S.has(dim[e].objectId));
    if (on.length === 1) out.push({ kind: "dimension", id: did, end: on[0] });
  }
  return out;
}

/** A doc as compared: runtime state and left-behind fields gone from the objects and root traits copied, their render docs by what they hold. */
function comparable(doc, copied, K, renderOf) {
  const d = JSON.parse(JSON.stringify(doc));
  for (const k of K) {
    const r = RUNTIME.get(k);
    if (r === true) delete d.traits[k];
    else for (const key of r ?? []) delete d.traits[k]?.[key];
  }
  for (const id of copied) {
    const o = d.objects[id];
    if (!o) continue;
    for (const f of RUNTIME_FIELDS) delete o[f];
    for (const [k, v] of Object.entries(o.traits ?? {})) {
      const r = RUNTIME.get(k);
      for (const key of r instanceof Set ? r : []) delete v[key];
      for (const f of REFS.get(k) ?? []) if (f.drop) delete v[f.key];
    }
    if (o.renderUrl) o.renderUrl = renderOf(o.renderUrl);
  }
  return d;
}
const seedOf = (repo) => (url) => {
  const r = repo.handles.get(url)?.doc();
  return r ? JSON.stringify({ providerId: r.providerId, params: r.params, glbUrl: r.glbUrl, builtFrom: r.builtFrom, builtAt: r.builtAt }) : null;
};

/** A doc with its object and dimension ids renamed (`objs`, `dims`: Maps), every reference to them following. */
function renamed(doc, objs, dims) {
  const d = JSON.parse(JSON.stringify(doc));
  const o = (id) => (objs.has(id) ? objs.get(id) : id);
  d.objects = Object.fromEntries(
    Object.entries(d.objects).map(([id, x]) => {
      if (x.parent != null) x.parent = o(x.parent);
      if (x.group != null) x.group = o(x.group);
      if (x.traits?.["t.lever"]?.target != null) x.traits["t.lever"].target = o(x.traits["t.lever"].target);
      return [o(id), x];
    }),
  );
  d.order = d.order.map(o);
  d.dimensions = Object.fromEntries(
    Object.entries(d.dimensions).map(([id, x]) => {
      for (const e of ["a", "b"]) if (x[e]?.objectId != null) x[e].objectId = o(x[e].objectId);
      return [dims.has(id) ? dims.get(id) : id, x];
    }),
  );
  if (typeof d.view?.start?.place === "string") d.view.start.place = o(d.view.start.place);
  return d;
}

/** I2 in one doc: every parent, group, described object reference, anchor and start place names an object of that doc. */
function intraDoc(doc) {
  const objects = doc.objects;
  const bad = [];
  for (const [id, o] of Object.entries(objects)) {
    if (o.parent != null && !objects[o.parent]) bad.push(`${id}.parent`);
    if (o.group != null && !isGroup(objects[o.group])) bad.push(`${id}.group`);
    for (const r of refsIn(o)) if (r.kind === "object" && !objects[r.value]) bad.push(`${id} → ${r.value}`);
  }
  for (const [did, dim] of Object.entries(doc.dimensions ?? {})) for (const e of ["a", "b"]) if (dim[e]?.objectId != null && !objects[dim[e].objectId]) bad.push(`${did}.${e}`);
  const place = doc.view?.start?.place;
  if (typeof place === "string" && !objects[place]) bad.push(`start → ${place}`);
  return bad;
}

/** Runtime state anywhere in a doc's objects or root traits. */
function runtimeIn(doc) {
  const out = [];
  for (const [id, o] of Object.entries(doc.objects)) {
    for (const f of RUNTIME_FIELDS) if (o[f] !== undefined) out.push(`${id}.${f}`);
    for (const [k, v] of Object.entries(o.traits ?? {})) {
      const r = RUNTIME.get(k);
      if (r === true) out.push(`${id}.${k}`);
      else if (r) for (const key of r) if (v?.[key] !== undefined) out.push(`${id}.${k}.${key}`);
    }
  }
  for (const [k, v] of Object.entries(doc.traits ?? {})) {
    const r = RUNTIME.get(k);
    if (r instanceof Set) for (const key of r) if (v?.[key] !== undefined) out.push(`traits.${k}.${key}`);
  }
  return out;
}

const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// ─── the harness ───────────────────────────────────────────────────────────

/**
 * One case: extract `roots` with K from a fresh fixture, then bundle the link
 * back; with `squat`, the host first takes every id T has (objects and
 * dimensions), so each comes back under a new one. Checks everything every
 * case owes; returns what the class tallies need.
 */
async function roundTrip(roots, K, { squat = false } = {}) {
  const repo = new FakeRepo();
  const host = fixture(repo);
  const original = JSON.parse(JSON.stringify(host.doc()));
  const existing = new Set(repo.handles.keys());
  const { api, writes, notices, count } = fakeApi(repo, host);
  const can = extractable(original, roots);
  const res = await extractObjects(api, roots, K);
  const label = `${roots.join("+")} × [${K.join(",")}]${squat ? " (ids taken)" : ""}`;
  if (!can.ok) {
    // refused exactly when the tops of S don't share a parent
    expect(res, label).toBe(null);
    expect(writes.size, label).toBe(0);
    expect(repo.handles.size, label).toBe(existing.size);
    return { refused: true };
  }
  const S = new Set(can.ids);
  const parents = resolveParents(original.objects);
  expect(new Set(can.tops.map((id) => parents.get(id) ?? null)).size, label).toBe(1);
  // one host change; nothing else that existed written; new docs: T and a render doc per built object of S
  expect([...writes], label).toEqual([[host.url, 1]]);
  const made = [...repo.handles.keys()].filter((u) => !existing.has(u));
  const built = can.ids.filter((id) => original.objects[id].renderUrl);
  expect(made.length, label).toBe(1 + built.length);
  const t = repo.handles.get(res.url).doc();
  // T: S's ids, intra-doc, no runtime state, K's traits (cleaned), every map a scene has
  expect(Object.keys(t.objects).sort(), label).toEqual([...S].sort());
  expect(intraDoc(t), label).toEqual([]);
  expect(runtimeIn(t), label).toEqual([]);
  expect(Object.keys(t.traits).sort(), label).toEqual([...K].sort());
  for (const k of ["objects", "order", "dimensions", "traits", "assets", "packages", "clock", "view"]) expect(t[k], `${label}: T.${k}`).toBeDefined();
  // the host: S gone, the link at p, intra-doc, K's traits gone
  const after = JSON.parse(JSON.stringify(host.doc()));
  for (const id of S) expect(after.objects[id], label).toBeUndefined();
  const link = after.objects[res.link];
  expect(isLink(link) && link.sourceUrl === res.url && link.parent === (can.parent ?? null), label).toBe(true);
  expect(link.transform, label).toEqual(T());
  expect(intraDoc(after), label).toEqual([]);
  for (const k of K) expect(after.traits[k], label).toBeUndefined();

  // each edge outside S: the field that crossed cleared where it now lives, and said; a group or dimension as decided
  const edges = edgesOutside(original, S, K);
  for (const e of edges) {
    const where = `${label}: ${JSON.stringify(e)}`;
    if (e.kind === "object" || e.kind === "entry") {
      const holder = S.has(e.from) ? t : after;
      expect(holder.objects[e.from].traits[e.trait][e.key], where).toBeUndefined();
      expect(notices, where).toContain(e.kind === "object" ? LOST : ENTRY);
    } else if (e.kind === "group") {
      expect(link.group, where).toBe(null);
    } else {
      // stays in the host, the end on S frozen where it was; not in T
      const end = after.dimensions[e.id][e.end];
      expect(end.objectId, where).toBe(null);
      expect(close(end.world, resolveAnchor(original.dimensions[e.id][e.end], original.objects).world), where).toBe(true);
      expect(t.dimensions[e.id], where).toBeUndefined();
    }
  }
  // and nothing said that didn't cross
  if (!edges.some((e) => e.kind === "object")) expect(notices, label).not.toContain(LOST);
  if (!edges.some((e) => e.kind === "entry")) expect(notices, label).not.toContain(ENTRY);

  if (squat) {
    host.change((d) => {
      for (const id of S) {
        d.objects[id] = obj(`Squatter ${id}`);
        d.order.push(id);
      }
      for (const did of Object.keys(t.dimensions)) d.dimensions[did] = { a: { objectId: null, local: null, world: [0, 0, 0] }, b: { objectId: null, local: null, world: [1, 0, 0] }, label: "squat" };
    });
  }
  const held = JSON.parse(JSON.stringify(host.doc()));
  const hostWrites = writes.get(host.url);

  // and back
  const tWrites = writes.get(res.url) ?? 0;
  const before = new Set(repo.handles.keys());
  const back = await bundleLink(api, res.link, K);
  expect(back, label).not.toBe(null);
  expect(writes.get(host.url), label).toBe(hostWrites + 1);
  expect(writes.get(res.url) ?? 0, label).toBe(tWrites); // the linked doc is never written
  expect([...writes.keys()].filter((u) => u !== host.url), label).toEqual([]);
  expect([...repo.handles.keys()].filter((u) => !before.has(u)).length, label).toBe(built.length);
  for (const u of repo.handles.keys()) count(repo.handles.get(u));
  let round = JSON.parse(JSON.stringify(host.doc()));
  expect(intraDoc(round), label).toEqual([]);
  // what came back holds no runtime state (the copy left it behind)
  const came = new Set(Object.keys(round.objects).filter((id) => !held.objects[id]));
  expect(runtimeIn({ objects: Object.fromEntries([...came].map((id) => [id, round.objects[id]])), traits: Object.fromEntries(K.map((k) => [k, round.traits[k]])) }), label).toEqual([]);
  if (edges.length) return { edges: true };

  if (squat) {
    // every id T had came back new, every reference following it; the squatters as they were
    expect(came.size, label).toBe(S.size);
    for (const id of came) expect(S.has(id), label).toBe(false);
    const byName = new Map(Object.entries(original.objects).map(([id, o]) => [o.name, id]));
    const objs = new Map([...came].map((id) => [id, byName.get(round.objects[id].name)]));
    const byLabel = new Map(Object.entries(original.dimensions).map(([id, d]) => [d.label, id]));
    const dims = new Map(Object.keys(round.dimensions).filter((id) => !held.dimensions[id]).map((id) => [id, byLabel.get(round.dimensions[id].label)]));
    expect(dims.size, label).toBe(Object.keys(t.dimensions).length);
    for (const id of S) expect(round.objects[id], label).toEqual(held.objects[id]);
    // the squatters gone, T's ids put back: the original
    for (const id of S) delete round.objects[id];
    for (const did of Object.keys(t.dimensions)) delete round.dimensions[did];
    round.order = round.order.filter((id) => !S.has(id));
    // with the squatters gone, nothing points at their ids: every reference followed its object
    expect(intraDoc(round), label).toEqual([]);
    round = renamed(round, objs, dims);
  }
  const seed = seedOf(repo);
  const want = comparable(original, S, K, seed);
  const got = comparable(round, S, K, seed);
  // order: S comes back as one block where its first member was; exactly the original when S was one block
  const idx = original.order.map((id, i) => (S.has(id) ? i : -1)).filter((i) => i >= 0);
  const contiguous = idx.at(-1) - idx[0] === idx.length - 1;
  if (!contiguous) {
    const block = (o) => [...o.filter((id) => !S.has(id)), "|", ...o.filter((id) => S.has(id))];
    expect(block(got.order), label).toEqual(block(want.order));
    // where its first member was
    expect(got.order.findIndex((id) => S.has(id)), label).toBe(want.order.findIndex((id) => S.has(id)));
    got.order = want.order;
  }
  expect(got, label).toEqual(want);
  return { exact: true, parent: can.parent, grouped: link.group != null, contiguous };
}

// The fixture's counts: 584 sets of roots × K hang S's tops on two parents (a
// table-side and a shelf-side root, say). Of the exact ones: the whole scene
// (64: every roots ⊇ {table, shelf, cargo} × K ∋ seats); the table with what's
// on it (16, K ∋ seats) and the shelf with the cargo (16, K ∌ seats), each
// spread through the order; the cargo group on the shelf (16: p the shelf,
// one block); the crate and wheel without their group (4: p the shelf, the
// link filed in the cargo group, spread).
const TALLY = { refused: 584, exact: 116, withEdges: 316 };
const CLASSES = { "p=root ungrouped one block": 64, "p=root ungrouped spread": 32, "p=shelf ungrouped one block": 16, "p=shelf grouped spread": 4 };

describe("extract and bundle (I9): every set of roots × every K", () => {
  it(
    "one host change each, no other doc written; T and the host each intra-doc and T without runtime state; each edge outside cleared where it lives and said; bundle(extract(S, K), K) is the original when S has no edge outside, ids taken or not",
    async () => {
      const tally = { refused: 0, exact: 0, withEdges: 0 };
      const classes = {};
      const exactCases = [];
      for (const roots of subsets(IDS).filter((r) => r.length)) {
        for (const K of subsets(ROOT_TRAITS)) {
          const r = await roundTrip(roots, K);
          if (r.refused) tally.refused++;
          else if (r.edges) tally.withEdges++;
          else {
            tally.exact++;
            exactCases.push([roots, K]);
            const c = `p=${r.parent ?? "root"} ${r.grouped ? "grouped" : "ungrouped"} ${r.contiguous ? "one block" : "spread"}`;
            classes[c] = (classes[c] ?? 0) + 1;
          }
        }
      }
      // every case is one of the three; the exact ones in every class the rules distinguish
      expect(tally).toEqual(TALLY);
      expect(classes).toEqual(CLASSES);
      // and every exact one again, the host holding T's ids when it comes back
      for (const [roots, K] of exactCases) expect((await roundTrip(roots, K, { squat: true })).exact).toBe(true);
    },
    120_000,
  );
});

describe("extract: the pieces", () => {
  it("composeTransforms: the identity gives b back exactly; otherwise the product", () => {
    const b = { position: [0.1, 0.2, 0.3], rotation: [0.7, -0.2, 1.3], scale: 0.37 };
    expect(composeTransforms(T(), b)).toEqual(b);
    const a = T([1, 2, 3], [0, Math.PI / 2, 0], 2);
    const m = composeMatrix(composeTransforms(a, b));
    const want = multiplyMatrices(composeMatrix(a), composeMatrix(b));
    m.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });

  it("extract keeps transforms below p and sets references to p to null; the link takes the group S's members share and S's box in p's frame", () => {
    const doc = emptyScene({
      objects: {
        deck: obj("Deck", { transform: T([0, 2, 0], [0, 0, 0], 2) }),
        g: { kind: "group", name: "Fit-out", group: null },
        winch: obj("Winch", { parent: "deck", group: "g", transform: T([1, 0, 0]), hint: box, traits: { "t.lever": { target: "deck" } } }),
      },
      order: ["deck", "g", "winch"],
    });
    const plan = extractPlan(doc, ["winch"], { runtime: RUNTIME, refs: REFS });
    expect(plan.ok && plan.parent === "deck" && plan.group === "g").toBe(true);
    const t = plan.doc();
    expect(t.objects.winch.transform).toEqual(T([1, 0, 0]));
    expect(t.objects.winch.parent).toBe(null);
    expect(t.objects.winch.traits["t.lever"].target).toBe(null);
    // S's box, in the deck's frame (the deck's scale 2 taken out)
    expect(plan.hint.min.map((v) => +v.toFixed(9))).toEqual([0.5, 0, -0.5]);
    expect(plan.hint.max.map((v) => +v.toFixed(9))).toEqual([1.5, 1, 0.5]);
  });

  it("the link's hint is S's box in p's frame: each object's own box carried there, never a box boxed again, under a turned p; the stage's box asked for in p's frame when it has one", () => {
    // p turned 45° about y, the winch on it unturned in p's frame: its box in p's frame is its hint, moved
    const objects = {
      deck: obj("Deck", { transform: T([3, 0, 1], [0, Math.PI / 4, 0], 2) }),
      winch: obj("Winch", { parent: "deck", transform: T([1, 0, 0]), hint: box }),
      cleat: obj("Cleat", { parent: "deck", transform: T([0, 0, 2], [0, Math.PI / 2, 0]), hint: box }),
    };
    const got = boxIn(objects, ["winch", "cleat"], "deck");
    const r = (v) => v.map((x) => +x.toFixed(9));
    // winch: [0.5, 1.5] × [0, 1] × [-0.5, 0.5]; cleat (a quarter turn of a square box): [-0.5, 0.5] × [0, 1] × [1.5, 2.5]
    expect(r(got.min)).toEqual([-0.5, 0, -0.5]);
    expect(r(got.max)).toEqual([1.5, 1, 2.5]);
    // what boxing the world box again would give is looser: it isn't that
    const world = (id) => {
      const m = worldMatrix(objects, id);
      const ps = [];
      for (let i = 0; i < 8; i++) ps.push(applyMatrix(m, [i & 1 ? 0.5 : -0.5, i & 2 ? 1 : 0, i & 4 ? 0.5 : -0.5]));
      return { min: [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))), max: [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k]))) };
    };
    const inv = invertMatrix(worldMatrix(objects, "deck"));
    const reboxed = [];
    for (const id of ["winch", "cleat"]) {
      const w = world(id);
      for (let i = 0; i < 8; i++) reboxed.push(applyMatrix(inv, [i & 1 ? w.max[0] : w.min[0], i & 2 ? w.max[1] : w.min[1], i & 4 ? w.max[2] : w.min[2]]));
    }
    expect(Math.min(...reboxed.map((p) => p[0]))).toBeLessThan(got.min[0] - 0.1);
    // the stage's own, asked for in p's frame (posed, as drawn), wins over the hint
    const asked = [];
    const drawn = boxIn(objects, ["winch"], "deck", (id, frame) => (asked.push([id, frame]), { min: [9, 9, 9], max: [10, 10, 10] }));
    expect(asked).toEqual([["winch", "deck"]]);
    expect(drawn).toEqual({ min: [9, 9, 9], max: [10, 10, 10] });
  });

  it("a group whose members hang on different things is refused, and says why", () => {
    const doc = emptyScene({
      objects: { a: obj("A"), b: obj("B"), g: { kind: "group", name: "G", group: null }, c: obj("C", { parent: "a", group: "g" }), d: obj("D", { parent: "b", group: "g" }) },
      order: ["a", "b", "g", "c", "d"],
    });
    expect(extractable(doc, ["g"])).toEqual({ ok: false, reason: "These are attached to different things: extract them one at a time." });
    expect(extractable(doc, ["c"]).ok).toBe(true);
  });

  it("extract refuses K the scene hasn't; bundle refuses K the host has, naming it, and K the linked doc hasn't", () => {
    const doc = emptyScene({ objects: { a: obj("A") }, order: ["a"], traits: { seats: {} } });
    expect(extractPlan(doc, ["a"], { traits: ["t.sea"] })).toMatchObject({ ok: false });
    const host = emptyScene({ objects: { L: obj("L", { providerId: "scene.link", sourceUrl: "automerge:abc" }) }, order: ["L"], traits: { seats: {} } });
    const linked = emptyScene({ objects: {}, traits: { seats: { p1: {} }, "t.sea": { level: 1 } } });
    expect(bundlePlan(host, "L", linked, { traits: ["seats"], describes: DESCRIBES, newId: () => "n" })).toEqual({ ok: false, reason: "This scene already has Seats." });
    expect(bundlePlan(host, "L", linked, { traits: ["t.rule"], describes: DESCRIBES, newId: () => "n" })).toEqual({ ok: false, reason: "That scene has no Rule to bring." });
    expect(bundlePlan(host, "L", linked, { traits: ["t.sea"], describes: DESCRIBES, newId: () => "n" }).ok).toBe(true);
  });

  it("bundle: ids the host has are made new and every reference follows; the link's place, group and pose carry its top objects; what hung on it stays put", () => {
    const host = emptyScene({
      objects: {
        shelf: obj("Shelf"),
        g: { kind: "group", name: "G", group: null },
        L: obj("Fit-out", { providerId: "scene.link", sourceUrl: "automerge:abc", parent: "shelf", group: "g", transform: T([1, 0, 0], [0, 0, 0], 2) }),
        tag: obj("Tag", { parent: "L", transform: T([0, 1, 0]) }),
        lever: obj("Lever", { traits: { "t.lever": { target: "L" } } }),
        a: obj("Taken"),
      },
      order: ["shelf", "g", "L", "tag", "lever", "a"],
      view: { start: { place: "L", home: { position: [1, 1, 1] } } },
    });
    const linked = emptyScene({
      objects: { a: obj("Winch", { transform: T([0, 0, 1]) }), b: obj("Handle", { parent: "a", traits: { "t.lever": { target: "a" } } }) },
      order: ["a", "b"],
      view: { start: { body: "t.walk", place: "a" } },
    });
    let n = 0;
    const plan = bundlePlan(host, "L", linked, { runtime: RUNTIME, refs: REFS, describes: DESCRIBES, newId: (p) => `${p}${++n}` });
    expect(plan.ok).toBe(true);
    const d = JSON.parse(JSON.stringify(host));
    plan.change(d);
    expect(plan.map).toEqual(new Map([["a", "o1"], ["b", "b"]]));
    expect(d.objects.o1).toMatchObject({ name: "Winch", parent: "shelf", group: "g", transform: { position: [1, 0, 2], scale: 2 } });
    expect(d.objects.b).toMatchObject({ parent: "o1", group: "g", traits: { "t.lever": { target: "o1" } } });
    expect(d.objects.L).toBeUndefined();
    expect(d.order).toEqual(["shelf", "g", "o1", "b", "tag", "lever", "a"]);
    // what hung on the link: on its parent, where it was
    expect(d.objects.tag).toMatchObject({ parent: "shelf", transform: { position: [1, 2, 0], scale: 2 } });
    // a reference to the link: cleared, and said
    expect(d.objects.lever.traits["t.lever"].target).toBeUndefined();
    expect(plan.lost).toEqual([{ id: "lever", trait: "t.lever", key: "target", label: "Target" }]);
    // a start through the link: the linked doc's start, here, its place following its id
    expect(d.view.start).toEqual({ body: "t.walk", place: "o1", home: { position: [1, 1, 1] } });
  });

  it("bundling a fixed link keeps a live link inside it fixed where the pin held it", () => {
    const host = emptyScene({ objects: { L: obj("L", { providerId: "scene.link", sourceUrl: "automerge:abc", at: { heads: ["h1"], deps: { "automerge:in": ["h9"] } } }) }, order: ["L"] });
    const linked = emptyScene({ objects: { inner: obj("Inner", { providerId: "scene.link", sourceUrl: "automerge:in" }) }, order: ["inner"] });
    const plan = bundlePlan(host, "L", linked, { newId: () => "n", deps: { "automerge:in": ["h9"] } });
    const d = JSON.parse(JSON.stringify(host));
    plan.change(d);
    expect(d.objects.inner.at).toEqual({ heads: ["h9"], deps: { "automerge:in": ["h9"] } });
  });

  it("bundling a pin copies its value: a built object fixed where the pin held its source, its render doc seeded as the pin holds it, not as it is now; a file object as it is (its file never changes)", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "Lamp source", glow: 1 });
    const render = repo.add(newRenderDoc({ title: "Lamp", parent: source.url, providerId: "t.lampgen", params: { glow: 2 } }));
    render.change((d) => {
      d.glbUrl = "automerge:glb-then";
      d.builtFrom = { heads: source.heads() };
      d.builtAt = 5;
    });
    const file = fakeUrl();
    const linked = repo.add(
      emptyScene({
        title: "Fit-out",
        objects: { lamp: obj("Lamp", { sourceUrl: source.url, providerId: "t.lampgen", renderUrl: render.url }), crate: obj("Crate", { sourceUrl: file }) },
        order: ["lamp", "crate"],
      }),
    );
    const deps = { [linked.url]: linked.heads(), [source.url]: source.heads(), [render.url]: render.heads() };
    const host = repo.add(emptyScene({ objects: { L: obj("Fit-out", { providerId: "scene.link", sourceUrl: linked.url, at: { heads: linked.heads(), deps } }) }, order: ["L"] }));
    // after the pin: the source edited, the render doc rebuilt with new params
    source.change((d) => (d.glow = 9));
    render.change((d) => {
      d.params.glow = 7;
      d.glbUrl = "automerge:glb-now";
      d.builtFrom = { heads: source.heads() };
    });
    const { api } = fakeApi(repo, host);
    const tops = await bundleLink(api, "L", []);
    expect(tops).toEqual(["lamp", "crate"]);
    const lamp = host.doc().objects.lamp;
    expect(lamp.at).toEqual({ heads: deps[source.url], deps });
    const copy = repo.handles.get(lamp.renderUrl).doc();
    expect(lamp.renderUrl).not.toBe(render.url);
    expect(copy.params).toEqual({ glow: 2 });
    expect(copy.glbUrl).toBe("automerge:glb-then");
    expect(host.doc().objects.crate.at).toBeUndefined();
  });
});

describe("extract's compare-and-set: anything T was made from that changes meanwhile, and nothing is written", () => {
  // each kind of edit that could land while T and its render docs are being made, against S = the table (with the lamp and card on it)
  const EDITS = {
    "a new object attached under S": (d) => (d.objects.mug = obj("Mug", { parent: "table" })),
    "a new object filed in a group of S": (d) => {
      d.objects.g = { kind: "group", name: "G", group: null };
      d.objects.lamp.group = "g";
    },
    "a member of S edited": (d) => (d.objects.card.name = "Queen"),
    "S's order changed": (d) => d.order.splice(d.order.indexOf("card"), 1) && d.order.unshift("card"),
    "p changed (S's tops moved under something)": (d) => (d.objects.table.parent = "shelf"),
    "a new dimension with both ends on S": (d) => (d.dimensions.d9 = { a: { objectId: "table", local: [0, 0, 0], world: [1, 0, 2] }, b: { objectId: "lamp", local: [0, 0, 0], world: [1, 1, 2] }, label: null }),
    "a new dimension with one end on S": (d) => (d.dimensions.d9 = { a: { objectId: "table", local: [0, 0, 0], world: [1, 0, 2] }, b: { objectId: "shelf", local: [0, 0, 0], world: [-3, 0, 0] }, label: null }),
    "a dimension on S edited": (d) => (d.dimensions.d1.label = "high"),
    "the start moved onto S": (d) => (d.view.start = { body: "t.walk", place: "card" }),
    "the start moved off S": (d) => (d.view.start.place = null),
    "a trait of K edited": (d) => (d.traits.seats.p3 = { name: "Three" }),
  };
  // and edits that touch nothing T was made from: the extract goes ahead
  const HARMLESS = {
    "an object outside S edited": (d) => (d.objects.shelf.name = "Rack"),
    "a dimension off S added": (d) => (d.dimensions.d9 = { a: { objectId: "crate", local: [0, 0, 0], world: [0, 0, 0] }, b: { objectId: "shelf", local: [0, 0, 0], world: [0, 0, 0] }, label: null }),
    "a trait not in K edited": (d) => (d.traits["t.rule"].game = "y"),
    "a reference into S added from outside": (d) => (d.objects.shelf.traits = { "t.lever": { target: "lamp" } }),
  };

  /** Extract the table with K = [seats], `edit` landing on the host while T is being made. */
  async function racing(edit) {
    const repo = new FakeRepo();
    const host = fixture(repo);
    const { api, writes, notices } = fakeApi(repo, host);
    const create2 = repo.create2.bind(repo);
    repo.create2 = async (doc) => {
      const h = await create2(doc);
      // T is the scene doc made (a render doc has no objects)
      if (doc.objects) host.change(edit);
      return h;
    };
    const before = JSON.parse(JSON.stringify(host.doc()));
    const res = await extractObjects(api, ["table"], ["seats"]);
    return { res, host, before, writes, notices };
  }

  for (const [name, edit] of Object.entries(EDITS)) {
    it(`${name}: refused, the host only as the edit left it`, async () => {
      const { res, host, before, writes, notices } = await racing(edit);
      expect(res).toBe(null);
      expect(writes.get(host.url)).toBe(1); // the edit's own change, nothing of extract's
      const want = JSON.parse(JSON.stringify(before));
      edit(want);
      expect(JSON.parse(JSON.stringify(host.doc()))).toEqual(want);
      expect(notices).toContain("error: It changed while it was being extracted: nothing was changed here. Try again.");
    });
  }

  for (const [name, edit] of Object.entries(HARMLESS)) {
    it(`${name}: extracted, the host intra-doc`, async () => {
      const { res, host, writes } = await racing(edit);
      expect(res).not.toBe(null);
      expect(writes.get(host.url)).toBe(2);
      expect(intraDoc(host.doc())).toEqual([]);
      expect(host.doc().objects.table).toBeUndefined();
    });
  }

  it("extractHost against a stale plan is null for every edit above, and a change for every harmless one (the pure function, no doer)", () => {
    const repo = new FakeRepo();
    const doc = JSON.parse(JSON.stringify(fixture(repo).doc()));
    const plan = extractPlan(doc, ["table"], { traits: ["seats"], runtime: RUNTIME, refs: REFS });
    expect(extractHost(doc, plan, { link: "L", url: "automerge:t", refs: REFS })).not.toBe(null);
    for (const [name, edit] of Object.entries(EDITS)) {
      const now = JSON.parse(JSON.stringify(doc));
      edit(now);
      expect(extractHost(now, plan, { link: "L", url: "automerge:t", refs: REFS }), name).toBe(null);
    }
    for (const [name, edit] of Object.entries(HARMLESS)) {
      const now = JSON.parse(JSON.stringify(doc));
      edit(now);
      expect(extractHost(now, plan, { link: "L", url: "automerge:t", refs: REFS }), name).not.toBe(null);
    }
  });
});
