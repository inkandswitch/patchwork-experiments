// The heights a terrain is built from: the DEM, moved to mean water level,
// with the OSM shoreline burned in (coast.js says which nodes are land).
//
// Within `band` of the coast a node's height is `slope` × its signed
// distance from the shore (land +), whatever the DEM says there. Between two
// such nodes the mesh (and a bilinear sampler) is linear, so it crosses
// y = 0 where the signed distance does: on the OSM shoreline (exactly, for a
// straight shore; within a fraction of a metre on curves). Further off:
// - land is the DEM, but at least `landFloor` (above the highest normal
//   tide: OSM's coastline is the high-water line, so what it calls land
//   stays dry at high water);
// - water is the DEM, but at least slope·band deep.
// Where the DEM is held to a floor, its height is made up, and the node's
// quality says so (QUALITY below), so a reader can treat those depths as
// unknown rather than measured.
//
// Islets: a closed coastline ring whose every node lies in the shore band
// would only reach slope·band (+0.57 m), awash at high water. So when a
// ring's highest node is below `landFloor`, its land nodes are raised to the
// DEM's height there, held between `landFloor` and `isletTop`. Their shore
// then crosses y = 0 within the cell edge OSM's line crosses, not on it. A
// ring with no node inside at all can't be in the heightfield: it is
// returned as a rock (its outline and a top) for the mesh and for readers.
//
// Heights are then quantised to `scale`; a node that would round to 0 is put
// one step to its own side. So, by construction and checked by checkSigns()
// and checkIslets():
//   land ⇒ v ≥ +1 step,   water ⇒ v ≤ −1 step,
//   every ring with a node inside ⇒ its highest node ≥ landFloor.

/** What a node's height is made from: 2 bits a node in extras.terrain. */
export const QUALITY = Object.freeze({ DEM: 0, SHORE: 1, RAISED: 2, CLAMPED: 3 });
export const QUALITY_NAMES = Object.freeze(["dem", "shore", "raised", "clamped"]);
export const QUALITY_MEANING = Object.freeze({
  dem: "the DEM's height, on OSM's side of the water",
  shore: "within the shore band: the OSM shoreline burned in at a 1 in 20 slope, not measured",
  raised: "land the DEM puts below the land floor (or an islet too small for the grid), raised to it: made up",
  clamped: "water the DEM puts shallower than the water floor, or on land: the depth is made up, treat it as unknown",
});

/** The default land floor: 0.3 m above the highest normal tide, or +1.5 m. */
export const landFloorFor = (datum) => (Number.isFinite(datum?.tide?.HHWLT) ? datum.tide.HHWLT : 1.2) + 0.3;

/** The share of the DEM's nodes beyond the band on OSM's side of the water that data must reach, or it is refused. */
export const MIN_AGREEMENT = 0.98;

/**
 * Every node strictly inside a polygon (even-odd), by scanline: node indices.
 * @param {{ n, cell, x0, z0 }} grid
 * @param {number[][]} pts  the ring, not repeating its first point
 */
export function nodesInside(grid, pts) {
  const { n, cell, x0, z0 } = grid;
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pts) {
    if (p[1] < zmin) zmin = p[1];
    if (p[1] > zmax) zmax = p[1];
  }
  const out = [];
  const j0 = Math.max(0, Math.ceil((zmin - z0) / cell)), j1 = Math.min(n - 1, Math.floor((zmax - z0) / cell));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = z0 + j * cell;
    xs.length = 0;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      const [xa, za] = pts[a], [xb, zb] = pts[b];
      if (za > z !== zb > z) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.floor((xs[k] - x0) / cell) + 1), i1 = Math.min(n - 1, Math.ceil((xs[k + 1] - x0) / cell) - 1);
      for (let i = i0; i <= i1; i++) out.push(j * n + i);
    }
  }
  return out;
}

/**
 * @param {{ n: number, cell, x0, z0 }} grid
 * @param {Int16Array} dem  the DEM's steps (row 0 north)
 * @param {{ scale: number, offset?: number, toMWL?: number }} demRec  height = offset + scale·v + toMWL
 * @param {{ label: Int8Array, dist: Float32Array, band: number }} cls  coast.js classify()
 * @param {{ closed: boolean, points: number[][], ids: string[] }[]} [chains]  coast.js joinCoast(): its rings are the islets
 * @param {{ slope?, scale?, landFloor?, isletTop? }} [o]
 * @returns {{ heights: Int16Array, quality: Uint8Array, islets: object, agreement: { agree, total, share } }}
 */
export function burn(grid, dem, demRec, cls, chains = [], { slope = 0.05, scale = 0.02, landFloor = 1.5, isletTop = 6 } = {}) {
  const n = grid.n, N = n * n;
  if (dem.length !== N || cls.label.length !== N) throw new Error("The DEM and the coast don't fit the grid.");
  const off = (demRec.offset ?? 0) + (demRec.toMWL ?? 0);
  const rawAt = (at) => off + demRec.scale * dem[at];
  const waterFloor = slope * cls.band;
  const hs = new Float64Array(N);
  const quality = new Uint8Array(N);
  let agree = 0, total = 0;
  for (let at = 0; at < N; at++) {
    const l = cls.label[at];
    const raw = rawAt(at);
    if (l === 0) {
      hs[at] = raw; // untold (no coastline near): the DEM as it is
    } else if (cls.dist[at] <= cls.band) {
      hs[at] = l * slope * cls.dist[at];
      quality[at] = QUALITY.SHORE;
    } else {
      total++;
      if ((raw > 0 && l > 0) || (raw < 0 && l < 0)) agree++;
      if (l > 0) {
        if (raw >= landFloor) hs[at] = raw;
        else (hs[at] = landFloor), (quality[at] = QUALITY.RAISED);
      } else if (raw <= -waterFloor) hs[at] = raw;
      else (hs[at] = -waterFloor), (quality[at] = QUALITY.CLAMPED);
    }
  }

  // islets: rings too small for the band's slope to clear the tide
  const islets = { rings: 0, raised: [], rocks: [], low: [] };
  const inGrid = (x, z) => x >= grid.x0 && z >= grid.z0 && x <= grid.x0 + (n - 1) * grid.cell && z <= grid.z0 + (n - 1) * grid.cell;
  for (const c of chains) {
    if (!c.closed) continue;
    const inside = nodesInside(grid, c.points).filter((at) => cls.label[at] > 0);
    if (!inside.length) {
      const [cx, cz] = centroid(c.points);
      if (inGrid(cx, cz) && area(c.points) > 0) islets.rocks.push({ id: c.ids[0], points: c.points.map(([x, z]) => [x, z]), top: round2(clamp(demAt(grid, dem, demRec, cx, cz), landFloor, isletTop)) });
      continue;
    }
    islets.rings++;
    let top = -Infinity;
    for (const at of inside) top = Math.max(top, hs[at]);
    if (top >= landFloor) continue;
    for (const at of inside) {
      hs[at] = Math.max(hs[at], clamp(rawAt(at), landFloor, isletTop));
      quality[at] = QUALITY.RAISED;
    }
    islets.raised.push({ id: c.ids[0], nodes: inside.length, was: round2(top) });
  }

  const heights = new Int16Array(N);
  for (let at = 0; at < N; at++) {
    const l = cls.label[at];
    let v = Math.round(hs[at] / scale);
    if (l > 0 && v < 1) v = 1;
    else if (l < 0 && v > -1) v = -1;
    heights[at] = Math.max(-32767, Math.min(32767, v));
  }
  // the check, on the quantised heights
  for (const c of chains) {
    if (!c.closed) continue;
    const inside = nodesInside(grid, c.points).filter((at) => cls.label[at] > 0);
    if (!inside.length) continue;
    let top = -Infinity;
    for (const at of inside) top = Math.max(top, heights[at] * scale);
    if (top < landFloor - scale / 2) islets.low.push({ id: c.ids[0], top });
  }
  return { heights, quality, islets, agreement: { agree, total, share: total ? agree / total : 1 } };
}

/** The heights alone (burn() without islets): what the shore tests use. */
export function burnHeights(grid, dem, demRec, cls, o = {}) {
  return burn(grid, dem, demRec, cls, [], o).heights;
}

/** Every land node above the water and every water node below it: [] or what isn't. */
export function checkSigns(heights, label) {
  const bad = [];
  for (let at = 0; at < heights.length; at++) {
    const l = label[at];
    if ((l > 0 && !(heights[at] >= 1)) || (l < 0 && !(heights[at] <= -1))) {
      bad.push(at);
      if (bad.length > 20) break;
    }
  }
  return bad;
}

/** 4-connected regions of nodes with quality `q`, largest first: [{ nodes, x, z }] (x, z the centroid). */
export function regionsOf(grid, quality, q) {
  const { n, cell, x0, z0 } = grid;
  const seen = new Uint8Array(n * n);
  const out = [];
  const stack = [];
  for (let s = 0; s < n * n; s++) {
    if (quality[s] !== q || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let count = 0, si = 0, sj = 0;
    while (stack.length) {
      const at = stack.pop();
      const i = at % n, j = (at - i) / n;
      count++;
      si += i;
      sj += j;
      for (const nb of [i > 0 ? at - 1 : -1, i < n - 1 ? at + 1 : -1, j > 0 ? at - n : -1, j < n - 1 ? at + n : -1]) {
        if (nb >= 0 && !seen[nb] && quality[nb] === q) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    out.push({ nodes: count, x: Math.round(x0 + (si / count) * cell), z: Math.round(z0 + (sj / count) * cell) });
  }
  return out.sort((a, b) => b.nodes - a.nodes);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) (x += p[0]), (z += p[1]);
  return [x / pts.length, z / pts.length];
}

/** Signed area (positive: counter-clockwise seen from above with z south, i.e. land inside for OSM). */
function area(pts) {
  let s = 0;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) s += pts[b][0] * pts[a][1] - pts[a][0] * pts[b][1];
  return -s / 2;
}

/** The DEM's height above MWL at (x, z), bilinear; the nearest edge off the grid. */
function demAt(grid, dem, demRec, x, z) {
  const { n, cell, x0, z0 } = grid;
  const fx = Math.min(Math.max((x - x0) / cell, 0), n - 1), fz = Math.min(Math.max((z - z0) / cell, 0), n - 1);
  const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fz), n - 2);
  const u = fx - i, w = fz - j;
  const v = (1 - w) * ((1 - u) * dem[j * n + i] + u * dem[j * n + i + 1]) + w * ((1 - u) * dem[(j + 1) * n + i] + u * dem[(j + 1) * n + i + 1]);
  return (demRec.offset ?? 0) + (demRec.toMWL ?? 0) + demRec.scale * v;
}
