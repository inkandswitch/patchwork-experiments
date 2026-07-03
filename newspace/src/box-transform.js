// Coordinate-space-as-box — the uniform transform model.
//
// Every thing on the canvas is a BOX that owns a coordinate space: layers, frames, the map,
// embedded tools, strokes. Nesting is transform COMPOSITION. The transform is split in two,
// owned by different parties:
//
//   • FIRST half (placement) — owned by the CONTAINER: subtract the box's origin (box.x, box.y,
//     stored in the container's space) so what the box receives has (0,0) at its top-left.
//   • SECOND half (projection) — owned by the BOX: its own transform (identity for a plain
//     frame, camera for a viewport layer, rotate for a rotated frame, reproject for a map).
//     A box never needs to know its own x,y to interpret its content.
//
//   local = box.own( outerCoord - boxOrigin )        outer = boxOrigin + box.ownInverse(local)
//
// A transform KIND implements only the second half; the composer does the first half uniformly,
// so there is no third place for a space mismatch to sneak in. Composition just walks the chain
// of boxes (outermost → target), subtracting each origin and applying each own transform.
//
// This is a plain module of pure functions (no Solid) — see [[opstream-processing-raw-callbacks]].

const KINDS = new Map();

// register a transform kind: a factory (box, env) -> { toLocal, toOuter, scale }.
//   toLocal(p): my-top-left-relative outer point → my content-local point (the SECOND half)
//   toOuter(p): my content-local point → my-top-left-relative outer point (its inverse)
//   scale():    px per local unit (stroke widths, hit slop)
// `env` carries shared runtime (e.g. a camera accessor); box-specific runtime (a live map for
// reproject) rides on the box itself.
export function registerTransform(id, factory) { KINDS.set(id, factory); }
export function transformKind(id) { return KINDS.get(id) || KINDS.get("identity"); }
export const hasTransformKind = (id) => KINDS.has(id);

// bind a box's second-half transform (its kind), defaulting to identity.
export function ownTransform(box, env) {
  const factory = transformKind((box && box.transform && box.transform.kind) || "identity");
  try { return factory(box || {}, env) || IDENTITY; } catch { return IDENTITY; }
}

const IDENTITY = { toLocal: (p) => p, toOuter: (p) => p, scale: () => 1 };
const origin = (box) => ({ x: (box && box.x) || 0, y: (box && box.y) || 0 });

// ── the composer — the ONLY place the two halves meet ───────────────────────
// chain = [outermost box, …, innermost target box]; each box = { x, y, transform:{kind,…}, … }.
// walk IN: for each box, subtract its origin (first half) then apply its own toLocal (second).
export function chainToLocal(chain, outer, env) {
  let p = outer;
  for (const box of chain) {
    const o = origin(box);
    p = ownTransform(box, env).toLocal({ x: p.x - o.x, y: p.y - o.y });
  }
  return p;
}
// walk OUT (reverse): apply each box's toOuter then add its origin.
export function chainToOuter(chain, local, env) {
  let p = local;
  for (let i = chain.length - 1; i >= 0; i--) {
    const box = chain[i], o = origin(box);
    const q = ownTransform(box, env).toOuter(p);
    p = { x: q.x + o.x, y: q.y + o.y };
  }
  return p;
}
// px per local unit at the end of the chain (product of each box's scale).
export function chainScale(chain, env) {
  let s = 1;
  for (const box of chain) s *= ownTransform(box, env).scale() || 1;
  return s;
}

// ── built-in kinds (each implements ONLY the second half) ───────────────────
// identity — a plain frame; and translate — a placement-only box (a stroke): the translate IS
// the first-half origin subtraction, so its own transform is identity.
registerTransform("identity", () => IDENTITY);
registerTransform("translate", () => IDENTITY);

// viewport — a pan/zoom layer (the canvas camera). Reads the camera off env (reactive) or the
// box's own stored camera. Note: a full-viewport layer has origin (0,0), so the first half is a
// no-op and this is the whole transform.
registerTransform("viewport", (box, env) => {
  const cam = () => (env && typeof env.camera === "function" && env.camera()) || (box && box.camera) || { x: 0, y: 0, z: 1 };
  return {
    toLocal: (p) => { const c = cam(); return { x: (p.x - c.x) / c.z, y: (p.y - c.y) / c.z }; },
    toOuter: (p) => { const c = cam(); return { x: p.x * c.z + c.x, y: p.y * c.z + c.y }; },
    scale: () => cam().z || 1,
  };
});

// rotate — a rotated frame. Rotates around the box centre (box.w/2, box.h/2), in its own space.
registerTransform("rotate", (box) => {
  const deg = (box && (box.transform && box.transform.rotation != null ? box.transform.rotation : box.rotation)) || 0;
  const r = deg * Math.PI / 180;
  const cx = ((box && box.w) || 0) / 2, cy = ((box && box.h) || 0) / 2;
  const cos = Math.cos(r), sin = Math.sin(r);
  return {
    // outer→local: rotate by -r about the centre
    toLocal: (p) => { const dx = p.x - cx, dy = p.y - cy; return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos }; },
    // local→outer: rotate by +r about the centre
    toOuter: (p) => { const dx = p.x - cx, dy = p.y - cy; return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }; },
    scale: () => 1,
  };
});

// scale — a counter-scaled container: content is DRAWN at k× its stored coords (a
// docked/sticky window on a camera layer renders at k = 1/zoom so it holds its
// screen size). local = outer / k.
registerTransform("scale", (box) => {
  const k = (box && box.transform && box.transform.k) || 1;
  return {
    toLocal: (p) => ({ x: p.x / k, y: p.y / k }),
    toOuter: (p) => ({ x: p.x * k, y: p.y * k }),
    scale: () => k,
  };
});

// reproject (a MAP) — the box's own transform is Leaflet's lat/lng projection. The live map
// instance can't live in the doc, so a map box binds its instance here at mount (by item id);
// the transform looks it up. Geo-local coords are { x: lng, y: lat }. Until the map has mounted
// (or if it's gone) the kind is identity, so composition never throws.
const MAP_INSTANCES = new Map();
export function bindMapInstance(id, map) { if (id == null) return; if (map) MAP_INSTANCES.set(id, map); else MAP_INSTANCES.delete(id); notifySpaceChanged(id); }

// ── space-change notification ────────────────────────────────────────────────
// A bound instance's projection CHANGES over time (a Leaflet map pans/zooms), so anything
// rendering through a `reproject` box must re-project. This module stays Solid-free: the map
// calls `notifySpaceChanged(itemId)` on its move/zoom events (and bind/unbind above), and a
// reactive host (canvas.jsx) subscribes once via `onSpaceChanged` and bumps a signal.
// Listeners are a COW array (cheap add/remove, safe iteration mid-notify).
let SPACE_LISTENERS = [];
export function notifySpaceChanged(id) {
  const ls = SPACE_LISTENERS;
  for (const l of ls) { try { l(id); } catch {} }
}
export function onSpaceChanged(cb) {
  SPACE_LISTENERS = [...SPACE_LISTENERS, cb];
  return () => { SPACE_LISTENERS = SPACE_LISTENERS.filter((x) => x !== cb); };
}
export const mapInstanceFor = (id) => MAP_INSTANCES.get(id) || null; // the live Leaflet for a map box (for screen↔geo outside the composer)
registerTransform("reproject", (box) => {
  const map = box && MAP_INSTANCES.get(box.id);
  if (!map) return IDENTITY;
  return {
    toLocal: (p) => { const ll = map.containerPointToLatLng([p.x, p.y]); return { x: ll.lng, y: ll.lat }; }, // screen px → geo (lng,lat)
    toOuter: (g) => { const pt = map.latLngToContainerPoint([g.y, g.x]); return { x: pt.x, y: pt.y }; },        // geo → screen px
    scale: () => 1,
  };
});
