// The constraint-SKETCH model + solver — Ivan Sutherland's Sketchpad in
// miniature, the part that makes a figure *hold together*. A sketch is one
// canvas item: a set of NODES (points) joined by BARS (rigid links with a rest
// length). Nodes can be coincident by virtue of being the SAME node — that's
// how two bars share a pivot. Drag a node and the solver re-satisfies every
// bar's length (and every pinned/anchored node), so the linkage articulates:
// the scissors demo is just rigid bars around shared pivots.
//
//   sketch { kind:"sketch", id, nodes:[{id,x,y,fixed?}], bars:[{id,a,b,len}],
//            color, strokeWidth, rotation }
//
// Coords are plain canvas coords (world, at root) like every other item, so the
// host renders/selects/moves it with the same machinery (see itemBounds /
// the move handler in tool.jsx). Articulation lives in `relax`, which the
// SketchItem runs on every node-drag move.

// Axis-aligned bounds of a sketch = bounding box of its nodes, padded for the
// node dots + stroke. Always at least a few px so a fresh one-node sketch shows.
export function sketchBounds(s) {
  const ns = s.nodes || [];
  if (!ns.length) return { x: s.x || 0, y: s.y || 0, w: 1, h: 1 };
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const n of ns) {
    if (n.x < minx) minx = n.x; if (n.y < miny) miny = n.y;
    if (n.x > maxx) maxx = n.x; if (n.y > maxy) maxy = n.y;
  }
  const pad = Math.max(8, (s.strokeWidth || 2) + 6);
  return { x: minx - pad, y: miny - pad, w: maxx - minx + 2 * pad, h: maxy - miny + 2 * pad };
}

// Gauss-Seidel relaxation (à la Sketchpad / position-based dynamics): repeatedly
// nudge each bar's endpoints toward its rest length. `pinned` (a Set of node
// ids) and any node's own `fixed` flag are held still — the rest move. Mutates
// `nodes` in place (expects plain {id,x,y,fixed} objects, not automerge proxies).
//
// Two constraint kinds run together each iteration:
//  1. BAR length — every bar is a rigid rod (the distance constraint).
//  2. RIGID PIVOT — a *fixed* node whose two opposite bars are roughly in line
//     keeps them collinear, turning bar–pivot–bar into ONE rigid arm that swings
//     about the pivot. That's a scissor arm: move one tip, the other swings the
//     opposite way, the arm staying straight. We only do this when the two
//     neighbours are NOT directly joined (so we never flatten a triangle) and
//     are already roughly in line (so an L-shaped anchor stays bent).
export function relax(nodes, bars, pinned = new Set(), iters = 60) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const held = (n) => n.fixed || pinned.has(n.id);

  // incident neighbours per node + adjacency, to find rigid pivots once up front
  const incident = new Map();
  const adj = new Set();
  const key = (x, y) => (x < y ? x + "|" + y : y + "|" + x);
  const link = (x, y) => { if (!incident.has(x)) incident.set(x, []); incident.get(x).push(y); };
  for (const bar of bars) { link(bar.a, bar.b); link(bar.b, bar.a); adj.add(key(bar.a, bar.b)); }
  const pivots = [];
  for (const n of nodes) {
    if (!n.fixed) continue;
    const nb = (incident.get(n.id) || []).map((id) => byId.get(id)).filter(Boolean);
    if (nb.length < 2) continue;
    for (const [p, q] of pairOpposite(n, nb)) {
      if (adj.has(key(p.id, q.id))) continue; // p–q joined → a triangle, leave it
      pivots.push({ n, p, q }); // pairOpposite already screened for roughly-in-line
    }
  }

  for (let k = 0; k < iters; k++) {
    for (const bar of bars) {
      const a = byId.get(bar.a), b = byId.get(bar.b);
      if (!a || !b) continue;
      const af = held(a), bf = held(b);
      if (af && bf) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy) || 1e-6;
      const k2 = (d - bar.len) / d;
      if (af) { b.x -= dx * k2; b.y -= dy * k2; }
      else if (bf) { a.x += dx * k2; a.y += dy * k2; }
      else { const h = k2 * 0.5; a.x += dx * h; a.y += dy * h; b.x -= dx * h; b.y -= dy * h; }
    }
    for (const pv of pivots) straighten(pv.n, pv.p, pv.q, held);
  }
  return nodes;
}

// pair a fixed node's neighbours into roughly-opposite pairs (so bar–pivot–bar
// arms get straightened). Only pairs within ~50° of a straight line qualify.
function pairOpposite(n, nb) {
  const dirs = nb.map((p) => ({ p, ang: Math.atan2(p.y - n.y, p.x - n.x) }));
  const used = new Set(), pairs = [];
  const apart = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
  for (let i = 0; i < dirs.length; i++) {
    if (used.has(i)) continue;
    let best = -1, bestErr = Infinity;
    for (let j = i + 1; j < dirs.length; j++) {
      if (used.has(j)) continue;
      const err = Math.abs(Math.PI - apart(dirs[i].ang, dirs[j].ang)); // 0 = perfectly opposite
      if (err < bestErr) { bestErr = err; best = j; }
    }
    if (best >= 0 && bestErr < (60 * Math.PI) / 180) { used.add(i); used.add(best); pairs.push([dirs[i].p, dirs[best].p]); }
  }
  return pairs;
}

// hold n (fixed) and place p, q collinear through it, each at its current radius
// (the bar-length constraint pins the radii) — so the arm stays straight.
function straighten(n, p, q, held) {
  const hp = held(p), hq = held(q);
  if (hp && hq) return;
  const rp = Math.hypot(p.x - n.x, p.y - n.y) || 1e-6;
  const rq = Math.hypot(q.x - n.x, q.y - n.y) || 1e-6;
  if (hp) { const ux = (p.x - n.x) / rp, uy = (p.y - n.y) / rp; q.x = n.x - ux * rq; q.y = n.y - uy * rq; return; }
  if (hq) { const ux = (q.x - n.x) / rq, uy = (q.y - n.y) / rq; p.x = n.x - ux * rp; p.y = n.y - uy * rp; return; }
  let dx = (p.x - n.x) - (q.x - n.x), dy = (p.y - n.y) - (q.y - n.y);
  const L = Math.hypot(dx, dy) || 1e-6; dx /= L; dy /= L;
  p.x = n.x + dx * rp; p.y = n.y + dy * rp;
  q.x = n.x - dx * rq; q.y = n.y - dy * rq;
}

// ---- structural edits (work on a sketch's live nodes/bars, proxy or plain) --

// SNAP: fold `dropId` into `keepId` — every bar repoints, self-loops and the
// duplicate bars that creates are removed, the dropped node deleted.
export function mergeNodes(sketch, keepId, dropId) {
  if (keepId === dropId) return;
  for (const bar of sketch.bars) { if (bar.a === dropId) bar.a = keepId; if (bar.b === dropId) bar.b = keepId; }
  const seen = new Set();
  for (let i = sketch.bars.length - 1; i >= 0; i--) {
    const bar = sketch.bars[i];
    const k = bar.a < bar.b ? bar.a + "|" + bar.b : bar.b + "|" + bar.a;
    if (bar.a === bar.b || seen.has(k)) { sketch.bars.splice(i, 1); continue; }
    seen.add(k);
  }
  const ni = sketch.nodes.findIndex((n) => n.id === dropId);
  if (ni >= 0) sketch.nodes.splice(ni, 1);
}

// UN-snap: the inverse — give every incident bar past the first its own fresh
// point, fanned out a little so they're distinct and grabbable.
export function unsnapNode(sketch, nodeId, uid) {
  const node = sketch.nodes.find((n) => n.id === nodeId);
  const incident = sketch.bars.filter((bar) => bar.a === nodeId || bar.b === nodeId);
  if (!node || incident.length < 2) return;
  for (let k = 1; k < incident.length; k++) {
    const bar = incident[k];
    const ang = (k / incident.length) * Math.PI * 2;
    const nn = { id: uid(), x: node.x + Math.cos(ang) * 16, y: node.y + Math.sin(ang) * 16, fixed: false };
    sketch.nodes.push(nn);
    if (bar.a === nodeId) bar.a = nn.id; else bar.b = nn.id;
  }
  node.fixed = false;
}

// SPLIT a bar at world (x,y) — insert a node on it (clamped off the ends) and
// replace the bar with its two halves. `fixed` pins the new node (a pivot).
export function splitBarAt(sketch, barId, x, y, uid, fixed = false) {
  const bi = sketch.bars.findIndex((b) => b.id === barId);
  if (bi < 0) return null;
  const bar = sketch.bars[bi];
  const A = sketch.nodes.find((n) => n.id === bar.a), B = sketch.nodes.find((n) => n.id === bar.b);
  if (!A || !B) return null;
  const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1e-9;
  let t = ((x - A.x) * dx + (y - A.y) * dy) / L2;
  t = Math.max(0.15, Math.min(0.85, t));
  const mx = A.x + t * dx, my = A.y + t * dy;
  const m = { id: uid(), x: mx, y: my, fixed };
  sketch.nodes.push(m);
  sketch.bars.splice(bi, 1,
    { id: uid(), a: A.id, b: m.id, len: Math.hypot(mx - A.x, my - A.y) },
    { id: uid(), a: m.id, b: B.id, len: Math.hypot(B.x - mx, B.y - my) });
  return m.id;
}

// interior intersection of segments p1p2 and p3p4 (null if parallel or meeting
// only at/near an endpoint)
function segInt(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  return null;
}

// WELD CROSSINGS — wherever two bars properly cross (and don't already share a
// node), split both at the intersection and pin a SHARED pivot there. So drawing
// two crossing lines makes a rigid, articulating X: the scissors. Crossing bars
// in separate sketches are merged into one first. Pure; mutates `items`.
export function weldCrossings(items, uid) {
  const nodeOf = (s, id) => s.nodes.find((n) => n.id === id);
  for (let guard = 0; guard < 200; guard++) {
    const sketches = items.filter((it) => it.kind === "sketch");
    let hit = null;
    search:
    for (let i = 0; i < sketches.length; i++) {
      const s1 = sketches[i];
      for (let bi = 0; bi < s1.bars.length; bi++) {
        const b1 = s1.bars[bi], A1 = nodeOf(s1, b1.a), B1 = nodeOf(s1, b1.b);
        if (!A1 || !B1) continue;
        for (let j = i; j < sketches.length; j++) {
          const s2 = sketches[j];
          for (let bj = (j === i ? bi + 1 : 0); bj < s2.bars.length; bj++) {
            const b2 = s2.bars[bj], A2 = nodeOf(s2, b2.a), B2 = nodeOf(s2, b2.b);
            if (!A2 || !B2) continue;
            if (s1 === s2 && (b1.a === b2.a || b1.a === b2.b || b1.b === b2.a || b1.b === b2.b)) continue;
            const x = segInt(A1, B1, A2, B2);
            if (x) { hit = { s1, b1, A1, B1, s2, b2, A2, B2, x }; break search; }
          }
        }
      }
    }
    if (!hit) break;
    weldAt(items, hit, uid);
  }
}

function weldAt(items, h, uid) {
  let { s1, b1, A1, B1, s2, b2, A2, B2, x } = h;
  const D = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  if (s1 !== s2) {
    // pull s2's nodes/bars into s1 under fresh ids, then drop s2
    const remap = new Map();
    for (const n of s2.nodes) { const nid = uid(); remap.set(n.id, nid); s1.nodes.push({ id: nid, x: n.x, y: n.y, fixed: !!n.fixed }); }
    for (const bar of s2.bars) s1.bars.push({ id: uid(), a: remap.get(bar.a), b: remap.get(bar.b), len: bar.len });
    b2 = { a: remap.get(b2.a), b: remap.get(b2.b) };
    A2 = s1.nodes.find((n) => n.id === b2.a); B2 = s1.nodes.find((n) => n.id === b2.b);
    const si = items.findIndex((it) => it === s2); if (si >= 0) items.splice(si, 1);
  }
  const m = { id: uid(), x: x.x, y: x.y, fixed: true };
  s1.nodes.push(m);
  const drop = (na, nb) => { const k = s1.bars.findIndex((bar) => (bar.a === na && bar.b === nb) || (bar.a === nb && bar.b === na)); if (k >= 0) s1.bars.splice(k, 1); };
  drop(b1.a, b1.b); drop(b2.a, b2.b);
  s1.bars.push({ id: uid(), a: b1.a, b: m.id, len: D(A1, m) }, { id: uid(), a: m.id, b: b1.b, len: D(m, B1) });
  s1.bars.push({ id: uid(), a: b2.a, b: m.id, len: D(A2, m) }, { id: uid(), a: m.id, b: b2.b, len: D(m, B2) });
}

// plain {id,x,y,fixed} copies of a sketch's nodes (so we never relax automerge
// proxies, then write the results back)
export function nodeCopies(sketch) {
  return (sketch.nodes || []).map((n) => ({ id: n.id, x: n.x, y: n.y, fixed: !!n.fixed }));
}
export function barCopies(sketch) {
  return (sketch.bars || []).map((b) => ({ a: b.a, b: b.b, len: b.len }));
}
