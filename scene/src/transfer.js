// Copying objects into a scene from another one (or from itself): an outline
// row dragged into another scene's view or tree, Copy and Paste
// (STAGE.md, "Copying objects"). Shared by the outline (where a row drag
// starts and where it lands in a tree) and scene.transfer (the view's drop,
// Copy, Paste).
//
// What a copy is:
//   - the objects named, everything attached under them (a mast's boom and
//     sail) and, for a group, everything filed in it, with new ids. Their
//     attachments and group membership among themselves are kept, and so is
//     every transform below the top (the top-level ones are placed);
//   - everything about them but runtime state: name, colour, tags, traits,
//     hint, locked, infoUrl, `at`… The stage's own runtime field (`claims`)
//     is never copied, nor any trait field an extension's `describes` marks
//     as runtime (`runtime: true` for the whole trait, `runtime: ["motion"]`
//     for some of its keys, or a field spec with `runtime: true`). Pose holds
//     and presence are never in the doc, so never copied;
//   - a passthrough object (a GLB file) shares its file: the bytes are
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
// A copied object whose trait `describes` says it `needs` a scene trait this
// scene lacks (a ship needs a sea) is copied all the same, with a notice
// naming what to add. Nothing adds scene traits behind anyone's back.

import { ROW_MIME, parseAutomergeUrl } from "./dnd.js";
import { isGroup, resolveGroups } from "./groups.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";
import { composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices } from "./transform.js";

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
export const RUNTIME_FIELDS = Object.freeze(["claims"]);

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []);
const docId = (url) => String(parseAutomergeUrl(url) ?? "").replace(/^automerge:/, "");

// ─── the payload ───────────────────────────────────────────────────────────

/**
 * What a row is as a document outside the scene: its render doc (the way the
 * sidebar's own drags look, so a slicer or a flow field's body slot can take
 * it; see README "Consuming a render"), or for a passthrough object its GLB
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
 * copy? }`; `id` is the first, for older readers. `lift`: how far the copy's
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
    const ids = strings(v?.ids).length ? strings(v.ids) : typeof v?.id === "string" && v.id ? [v.id] : [];
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

/** An object as it's copied: a fresh plain copy without runtime state. Pure. */
export function cleanObject(o, runtime = new Map()) {
  const out = plain(o) ?? {};
  for (const f of RUNTIME_FIELDS) delete out[f];
  if (out.traits && typeof out.traits === "object") {
    for (const [k, v] of Object.entries(out.traits)) {
      const r = runtime.get(k);
      if (r === true) delete out.traits[k];
      else if (r && v && typeof v === "object" && !Array.isArray(v)) for (const key of r) delete v[key];
    }
  }
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

/**
 * A copied object's references, fixed before it's written (its `traits` are
 * a fresh copy, changed in place):
 *   - a `copy: "drop"` field is left behind;
 *   - an `object` field naming something copied with it is cleared now and
 *     set to that copy's new id once it's made (`later`); naming something
 *     else, it's kept in the same scene and cleared in another (`lost`);
 *   - an `entry` field is kept in the same scene, or when this scene's trait
 *     `of` has that key; else cleared (`entries`: what it needed).
 * Pure.
 * @returns {{ later: { trait, key, to }[], lost: { trait, key, label }[], entries: { trait, key, label, of }[] }}
 */
export function fixRefs(traits, refs, { copied = new Set(), same = false, sceneTraits = {} } = {}) {
  const out = { later: [], lost: [], entries: [] };
  if (!traits || typeof traits !== "object") return out;
  for (const [k, v] of Object.entries(traits)) {
    const fields = refs?.get?.(k);
    if (!fields || !v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const f of fields) {
      if (!(f.key in v)) continue;
      const val = v[f.key];
      if (f.drop) {
        delete v[f.key];
        continue;
      }
      if (f.kind === "object") {
        if (typeof val === "string" && copied.has(val)) {
          delete v[f.key];
          out.later.push({ trait: k, key: f.key, to: val });
        } else if (!same && val != null) {
          delete v[f.key];
          out.lost.push({ trait: k, key: f.key, label: f.label });
        }
      } else if (f.kind === "entry" && !same && val != null) {
        const map = sceneTraits?.[f.of];
        if (!(map && typeof map === "object" && typeof val === "string" && map[val] != null)) {
          delete v[f.key];
          out.entries.push({ trait: k, key: f.key, label: f.label, of: f.of });
        }
      }
    }
  }
  return out;
}

const lower = (s) => String(s).toLowerCase();
const article = (s) => (/^[aeiou]/i.test(String(s)) ? "an" : "a");
/** "a sea", "an anchor", "seats" (a plural takes none). */
const some = (s) => (/[^s]s$/i.test(String(s)) ? lower(s) : `${article(s)} ${lower(s)}`);

/**
 * The scene traits copied objects need that this scene lacks, from
 * `describes[key].needs` (scene trait keys): [{ trait, name, need, needName }],
 * one per missing need. Pure.
 */
export function missingNeeds(describes, traitKeys, sceneTraits) {
  const out = [];
  const seen = new Set();
  for (const k of traitKeys ?? []) {
    const d = describes?.get?.(k);
    for (const need of strings(d?.needs)) {
      if (seen.has(need) || (sceneTraits && sceneTraits[need] !== undefined && sceneTraits[need] !== null)) continue;
      seen.add(need);
      out.push({ trait: k, name: String(d?.name ?? k), need, needName: String(describes.get(need)?.name ?? need) });
    }
  }
  return out;
}

/** "This ship needs a sea: add Sea to the scene." */
export const needsText = ({ name, needName }) => `This ${lower(name)} needs ${some(needName)}: add ${needName} to the scene.`;
/** "This private zone's seat isn't one of this scene's seats: choose one in the inspector." */
export const entryText = ({ name, label, ofName }) => `This ${lower(name)}'s ${lower(label)} isn't one of this scene's ${lower(ofName)}: choose one in the inspector.`;
/** "This lever's target was left behind: choose one in the inspector." */
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
 * heading; several, the middle of their origins (at the lowest), heading 0.
 */
export function referenceOf(worlds) {
  if (worlds.length === 1) return { point: [worlds[0][12], worlds[0][13], worlds[0][14]], yaw: yawOf(worlds[0]) };
  if (!worlds.length) return { point: [0, 0, 0], yaw: 0 };
  const xs = worlds.map((m) => m[12]);
  const ys = worlds.map((m) => m[13]);
  const zs = worlds.map((m) => m[14]);
  return { point: [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys), (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0 };
}

/**
 * The rigid move that puts `ref` at `point`, turned about the vertical so its
 * heading becomes `yaw` (null: as it was). Column-major 4×4.
 */
export function moveBy(ref, point, yaw = null) {
  const t = yaw == null ? 0 : yaw - ref.yaw;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const [px, py, pz] = ref.point;
  // T(point) · Ry(t) · T(−ref)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, point[0] - (c * px + s * pz), point[1] - py, point[2] - (-s * px + c * pz), 1];
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
  const m = worldMatrix(objects, id, parents);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      }
  return min.every(Number.isFinite) ? { min, max } : null;
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
 *   target: { land?: { point, yaw?, parent?, parentWorld?, group? }, // where it lands (a drop, a paste; `group`: the tree's, for the top)
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
  if (target.land) move = moveBy(referenceOf([...worlds.values()]), target.land.point, target.land.yaw ?? null);
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
const OWN_FIELDS = new Set(["kind", "name", "sourceUrl", "providerId", "renderUrl", "parent", "group", "transform", "claims"]);

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
 * @param {object} api  an extension's api: repo, url, doc, scene, change, newId, addObject, notify, registry, local
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
      api.notify(`Couldn't open that scene: ${err?.message ?? err}`, "error");
      return null;
    }
  }
  if (!live()) return null;
  const objects = source?.objects ?? {};
  const roots = payload.ids.filter((id) => objects[id]);
  if (!roots.length) {
    api.notify("Those objects are no longer in that scene.", "error");
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
  if (t.land && !t.land.snapped) {
    const parents = resolveParents(objects);
    const lift = Number.isFinite(payload.lift)
      ? payload.lift
      : liftOf(objects, roots, source.order ?? [], { box: (id) => hintBoxOf(objects, id, parents), worldOf: (id) => worldMatrix(objects, id, parents) });
    if (Number.isFinite(lift) && lift !== 0) t.land = { ...t.land, point: [t.land.point[0], t.land.point[1] + lift, t.land.point[2]] };
  }
  if (typeof t.beside === "function") t.beside = t.beside(roots);
  const plan = planCopy({ objects, order: source.order ?? [], roots, runtime, target: t });

  // what the copies point at in the scene: their own parts (set once made),
  // what's here, or nothing (STAGE.md, "Copying objects")
  const copied = new Set(plan.items.map((it) => it.from));
  const sceneTraits = api.doc()?.traits ?? {};
  const fixes = new Map(plan.items.map((it) => [it.from, fixRefs(it.data.traits, refs, { copied, same, sceneTraits })]));

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

  const map = new Map(); // source id → new id
  const before = t.before ?? null;
  const placeInOrder = (d, id) => {
    if (!d.order) d.order = [];
    const at = before ? d.order.indexOf(before) : -1;
    if (at >= 0) d.order.splice(at, 0, id);
    else d.order.push(id);
  };

  // groups first, in one change (what's filed in them is made after)
  const groupItems = plan.items.filter((it) => it.group);
  if (groupItems.length) {
    for (const it of groupItems) map.set(it.from, api.newId("g"));
    api.change((d) => {
      if (!d.objects) d.objects = {};
      for (const it of groupItems) {
        const id = map.get(it.from);
        const g = it.groupOf != null ? map.get(it.groupOf) : it.groupIn;
        d.objects[id] = { ...it.data, kind: "group", group: g && d.objects[g] && isGroup(d.objects[g]) ? g : null };
        placeInOrder(d, id);
      }
    });
  }

  // then each object, through the stage's addObject (render docs and all), parents first
  const failed = [];
  for (const it of plan.items) {
    if (it.group || !live()) continue;
    const parent = it.top ? it.parentIn : (map.get(it.parent) ?? null);
    const group = it.groupOf != null ? (map.get(it.groupOf) ?? null) : it.groupIn;
    // a parent that couldn't be made: this one goes at the root, where it would have been
    let transform = it.transform;
    if (!it.top && it.parent != null && !map.has(it.parent)) transform = it.world ? decomposeMatrix(it.world) : null;
    const fields = {};
    for (const [k, v] of Object.entries(it.data)) if (!OWN_FIELDS.has(k)) fields[k] = v;
    if (!it.data.sourceUrl) {
      // nothing to show it from: written as it is, in its turn (what's under it needs it there)
      const id = api.newId("o");
      api.change((d) => {
        if (!d.objects) d.objects = {};
        const p = parent && d.objects[parent] && !isGroup(d.objects[parent]) ? parent : null;
        const gWanted = group !== undefined ? group : p ? (d.objects[p].group ?? null) : null;
        const g = gWanted && d.objects[gWanted] && isGroup(d.objects[gWanted]) ? gWanted : null;
        d.objects[id] = { ...fields, name: it.data.name ?? "Object", sourceUrl: null, providerId: it.data.providerId ?? null, renderUrl: null, parent: p, group: g, transform: plain(transform ?? it.data.transform) };
        placeInOrder(d, id);
      });
      map.set(it.from, id);
      continue;
    }
    const seed = seeds.get(it.from);
    try {
      const id = await api.addObject(it.data.sourceUrl, {
        providerId: it.data.providerId ?? undefined,
        name: it.data.name || undefined,
        ...(parent ? { parent } : {}),
        ...(group !== undefined ? { group } : {}),
        before,
        transform: transform ?? undefined,
        fields,
        ...(seed ? { render: seed } : {}),
      });
      map.set(it.from, id);
    } catch (err) {
      failed.push(`${it.data.name || "Object"}: ${err?.message ?? err}`);
    }
  }
  if (!live()) return null;

  // references among the copies, to the copies' new ids, field by field
  const later = [...fixes].flatMap(([from, f]) => f.later.filter((l) => map.has(from) && map.has(l.to)).map((l) => ({ id: map.get(from), ...l, to: map.get(l.to) })));
  if (later.length) {
    api.change((d) => {
      for (const l of later) {
        const tr = d.objects?.[l.id]?.traits?.[l.trait];
        if (tr && typeof tr === "object") tr[l.key] = l.to;
      }
    });
  }

  // the files' assets: what names them in the source scene comes along, under the same key
  const urls = plan.items.filter((it) => !it.group && map.has(it.from) && typeof it.data.sourceUrl === "string").map((it) => it.data.sourceUrl);
  const assets = same ? {} : assetsFor(source.assets, urls, api.doc()?.assets);
  if (Object.keys(assets).length) {
    api.change((d) => {
      // made with the doc; a scene from before `assets` makes it here (as ctx.file does)
      if (!d.assets) d.assets = {};
      for (const [k, a] of Object.entries(assets)) if (!d.assets[k]) d.assets[k] = a;
    });
  }

  for (const f of failed) api.notify(`Couldn't copy ${f}`, "error");
  const traitKeys = plan.items.filter((it) => map.has(it.from)).flatMap((it) => Object.keys(it.data.traits ?? {}));
  const needs = missingNeeds(describes, traitKeys, api.doc()?.traits);
  for (const n of needs) api.notify(needsText(n), "warn");
  // a field naming an entry of a scene trait: the trait is missing (a need,
  // as above), or it's here without that entry
  const told = new Set(needs.map((n) => n.need));
  const nameOf = (k) => String(describes.get(k)?.name ?? k);
  for (const [from, f] of fixes) {
    if (!map.has(from)) continue;
    for (const e of f.entries) {
      const key = `${e.trait}.${e.key}`;
      const has = sceneTraits[e.of] != null || api.doc()?.traits?.[e.of] != null;
      if (has ? told.has(key) : told.has(e.of)) continue;
      told.add(has ? key : e.of);
      api.notify(has ? entryText({ name: nameOf(e.trait), label: e.label, ofName: nameOf(e.of) }) : needsText({ name: nameOf(e.trait), needName: nameOf(e.of) }), "warn");
    }
    for (const l of f.lost) {
      const key = `${l.trait}.${l.key}`;
      if (told.has(key)) continue;
      told.add(key);
      api.notify(lostText({ name: nameOf(l.trait), label: l.label }), "warn");
    }
  }

  const made = roots.map((id) => map.get(id)).filter(Boolean);
  if (made.length) api.local.swap((m) => (m.selected === made[0] ? m : { ...m, selected: made[0] }));
  return made.length ? made : null;
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
