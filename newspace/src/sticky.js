// STICKY — a window docked to a viewport EDGE, set by dragging. Any root
// window/doc item may carry `sticky: { edge: "left"|"right"|"top"|"bottom",
// t: 0..1 }`: `edge` is the viewport edge it hugs, `t` the normalized position
// ALONG that edge (0 = the top/left end, 1 = the bottom/right end). While
// stuck, the item renders viewport-anchored (the stored x/y are unused); a drag
// away from the edge deletes `sticky` and writes fresh space coords.
//
// The legacy corner `anchor` field ("bottom-left" etc., x/y stored as offsets
// from that corner) READS as sticky (stickyOf below): sticky wins when both
// are present, persisted `anchor` fields are never rewritten by reads, and
// every dock interaction writes sticky only (a gesture that rewrites a legacy
// item's position persists the sticky form and deletes `anchor`).
//
// Pure math only (unit-tested in sticky.test.js); the canvas owns the DOM.

export const STICKY_SNAP = 24; // px from a viewport edge within which a drop docks
export const STICKY_INSET = 12; // px a docked window sits off its edge

export const STICKY_EDGES = ["left", "right", "top", "bottom"];

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

// t along an edge from a top-left position: the fraction of the FREE run
// (viewport minus the item) the item sits at. Degenerate runs centre (0.5).
export function stickyT(edge, x, y, w, h, W, H) {
  if (edge === "left" || edge === "right") return H > h ? clamp01(y / (H - h)) : 0.5;
  return W > w ? clamp01(x / (W - w)) : 0.5;
}

// Does a rect (screen px) land within `snap` of a viewport edge? Returns the
// full sticky value `{ edge, t }` for the NEAREST qualifying edge, else null.
export function stickyFromRect(x, y, w, h, W, H, snap = STICKY_SNAP) {
  const dist = { left: x, right: W - (x + w), top: y, bottom: H - (y + h) };
  let edge = null;
  for (const e of STICKY_EDGES) if (dist[e] <= snap && (edge === null || dist[e] < dist[edge])) edge = e;
  if (!edge) return null;
  return { edge, t: stickyT(edge, x, y, w, h, W, H) };
}

// is the item viewport-docked (sticky, or a legacy corner anchor)?
export const isStuck = (it) => !!(it && (it.sticky || it.anchor));

// the item's EFFECTIVE sticky value (migrate-on-read; sticky wins). A corner
// anchor normalizes onto its left/right edge with t derived from the stored
// along-edge offset, so resolveStickyScreen reproduces the legacy along-edge
// position exactly — only the cross axis shifts (the 16px corner offsets
// become the 12px STICKY_INSET, a ≤4px move for the seeded chrome).
export function stickyOf(it, W, H) {
  if (!it) return null;
  if (it.sticky) return it.sticky;
  const a = it.anchor;
  if (typeof a !== "string") return null;
  const edge = a.endsWith("right") ? "right" : "left";
  const run = Math.max(0, (H || 0) - (it.h || 0));
  const target = a.startsWith("top") ? it.y || 0 : run - (it.y || 0);
  return { edge, t: run > 0 ? clamp01(target / run) : 0.5 };
}

// A sticky value + the item's size → its top-left in SCREEN px: flush to the
// edge (inset off it), positioned along it by t over the free run.
export function resolveStickyScreen(sticky, w, h, W, H, inset = STICKY_INSET) {
  const t = clamp01(sticky && sticky.t);
  const runX = Math.max(0, W - w), runY = Math.max(0, H - h);
  switch (sticky && sticky.edge) {
    case "left": return { x: inset, y: t * runY };
    case "right": return { x: Math.max(0, W - w - inset), y: t * runY };
    case "top": return { x: t * runX, y: inset };
    default: return { x: t * runX, y: Math.max(0, H - h - inset) }; // bottom (and the safe fallback)
  }
}
