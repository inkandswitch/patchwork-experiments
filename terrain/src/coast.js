// Land or water at every node of the grid, from OpenStreetMap's coastline
// (never from the DEM's 0 m contour, which wanders a cell or more from the
// real shore). OSM draws natural=coastline with the land on its left.
//
// How, and why it's right:
// 1. The ways are joined end to end (by node id) into chains: closed rings
//    (islands, islets) and open chains that leave the box (the mainland).
// 2. Every node within `band` metres of the coastline is labelled by the
//    side of its nearest point on it: a segment's side if that point is
//    inside a segment, else the vertex's rule (land is the wedge left of
//    both edges where the shore turns left, left of either where it turns
//    right). For curves that don't cross, the nearest point's side is the
//    region's: the straight line from a node to its nearest point crosses no
//    coastline. An open chain's free end has no such rule, so a node whose
//    nearest point is one is an error; openEnds() says where they are, and
//    the check is that none is within `band` of the grid.
// 3. Every other node is more than `band` from the coast, with band ≥ one
//    cell. Two such nodes a step apart can't have the coast between them
//    (it would pass within half a step of one), and neither can such a node
//    and a labelled neighbour (within a step of it). So each 4-connected
//    region of unlabelled nodes lies on one side, and takes the label of the
//    labelled nodes around it. That they all agree is checked, not assumed:
//    a region bordered by both is a conflict (an OSM coastline that crosses
//    itself or runs the wrong way), and the result says so.
//
// The result also keeps each band node's signed distance (land +), which is
// what burn.js shapes the shore from.

/**
 * Join coastline ways into chains by their end node ids.
 * @param {{ id: string, a: number, b: number, points: number[][] }[]} ways
 * @returns {{ closed: boolean, points: number[][], ids: string[] }[]}  a closed chain's points don't repeat the first
 */
export function joinCoast(ways) {
  const byStart = new Map();
  for (const w of ways) {
    if (w.a === w.b) continue;
    if (byStart.has(w.a)) throw new Error(`OSM's coastline forks at node ${w.a} (${byStart.get(w.a).id}, ${w.id}).`);
    byStart.set(w.a, w);
  }
  const byEnd = new Map();
  for (const w of ways) if (w.a !== w.b) byEnd.set(w.b, w);
  const used = new Set();
  const out = [];
  const append = (pts, more) => {
    for (const p of more) {
      const last = pts[pts.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      pts.push(p);
    }
  };
  for (const w of ways) {
    if (used.has(w)) continue;
    if (w.a === w.b) {
      used.add(w);
      const pts = [];
      append(pts, w.points);
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      if (pts.length >= 3) out.push({ closed: true, points: pts, ids: [w.id] });
      continue;
    }
    // back up to the chain's first way (or all the way round a ring)
    let first = w;
    for (;;) {
      const prev = byEnd.get(first.a);
      if (!prev || used.has(prev) || prev === w) break;
      first = prev;
    }
    const pts = [], ids = [];
    let cur = first, closed = false;
    while (cur && !used.has(cur)) {
      used.add(cur);
      ids.push(cur.id);
      append(pts, cur.points);
      const next = byStart.get(cur.b);
      if (next === first) {
        closed = true;
        break;
      }
      cur = next;
    }
    if (closed && pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
    if (pts.length >= 2) out.push({ closed, points: pts, ids });
  }
  return out;
}

/** The open chains' free ends: [{ point, id, end: "start" | "end" }]. */
export function openEnds(chains) {
  const out = [];
  for (const c of chains) {
    if (c.closed) continue;
    out.push({ point: c.points[0], id: c.ids[0], end: "start" }, { point: c.points.at(-1), id: c.ids.at(-1), end: "end" });
  }
  return out;
}

/** Distance from a point to the grid's rectangle of nodes (0 inside). */
export function distanceToGrid(grid, [x, z]) {
  const x1 = grid.x0, x2 = grid.x0 + (grid.n - 1) * grid.cell, z1 = grid.z0, z2 = grid.z0 + (grid.n - 1) * grid.cell;
  const dx = Math.max(x1 - x, 0, x - x2), dz = Math.max(z1 - z, 0, z - z2);
  return Math.hypot(dx, dz);
}

// side of P from the directed line p→p+d: + is the left (land), in the map's sense (x east, north up; z is south)
const sideOf = (dx, dz, px, pz) => dz * px - dx * pz;

export const LAND = 1;
export const WATER = -1;

/**
 * Label every node of the grid land or water.
 * @param {{ n: number, cell: number, x0: number, z0: number }} grid  square: n × n nodes
 * @param {{ closed: boolean, points: number[][] }[]} chains
 * @param {{ band?: number }} [o]  how far from the coast nodes are labelled by their nearest point (≥ one cell; default cell·√2)
 * @returns {{ label: Int8Array, dist: Float32Array, band: number, stats: object, problems: string[] }}
 *   label: LAND or WATER (0 where it couldn't be told: see problems); dist: distance to the coast for band nodes, Infinity elsewhere
 */
export function classify(grid, chains, { band = grid.cell * Math.SQRT2 } = {}) {
  const { n, cell, x0, z0 } = grid;
  if (!(band >= cell)) throw new Error("The band must be at least one cell.");
  const N = n * n;
  const dist = new Float32Array(N).fill(Infinity);
  const side = new Int8Array(N); // +1 land, −1 water, 2 an open chain's free end
  const range = (lo, hi, o) => [Math.max(0, Math.ceil((lo - band - o) / cell)), Math.min(n - 1, Math.floor((hi + band - o) / cell))];
  const best = new Float64Array(N).fill(Infinity);

  for (const c of chains) {
    const pts = c.points;
    const m = pts.length;
    const segs = c.closed ? m : m - 1;
    // segments' interiors
    for (let k = 0; k < segs; k++) {
      const p = pts[k], q = pts[(k + 1) % m];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const len2 = dx * dx + dz * dz;
      if (!(len2 > 0)) continue;
      const [i0, i1] = range(Math.min(p[0], q[0]), Math.max(p[0], q[0]), x0);
      const [j0, j1] = range(Math.min(p[1], q[1]), Math.max(p[1], q[1]), z0);
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + j * cell - p[1];
        for (let i = i0; i <= i1; i++) {
          const px = x0 + i * cell - p[0];
          const t = (px * dx + pz * dz) / len2;
          if (!(t > 0 && t < 1)) continue;
          const ex = px - t * dx, ez = pz - t * dz;
          const d = Math.sqrt(ex * ex + ez * ez);
          const at = j * n + i;
          if (d < best[at]) {
            best[at] = d;
            side[at] = sideOf(dx, dz, px, pz) >= 0 ? 1 : -1;
          }
        }
      }
    }
    // vertices
    for (let k = 0; k < m; k++) {
      const v = pts[k];
      const free = !c.closed && (k === 0 || k === m - 1);
      const u = free ? null : pts[(k - 1 + m) % m];
      const w = free ? null : pts[(k + 1) % m];
      const [i0, i1] = range(v[0], v[0], x0);
      const [j0, j1] = range(v[1], v[1], z0);
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + j * cell - v[1];
        for (let i = i0; i <= i1; i++) {
          const px = x0 + i * cell - v[0];
          const d = Math.sqrt(px * px + pz * pz);
          const at = j * n + i;
          if (!(d < best[at])) continue;
          best[at] = d;
          if (free) {
            side[at] = 2;
            continue;
          }
          const ax = v[0] - u[0], az = v[1] - u[1]; // in
          const bx = w[0] - v[0], bz = w[1] - v[1]; // out
          const l1 = sideOf(ax, az, px, pz) >= 0, l2 = sideOf(bx, bz, px, pz) >= 0;
          const turnsLeft = sideOf(ax, az, bx, bz) > 0;
          side[at] = (turnsLeft ? l1 && l2 : l1 || l2) ? 1 : -1;
        }
      }
    }
  }

  const label = new Int8Array(N);
  const problems = [];
  let bandNodes = 0, freeEnds = 0;
  for (let at = 0; at < N; at++) {
    if (!(best[at] <= band)) continue;
    dist[at] = best[at];
    if (side[at] === 2) {
      freeEnds++;
      continue;
    }
    label[at] = side[at];
    bandNodes++;
  }
  if (freeEnds) problems.push(`${freeEnds} nodes are nearest an open end of the coastline (the coastline data stops inside the grid).`);

  // the rest: 4-connected regions of unlabelled nodes take their border's label
  const region = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let regions = 0, conflicts = 0, orphans = 0;
  const regionSizes = [];
  for (let s = 0; s < N; s++) {
    if (label[s] !== 0 || region[s] >= 0 || side[s] === 2) continue;
    let top = 0, size = 0, sawLand = false, sawWater = false;
    stack[top++] = s;
    region[s] = regions;
    const members = [];
    while (top) {
      const at = stack[--top];
      members.push(at);
      size++;
      const i = at % n, j = (at - i) / n;
      const look = (nb) => {
        const l = label[nb];
        if (l === 1) sawLand = true;
        else if (l === -1) sawWater = true;
        else if (region[nb] < 0 && side[nb] !== 2) {
          region[nb] = regions;
          stack[top++] = nb;
        }
      };
      if (i > 0) look(at - 1);
      if (i < n - 1) look(at + 1);
      if (j > 0) look(at - n);
      if (j < n - 1) look(at + n);
    }
    regionSizes.push(size);
    if (sawLand && sawWater) {
      conflicts++;
      problems.push(`A region of ${size} nodes around node (${s % n}, ${Math.floor(s / n)}) borders both land and water: the coastline crosses itself or runs the wrong way there.`);
    } else if (!sawLand && !sawWater) {
      orphans++;
    } else {
      const l = sawLand ? 1 : -1;
      for (const at of members) label[at] = l;
    }
    regions++;
  }
  if (orphans) problems.push(`${orphans} regions have no coastline near them to say what they are.`);
  let land = 0, water = 0, unknown = 0;
  for (let at = 0; at < N; at++) (label[at] === 1 ? land++ : label[at] === -1 ? water++ : unknown++);
  return { label, dist, band, problems, stats: { nodes: N, band: bandNodes, regions, conflicts, orphans, land, water, unknown, freeEnds } };
}

/** The signed distance (land +) of a band node, or ±Infinity off the band. */
export const signedDistance = (cls, at) => cls.label[at] * cls.dist[at];
