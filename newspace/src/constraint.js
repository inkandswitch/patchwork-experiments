// A constraint-SKETCH brush — Ivan Sutherland's Sketchpad / Ink & Switch
// Crosscut, the buildable version. Registered as a `sketchy:brush` plugin, it
// owns its whole gesture through the host's `behavior` hooks and builds a real
// articulable figure (a `sketch` item) rather than dropping loose lines.
//
// Each DRAG adds one rigid BAR. Where a bar's end lands on an existing NODE it
// reuses that node (a shared pivot); where it lands on the middle of an existing
// BAR it SPLITS that bar and shares the new pivot — that crossing-pivot is what
// makes the Sketchpad scissors possible. In select mode, drag any node and the
// solver (sketch.js) keeps every bar's length; double-click a node to anchor it.
//
// IMPORTANT (pluggable-brush design): everything the brush needs lives in the
// brush. It reads/writes the document only through the generic host context
// (ctx.items + ctx.change — no sketch knowledge in tool.jsx beyond rendering),
// and it injects its OWN css (below) rather than relying on the host stylesheet,
// so it could just as well ship from a separate package.

import { weldCrossings } from "./sketch.js";

// ---- self-contained styling (injected once, on load) ----------------------
const CSS = `
.ns-guide-seg { fill: none; stroke: var(--ns-pink); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.85; }
.ns-guide-pt { fill: var(--ns-paper); stroke: var(--ns-sky); stroke-width: 1.5; }
.ns-guide-pt.hot { fill: var(--ns-pink); stroke: var(--ns-pink); }
.ns-guide-badge { fill: var(--ns-pink); font: 600 13px var(--studio-family-mono, ui-monospace, monospace); paint-order: stroke; stroke: var(--ns-paper); stroke-width: 3px; stroke-linejoin: round; dominant-baseline: middle; user-select: none; }
.ns-sketch-node { fill: var(--ns-paper); stroke: var(--ns-sky); stroke-width: 2; vector-effect: non-scaling-stroke; cursor: grab; }
.ns-sketch-node:active { cursor: grabbing; }
.ns-sketch-node.fixed { fill: var(--ns-pink); stroke: var(--ns-pink); }
.ns-sketch-node.merge { stroke: var(--ns-pink); stroke-width: 3.5; }
.ns-sel-sketch { fill: none; stroke: var(--ns-sky); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
`;
function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("newspace-constraint-brush")) return;
  const el = document.createElement("style");
  el.id = "newspace-constraint-brush";
  el.textContent = CSS;
  document.head.appendChild(el);
}
injectCSS();

const ANGLE_TOL = (7 * Math.PI) / 180;

function angDiff(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// ---- geometry the brush computes from the live model -----------------------
// Sketch BARS, with their bar identity (sketchId + endpoint node ids) so we can
// split the exact one an endpoint lands on. (ctx.geometry.segments carries only
// the owning item id, which isn't enough to split a specific bar.)
function sketchBars(items) {
  const out = [];
  for (const it of items || []) {
    if (it.kind !== "sketch") continue;
    const byId = new Map((it.nodes || []).map((n) => [n.id, n]));
    for (const bar of it.bars || []) {
      const a = byId.get(bar.a), b = byId.get(bar.b);
      if (a && b) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, sketchId: it.id, na: bar.a, nb: bar.b });
    }
  }
  return out;
}

function projectOnSeg(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L2));
  const x = s.x1 + t * dx, y = s.y1 + t * dy;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

// nearest snap point (carrying node identity if any), skipping the gesture start
function snapPoint(pt, points, tol, not) {
  let best = null, bd = tol;
  for (const q of points || []) {
    if (not && Math.hypot(q.x - not.x, q.y - not.y) < 1e-6) continue;
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// the middle of an existing bar (not its ends — those are node snaps) → a split
function snapBar(pt, bars, tol) {
  let best = null, bd = tol;
  for (const s of bars) {
    const pr = projectOnSeg(pt.x, pt.y, s);
    if (pr.dist < bd && pr.t > 0.08 && pr.t < 0.92) { bd = pr.dist; best = { x: pr.x, y: pr.y, sketchId: s.sketchId, splitBar: { na: s.na, nb: s.nb } }; }
  }
  return best;
}

// resolve a raw pointer to a constrained endpoint. priority: coincident node
// (shared pivot) > on a bar (split → shared pivot) > angle (axes / ∥ / ⊥) +
// equal length > free. `from` (the gesture start) enables the angle snaps.
function resolvePoint(raw, ctx, from) {
  const geo = ctx.geometry, bars = sketchBars(ctx.items), tol = ctx.tol;

  const node = snapPoint(raw, geo.points, tol, from);
  if (node) return { end: { x: node.x, y: node.y, sketchId: node.sketchId, nodeId: node.nodeId }, cons: ["•"], guides: [{ t: "pt", x: node.x, y: node.y, hot: true }] };

  const bar = snapBar(raw, bars, tol);
  if (bar) return { end: bar, cons: ["•"], guides: [{ t: "pt", x: bar.x, y: bar.y, hot: true }, { t: "seg", x1: raw.x, y1: raw.y, x2: bar.x, y2: bar.y }] };

  if (!from) return { end: { x: raw.x, y: raw.y }, cons: [], guides: [] };

  const dx = raw.x - from.x, dy = raw.y - from.y;
  let len = Math.hypot(dx, dy);
  if (len < 1e-3) return { end: { x: raw.x, y: raw.y }, cons: [], guides: [] };
  const ang = Math.atan2(dy, dx);

  const cands = [
    { a: 0, glyph: "H" }, { a: Math.PI / 2, glyph: "V" },
    { a: Math.PI / 4, glyph: "⌟" }, { a: -Math.PI / 4, glyph: "⌟" },
  ];
  for (const s of geo.segments) {
    const sa = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    cands.push({ a: sa, glyph: "∥", ref: s });
    cands.push({ a: sa + Math.PI / 2, glyph: "⊥", ref: s });
  }
  let snap = null, bestErr = ANGLE_TOL;
  for (const c of cands) {
    let a = c.a, err = angDiff(ang, c.a);
    const err2 = angDiff(ang, c.a + Math.PI);
    if (err2 < err) { err = err2; a = c.a + Math.PI; }
    if (err < bestErr) { bestErr = err; snap = { ...c, a }; }
  }

  const cons = [], guides = [];
  let end = { x: raw.x, y: raw.y };
  if (snap) {
    end = { x: from.x + Math.cos(snap.a) * len, y: from.y + Math.sin(snap.a) * len };
    cons.push(snap.glyph);
    if (snap.ref) guides.push({ t: "seg", x1: snap.ref.x1, y1: snap.ref.y1, x2: snap.ref.x2, y2: snap.ref.y2 });
  }
  len = Math.hypot(end.x - from.x, end.y - from.y);
  let lref = null, lb = tol;
  for (const s of geo.segments) { const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); if (Math.abs(sl - len) < lb) { lb = Math.abs(sl - len); lref = sl; } }
  if (lref) { const a = Math.atan2(end.y - from.y, end.x - from.x); end = { x: from.x + Math.cos(a) * lref, y: from.y + Math.sin(a) * lref }; cons.push("="); }
  return { end, cons, guides };
}

// the live preview: a rough.js straight line (a bar-to-be), matching how bars
// are drawn once committed (see SketchItem)
function lineDraft(a, b, brush) {
  return {
    kind: "shape", type: "line", x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y,
    color: brush.color, fill: "none", strokeWidth: brush.size || 2,
    roughness: brush.roughness ?? 1.1, bowing: brush.bowing ?? 0.6, fillStyle: "solid", seed: 1, rotation: 0,
  };
}

// ---- committing a bar into the document ------------------------------------
const findSketch = (items, id) => items.find((it) => it.id === id && it.kind === "sketch");

// turn a resolved endpoint into a concrete { sketch, nodeId } inside `items`,
// creating the node by SPLITTING a bar when the end landed on one. returns null
// when the end is "free" (not on any sketch) — the caller starts a new sketch.
function resolveNode(items, end, uid) {
  if (end.nodeId) { const s = findSketch(items, end.sketchId); return s ? { sketch: s, nodeId: end.nodeId } : null; }
  if (end.splitBar) {
    const s = findSketch(items, end.sketchId);
    if (!s) return null;
    const m = { id: uid(), x: end.x, y: end.y, fixed: false };
    const bi = s.bars.findIndex((b) => b.a === end.splitBar.na && b.b === end.splitBar.nb);
    s.nodes.push(m);
    if (bi >= 0) {
      const bar = s.bars[bi];
      const A = s.nodes.find((n) => n.id === bar.a), B = s.nodes.find((n) => n.id === bar.b);
      const l1 = Math.hypot(m.x - A.x, m.y - A.y), l2 = Math.hypot(B.x - m.x, B.y - m.y);
      s.bars.splice(bi, 1, { id: uid(), a: bar.a, b: m.id, len: l1 }, { id: uid(), a: m.id, b: bar.b, len: l2 });
    }
    return { sketch: s, nodeId: m.id };
  }
  return null;
}

// commit one bar between resolved endpoints `a` and `b`, then weld any crossings
// it created into shared pinned pivots (so two crossing lines = a scissors).
export function addBar(items, a, b, brush, uid) {
  addBarOnly(items, a, b, brush, uid);
  weldCrossings(items, uid);
}

// the bar commit itself. Mutates `items`: creates a sketch, extends one, closes
// a loop, splits a bar, or merges two.
function addBarOnly(items, a, b, brush, uid) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-3) return;
  const mkBar = (na, nb, l = len) => ({ id: uid(), a: na, b: nb, len: l });
  const ra = resolveNode(items, a, uid);
  const rb = resolveNode(items, b, uid);

  if (!ra && !rb) {
    const n1 = { id: uid(), x: a.x, y: a.y, fixed: false }, n2 = { id: uid(), x: b.x, y: b.y, fixed: false };
    items.push({ id: uid(), kind: "sketch", nodes: [n1, n2], bars: [mkBar(n1.id, n2.id)], color: brush.color, strokeWidth: brush.size || 2, roughness: brush.roughness, bowing: brush.bowing, rotation: 0 });
    return;
  }
  if (ra && !rb) { const n = { id: uid(), x: b.x, y: b.y, fixed: false }; ra.sketch.nodes.push(n); ra.sketch.bars.push(mkBar(ra.nodeId, n.id)); return; }
  if (rb && !ra) { const n = { id: uid(), x: a.x, y: a.y, fixed: false }; rb.sketch.nodes.push(n); rb.sketch.bars.push(mkBar(n.id, rb.nodeId)); return; }

  if (ra.sketch.id === rb.sketch.id) {
    if (ra.nodeId === rb.nodeId) return;
    if (ra.sketch.bars.some((bar) => (bar.a === ra.nodeId && bar.b === rb.nodeId) || (bar.a === rb.nodeId && bar.b === ra.nodeId))) return;
    ra.sketch.bars.push(mkBar(ra.nodeId, rb.nodeId));
    return;
  }
  // ends on DIFFERENT sketches → merge rb's into ra's, then connect
  const remap = new Map();
  for (const n of rb.sketch.nodes) { const nid = uid(); remap.set(n.id, nid); ra.sketch.nodes.push({ id: nid, x: n.x, y: n.y, fixed: !!n.fixed }); }
  for (const bar of rb.sketch.bars) ra.sketch.bars.push({ id: uid(), a: remap.get(bar.a), b: remap.get(bar.b), len: bar.len });
  ra.sketch.bars.push(mkBar(ra.nodeId, remap.get(rb.nodeId)));
  const i = items.findIndex((it) => it.id === rb.sketch.id);
  if (i >= 0) items.splice(i, 1);
}

function guidesFor(a, b, cons, extra, tol) {
  const guides = [{ t: "pt", x: a.x, y: a.y }, { t: "pt", x: b.x, y: b.y, hot: cons.includes("•") }, ...extra];
  if (cons.length) guides.push({ t: "badge", x: b.x + tol * 1.4, y: b.y - tol, text: cons.join(" ") });
  return guides;
}

export const ConstraintBrush = {
  id: "constraint",
  name: "Constraint sketch",
  icon: "Ruler",
  iconPath: "M5 18a1.6 1.6 0 100-.1z M17 6a1.6 1.6 0 100-.1z M6 17L16 7 M6 17h5",
  // declared params → the host renders a panel for them (the "clean" form). A
  // brush can instead set `params` to a function (element, {get,set}) => cleanup
  // to render its OWN whole panel.
  params: [
    { key: "color", type: "color", label: "colour" },
    { key: "size", type: "size", label: "thickness" },
    { key: "roughness", type: "slider", min: 0, max: 3, step: 0.1, label: "sketchiness" },
  ],
  behavior: {
    down(ctx) {
      const r = resolvePoint(ctx.p, ctx, null);
      ctx.state.a = r.end;
      ctx.state.b = r.end;
      ctx.setDraft(lineDraft(r.end, r.end, ctx.brush));
      ctx.setGuides([{ t: "pt", x: r.end.x, y: r.end.y, hot: r.cons.includes("•") }, ...r.guides.filter((g) => g.t !== "pt")]);
    },
    move(ctx) {
      const a = ctx.state.a;
      const r = resolvePoint(ctx.p, ctx, a);
      ctx.state.b = r.end;
      ctx.setDraft(lineDraft(a, r.end, ctx.brush));
      ctx.setGuides(guidesFor(a, r.end, r.cons, r.guides, ctx.tol));
    },
    up(ctx) {
      const a = ctx.state.a, b = ctx.state.b || ctx.p;
      ctx.setDraft(null);
      ctx.setGuides(null);
      if (Math.hypot(b.x - a.x, b.y - a.y) <= 3) return;
      ctx.change((items) => addBar(items, a, b, ctx.brush, ctx.uid));
    },
  },
};

export const constraintPlugin = {
  type: "sketchy:brush",
  id: "constraint",
  name: "Constraint sketch",
  icon: "Ruler",
  async load() {
    return ConstraintBrush;
  },
};
