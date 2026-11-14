// Extract and bundle (COMPOSITION.md §8), invariant I9: each is one host
// change and writes no other existing doc, and bundle(extract(S, K), K) is
// the original on every field but runtime state and render doc identity
// when S has no edge outside it. Checked over every set of roots of a fixed
// six-object scene (a table with a lamp and a card on it, a crate and a
// wheel filed in a group) with traits, references of both kinds, a group,
// dimensions, a start placed on an object, and a seats map, × every K ⊆ the
// root's three traits: 63 × 8 cases, each extracted and bundled back.
import { describe, it, expect } from "vitest";
import { FakeRepo, fakeUrl } from "./test/fake-repo.js";
import { emptyScene } from "./test/empty-scene.js";
import { newRenderDoc } from "./datatype.js";
import { bundleLink, bundlePlan, composeTransforms, extractObjects, extractPlan, extractable, refEdits } from "./extract.js";
import { describesOf, refsOf, runtimeOf, RUNTIME_FIELDS } from "./transfer.js";
import { resolveAnchor } from "./anchors.js";
import { isLink } from "./stage/links.js";
import { isGroup, resolveGroups } from "./groups.js";
import { resolveParents } from "./hierarchy.js";
import { composeMatrix, multiplyMatrices } from "./transform.js";

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
    crate: obj("Crate", { sourceUrl: other, group: "cargo", hint: box, transform: T([-3, 0, 0]), traits: { "t.lever": { target: "table" } } }),
    cargo: { kind: "group", name: "Cargo", group: null, visible: true, opacity: 1 },
    wheel: obj("Wheel", { sourceUrl: other, group: "cargo", transform: T([-3, 0, 2], [0.3, 0, 0]), traits: { "t.lever": { target: "crate" } }, saved: 12 }),
  };
  const fresh = (objectId, local) => ({ objectId, local, world: resolveAnchor({ objectId, local, world: [0, 0, 0] }, objects).world });
  const doc = emptyScene({
    title: "Host",
    objects,
    order: ["cargo", "table", "lamp", "crate", "card", "wheel"],
    traits: { seats: { p1: { name: "One" }, p2: { name: "Two" } }, "t.sea": { level: 0, phase: 3 }, "t.rule": { game: "x" } },
    dimensions: {
      d1: { a: fresh("table", [0, 1, 0]), b: fresh("lamp", [0, 0, 0]), label: null },
      d2: { a: fresh("crate", [0, 0, 0]), b: fresh("wheel", [0, 0, 0]), label: "gap" },
      d3: { a: fresh("table", [0, 0, 0]), b: fresh("crate", [0, 1, 0]), label: null },
    },
    assets: { table: { url: file }, crate: { url: other } },
    view: { units: "cm", start: { body: "t.walk", place: "crate", home: { position: [5, 5, 5], target: [0, 0, 0] } } },
  });
  return repo.add(doc);
}

const IDS = ["table", "lamp", "card", "crate", "cargo", "wheel"];
const subsets = (xs) => Array.from({ length: 2 ** xs.length }, (_, m) => xs.filter((_, i) => m & (1 << i)));

/** A stage's own api, enough for extract and bundle, over a fake repo; counts every write to every doc. */
function fakeApi(repo, handle) {
  const writes = new Map(); // url → changes
  for (const h of repo.handles.values()) {
    const change = h.change.bind(h);
    h.change = (fn, o) => {
      writes.set(h.url, (writes.get(h.url) ?? 0) + 1);
      return change(fn, o);
    };
  }
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
  return { api, writes, notices, selected: () => selected };
}

// ─── what the round trip must give back, said independently of extract.js ──

/** Every described reference in an object's traits: [{ kind, of?, value }]. */
function refsIn(o) {
  const out = [];
  for (const [k, v] of Object.entries(o?.traits ?? {})) for (const f of REFS.get(k) ?? []) if (!f.drop && v?.[f.key] != null) out.push({ kind: f.kind, of: f.of, value: v[f.key] });
  return out;
}

/** Does S have an edge outside it (anything the round trip may not give back)? */
function edgeOutside(doc, S, K) {
  const objects = doc.objects;
  const groups = resolveGroups(objects);
  for (const [id, o] of Object.entries(objects)) {
    for (const r of refsIn(o)) {
      if (r.kind === "object" && S.has(id) !== S.has(r.value)) return "an object reference across S";
      if (r.kind === "entry" && S.has(id) !== K.includes(r.of)) return "an entry reference across S";
    }
  }
  const outerGroups = new Set([...S].filter((id) => !S.has(groups.get(id) ?? "")).map((id) => groups.get(id) ?? null));
  if (outerGroups.size > 1) return "S's outer members in different groups";
  for (const dim of Object.values(doc.dimensions)) if (S.has(dim.a.objectId) !== S.has(dim.b.objectId)) return "a dimension across S";
  return null;
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

// ─── the harness ───────────────────────────────────────────────────────────

describe("extract and bundle (I9): every set of roots × every K", () => {
  it(
    "one host change each, no other doc written; T and the host each intra-doc and T without runtime state; bundle(extract(S, K), K) is the original when S has no edge outside",
    async () => {
      let refused = 0;
      let exact = 0;
      let withEdges = 0;
      for (const roots of subsets(IDS).filter((r) => r.length)) {
        for (const K of subsets(ROOT_TRAITS)) {
          const repo = new FakeRepo();
          const host = fixture(repo);
          const original = JSON.parse(JSON.stringify(host.doc()));
          const existing = new Set(repo.handles.keys());
          const { api, writes, notices } = fakeApi(repo, host);
          const can = extractable(original, roots);
          const res = await extractObjects(api, roots, K);
          const label = `${roots.join("+")} × [${K.join(",")}]`;
          if (!can.ok) {
            // refused exactly when the tops of S don't share a parent
            refused++;
            expect(res, label).toBe(null);
            expect(writes.size, label).toBe(0);
            expect(repo.handles.size, label).toBe(existing.size);
            continue;
          }
          const S = new Set(can.ids);
          const parents = resolveParents(original.objects);
          const ps = new Set(can.tops.map((id) => parents.get(id) ?? null));
          expect(ps.size, label).toBeLessThanOrEqual(1);
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
          const after = host.doc();
          for (const id of S) expect(after.objects[id], label).toBeUndefined();
          const link = after.objects[res.link];
          expect(isLink(link) && link.sourceUrl === res.url && link.parent === (can.parent ?? null), label).toBe(true);
          expect(link.transform, label).toEqual(T());
          expect(intraDoc(after), label).toEqual([]);
          for (const k of K) expect(after.traits[k], label).toBeUndefined();

          // and back
          const tWrites = writes.get(res.url) ?? 0;
          const before = new Set(repo.handles.keys());
          const back = await bundleLink(api, res.link, K);
          expect(back, label).not.toBe(null);
          expect(writes.get(host.url), label).toBe(2);
          expect(writes.get(res.url) ?? 0, label).toBe(tWrites); // the linked doc is never written
          expect([...writes.keys()].filter((u) => u !== host.url), label).toEqual([]);
          expect([...repo.handles.keys()].filter((u) => !before.has(u)).length, label).toBe(built.length);
          const round = host.doc();
          expect(intraDoc(round), label).toEqual([]);
          // what came back holds no runtime state (the copy left it behind)
          const came = new Set(Object.keys(round.objects).filter((id) => !after.objects[id]));
          expect(runtimeIn({ objects: Object.fromEntries([...came].map((id) => [id, round.objects[id]])), traits: Object.fromEntries(K.map((k) => [k, round.traits[k]])) }), label).toEqual([]);
          const edge = edgeOutside(original, S, K);
          if (edge) {
            withEdges++;
            // what crossed was cleared, and said
            expect(notices.some((n) => n.startsWith("warn:")) || edge.startsWith("S's outer") || edge.startsWith("a dimension"), `${label}: ${edge}`).toBe(true);
            continue;
          }
          exact++;
          const seed = seedOf(repo);
          const want = comparable(original, S, K, seed);
          const got = comparable(round, S, K, seed);
          // order: S comes back as one block where its first member was; exactly the original when S was one block
          const contiguous = (() => {
            const idx = original.order.map((id, i) => (S.has(id) ? i : -1)).filter((i) => i >= 0);
            return idx.length === 0 || idx.at(-1) - idx[0] === idx.length - 1;
          })();
          if (!contiguous) {
            const block = (o) => [...o.filter((id) => !S.has(id)), "|", ...o.filter((id) => S.has(id))];
            expect(block(got.order), label).toEqual(block(want.order));
            got.order = want.order;
          }
          expect(got, label).toEqual(want);
        }
      }
      // every case is one of the three (the counts are the fixture's: 168 sets of roots hang on two parents)
      expect({ refused, exact, withEdges }).toEqual({ refused: 168, exact: 64, withEdges: 272 });
    },
    60_000,
  );
});

describe("extract: the pieces", () => {
  it("refEdits: an object reference by rule, null kept, an entry by rule, a dropped field only when copying", () => {
    const traits = { "t.lever": { target: "a" }, "t.zone": { seat: "p9" }, "t.keep": { doc: "automerge:x", pile: 1 } };
    const r = refEdits(traits, REFS, { object: (v) => (v === "a" ? null : v), entry: () => false, drop: true });
    expect(r.edits).toEqual([
      { trait: "t.lever", key: "target", to: null },
      { trait: "t.zone", key: "seat", to: undefined },
      { trait: "t.keep", key: "doc", to: undefined },
    ]);
    expect(r.lost).toEqual([]);
    expect(r.entries).toEqual([{ trait: "t.zone", key: "seat", label: "Seat", of: "seats" }]);
    const kept = refEdits({ "t.lever": { target: null }, "t.keep": { doc: "automerge:x" } }, REFS, { object: () => undefined, entry: () => true });
    expect(kept.edits).toEqual([]);
  });

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
});
