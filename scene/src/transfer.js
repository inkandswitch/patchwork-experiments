// Copying objects into a scene from another one (or from itself): an outline
// row dragged into another scene's view or tree, Copy and Paste
// (EDITOR.md, "Copying objects"). Shared by the outline (where a row drag
// starts and where it lands in a tree) and scene.transfer (the view's drop,
// Copy, Paste).
//
// What a copy is:
//   - the objects named, everything attached under them (and under those)
//     and, for a group, everything filed in it, with new ids. Their
//     attachments and group membership among themselves are kept, and so is
//     every transform below the top (the top-level ones are placed);
//   - everything about them but runtime state: name, colour, tags, traits,
//     hint, locked, infoUrl, `at`… The stage's own runtime fields (`claims`,
//     and `saved`, the world clock's checkpoint stamp) are never copied, nor any trait field an extension's `describes` marks
//     as runtime (`runtime: true` for the whole trait, `runtime: ["motion"]`
//     for some of its keys, or a field spec with `runtime: true`). Pose holds
//     and presence are never in the doc, so never copied;
//   - a file object (a GLB file) shares its file: the bytes are
//     immutable. The source scene's `assets` entries naming a copied file go
//     with it, under the same key, unless this scene already has that key;
//   - a built object (one with a render doc) gets a render doc of its own in
//     this scene, for the same source and provider, with the same params and
//     the build it had (so nothing rebuilds until someone changes it here):
//     tuning one scene's copy never changes the other's.
//   - references in traits, by their described field kinds: an `object`
//     field follows its object when that was copied too, is kept in the same
//     scene, and cleared in another; an `entry` field is kept where this
//     scene has that entry; a `copy: "drop"` field is left behind;
//   - where it lands, it rests on its base unless it snaps to a connector
//     (the payload's `lift`).
// A copied object whose trait has an `entry` field naming a scene trait this
// scene lacks (an entry naming the scene's list of something it doesn't keep) is copied all the same,
// with a notice naming what to add. Nothing adds scene traits behind anyone's
// back.

import { ROW_MIME, parseAutomergeUrl } from "./dnd.js";
import { isGroup, resolveGroups } from "./groups.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";
import { composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices } from "./transform.js";
import { CARRY, intoSnap } from "./carry-rules.js";
import { editor } from "./parts/editor.js";

export { ROW_MIME };

/**
 * The drag's summary, in its type list (only types are readable during
 * dragover, and they come back lower-cased): how far the dragged object
 * reaches from its origin in plan, `application/x-scene-object-size;r=1.25`
 * (scene units), so a view can show a ring that size while it's dragged.
 */
export const SIZE_TYPE = "application/x-scene-object-size";
/**
 * Which scene a row drag comes from, as a type (lower-cased document id), so
 * a view can tell its own rows from another scene's during dragover:
 * `application/x-scene-object-from;2j9knn…`.
 */
export const FROM_TYPE = "application/x-scene-object-from";
/** Fields the stage keeps that are about now, not about the object: never copied. */
export const RUNTIME_FIELDS = Object.freeze(["claims", "saved"]);

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []);
const docId = (url) => String(parseAutomergeUrl(url) ?? "").replace(/^automerge:/, "");

// ─── the payload ───────────────────────────────────────────────────────────

/**
 * What a row is as a document outside the scene: its render doc (the way the
 * sidebar's own drags look, so another tool's drop target can take it; see
 * README "Consuming a render"), or for a file object its GLB
 * file. null for a group or an object with neither.
 * @returns {{ url: string, name?: string, type?: string } | null}
 */
export function rowDocument(o) {
  if (!o || isGroup(o)) return null;
  const url = o.renderUrl ?? o.sourceUrl ?? null;
  if (typeof url !== "string" || !url.startsWith("automerge:")) return null;
  return o.renderUrl ? { url, name: o.name, type: "scene-render" } : { url, name: o.name };
}

/**
 * The row payload (ROW_MIME, and the clipboard's): `{ scene, id, ids, lift?,
 * copy? }`; `id` is the first, for a reader that takes one. `lift`: how far the copy's
 * reference point (the top object's origin) is above its lowest point, so it
 * lands on its base (measured where it's drawn, in the scene it's from).
 * `copy`: which Copy this was (a paste counts its repeats by it).
 */
export function rowPayload(scene, ids, extra = {}) {
  const list = strings(ids);
  const out = { scene, id: list[0] ?? null, ids: list };
  if (Number.isFinite(extra?.lift)) out.lift = extra.lift;
  if (typeof extra?.copy === "string" && extra.copy) out.copy = extra.copy;
  return JSON.stringify(out);
}

/** A row payload read back, or null. @returns {{ scene: string | null, id: string, ids: string[], lift?: number, copy?: string } | null} */
export function readRowPayload(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    const ids = strings(v?.ids);
    if (!ids.length) return null;
    const out = { scene: typeof v.scene === "string" ? v.scene : null, id: ids[0], ids };
    if (Number.isFinite(v.lift)) out.lift = v.lift;
    if (typeof v.copy === "string" && v.copy) out.copy = v.copy;
    return out;
  } catch {
    return null;
  }
}

/** The summary types for a row drag: `{ [type]: "1" }` (each set with a value, as some browsers drop empty ones). */
export function summaryTypes(scene, radius = null) {
  const out = {};
  const id = docId(scene).toLowerCase();
  if (id) out[`${FROM_TYPE};${id}`] = "1";
  if (Number.isFinite(radius) && radius > 0) out[`${SIZE_TYPE};r=${Number(radius.toPrecision(4))}`] = "1";
  return out;
}

const typesOf = (dt) => (dt?.types ? [...dt.types].map(String) : []);

/** Is this a row drag (or row paste)? Readable during dragover. */
export const isRowDrag = (dt) => typesOf(dt).includes(ROW_MIME);

/** The size a row drag says, or null. */
export function sizeOf(dt) {
  for (const t of typesOf(dt)) {
    const m = /^application\/x-scene-object-size;r=([0-9.eE+-]+)$/i.exec(t);
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }
  return null;
}

/** Does a row drag come from this scene? true, false, or null when it doesn't say. */
export function fromScene(dt, url) {
  const id = docId(url).toLowerCase();
  for (const t of typesOf(dt)) {
    const m = /^application\/x-scene-object-from;(.+)$/i.exec(t);
    if (m) return m[1].toLowerCase() === id;
  }
  return null;
}

// What's being dragged out of an outline on this page, if anything: a view
// beside it (another scene, same page) reads the tags and name here during
// dragover, which the types can't carry. One drag at a time on a page.
let dragging = null;
export const startDrag = (info) => void (dragging = info ? Object.freeze({ ...info }) : null);
export const endDrag = (info = null) => void (info == null || dragging?.scene === info.scene ? (dragging = null) : null);
export const currentDrag = () => dragging;

// What Copy put on the clipboard, on this page: Paste from the menu reads it
// (a page can't read the clipboard without asking), and so does a paste
// whose text is what Copy wrote (the menu's Copy can only write text).
let held = null;
export const hold = (info) => void (held = info ? Object.freeze({ ...info, ids: [...info.ids] }) : null);
export const heldCopy = () => held;

// ─── what a copy is made of (pure) ─────────────────────────────────────────

/**
 * Every object to copy for these roots, parents and groups before what's in
 * them: the roots, what's attached under them, what's filed in a copied
 * group, at any depth. `order` (the scene's) breaks ties. Pure.
 * @returns {{ ids: string[], listed: string[] }}  ids: creation order; listed: the scene's order
 */
export function subtreeOf(objects, roots, order = []) {
  const all = Object.keys(objects ?? {});
  const parents = resolveParents(objects);
  const groups = resolveGroups(objects);
  const set = new Set(strings(roots).filter((id) => objects?.[id]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of all) {
      if (set.has(id)) continue;
      const p = parents.get(id);
      const g = groups.get(id);
      if ((p != null && set.has(p)) || (g != null && set.has(g))) {
        set.add(id);
        grew = true;
      }
    }
  }
  const seen = new Set();
  const listed = [];
  for (const id of [...(Array.isArray(order) ? order : []), ...all]) {
    if (set.has(id) && !seen.has(id)) {
      seen.add(id);
      listed.push(id);
    }
  }
  // creation order: each after its parent and its group, if those are copied too
  const ids = [];
  const done = new Set();
  let rest = listed;
  while (rest.length) {
    const next = [];
    for (const id of rest) {
      const p = parents.get(id);
      const g = groups.get(id);
      if ((p != null && set.has(p) && !done.has(p)) || (g != null && set.has(g) && !done.has(g))) next.push(id);
      else {
        ids.push(id);
        done.add(id);
      }
    }
    if (next.length === rest.length) {
      ids.push(...next); // can't happen (resolve* breaks loops); never spin
      break;
    }
    rest = next;
  }
  return { ids, listed };
}

/** Each trait key's description, the first plugin's in registry order (as the inspector reads them). Pure. */
export function describesOf(metas) {
  const out = new Map();
  for (const m of Array.isArray(metas) ? metas : []) {
    for (const [k, d] of Object.entries(m?.describes ?? {})) if (!out.has(k) && d && typeof d === "object") out.set(k, d);
  }
  return out;
}

/**
 * What of each trait is runtime state, never copied: trait key → true (all
 * of it) or a Set of its keys. From `describes[key].runtime` (true, or a list
 * of keys) and any field spec with `runtime: true`. Pure.
 */
export function runtimeOf(describes) {
  const out = new Map();
  for (const [k, d] of describes ?? []) {
    if (d.runtime === true) {
      out.set(k, true);
      continue;
    }
    const keys = new Set([...strings(d.runtime), ...(Array.isArray(d.fields) ? d.fields : []).filter((f) => f?.runtime === true && typeof f.key === "string").map((f) => f.key)]);
    if (keys.size) out.set(k, keys);
  }
  return out;
}

/** Traits as they're copied (an object's, or a scene's root traits): a fresh plain copy without runtime state. Pure. */
export function cleanTraits(traits, runtime = new Map()) {
  const out = plain(traits) ?? {};
  for (const [k, v] of Object.entries(out)) {
    const r = runtime.get(k);
    if (r === true) delete out[k];
    else if (r && v && typeof v === "object" && !Array.isArray(v)) for (const key of r) delete v[key];
  }
  return out;
}

/** An object as it's copied: a fresh plain copy without runtime state. Pure. */
export function cleanObject(o, runtime = new Map()) {
  const out = plain(o) ?? {};
  for (const f of RUNTIME_FIELDS) delete out[f];
  if (out.traits && typeof out.traits === "object") out.traits = cleanTraits(out.traits, runtime);
  return out;
}

/**
 * The fields of each trait that point at something in the scene, or that a
 * copy leaves behind: trait key → [{ key, kind, of?, label?, drop? }], from
 * `describes[key].fields`: `kind: "object"` (an object or group id in this
 * scene), `kind: "entry"` (a key of the scene trait `of`), and any field with
 * `copy: "drop"` (a document keyed to this object's id, say). Pure.
 */
export function refsOf(describes) {
  const out = new Map();
  for (const [k, d] of describes ?? []) {
    const fields = (Array.isArray(d?.fields) ? d.fields : []).filter((f) => typeof f?.key === "string" && (f.copy === "drop" || f.kind === "object" || (f.kind === "entry" && typeof f.of === "string")));
    if (fields.length) out.set(k, fields.map((f) => ({ key: f.key, kind: f.kind, of: f.of, label: f.label ?? f.key, drop: f.copy === "drop" })));
  }
  return out;
}

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The described references in one object's traits, rewritten by two rules:
 * `object(id)` → the id it names now (null: the root), or undefined to clear
 * it; `entry(of, key)` → whether an entry of root trait `of` is kept. A null
 * reference stays null; a `copy: "drop"` field is cleared when `drop` says
 * so (a copy leaves it behind; an object staying where it is keeps its own).
 * The one rewriter: what a copy does to its references (copyRefs) and what
 * the objects left in a doc do when something leaves it or arrives
 * (extract.js) both go through it. Pure.
 * @returns {{ edits: { trait, key, to }[], lost: { trait, key, label }[], entries: { trait, key, label, of }[] }}
 *   `to` undefined: clear it
 */
export function refEdits(traits, refs, { object, entry, drop = false }) {
  const out = { edits: [], lost: [], entries: [] };
  if (!isMap(traits)) return out;
  for (const [k, v] of Object.entries(traits)) {
    const fields = refs?.get?.(k);
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
export function applyRefEdits(traits, edits) {
  for (const e of edits) {
    const t = traits?.[e.trait];
    if (!isMap(t)) continue;
    if (e.to === undefined) delete t[e.key];
    else t[e.key] = e.to;
  }
}

/** Does a scene with these root traits have entry `key` of trait `of`? (An `entry` reference is kept by it.) */
export const entryIn = (sceneTraits) => (of, key) => isMap(sceneTraits?.[of]) && typeof key === "string" && sceneTraits[of][key] != null;

/**
 * The copy rule for one copied object's references, the same for paste,
 * extract and bundle (its `traits` are a fresh copy, changed in place):
 *   - an `object` field naming a copied object follows it (`map`: old id →
 *     its id in the copy, null for the copy's root); naming anything else
 *     it is `outside(id)`: kept (paste in its own scene) or, undefined,
 *     cleared (`lost`);
 *   - an `entry` field is kept where `entries(of, key)` (the scene it lands
 *     in has that entry), else cleared (`entries`: what it needed);
 *   - a `copy: "drop"` field is left behind.
 * Ids are mapped before anything is written, so every reference is written
 * once, already right. Pure.
 * @returns {{ lost: { trait, key, label }[], entries: { trait, key, label, of }[] }}
 */
export function copyRefs(traits, refs, { map = new Map(), outside = () => undefined, entries = () => false } = {}) {
  const r = refEdits(traits, refs, { object: (v) => (map.has(v) ? map.get(v) : outside(v)), entry: entries, drop: true });
  applyRefEdits(traits, r.edits);
  return { lost: r.lost, entries: r.entries };
}

const lower = (s) => String(s).toLowerCase();
const article = (s) => (/^[aeiou]/i.test(String(s)) ? "an" : "a");
/** A name with its article ("a box", "an orb"); a plural takes none ("boxes"). */
const some = (s) => (/[^s]s$/i.test(String(s)) ? lower(s) : `${article(s)} ${lower(s)}`);

/** "This <thing> needs <a need>: add <Need> to the scene." */
export const needsText = ({ name, needName }) => `This ${lower(name)} needs ${some(needName)}: add ${needName} to the scene.`;
/** "This <thing>'s <field> isn't one of this scene's <entries>: choose one in the inspector." */
export const entryText = ({ name, label, ofName }) => `This ${lower(name)}'s ${lower(label)} isn't one of this scene's ${lower(ofName)}: choose one in the inspector.`;
/** "This <thing>'s <field> was left behind: choose one in the inspector." */
export const lostText = ({ name, label }) => `This ${lower(name)}'s ${lower(label)} was left behind: choose one in the inspector.`;

/** The scene's `assets` entries naming these files, that `have` hasn't got under the same key: { key: entry }. Pure. */
export function assetsFor(assets, urls, have = {}) {
  const want = new Set(strings([...(urls ?? [])]));
  const out = {};
  for (const [k, a] of Object.entries(assets ?? {})) {
    if (typeof a?.url === "string" && want.has(a.url) && !have?.[k]) out[k] = plain(a);
  }
  return out;
}

/** What a render doc gives its copy: params, and the build it had (with its GLB, which is immutable). Pure. */
export function renderSeed(r) {
  if (!r || typeof r !== "object") return null;
  const out = { providerId: r.providerId ?? null, parent: r.parent ?? null, params: plain(r.params ?? {}) };
  if (typeof r.glbUrl === "string" && r.builtFrom && typeof r.builtFrom === "object") {
    out.glbUrl = r.glbUrl;
    out.builtFrom = plain(r.builtFrom);
    out.builtAt = Number.isFinite(r.builtAt) ? r.builtAt : null;
    out.bounds = plain(r.bounds ?? null);
  }
  if (r.pinned === true) out.pinned = true;
  return out;
}

// ─── where it goes (pure) ──────────────────────────────────────────────────

const yawOf = (m) => Math.atan2(m[8], m[10]);

/**
 * What a set of top-level objects is moved by: one object's own origin and
 * heading (and its world: `world`, which a connector's frame turns); several,
 * the middle of their origins (at the lowest), heading 0.
 */
export function referenceOf(worlds) {
  if (worlds.length === 1) return { point: [worlds[0][12], worlds[0][13], worlds[0][14]], yaw: yawOf(worlds[0]), world: worlds[0].slice() };
  if (!worlds.length) return { point: [0, 0, 0], yaw: 0 };
  const xs = worlds.map((m) => m[12]);
  const ys = worlds.map((m) => m[13]);
  const zs = worlds.map((m) => m[14]);
  return { point: [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys), (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0 };
}

/**
 * The rigid move that puts `ref` at `point`, turned as a connector turns
 * what is set down on it. One object (`ref.world`) is turned the carry's way
 * (carry-rules intoSnap: into a connector's whole frame, `rotation`, Euler
 * XYZ, world, face up or down as it was; else about the vertical to face
 * `yaw`). Several are turned about the vertical through `ref.point` from
 * heading `ref.yaw` to `yaw`. null: as it was. Column-major 4×4.
 */
export function moveBy(ref, point, yaw = null, rotation = null) {
  if (ref.world) {
    const W = ref.world;
    const into = intoSnap(W, { rotation, yaw });
    const turned = [0, 1, 2, 4, 5, 6, 8, 9, 10].some((i) => into[i] !== W[i]);
    const m = turned ? multiplyMatrices(into, invertMatrix(W)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m[12] += point[0] - ref.point[0];
    m[13] += point[1] - ref.point[1];
    m[14] += point[2] - ref.point[2];
    return m;
  }
  const t = yaw == null ? 0 : yaw - ref.yaw;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const [px, py, pz] = ref.point;
  // T(point) · Ry(t) · T(−ref)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, point[0] - (c * px + s * pz), point[1] - py, point[2] - (-s * px + c * pz), 1];
}

/**
 * A landing on a connector (`land.snapped`) for a copy whose one top-level
 * object is a carried piece (the `scene.carry` trait) with a load hint: moved
 * so that the piece, as moveBy turns it there, has the middle of its
 * footprint over the connector and its underside at the connector's height,
 * as the carry sets a piece on one (the carry's rays find the surface; a
 * copy has none, and a connector is where its surface is). So a piece lands
 * on a connector where it would carried, whichever way the connector is
 * written (a whole frame or a yaw): a tile stood on edge in a rack's place
 * sits on the rack, not half through it. Anything else keeps the parts
 * bin's rule, its origin at the connector (a connector for a part, a mast
 * step, is made for the part's origin), as do several objects and one
 * without a hint. Pure.
 */
export function restOnConnector(objects, roots, order, land) {
  if (!land?.snapped) return land;
  const parents = resolveParents(objects);
  const tops = topsOf(objects, subtreeOf(objects, roots, order).ids, parents);
  if (tops.length !== 1) return land;
  const o = objects[tops[0]];
  const b = o?.hint?.bounds;
  if (!o?.traits || !Object.hasOwn(o.traits, CARRY) || o.traits[CARRY] == null || !Array.isArray(b?.min) || !Array.isArray(b?.max)) return land;
  const w = worldMatrix(objects, tops[0], parents);
  const box = boxUnder(b, multiplyMatrices(moveBy(referenceOf([w]), land.point, land.yaw ?? null, land.rotation ?? null), w));
  if (!box) return land;
  const d = [land.point[0] - (box.min[0] + box.max[0]) / 2, land.point[1] - box.min[1], land.point[2] - (box.min[2] + box.max[2]) / 2];
  return { ...land, point: land.point.map((v, k) => v + d[k]) };
}

/** A body box (`hint.bounds`: { min, max }) under a matrix, boxed again; null if it isn't finite. Pure. */
function boxUnder(b, m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const p = [x, y, z].map(Number);
        for (let i = 0; i < 3; i++) {
          const v = m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i];
          min[i] = Math.min(min[i], v);
          max[i] = Math.max(max[i], v);
        }
      }
  return min.every(Number.isFinite) && max.every(Number.isFinite) ? { min, max } : null;
}

/** The copy's top-level objects: what isn't a group and isn't attached under something copied. Pure. */
function topsOf(objects, ids, parents) {
  const set = new Set(ids);
  return ids.filter((id) => !isGroup(objects[id]) && !set.has(parents.get(id) ?? ""));
}

/**
 * How far a copy's reference point (referenceOf: one top object's origin;
 * several, the lowest of theirs) is above its lowest point, so it can land
 * on its base rather than its origin: a crate whose origin is at its middle
 * sits that much above where it lands. `box(id)` and `worldOf(id)` are where
 * each is drawn (the api's), or from the doc (hintBoxOf). Null when nothing
 * has a box. Pure.
 */
export function liftOf(objects, roots, order, { box, worldOf }) {
  const { ids } = subtreeOf(objects, roots, order);
  const parents = resolveParents(objects);
  const ys = topsOf(objects, ids, parents)
    .map((id) => worldOf(id)?.[13])
    .filter(Number.isFinite);
  if (!ys.length) return null;
  let low = Infinity;
  for (const id of ids) {
    if (isGroup(objects[id])) continue;
    const b = box(id);
    if (b && Number.isFinite(b.min?.[1])) low = Math.min(low, b.min[1]);
  }
  return Number.isFinite(low) ? Math.min(...ys) - low : null;
}

/** An object's world box from its `hint.bounds` (its file's own frame) and the doc's transforms, or null. Pure. */
export function hintBoxOf(objects, id, parents = resolveParents(objects)) {
  const b = objects?.[id]?.hint?.bounds;
  if (!Array.isArray(b?.min) || !Array.isArray(b?.max)) return null;
  return boxUnder(b, worldMatrix(objects, id, parents));
}

/** The local transform that shows a world matrix under a parent's world (null: the root). */
export function localOf(parentWorld, world) {
  const inv = parentWorld ? invertMatrix(parentWorld) : null;
  return decomposeMatrix(inv ? multiplyMatrices(inv, world) : world);
}

/**
 * The whole copy as a plan: what to make, in what order, where each top-level
 * one goes. Pure.
 * @param {{
 *   objects: object, order?: string[], roots: string[],
 *   runtime?: Map,                                  // runtimeOf(describes)
 *   target: { land?: { point, yaw?, rotation?, parent?, parentWorld?, group? }, // where it lands (a drop, a paste; `rotation`: a connector's frame; `group`: the tree's, for the top)
 *             beside?: { offset: number[] } },                     // a duplicate in its own scene
 * }} o
 * @returns {{ items: { from, group: boolean, data, top: boolean, parent, parentIn, groupOf, groupIn, transform, world }[], listed: string[], tops: string[] }}
 *   `parent` and `groupOf` are source ids (copied too: mapped as they're
 *   made); `parentIn` and `groupIn` are ids in the target scene (`groupIn`
 *   undefined: whatever its parent is in). `world` is where it ends up.
 */
export function planCopy({ objects, order = [], roots, runtime = new Map(), target = {} }) {
  const { ids, listed } = subtreeOf(objects, roots, order);
  const set = new Set(ids);
  const parents = resolveParents(objects);
  const groups = resolveGroups(objects);
  const tops = topsOf(objects, ids, parents);
  const worlds = new Map(tops.map((id) => [id, worldMatrix(objects, id, parents)]));
  let move = null;
  if (target.land) move = moveBy(referenceOf([...worlds.values()]), target.land.point, target.land.yaw ?? null, target.land.rotation ?? null);
  else if (target.beside) {
    const [dx = 0, dy = 0, dz = 0] = target.beside.offset ?? [];
    move = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
  }
  const items = ids.map((id) => {
    const o = objects[id];
    const data = cleanObject(o, runtime);
    const g = groups.get(id) ?? null;
    const p = parents.get(id) ?? null;
    const group = isGroup(o);
    const item = { from: id, group, data, top: tops.includes(id), parent: null, parentIn: null, groupOf: null, groupIn: undefined, transform: null, world: null };
    // the group it's filed in: a copied one; else, for what goes in at the
    // top, where the target says; else whatever its new parent is in
    if (g != null && set.has(g)) item.groupOf = g;
    else if (target.beside) item.groupIn = g;
    else if (target.land && target.land.group !== undefined) item.groupIn = item.top || group ? target.land.group : undefined;
    else item.groupIn = group ? null : undefined;
    if (group) return item;
    if (!item.top) {
      item.parent = p;
      item.transform = plain(o.transform);
      return item;
    }
    const w = worlds.get(id);
    const world = move ? multiplyMatrices(move, w) : w;
    item.world = world;
    if (target.beside) {
      // the parent measured as the original was (from the doc, not where a
      // pose draws it): the duplicate is the original's local, moved
      item.parentIn = p;
      item.transform = localOf(p != null ? worldMatrix(objects, p, parents) : null, world);
    } else {
      const at = target.land ?? {};
      item.parentIn = at.parent ?? null;
      item.transform = localOf(at.parent ? (at.parentWorld ?? null) : null, world);
    }
    return item;
  });
  // where everything ends up in the world (a child whose parent can't be made goes there, at the root)
  const byId = new Map(items.map((it) => [it.from, it]));
  for (const it of items) {
    if (it.group || it.top) continue;
    const pw = byId.get(it.parent)?.world;
    it.world = pw ? multiplyMatrices(pw, composeMatrix(it.transform)) : null;
  }
  return { items, listed, tops };
}

// ─── doing it ──────────────────────────────────────────────────────────────

/** The fields addObject writes itself; the rest of a copied object goes through `fields`. */
const OWN_FIELDS = new Set(["kind", "name", "sourceUrl", "providerId", "renderUrl", "parent", "group", "transform", "claims", "saved"]);

async function extensionMetas(api) {
  try {
    const reg = await api.registry("scene:extension");
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

/**
 * Copy objects from a scene (another, or this one) into this one.
 * @param {object} api  the focus's (a view plugin's api.focus()): repo, url, doc, scene, change, newId, addObject, use, registry, local
 * @param {{ scene: string, ids: string[] }} payload
 * @param {{ land?: object | ((tags: string[]) => object | null), beside?: object | ((roots: string[]) => object), before?: string | null }} target
 *   as planCopy's; `land` may be a function of the copied top's tags (a
 *   single top snaps to connectors that take it), `beside` of the roots.
 *   A landing that didn't snap is raised by the payload's `lift` (else one
 *   from the objects' `hint.bounds`), so the copy rests on its base; a
 *   connector is made for an origin at the base, so a snapped one isn't.
 *   `before`: the id it goes in front of in the scene's order.
 * @returns {Promise<string[] | null>} the new ids of the roots (the first is selected), or null
 */
export async function copyObjects(api, payload, target) {
  if (!api) return null;
  // the whole copy is one edit (HISTORY.md, TOOLS Decisions 2): undo takes it out again
  const edit = editor(api).edits("Paste");
  try {
    return await copyInto(api, payload, target, edit.change);
  } finally {
    edit.end();
  }
}

async function copyInto(api, payload, target, change) {
  const live = () => !api.signal?.aborted;
  const sceneUrl = parseAutomergeUrl(payload?.scene);
  if (!sceneUrl || !payload?.ids?.length) return null;
  const same = sceneUrl === api.url;
  let source;
  if (same) source = api.doc();
  else {
    try {
      source = (await api.repo.find(sceneUrl))?.doc?.();
    } catch (err) {
      api.use("notices")?.notify(`Couldn't open that scene: ${err?.message ?? err}`, "error");
      return null;
    }
  }
  if (!live()) return null;
  const objects = source?.objects ?? {};
  const roots = payload.ids.filter((id) => objects[id]);
  if (!roots.length) {
    api.use("notices")?.notify("Those objects are no longer in that scene.", "error");
    return null;
  }
  const describes = describesOf(await extensionMetas(api));
  if (!live()) return null;
  const runtime = runtimeOf(describes);
  const refs = refsOf(describes);

  // where: a landing may depend on what's being put down (a mast snaps to a mast step)
  const t = { ...target };
  if (typeof t.land === "function") {
    const single = roots.length === 1 && !isGroup(objects[roots[0]]);
    t.land = t.land(single ? strings(objects[roots[0]].tags) : []);
    if (!t.land) return null;
  }
  t.land = restOnConnector(objects, roots, source.order ?? [], t.land);
  if (t.land && !t.land.snapped) {
    const parents = resolveParents(objects);
    const lift = Number.isFinite(payload.lift)
      ? payload.lift
      : liftOf(objects, roots, source.order ?? [], { box: (id) => hintBoxOf(objects, id, parents), worldOf: (id) => worldMatrix(objects, id, parents) });
    if (Number.isFinite(lift) && lift !== 0) t.land = { ...t.land, point: [t.land.point[0], t.land.point[1] + lift, t.land.point[2]] };
  }
  if (typeof t.beside === "function") t.beside = t.beside(roots);
  const plan = planCopy({ objects, order: source.order ?? [], roots, runtime, target: t });

  // every copy's id, chosen before anything is written, so each reference is
  // written once: to the copy of what it named, to what's here (in its own
  // scene), or nothing (EDITOR.md, "Copying objects"; the copy rule, copyRefs)
  const map = new Map(plan.items.map((it) => [it.from, api.newId(it.group ? "g" : "o")]));
  const sceneTraits = api.doc()?.traits ?? {};
  const fixes = new Map(plan.items.map((it) => [it.from, copyRefs(it.data.traits, refs, { map, outside: (v) => (same ? v : undefined), entries: same ? () => true : entryIn(sceneTraits) })]));

  // render docs: read each built object's, for its params and build
  const seeds = new Map();
  await Promise.all(
    plan.items
      .filter((it) => !it.group && typeof it.data.renderUrl === "string")
      .map(async (it) => {
        try {
          const r = (await api.repo.find(it.data.renderUrl))?.doc?.();
          seeds.set(it.from, renderSeed(r));
        } catch {
          seeds.set(it.from, null);
        }
      }),
  );
  if (!live()) return null;

  const made = new Set(); // source ids whose copy is in the scene
  const before = t.before ?? null;
  const placeInOrder = (d, id) => {
    const at = before ? d.order.indexOf(before) : -1;
    if (at >= 0) d.order.splice(at, 0, id);
    else d.order.push(id);
  };

  // groups first, in one change (what's filed in them is made after)
  const groupItems = plan.items.filter((it) => it.group);
  if (groupItems.length) {
    change((d) => {
      for (const it of groupItems) {
        const id = map.get(it.from);
        const g = it.groupOf != null ? map.get(it.groupOf) : it.groupIn;
        d.objects[id] = { ...it.data, kind: "group", group: g && d.objects[g] && isGroup(d.objects[g]) ? g : null };
        placeInOrder(d, id);
      }
    });
    for (const it of groupItems) made.add(it.from);
  }

  // then each object, through the stage's addObject (render docs and all), parents first
  const failed = [];
  for (const it of plan.items) {
    if (it.group || !live()) continue;
    const parent = it.top ? it.parentIn : made.has(it.parent) ? map.get(it.parent) : null;
    const group = it.groupOf != null ? (made.has(it.groupOf) ? map.get(it.groupOf) : null) : it.groupIn;
    // a parent that couldn't be made: this one goes at the root, where it would have been
    let transform = it.transform;
    if (!it.top && it.parent != null && !made.has(it.parent)) transform = it.world ? decomposeMatrix(it.world) : null;
    const fields = {};
    for (const [k, v] of Object.entries(it.data)) if (!OWN_FIELDS.has(k)) fields[k] = v;
    if (!it.data.sourceUrl) {
      // nothing to show it from: written as it is, in its turn (what's under it needs it there)
      const id = map.get(it.from);
      change((d) => {
        const p = parent && d.objects[parent] && !isGroup(d.objects[parent]) ? parent : null;
        const gWanted = group !== undefined ? group : p ? (d.objects[p].group ?? null) : null;
        const g = gWanted && d.objects[gWanted] && isGroup(d.objects[gWanted]) ? gWanted : null;
        d.objects[id] = { ...fields, name: it.data.name ?? "Object", sourceUrl: null, providerId: it.data.providerId ?? null, renderUrl: null, parent: p, group: g, transform: plain(transform ?? it.data.transform) };
        placeInOrder(d, id);
      });
      made.add(it.from);
      continue;
    }
    const seed = seeds.get(it.from);
    try {
      const add = await api.addObject(it.data.sourceUrl, {
        id: map.get(it.from),
        providerId: it.data.providerId ?? undefined,
        name: it.data.name || undefined,
        ...(parent ? { parent } : {}),
        ...(group !== undefined ? { group } : {}),
        before,
        transform: transform ?? undefined,
        fields,
        ...(seed ? { render: seed } : {}),
      });
      change(add);
      made.add(it.from);
    } catch (err) {
      failed.push(`${it.data.name || "Object"}: ${err?.message ?? err}`);
    }
  }
  if (!live()) return null;

  // a copy that couldn't be made: what named it names nothing (the same rewriter, nothing copied)
  const missing = new Set(plan.items.filter((it) => !made.has(it.from)).map((it) => map.get(it.from)));
  if (missing.size) {
    const unmade = [];
    for (const it of plan.items) {
      if (!made.has(it.from)) continue;
      const r = refEdits(it.data.traits, refs, { object: (v) => (missing.has(v) ? undefined : v), entry: () => true });
      if (r.edits.length) unmade.push({ id: map.get(it.from), edits: r.edits });
      fixes.get(it.from).lost.push(...r.lost);
    }
    if (unmade.length) change((d) => unmade.forEach((u) => d.objects[u.id] && applyRefEdits(d.objects[u.id].traits, u.edits)));
  }

  // the files' assets: what names them in the source scene comes along, under the same key
  const urls = plan.items.filter((it) => !it.group && made.has(it.from) && typeof it.data.sourceUrl === "string").map((it) => it.data.sourceUrl);
  const assets = same ? {} : assetsFor(source.assets, urls, api.doc()?.assets);
  if (Object.keys(assets).length) {
    change((d) => {
      for (const [k, a] of Object.entries(assets)) if (!d.assets[k]) d.assets[k] = a;
    });
  }

  for (const f of failed) api.use("notices")?.notify(`Couldn't copy ${f}`, "error");
  // a field naming an entry of a scene trait: the trait is missing, or it's
  // here without that entry
  const told = new Set();
  const nameOf = (k) => String(describes.get(k)?.name ?? k);
  for (const [from, f] of fixes) {
    if (!made.has(from)) continue;
    for (const e of f.entries) {
      const key = `${e.trait}.${e.key}`;
      const has = sceneTraits[e.of] != null || api.doc()?.traits?.[e.of] != null;
      if (has ? told.has(key) : told.has(e.of)) continue;
      told.add(has ? key : e.of);
      api.use("notices")?.notify(has ? entryText({ name: nameOf(e.trait), label: e.label, ofName: nameOf(e.of) }) : needsText({ name: nameOf(e.trait), needName: nameOf(e.of) }), "warn");
    }
    for (const l of f.lost) {
      const key = `${l.trait}.${l.key}`;
      if (told.has(key)) continue;
      told.add(key);
      api.use("notices")?.notify(lostText({ name: nameOf(l.trait), label: l.label }), "warn");
    }
  }

  const out = roots.filter((id) => made.has(id)).map((id) => map.get(id));
  if (out.length && api.view.get().selected !== out[0]) api.view.select(out[0]);
  return out.length ? out : null;
}

/**
 * How far a set of objects reaches from the first's origin, in plan: what a
 * drag's ring is sized by. `box(id)` and `worldOf(id)` as the api's. Null
 * when nothing has a box.
 */
export function reachOf(ids, { box, worldOf }) {
  const o = worldOf(ids[0]);
  if (!o) return null;
  const ox = o[12];
  const oz = o[14];
  let r = 0;
  let any = false;
  for (const id of ids) {
    const b = box(id);
    if (!b) continue;
    any = true;
    for (const x of [b.min[0], b.max[0]]) for (const z of [b.min[2], b.max[2]]) r = Math.max(r, Math.hypot(x - ox, z - oz));
  }
  return any && r > 0 ? r : null;
}
