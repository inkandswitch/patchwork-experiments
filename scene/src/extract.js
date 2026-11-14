// Extract and bundle (COMPOSITION.md §8, invariants I9 and I11): one copy
// rule used in two directions, each followed by one change to the host.
//
//   extract(S, K): objects S of a scene, siblings under one parent p, become
//     a new scene doc T, written whole before anyone can know of it, and a
//     link to T takes their place at p. bundle(L, K): the doc a link L shows
//     is copied into the host in L's place, and L goes; the copy no longer
//     follows that doc, which is never written.
//
// K is an explicit set of root trait keys (Seats, a Sea) that goes along:
// extract moves them from the host's root to T's, bundle copies them from
// T's root to the host's (refused for a key the host already has). Nothing
// infers K: the inspector shows them as checkboxes, none ticked.
//
// What a copy is, here as for paste (transfer.js): everything about an
// object but runtime state. The stage's runtime fields (`claims`, `saved`),
// every trait or trait field an extension's `describes` marks runtime, and
// every `copy: "drop"` field are left behind, so no runtime state ever has
// two writable holders (I11): an extracted game is dealt again. A built
// object gets a render doc of its own, seeded with the build it had, so
// nothing rebuilds and the two never fight over one render doc.
//
// References (I2: none crosses docs). Ids are kept: T is a fresh doc, so
// nothing collides; in bundle an id the host already has is made new, and
// every reference to it follows. Only described references are rewritten
// (an `object` field, an `entry` field naming a key of a root trait), as
// with paste, plus the doc's own: parent, group, the dimensions' anchors and
// `view.start.place`.
//   - extract: in T, a reference to an object of S is kept, one to p becomes
//     null (T's root is where p was), any other is cleared; an entry is kept
//     where K brought its trait with that key. In the host, a reference into
//     S is cleared, and so is an entry into a trait K took. A dimension with
//     both ends on S goes to T; one with one end on S stays, that end frozen
//     where it is (as removing the object would). A start placed on S moves
//     to T, and the host then starts people through the link (arriving at a
//     link arrives as its doc starts people: TOOLS.md §2).
//   - bundle: references among T's objects follow their ids; null stays the
//     root; any other is cleared; an entry is kept where the host (with K)
//     has it. In the host, a reference to L is cleared; what was attached to
//     L stays where it is, attached to L's parent. A start through L becomes
//     T's start.
// Every cleared reference is said, in paste's words.
//
// Placement. extract keeps every transform (p's frame becomes T's root) and
// puts the link at p with no transform of its own, filed in the group S's
// outer members share (else none), its hint the box S takes in p's frame.
// bundle puts T's top objects under L's parent at L · local, filed in L's
// group, in L's place in the order. So bundle(extract(S, K), K) is the
// original on every field but runtime state and render doc identity when S
// has no edge outside it (I9: src/extract.test.js says exactly which edges).
//
// Both are edits (api.edits: undo takes them back as one step), and each
// writes the host once, in one change, computed from the host as it is at
// that moment; the objects copied must still be as they were read, else
// nothing is written (T, made already, is left unlinked: an orphan doc,
// nothing lost).

import { SceneDatatype, newRenderDoc, seededRenderDoc } from "./datatype.js";
import { isGroup, resolveGroups } from "./groups.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";
import { applyMatrix, composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices, normalizeTransform } from "./transform.js";
import { detachAnchor, resolveAnchor } from "./anchors.js";
import { orderedIds } from "./ops.js";
import { listedPackages, packageUrl, packagesToList } from "./packages.js";
import { LINK, atOf, isLink } from "./stage/links.js";
import { assetsFor, cleanObject, describesOf, entryText, hintBoxOf, lostText, missingNeeds, needsText, refsOf, renderSeed, runtimeOf, subtreeOf } from "./transfer.js";

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === "string" && s))] : []);
const IDENTITY = Object.freeze({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

/** Is this transform the identity, exactly? */
function isIdentity(t) {
  const n = normalizeTransform(t);
  return n.scale === 1 && n.position.every((v) => v === 0) && n.rotation.every((v) => v === 0);
}

/** a · b as a transform: b itself, exactly, when a is the identity. Pure. */
export function composeTransforms(a, b) {
  if (isIdentity(a)) return plain(b ?? IDENTITY);
  return decomposeMatrix(multiplyMatrices(composeMatrix(a), composeMatrix(b)));
}

/** A root trait's value as it's copied: without its runtime keys (or nothing, when the whole trait is runtime). Pure. */
function cleanTrait(k, v, runtime) {
  const r = runtime.get(k);
  if (r === true) return undefined;
  const out = plain(v);
  if (r && isMap(out)) for (const key of r) delete out[key];
  return out;
}

/**
 * The described references in one object's traits, rewritten by two rules:
 * `object(id)` → the id it names now (null: the root), or undefined to clear
 * it; `entry(of, key)` → whether an entry of root trait `of` is kept. A null
 * reference stays null; a `copy: "drop"` field is cleared when `drop` says
 * so (a copy leaves it behind; the host's own objects keep theirs). Pure.
 * @returns {{ edits: { trait, key, to }[], lost: { trait, key, label }[], entries: { trait, key, label, of }[] }}
 *   `to` undefined: clear it
 */
export function refEdits(traits, refs, { object, entry, drop = false }) {
  const out = { edits: [], lost: [], entries: [] };
  if (!isMap(traits)) return out;
  for (const [k, v] of Object.entries(traits)) {
    const fields = refs.get(k);
    if (!fields || !isMap(v)) continue;
    for (const f of fields) {
      if (!(f.key in v)) continue;
      const val = v[f.key];
      if (f.drop) {
        if (drop) out.edits.push({ trait: k, key: f.key, to: undefined });
        continue;
      }
      if (val == null) continue;
      if (f.kind === "object") {
        const to = typeof val === "string" ? object(val) : undefined;
        if (to === val) continue;
        out.edits.push({ trait: k, key: f.key, to });
        if (to === undefined) out.lost.push({ trait: k, key: f.key, label: f.label });
      } else if (f.kind === "entry" && !entry(f.of, val)) {
        out.edits.push({ trait: k, key: f.key, to: undefined });
        out.entries.push({ trait: k, key: f.key, label: f.label, of: f.of });
      }
    }
  }
  return out;
}

/** Apply refEdits' edits to a traits map (plain or a draft's), in place. */
function applyRefEdits(traits, edits) {
  for (const e of edits) {
    const t = traits?.[e.trait];
    if (!isMap(t)) continue;
    if (e.to === undefined) delete t[e.key];
    else t[e.key] = e.to;
  }
}

/** The world box of what `ids` draw, in the frame of `parent` (null: the root), from `box(id)` (the stage's frame) else the doc's hints. Pure. */
function boxIn(objects, ids, parent, box) {
  const parents = resolveParents(objects);
  const inv = parent ? invertMatrix(worldMatrix(objects, parent, parents)) : null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    if (isGroup(objects[id])) continue;
    const b = box?.(id) ?? hintBoxOf(objects, id, parents);
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) continue;
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const p = inv ? applyMatrix(inv, [x, y, z]) : [x, y, z];
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
          }
        }
  }
  return min.every(Number.isFinite) ? { min, max } : null;
}

const ENDS = ["a", "b"];
const attached = (anchor, set) => typeof anchor?.objectId === "string" && set.has(anchor.objectId);

/** The scene's start, as written (a plain copy), or null. */
const startOfDoc = (doc) => (isMap(doc?.view?.start) ? plain(doc.view.start) : null);

// ─── extract ───────────────────────────────────────────────────────────────

/**
 * What extracting `roots` takes, before anything is copied: S (the roots,
 * what is attached under them and what is filed in a group among them, at
 * any depth, in the doc's order), its top objects and the one parent p they
 * must share. Pure.
 * @returns {{ ok: false, reason: string } | { ok: true, asked: string[], ids: string[], listed: string[], tops: string[], parent: string | null }}
 */
export function extractable(doc, roots) {
  const objects = isMap(doc?.objects) ? doc.objects : {};
  const asked = strings(roots).filter((id) => objects[id]);
  if (!asked.length) return { ok: false, reason: "Nothing to extract." };
  const { ids, listed } = subtreeOf(objects, asked, doc.order ?? []);
  const S = new Set(ids);
  const parents = resolveParents(objects);
  const tops = ids.filter((id) => !isGroup(objects[id]) && !S.has(parents.get(id) ?? ""));
  const ps = [...new Set(tops.map((id) => parents.get(id) ?? null))];
  if (ps.length > 1) return { ok: false, reason: "These are attached to different things: extract them one at a time." };
  return { ok: true, asked, ids, listed, tops, parent: ps[0] ?? null };
}

/**
 * What extracting `roots` with root traits `traits` (K) would make, from one
 * read of the host doc (S and p as `extractable` says). Pure.
 * @param {object} doc  the host doc
 * @param {string[]} roots
 * @param {{ traits?: string[], runtime?: Map, refs?: Map, box?: (id) => object | null }} [o]
 * @returns {{ ok: false, reason: string } | {
 *   ok: true, ids: string[], parent: string | null, group: string | null, traits: string[],
 *   built: string[],   // the objects of S with a render doc: each gets a copy
 *   doc(o: { renders?: Map, packages?: object[] }): object,   // T, whole
 *   lost: { id, trait, key, label }[], entries: { id, trait, key, label, of }[],   // what T's objects lose
 * }}
 */
export function extractPlan(doc, roots, { traits = [], runtime = new Map(), refs = new Map(), box = null } = {}) {
  const which = extractable(doc, roots);
  if (!which.ok) return which;
  const { asked, ids, listed, tops, parent: p } = which;
  const objects = doc.objects;
  const K = strings(traits);
  const rootTraits = isMap(doc?.traits) ? doc.traits : {};
  const missing = K.filter((k) => rootTraits[k] === undefined);
  if (missing.length) return { ok: false, reason: `This scene has no ${missing.join(", ")} to take along.` };
  const S = new Set(ids);
  const parents = resolveParents(objects);
  const groups = resolveGroups(objects);
  // the group S's outer members (those filed in nothing of S) share, if one
  const outer = ids.filter((id) => !S.has(groups.get(id) ?? ""));
  const gs = [...new Set(outer.map((id) => groups.get(id) ?? null))];
  const group = gs.length === 1 ? gs[0] : null;

  const Kset = new Set(K);
  const lost = [];
  const entries = [];
  const tObjects = {};
  for (const id of ids) {
    const o = cleanObject(objects[id], runtime);
    if (!isGroup(o)) o.parent = S.has(parents.get(id) ?? "") ? parents.get(id) : null;
    o.group = S.has(groups.get(id) ?? "") ? groups.get(id) : null;
    const r = refEdits(o.traits, refs, {
      object: (v) => (S.has(v) ? v : v === p && p != null ? null : undefined),
      entry: (of, key) => Kset.has(of) && isMap(rootTraits[of]) && rootTraits[of][key] != null,
      drop: true,
    });
    applyRefEdits(o.traits, r.edits);
    for (const l of r.lost) lost.push({ id, ...l });
    for (const e of r.entries) entries.push({ id, ...e });
    tObjects[id] = o;
  }
  const built = ids.filter((id) => typeof tObjects[id].renderUrl === "string");

  // dimensions with both ends on S go along, their last known points in T's frame
  const tDims = {};
  for (const [did, dim] of Object.entries(isMap(doc.dimensions) ? doc.dimensions : {})) {
    if (!ENDS.every((e) => attached(dim?.[e], S))) continue;
    const out = plain(dim);
    for (const e of ENDS) out[e] = { ...out[e], world: resolveAnchor(out[e], tObjects).world };
    tDims[did] = out;
  }

  const tTraits = {};
  for (const k of K) {
    const v = cleanTrait(k, rootTraits[k], runtime);
    if (v !== undefined) tTraits[k] = v;
  }
  const urls = ids.map((id) => tObjects[id].sourceUrl).filter((u) => typeof u === "string");
  const start = startOfDoc(doc);
  const startMoves = typeof start?.place === "string" && S.has(start.place);
  const title = String(objects[asked[0]]?.name || "Untitled scene");

  return {
    ok: true,
    ids,
    tops,
    parent: p,
    group,
    traits: K,
    built,
    lost,
    entries,
    title,
    startMoves,
    hint: boxIn(objects, ids, p, box),
    doc({ renders = new Map(), packages = [] } = {}) {
      const t = {};
      SceneDatatype.init(t);
      const objs = plain(tObjects);
      for (const id of built) objs[id].renderUrl = renders.get(objects[id].renderUrl) ?? null;
      const { start: _start, ...display } = isMap(doc.view) ? plain(doc.view) : {};
      const view = { ...t.view, ...display };
      // a start placed on S: T starts people there (the host then starts them through the link)
      if (startMoves) view.start = { ...(start.body ? { body: start.body } : {}), place: start.place };
      return {
        "@patchwork": { type: "scene", ...(isMap(doc["@patchwork"]) ? plain(doc["@patchwork"]) : {}) },
        ...t,
        title,
        objects: objs,
        order: listed.filter((id) => S.has(id)),
        dimensions: tDims,
        traits: tTraits,
        assets: assetsFor(doc.assets, urls),
        packages: plain(packages),
        view,
      };
    },
  };
}

/**
 * The host's one change for an extract: written against the host as it is
 * now (`doc`), from the plan made when T was. Removes S and K's root
 * traits, puts the link at p, clears the references that now cross, keeps
 * or freezes the dimensions, and moves a start placed on S. Null when S or
 * K's traits are no longer as the plan read them (nothing is written). Pure.
 * @returns {null | { change(d): void, lost: { id, trait, key, label }[], entries: { id, trait, key, label, of }[] }}
 */
export function extractHost(doc, before, plan, { link, url, refs = new Map() }) {
  const objects = isMap(doc?.objects) ? doc.objects : {};
  const S = new Set(plan.ids);
  // compare-and-set: what was copied must be what's here
  for (const id of plan.ids) if (JSON.stringify(plain(objects[id])) !== JSON.stringify(plain(before.objects?.[id]))) return null;
  for (const k of plan.traits) if (JSON.stringify(plain(doc.traits?.[k])) !== JSON.stringify(plain(before.traits?.[k]))) return null;
  if (plan.parent != null && !objects[plan.parent]) return null;
  const Kset = new Set(plan.traits);
  const lost = [];
  const entries = [];
  const refFixes = [];
  for (const [id, o] of Object.entries(objects)) {
    if (S.has(id) || !isMap(o?.traits)) continue;
    const r = refEdits(o.traits, refs, { object: (v) => (S.has(v) ? undefined : v), entry: (of) => !Kset.has(of) });
    if (!r.edits.length) continue;
    refFixes.push({ id, edits: r.edits });
    for (const l of r.lost) lost.push({ id, ...l });
    for (const e of r.entries) entries.push({ id, ...e });
  }
  const dimFixes = [];
  for (const [did, dim] of Object.entries(isMap(doc.dimensions) ? doc.dimensions : {})) {
    if (ENDS.every((e) => attached(dim?.[e], S))) dimFixes.push({ id: did, gone: true });
    else for (const e of ENDS) if (attached(dim?.[e], S)) dimFixes.push({ id: did, end: e, to: detachAnchor(dim[e], objects) });
  }
  const order = Array.isArray(doc.order) ? doc.order : [];
  const at = order.findIndex((id) => S.has(id));
  const record = {
    name: plan.title,
    sourceUrl: url,
    providerId: LINK,
    renderUrl: null,
    parent: plan.parent,
    group: plan.group != null && isGroup(objects[plan.group]) ? plan.group : null,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    transform: plain(IDENTITY),
    ...(plan.hint ? { hint: { bounds: plain(plan.hint) } } : {}),
  };
  const start = startOfDoc(doc);
  const startMoves = typeof start?.place === "string" && S.has(start.place);
  return {
    lost,
    entries,
    change(d) {
      for (const id of plan.ids) delete d.objects[id];
      for (let i = d.order.length - 1; i >= 0; i--) if (S.has(d.order[i])) d.order.splice(i, 1);
      d.objects[link] = plain(record);
      d.order.splice(at >= 0 ? Math.min(order.slice(0, at).filter((id) => !S.has(id)).length, d.order.length) : d.order.length, 0, link);
      for (const k of plan.traits) if (d.traits && k in d.traits) delete d.traits[k];
      for (const f of refFixes) applyRefEdits(d.objects[f.id].traits, f.edits);
      for (const f of dimFixes) {
        if (f.gone) delete d.dimensions[f.id];
        else d.dimensions[f.id][f.end] = plain(f.to);
      }
      // a start placed on S goes through the link now: arriving there arrives as T starts people
      if (startMoves) {
        const s = d.view.start;
        if ("body" in s) delete s.body;
        s.place = link;
      }
    },
  };
}

// ─── bundle ────────────────────────────────────────────────────────────────

/**
 * The host's one change for a bundle: the linked doc `linked` (as the link
 * shows it: at its `at` when pinned) copied into the host `doc` in link
 * `linkId`'s place. Ids kept unless the host has them (`newId(prefix)` makes
 * one). Refused when a trait of K is the host's already, or the link isn't
 * one. `renders`: old render doc url → its copy's. `deps`: a pinned link's
 * (a live link inside the pinned doc is copied fixed at the heads the pin
 * held it at). Pure.
 * @returns {{ ok: false, reason: string } | { ok: true, change(d): void, map: Map, tops: string[], lost, entries, needsTraits: string[] }}
 */
export function bundlePlan(doc, linkId, linked, { traits = [], runtime = new Map(), refs = new Map(), describes = new Map(), newId, renders = new Map(), deps = null } = {}) {
  const objects = isMap(doc?.objects) ? doc.objects : {};
  const L = objects[linkId];
  if (!isLink(L)) return { ok: false, reason: "That isn't a linked scene." };
  if (!isMap(linked?.objects)) return { ok: false, reason: "That scene isn't here yet." };
  const K = strings(traits);
  const hostTraits = isMap(doc.traits) ? doc.traits : {};
  const tTraitsAll = isMap(linked.traits) ? linked.traits : {};
  for (const k of K) {
    if (tTraitsAll[k] === undefined) return { ok: false, reason: `That scene has no ${describes.get(k)?.name ?? k} to bring.` };
    if (hostTraits[k] !== undefined) return { ok: false, reason: `This scene already has ${describes.get(k)?.name ?? k}.` };
  }
  const tObjects = linked.objects;
  const tIds = orderedIds(linked);
  const T = new Set(tIds);
  // ids: kept unless the host has them (the link's own included: it goes in the same change)
  const taken = new Set(Object.keys(objects));
  const map = new Map();
  for (const id of tIds) {
    let to = id;
    while (taken.has(to)) to = newId(isGroup(tObjects[id]) ? "g" : "o");
    taken.add(to);
    map.set(id, to);
  }
  const tParents = resolveParents(tObjects);
  const tGroups = resolveGroups(tObjects);
  const lParent = typeof L.parent === "string" && objects[L.parent] && !isGroup(objects[L.parent]) ? L.parent : null;
  const lGroup = typeof L.group === "string" && isGroup(objects[L.group]) ? L.group : null;
  const after = { ...hostTraits };
  const addTraits = {};
  for (const k of K) {
    const v = cleanTrait(k, tTraitsAll[k], runtime);
    if (v !== undefined) addTraits[k] = after[k] = v;
  }
  const lost = [];
  const entries = [];
  const made = {};
  const tops = [];
  for (const id of tIds) {
    const o = cleanObject(tObjects[id], runtime);
    const to = map.get(id);
    const tp = tParents.get(id) ?? null;
    const tg = tGroups.get(id) ?? null;
    o.group = tg != null ? map.get(tg) : lGroup;
    // (a group is attached to nothing)
    if (!isGroup(o) && tp != null) o.parent = map.get(tp);
    else if (!isGroup(o)) {
      o.parent = lParent;
      o.transform = composeTransforms(L.transform, o.transform);
      tops.push(to);
    }
    if (typeof o.renderUrl === "string") o.renderUrl = renders.get(o.renderUrl) ?? null;
    // inside a pinned doc a live link was shown at the pin's heads: its copy stays there
    if (deps && isLink(o) && !atOf(o) && Array.isArray(deps[o.sourceUrl])) o.at = { heads: [...deps[o.sourceUrl]], deps: plain(deps) };
    const r = refEdits(o.traits, refs, {
      object: (v) => (T.has(v) ? map.get(v) : undefined),
      entry: (of, key) => isMap(after[of]) && after[of][key] != null,
      drop: true,
    });
    applyRefEdits(o.traits, r.edits);
    for (const l of r.lost) lost.push({ id: to, ...l });
    for (const e of r.entries) entries.push({ id: to, ...e });
    made[to] = o;
  }
  // the host as it will be, for the dimensions' last known points
  const lWorld = worldMatrix(objects, linkId);
  const afterObjects = { ...objects, ...made };
  delete afterObjects[linkId];
  const dimIds = new Set(Object.keys(isMap(doc.dimensions) ? doc.dimensions : {}));
  const dims = {};
  for (const [did, dim] of Object.entries(isMap(linked.dimensions) ? linked.dimensions : {})) {
    let to = did;
    while (dimIds.has(to)) to = newId("d");
    dimIds.add(to);
    const out = plain(dim);
    for (const e of ENDS) {
      const a = out[e];
      if (!isMap(a)) continue;
      if (attached(a, T)) out[e] = { ...a, objectId: map.get(a.objectId), world: null };
      else out[e] = { objectId: null, local: null, world: applyMatrix(lWorld, resolveAnchor(a, tObjects).world) };
    }
    for (const e of ENDS) if (isMap(out[e]) && out[e].objectId) out[e].world = resolveAnchor(out[e], afterObjects).world;
    dims[to] = out;
  }
  // what's attached to the link stays where it is, on the link's parent
  const children = Object.entries(objects)
    .filter(([id, o]) => id !== linkId && o?.parent === linkId && !isGroup(o))
    .map(([id, o]) => ({ id, transform: composeTransforms(L.transform, o.transform) }));
  const refFixes = [];
  for (const [id, o] of Object.entries(objects)) {
    if (id === linkId || !isMap(o?.traits)) continue;
    const r = refEdits(o.traits, refs, { object: (v) => (v === linkId ? undefined : v), entry: () => true });
    if (!r.edits.length) continue;
    refFixes.push({ id, edits: r.edits });
    for (const l of r.lost) lost.push({ id, ...l });
  }
  const dimFixes = [];
  for (const [did, dim] of Object.entries(isMap(doc.dimensions) ? doc.dimensions : {})) {
    for (const e of ENDS) if (dim?.[e]?.objectId === linkId) dimFixes.push({ id: did, end: e, to: detachAnchor(dim[e], objects) });
  }
  const urls = tIds.map((id) => made[map.get(id)].sourceUrl).filter((u) => typeof u === "string");
  const assets = assetsFor(linked.assets, urls, doc.assets);
  const have = new Set(listedPackages(doc));
  const packages = (Array.isArray(linked.packages) ? linked.packages : []).filter((e) => {
    const u = packageUrl(e?.url);
    if (!u || have.has(u)) return false;
    have.add(u);
    return true;
  });
  const start = startOfDoc(doc);
  const tStart = startOfDoc(linked);
  const startThrough = start?.place === linkId;
  const nextStart = startThrough
    ? {
        ...(tStart?.body ? { body: tStart.body } : {}),
        ...(typeof tStart?.place === "string" ? { place: map.get(tStart.place) ?? tStart.place } : {}),
        ...(start.home ? { home: start.home } : {}),
      }
    : null;
  const needsTraits = Object.values(made).flatMap((o) => Object.keys(o.traits ?? {}));
  return {
    ok: true,
    map,
    tops,
    lost,
    entries,
    needsTraits,
    change(d) {
      for (const [id, o] of Object.entries(made)) d.objects[id] = plain(o);
      for (const c of children) {
        const o = d.objects[c.id];
        if (!o) continue;
        o.parent = lParent;
        o.transform = plain(c.transform);
      }
      for (const f of refFixes) if (d.objects[f.id]) applyRefEdits(d.objects[f.id].traits, f.edits);
      for (const f of dimFixes) if (d.dimensions[f.id]) d.dimensions[f.id][f.end] = plain(f.to);
      for (const [did, dim] of Object.entries(dims)) d.dimensions[did] = plain(dim);
      for (const [k, v] of Object.entries(addTraits)) d.traits[k] = plain(v);
      for (const [k, a] of Object.entries(assets)) if (!d.assets[k]) d.assets[k] = plain(a);
      for (const e of packages) d.packages.push(plain(e));
      if (nextStart) d.view.start = plain(nextStart);
      delete d.objects[linkId];
      const i = d.order.indexOf(linkId);
      const ids = tIds.map((id) => map.get(id));
      if (i >= 0) d.order.splice(i, 1, ...ids);
      else d.order.push(...ids);
    },
  };
}

// ─── doing it, through a stage's own api ───────────────────────────────────

async function metasOf(api, type) {
  try {
    const reg = await api.registry(type);
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

/** What the scene's extensions say about traits: { describes, runtime, refs }. */
export async function traitRules(api) {
  const describes = describesOf(await metasOf(api, "scene:extension"));
  return { describes, runtime: runtimeOf(describes), refs: refsOf(describes) };
}

/** A render doc of its own for each of these objects' (old url → new url), seeded with the build it had. */
async function copyRenders(api, objects, ids) {
  const out = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const o = objects[id];
      const from = o?.renderUrl;
      if (typeof from !== "string" || out.has(from)) return;
      let seed = null;
      try {
        seed = renderSeed((await api.repo.find(from))?.doc?.());
      } catch {
        seed = null;
      }
      const fresh = newRenderDoc({ title: o.name, parent: o.sourceUrl ?? null, providerId: seed?.providerId ?? o.providerId ?? null, params: {} });
      const h = await api.repo.create2(seededRenderDoc(fresh, seed));
      out.set(from, h.url);
    }),
  );
  return out;
}

const nameOf = (describes, k) => String(describes.get(k)?.name ?? k);

/** Say what a copy cleared, in paste's words: each (trait, key) once. */
function tell(api, describes, { lost = [], entries = [] }) {
  const told = new Set();
  for (const e of entries) {
    const key = `e|${e.trait}.${e.key}`;
    if (told.has(key)) continue;
    told.add(key);
    api.notify(entryText({ name: nameOf(describes, e.trait), label: e.label, ofName: nameOf(describes, e.of) }), "warn");
  }
  for (const l of lost) {
    const key = `l|${l.trait}.${l.key}`;
    if (told.has(key)) continue;
    told.add(key);
    api.notify(lostText({ name: nameOf(describes, l.trait), label: l.label }), "warn");
  }
}

/**
 * Extract these objects (and K's root traits) into a new scene doc, linked
 * in their place. One edit; the host written once.
 * @returns {Promise<{ url: string, link: string } | null>}
 */
export async function extractObjects(api, roots, traits = []) {
  if (!api.writable()) return null;
  const live = () => !api.signal?.aborted;
  const { describes, runtime, refs } = await traitRules(api);
  if (!live()) return null;
  const before = api.doc();
  const plan = extractPlan(before, roots, { traits, runtime, refs, box: (id) => api.box?.(id) ?? null });
  if (!plan.ok) {
    api.notify(plan.reason, "error");
    return null;
  }
  const renders = await copyRenders(api, before.objects, plan.built);
  // the packages its contents come from, as the host's reconcile would list them for it
  const registries = { "scene:source": await metasOf(api, "scene:source"), "scene:extension": await metasOf(api, "scene:extension") };
  const draft = plan.doc({ renders });
  const packages = packagesToList({ doc: { ...draft, packages: [] }, registries }).map((url) => ({ url }));
  const handle = await api.repo.create2(plan.doc({ renders, packages }));
  if (!live() || !api.writable()) return null;
  const link = api.newId("o");
  const host = extractHost(api.doc(), before, plan, { link, url: handle.url, refs });
  if (!host) {
    api.notify("It changed while it was being extracted: nothing was changed here. Try again.", "error");
    return null;
  }
  const edit = api.edits("Extract");
  try {
    edit.change(host.change);
  } finally {
    edit.end();
  }
  tell(api, describes, { lost: [...plan.lost, ...host.lost], entries: [...plan.entries, ...host.entries] });
  api.view.select(link);
  return { url: handle.url, link };
}

/**
 * Bundle a link: copy the scene it shows (at its version, when it is fixed
 * at one) into this one in its place, with K's root traits, and remove the
 * link. One edit; the host written once; the linked doc never written.
 * @returns {Promise<string[] | null>} the new ids of its top objects
 */
export async function bundleLink(api, linkId, traits = []) {
  if (!api.writable()) return null;
  const live = () => !api.signal?.aborted;
  const L = api.doc().objects?.[linkId];
  if (!isLink(L)) {
    api.notify("That isn't a linked scene.", "error");
    return null;
  }
  const at = atOf(L);
  let linked = null;
  try {
    const h = await api.repo.find(L.sourceUrl);
    linked = at ? (h.view?.(at.heads)?.doc?.() ?? null) : h.doc();
  } catch (err) {
    api.notify(`Couldn't open that scene: ${err?.message ?? err}`, "error");
    return null;
  }
  if (!live()) return null;
  const { describes, runtime, refs } = await traitRules(api);
  if (!live()) return null;
  const check = bundlePlan(api.doc(), linkId, linked, { traits, runtime, refs, describes, newId: api.newId, deps: at?.deps ?? null });
  if (!check.ok) {
    api.notify(check.reason, "error");
    return null;
  }
  const renders = await copyRenders(api, linked.objects, orderedIds(linked));
  if (!live() || !api.writable()) return null;
  // planned again against the host as it is now (the copies above took a moment)
  const plan = bundlePlan(api.doc(), linkId, linked, { traits, runtime, refs, describes, newId: api.newId, renders, deps: at?.deps ?? null });
  if (!plan.ok) {
    api.notify(plan.reason, "error");
    return null;
  }
  const edit = api.edits("Bundle");
  try {
    edit.change(plan.change);
  } finally {
    edit.end();
  }
  tell(api, describes, plan);
  for (const n of missingNeeds(describes, plan.needsTraits, api.doc()?.traits)) api.notify(needsText(n), "warn");
  if (plan.tops.length) api.view.select(plan.tops[0]);
  return plan.tops.length ? plan.tops : null;
}

