// Pure, framework-free model logic for newspace — extracted so it can be unit
// tested (the interaction/CSS bugs need a real browser, but these data rules
// caused most of the regressions: reconcile, transfer dedupe, coord transforms).
import { shapeBounds, strokeBounds } from "./draw.js";

export const rad = (d) => (d * Math.PI) / 180;
export function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// folders and newspaces both render as a "box" (a managed sub-doc)
export const isBoxType = (t) => t === "newspace" || t === "folder";

// a frame defines a rotated coordinate space (origin = frame top-left, rotated
// about its centre); local<->world is the transform in/out of that space.
export function localToWorld(frame, x, y) {
  if (!frame) return [x, y];
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const [rx, ry] = rot(x - frame.w / 2, y - frame.h / 2, rad(frame.rotation || 0));
  return [cx + rx, cy + ry];
}
export function worldToLocal(frame, x, y) {
  if (!frame) return [x, y];
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const [rx, ry] = rot(x - cx, y - cy, -rad(frame.rotation || 0));
  return [rx + frame.w / 2, ry + frame.h / 2];
}
export const pointInFrame = (f, wx, wy) => {
  const [lx, ly] = worldToLocal(f, wx, wy);
  return lx >= 0 && lx <= f.w && ly >= 0 && ly <= f.h;
};

// axis-aligned bounds of an item in its own coordinate space
export function itemBounds(it) {
  if (it.kind === "shape") return shapeBounds(it);
  if (it.kind === "stroke") return strokeBounds(it);
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

// deep-clone an item to a plain object (for moving between automerge docs)
export function cloneItem(o) {
  const c = { ...o };
  if (o.kind === "stroke" && Array.isArray(o.points)) c.points = o.points.map((p) => p.slice());
  delete c.parent;
  return c;
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

// alt-drag can leave several doc/frame shapes pointing at ONE url. When deleting
// `deletingIds`, the folder link should be removed only if no OTHER (un-deleted)
// shape still references that url — i.e. we're removing its last shape.
export function shouldUnlinkDoc(items, url, deletingIds) {
  const del = deletingIds instanceof Set ? deletingIds : new Set(deletingIds);
  return !items.some((it) => (it.kind === "doc" || it.kind === "frame") && it.url === url && !del.has(it.id));
}
