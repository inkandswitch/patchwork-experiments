// Pure, framework-free model logic for newspace — extracted so it can be unit
// tested (the interaction/CSS bugs need a real browser, but these data rules
// caused most of the regressions: reconcile, transfer dedupe, coord transforms).
import { shapeBounds, strokeBounds, strokeWorldPoints } from "./draw.js";
import { sketchBounds } from "./sketch.js";
import { chainToOuter, chainToLocal } from "./box-transform.js";

export const rad = (d) => (d * Math.PI) / 180;
export function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// a frame IS a box: origin = its top-left, own transform = rotate about its centre. The
// coordinate-space-as-box composer ([[box-transform.js]]) does the math — proven identical to
// the old hand-rolled version in box-transform.test.js, so every localToWorld/worldToLocal
// caller now goes through the unified model.
const frameBox = (f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, transform: { kind: "rotate", rotation: f.rotation || 0 } });

// ANY item as a BOX — the single "item → its coordinate space" mapping (no ad-hoc kind
// inference at call sites). A frame ROTATES about its centre; a map REPROJECTS (lat/lng);
// everything else (stroke, shape, text, doc, editor, sketch) is placement-only, so its own
// transform is identity ("translate"). This is "an item is a box with a transform."
export function transformKindOf(it) {
  if (!it) return "identity";
  if (it.kind === "frame") return "rotate";
  if (it.kind === "editor" && it.editorId === "map") return "reproject";
  return "translate";
}
export function itemBox(it) {
  return { id: it.id, x: it.x || 0, y: it.y || 0, w: it.w || 0, h: it.h || 0, rotation: it.rotation || 0, transform: { kind: transformKindOf(it) } };
}

// Does this item OWN a coordinate space other items' marks can live in? A frame is a
// sub-space; a map REPROJECTS (lat/lng). These are the draw-claim boundaries: a stroke/shape
// drawn over one from outside gets `parent: <boxId>` + BOX-LOCAL coords.
//
// LOCAL-COORD CONVENTION for a parented item (matches what frames call local coords):
//   • frame parent — frame-local px (origin = the frame's top-left, rotated with it).
//   • map parent   — geo, `{ x: lng, y: lat }` (box-transform's geo-local convention):
//     a stroke's points are [lng, lat, pressure]; a shape's x/y is its first corner in
//     lng/lat and h is typically NEGATIVE (lat decreases as screen y grows). The same
//     x/y/w/h + points slots, just numbers in the box's own space.
export const ownsSpace = (it) => !!it && (it.kind === "frame" || transformKindOf(it) !== "translate");

// ANNOTATION PARENTING — convert a stroke/shape drawn in WORLD coords into a spatial box's
// LOCAL space (via the box's own transform: rotate for a frame, reproject for a map) and tag
// it `parent: box.id`. The item stays in the OUTER surface's items array — it's an annotation
// ON the box (it travels with the outer canvas), not content OF the inner document. Mutates
// and returns `item` (callers pass a fresh draft or an automerge proxy inside change()).
// a ROTATE-kind box (a frame) turns its content; a REPROJECT box (the map) warps scale
// instead. Shapes convert CENTRE+rotation under a turning box (w/h are angle-invariant
// there), and both CORNERS under a warping one (that's where the local scale lives).
const boxTurn = (box) => (transformKindOf(box) === "rotate" ? box.rotation || 0 : 0);

export function annotateItemIntoBox(item, box) {
  const chain = [itemBox(box)];
  const toL = (x, y) => { const l = chainToLocal(chain, { x, y }); return [l.x, l.y]; };
  if (item.kind === "stroke") {
    item.points = strokeWorldPoints(item).map(([x, y, pr]) => { const [lx, ly] = toL(x, y); return pr == null ? [lx, ly] : [lx, ly, pr]; });
    item.x = 0; item.y = 0;
  } else if (item.kind === "shape") {
    const turn = boxTurn(box);
    if (item.cx != null) { const [ncx, ncy] = toL(item.cx, item.cy); item.cx = ncx; item.cy = ncy; } // a bent control point travels
    if (turn) {
      const w = item.w || 0, h = item.h || 0;
      const [lcx, lcy] = toL(item.x + w / 2, item.y + h / 2);
      item.x = lcx - w / 2; item.y = lcy - h / 2; item.rotation = (item.rotation || 0) - turn;
    } else {
      // convert both corners (keeps a line/arrow pointing the same way, captures geo scale)
      const [ax, ay] = toL(item.x, item.y);
      const [bx, by] = toL(item.x + (item.w || 0), item.y + (item.h || 0));
      item.x = ax; item.y = ay; item.w = bx - ax; item.h = by - ay;
    }
  }
  item.parent = box.id;
  return item;
}

// the inverse: a PARENTED item projected back into world coords — used to RENDER it through
// the canvas's normal rough.js/perfect-freehand pipeline, and (verbatim) as the drag-OUT
// conversion. Returns a plain projected copy; the stored item stays box-local.
export function projectItemFromBox(item, box) {
  const chain = [itemBox(box)];
  const toW = (x, y) => { const w = chainToOuter(chain, { x, y }); return [w.x, w.y]; };
  if (item.kind === "stroke") {
    const points = strokeWorldPoints(item).map(([x, y, pr]) => { const [wx, wy] = toW(x, y); return pr == null ? [wx, wy] : [wx, wy, pr]; });
    return { ...item, points, x: 0, y: 0 };
  }
  if (item.kind === "shape") {
    const out = { ...item };
    const turn = boxTurn(box);
    if (item.cx != null) { const [ncx, ncy] = toW(item.cx, item.cy); out.cx = ncx; out.cy = ncy; }
    if (turn) {
      const w = item.w || 0, h = item.h || 0;
      const [wcx, wcy] = toW(item.x + w / 2, item.y + h / 2);
      out.x = wcx - w / 2; out.y = wcy - h / 2; out.rotation = (item.rotation || 0) + turn;
    } else {
      const [ax, ay] = toW(item.x, item.y);
      const [bx, by] = toW(item.x + (item.w || 0), item.y + (item.h || 0));
      out.x = ax; out.y = ay; out.w = bx - ax; out.h = by - ay;
    }
    return out;
  }
  return item;
}

// is `surfaceId` the box's own surface, or a surface nested anywhere inside it? Feeds the
// claim decision's `entered` (entering a box re-roots the claim over its whole subtree).
// `itemsOf(url)` returns a loaded box's items (or null); depth-limited like rendering is.
export function surfaceWithinBox(box, surfaceId, itemsOf, depth = 3) {
  if (!box || surfaceId == null) return false;
  if (box.url != null && box.url === surfaceId) return true;
  if (depth <= 0 || box.kind !== "frame" || typeof itemsOf !== "function") return false;
  const items = itemsOf(box.url) || [];
  return items.some((c) => c && c.kind === "frame" && surfaceWithinBox(c, surfaceId, itemsOf, depth - 1));
}

// folders and sketches (both datatype ids for this tool: "sketch" current,
// "newspace" legacy) render as a "box" (a managed sub-doc / frame sub-space)
export const isBoxType = (t) => t === "sketch" || t === "newspace" || t === "folder";

// a frame defines a rotated coordinate space (origin = frame top-left, rotated
// about its centre); local<->world is the transform in/out of that space.
export function localToWorld(frame, x, y) {
  if (!frame) return [x, y];
  const o = chainToOuter([frameBox(frame)], { x, y });
  return [o.x, o.y];
}
export function worldToLocal(frame, x, y) {
  if (!frame) return [x, y];
  const l = chainToLocal([frameBox(frame)], { x, y });
  return [l.x, l.y];
}
export const pointInFrame = (f, wx, wy) => {
  const [lx, ly] = worldToLocal(f, wx, wy);
  return lx >= 0 && lx <= f.w && ly >= 0 && ly <= f.h;
};

// axis-aligned bounds of an item in its own coordinate space
export function itemBounds(it) {
  if (it.kind === "shape") return shapeBounds(it);
  if (it.kind === "stroke") return strokeBounds(it);
  if (it.kind === "sketch") return sketchBounds(it);
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

// WORLD position of a node's inlet/outlet port, computed from the item BOUNDS (not
// the DOM) so wire endpoints update exactly with the item — no getBoundingClientRect
// lag — and stay put even when the port chips are hidden (wire tool off). `side` is
// "in" (left edge) or "out" (right edge); ports are distributed around the vertical
// centre by index, with a capped gap so they never spill past the box.
export function portPoint(bounds, side, index = 0, count = 1) {
  const n = Math.max(count, 1);
  const x = side === "out" ? bounds.x + bounds.w : bounds.x;
  const gap = Math.min(bounds.h / (n + 1), 20); // matches the CSS nub pitch (12px nub + 8px gap)
  const y = bounds.y + bounds.h / 2 + (index - (n - 1) / 2) * gap;
  return { x, y };
}

// deep-clone an item to a plain object (for moving between automerge docs)
export function cloneItem(o) {
  const c = { ...o };
  if (o.kind === "stroke" && Array.isArray(o.points)) c.points = o.points.map((p) => p.slice());
  if (o.kind === "sketch") { c.nodes = (o.nodes || []).map((n) => ({ ...n })); c.bars = (o.bars || []).map((b) => ({ ...b })); }
  if (Array.isArray(o.layers)) c.layers = [...o.layers]; // fresh array — like points, a live list proxy can't be re-inserted
  if (o.sticky) c.sticky = { ...o.sticky }; // fresh object — a live map proxy can't be re-inserted either
  delete c.parent;
  return c;
}

// The canonical layout-item id for a folder link's url. DETERMINISTIC, so when
// two peers reconcile the same just-added link they create the SAME id — which
// then de-dupes to one item — instead of two random ids that both survive (the
// "doc appears twice with two viewers" bug).
export function linkItemId(url) { return "li-" + url; }

// indices of items whose id already appeared earlier in the array (duplicates to
// remove). Dedup is by ID, never URL, so intentional alt-drag COPIES (same url,
// unique ids) are preserved. Returns ascending indices (splice high→low).
export function duplicateItemIds(items) {
  const seen = new Set(), dup = [];
  for (let i = 0; i < items.length; i++) { const id = items[i].id; if (seen.has(id)) dup.push(i); else seen.add(id); }
  return dup;
}

// docs→items reconcile: which folder links still need a layout shape (skipping
// any url currently tombstoned — i.e. just deleted)
export function linksNeedingItems(docs, items, tombstoned = () => false) {
  const have = new Set(items.filter((it) => it.kind === "doc" || it.kind === "frame").map((it) => it.url));
  return docs.filter((l) => !have.has(l.url) && !tombstoned(l.url));
}

// the transfer dst-add guard: dedupe by ID only. (clone.url is undefined for
// strokes/shapes, so matching on url wrongly collided with other url-less items
// and dropped the transferred shape — this is that regression, pinned.)
export const itemPresent = (items, id) => items.some((x) => x.id === id);

// stable id order — the render-order comparator (see sortById in brush/constants.js)
export const byIdAsc = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// LAYER MEMBERSHIP — an item's `layers: string[]`. The FIRST entry is the HOME
// space: it owns the item's coordinates + transform (semantically the legacy
// single `layer:` field). Every FURTHER entry is a pure VISIBILITY membership:
// the item shows whenever ANY of its layers is visible, and always renders in
// its home space. Reading is additive + back-compat: `layers` wins; else a
// legacy `layer: "x"` reads as ["x"]; else ["canvas"]. Writers NEVER delete the
// legacy `layer` field; new/edited items write `layers` (mirroring `layer` to a
// non-base home so old clients keep the item in the right space). An entry may
// later grow into { id, x, y } (per-mode placement) — object entries already
// normalize to their id here, so that's not a model break.
export function itemLayers(it) {
  const ls = it && it.layers;
  if (Array.isArray(ls) && ls.length) {
    const out = [];
    for (const e of ls) { const id = typeof e === "string" ? e : e && e.id; if (id) out.push(id); }
    if (out.length) return out;
  }
  return [(it && it.layer) || "canvas"];
}
export const itemHomeLayer = (it) => itemLayers(it)[0];
// visibility = ANY member layer visible (`layerVisible` is a per-layer predicate)
export const itemVisibleOn = (it, layerVisible) => itemLayers(it).some((id) => layerVisible(id));

// ACTIVE-LAYER VISIBILITY — membership drives what shows for the current tab.
// `layerIds` is the stack in draw order (bottom → top); an item is visible iff
//   (a) its HOME layer sits AT or BELOW the active layer (lower layers keep
//       rendering under the active one — the frosted compositing), OR
//   (b) its `layers` membership includes the active layer (the Properties
//       "appears on" row is how an overlay widget earns a place on the canvas).
// An unknown home/active layer never hides anything (additive, never throws).
export function itemVisibleForActive(it, layerIds, activeLayerId) {
  const ls = itemLayers(it);
  const hi = layerIds.indexOf(ls[0]);
  const ai = layerIds.indexOf(activeLayerId);
  if (hi < 0 || ai < 0) return true;
  return hi <= ai || ls.includes(activeLayerId);
}

// README.md Phase 2 — ONE pass over `items` builds the hot lookups: `indexById`
// (id → doc index; doc index IS the z), `byHome` (per-HOME-layer render buckets,
// id-sorted so render order stays stable — live embeds must never be relocated;
// an item renders in EXACTLY ONE home bucket, never twice) and `byLayer`
// (MEMBERSHIP buckets: an item appears under every layer it's on, for
// visibility). `layersOf` returns an item's layer list, home first (itemLayers);
// a plain-string return still works.
// The index is a per-tick view of `items`: never hold it across ticks.
export function buildItemsIndex(items, layersOf = itemLayers) {
  const indexById = new Map();
  const byLayer = new Map();
  const byHome = new Map();
  const put = (m, k, it) => { let arr = m.get(k); if (!arr) { arr = []; m.set(k, arr); } arr.push(it); };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    indexById.set(it.id, i);
    const ls = layersOf(it);
    const list = Array.isArray(ls) ? ls : [ls];
    put(byHome, list[0], it);
    for (let j = 0; j < list.length; j++) if (list.indexOf(list[j]) === j) put(byLayer, list[j], it);
  }
  for (const arr of byHome.values()) arr.sort(byIdAsc);
  for (const arr of byLayer.values()) arr.sort(byIdAsc);
  return { byLayer, byHome, indexById };
}

// find an item by id — O(1) through an `indexMap` (a per-tick buildItemsIndex
// product over the SAME array) when one is passed, linear `.find` otherwise.
export function findById(items, id, indexMap) {
  if (indexMap) {
    const i = indexMap.get(id);
    return i == null ? undefined : items[i];
  }
  return (items || []).find((x) => x.id === id);
}

// where a ray from a box's centre toward `tx,ty` crosses the box edge
export function edgePoint(box, tx, ty) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (box.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (box.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

// an arrow bound to a shape connects to the MIDDLE of whichever edge faces the
// other end (excalidraw-ish), sitting `gap` px outside the shape.
export function edgeMidpoint(box, tx, ty, gap = 7) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy - box.h / 2 - gap];
  // pick the edge the ray exits (compare against the box's aspect)
  if (Math.abs(dx) * box.h >= Math.abs(dy) * box.w) {
    const side = dx >= 0 ? 1 : -1;
    return [cx + side * (box.w / 2 + gap), cy];
  }
  const side = dy >= 0 ? 1 : -1;
  return [cx, cy + side * (box.h / 2 + gap)];
}

// a normalized anchor {x,y} in [0,1] is a point fixed to a shape (0,0 = top-left
// of its unrotated bounds, 1,1 = bottom-right). Resolve it to a world point,
// honouring the shape's rotation — so a bound arrow tracks rotation, attaches
// anywhere on the shape, and can sit inside it.
export function anchorWorld(item, anchor) {
  const b = itemBounds(item);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const px = b.x + anchor.x * b.w, py = b.y + anchor.y * b.h;
  const [rx, ry] = rot(px - cx, py - cy, rad(item.rotation || 0));
  return [cx + rx, cy + ry];
}
// the inverse: a world point → normalized anchor within a shape's unrotated bounds
export function worldAnchor(item, wx, wy) {
  const b = itemBounds(item);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const [ux, uy] = rot(wx - cx, wy - cy, -rad(item.rotation || 0));
  return { x: b.w ? (ux + b.w / 2) / b.w : 0.5, y: b.h ? (uy + b.h / 2) / b.h : 0.5 };
}

// resolve a bound arrow's geometry. each bound end sits at its stored anchor on
// the shape (rotation-aware); a legacy binding with no anchor falls back to the
// facing edge midpoint. unbound ends use the arrow's own stored coords.
export function arrowGeometry(it, items) {
  let sx = it.x, sy = it.y, ex = it.x + it.w, ey = it.y + it.h;
  const from = it.fromId && items.find((x) => x.id === it.fromId);
  const to = it.toId && items.find((x) => x.id === it.toId);
  const fb = from && itemBounds(from), tb = to && itemBounds(to);
  const fc = fb && [fb.x + fb.w / 2, fb.y + fb.h / 2];
  const tc = tb && [tb.x + tb.w / 2, tb.y + tb.h / 2];
  // legacy (no anchor) ends face the other shape's centre, else the free end
  if (from) { if (it.fromAnchor) [sx, sy] = anchorWorld(from, it.fromAnchor); else [sx, sy] = edgeMidpoint(fb, tc ? tc[0] : ex, tc ? tc[1] : ey); }
  if (to) { if (it.toAnchor) [ex, ey] = anchorWorld(to, it.toAnchor); else [ex, ey] = edgeMidpoint(tb, fc ? fc[0] : sx, fc ? fc[1] : sy); }
  return { x: sx, y: sy, w: ex - sx, h: ey - sy };
}

// reorder the `arr` of items in place (z-order = array order). `mode` is
// front|back|forward|backward. Re-inserts a CLONE of each moved item (a live
// automerge proxy can't be re-inserted), preserving everything but identity —
// callers rely on the reconcile keeping DOM nodes by `id`. Works on a plain
// array or a live automerge list.
export function applyReorder(arr, selectedIds, mode) {
  const sel = new Set(selectedIds);
  if (!sel.size) return;
  const cloneAt = (i) => cloneItem(arr[i]);
  if (mode === "front" || mode === "back") {
    const moved = [];
    for (let i = arr.length - 1; i >= 0; i--) if (sel.has(arr[i].id)) { moved.unshift(cloneAt(i)); arr.splice(i, 1); }
    if (mode === "front") for (const m of moved) arr.push(m);
    else for (let k = moved.length - 1; k >= 0; k--) arr.splice(0, 0, moved[k]);
  } else {
    const dir = mode === "forward" ? 1 : -1;
    const ids = [...selectedIds].sort((a, b) => arr.findIndex((x) => x.id === a) - arr.findIndex((x) => x.id === b));
    const seq = dir === 1 ? ids.reverse() : ids;
    for (const id of seq) { const i = arr.findIndex((x) => x.id === id); const j = i + dir; if (j < 0 || j >= arr.length || sel.has(arr[j].id)) continue; const m = cloneAt(i); arr.splice(i, 1); arr.splice(j, 0, m); }
  }
}

// compose a chain of frame transforms (outermost first) to turn a point in the
// innermost frame's local space into world coords — the basis for binding an
// arrow to an item that lives inside a box.
export function framesToWorld(frames, x, y) {
  let px = x, py = y;
  for (let i = frames.length - 1; i >= 0; i--) [px, py] = localToWorld(frames[i], px, py);
  return [px, py];
}

// axis-aligned bounds enclosing every item in `groupId` (group-as-shape basis)
export function groupBounds(items, groupId) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const it of items) {
    if (it.group !== groupId) continue;
    const b = itemBounds(it);
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  }
  if (minx === Infinity) return null;
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}

// ids of items whose CENTRE falls within the rect (marquee selection)
export function itemsInRect(items, x0, y0, x1, y1) {
  const minx = Math.min(x0, x1), maxx = Math.max(x0, x1);
  const miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
  const hit = [];
  for (const it of items) {
    const b = itemBounds(it);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx >= minx && cx <= maxx && cy >= miny && cy <= maxy) hit.push(it.id);
  }
  return hit;
}

// what a plain click selects, honouring an ENTERED group (group-as-shape): when
// you're inside the clicked item's group, the click picks that single member;
// otherwise it picks the item's whole group (and signals to exit any group you
// were in). returns { ids, exitGroup }.
export function clickSelection(items, clickedId, enteredGroupId) {
  const it = items.find((x) => x.id === clickedId);
  const grp = it && it.group != null ? it.group : null;
  if (grp != null && grp === enteredGroupId) return { ids: [clickedId], exitGroup: false };
  // not inside the clicked item's group → select its whole group; if we WERE in
  // some (other) group, signal to leave it
  return { ids: expandGroups(items, [clickedId]), exitGroup: enteredGroupId != null };
}

// grouping: given a selection, expand it to every item sharing a `group` id with
// any selected item (so groups select/move/rotate as a unit)
export function expandGroups(items, ids) {
  const gids = new Set();
  for (const id of ids) { const o = items.find((x) => x.id === id); if (o && o.group != null) gids.add(o.group); }
  if (!gids.size) return ids;
  const out = new Set(ids);
  for (const o of items) if (o.group != null && gids.has(o.group)) out.add(o.id);
  return [...out];
}

// alt-drag can leave several doc/frame shapes pointing at ONE url. When deleting
// `deletingIds`, the folder link should be removed only if no OTHER (un-deleted)
// shape still references that url — i.e. we're removing its last shape.
export function shouldUnlinkDoc(items, url, deletingIds) {
  const del = deletingIds instanceof Set ? deletingIds : new Set(deletingIds);
  return !items.some((it) => (it.kind === "doc" || it.kind === "frame") && it.url === url && !del.has(it.id));
}

// ── PALETTE ENTRIES — the rich toolbar structure (palette-node / palette-config) ──
// An entry is one of:
//   { kind: "tool", id }                             — an armable tool/brush button
//   { kind: "divider" }                              — the toolbar's vertical rule
//   { kind: "menu", label, icon?, items: [entry…] }  — an overflow menu (ONE level:
//                                                      menu items are tools/dividers;
//                                                      nested menus are dropped)
// Pure helpers, shared by the palette window (renders entries), the palette-config
// window (edits + emits them), the parts bin presets, and the seeds in constants.js.
export const toolEntry = (id) => ({ kind: "tool", id });
export const entriesFromIds = (ids) => (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x).map(toolEntry);

// entries (or any junk) → a clean array of valid entries. Lenient on purpose: a
// bare string reads as a tool id (so a plain id list IS a valid entries value).
export function normalizeEntries(value, depth = 0) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const e of value) {
    if (typeof e === "string" && e) { out.push(toolEntry(e)); continue; }
    if (!e || typeof e !== "object") continue;
    if (e.kind === "tool" && typeof e.id === "string" && e.id) out.push({ kind: "tool", id: e.id });
    else if (e.kind === "divider") out.push({ kind: "divider" });
    else if (e.kind === "menu" && depth === 0) {
      const items = normalizeEntries(e.items, 1).filter((x) => x.kind !== "menu"); // one level of nesting is enough
      const m = { kind: "menu", label: typeof e.label === "string" ? e.label : "menu", items };
      if (typeof e.icon === "string" && e.icon) m.icon = e.icon;
      out.push(m);
    }
  }
  return out;
}

// the flat tool-id list an entries array arms (menus included) — dedupe/back-compat
export function entryToolIds(entries) {
  const ids = [];
  for (const e of entries || []) {
    if (e.kind === "tool") ids.push(e.id);
    else if (e.kind === "menu") for (const i of e.items || []) if (i.kind === "tool") ids.push(i.id);
  }
  return ids;
}
// all entries are plain tools (no dividers/menus) — such a list persists as the
// legacy `config.brushes` id array, so old clients keep reading it forever
export const entriesArePlainTools = (entries) => (entries || []).every((e) => e && e.kind === "tool");
