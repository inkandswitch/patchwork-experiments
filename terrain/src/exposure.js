// How open the water is to the wind (water/WATER.md, "Shelter"): for every
// cell of a grid over a place, the fetch: how far the wind has blown over
// open water to reach it, marched upwind (toward the bearing the wind comes
// from) along a fan of rays until each meets land, averaged with weights
// cos² of each ray's angle off the wind. Exposure is that fetch over
// EXPOSURE.reach, held to [EXPOSURE.min, 1]: a basin behind its breakwater
// is sheltered, the open coast is not. A land cell takes its most exposed
// water neighbour's (so the water at a shore isn't dragged toward the land's
// by the texture's filtering). Off the land's grid is open sea.
//
// Pure: a function of a "is it water" test and a wind.

/** The grid's cells a side, the fetch that counts as fully open (m: 6 km, so Ucluelet's harbour, about 1.4 km of fetch to the west-north-west, reads as sheltered), the least exposure, the fan's rays (degrees off the wind). */
export const EXPOSURE = Object.freeze({ n: 256, reach: 6000, min: 0.15, fan: Object.freeze([-30, -15, 0, 15, 30]) });

/** A compass bearing's direction in the frame ([dx, dz]: north is −z, east +x). */
export const bearingDir = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];

/** Exposure from a fetch (m). Pure, monotone. */
export const exposureOf = (fetch, o = EXPOSURE) => Math.max(o.min, Math.min(1, fetch / o.reach));

/**
 * The exposure grid over a square `size` metres a side, for a wind from
 * `from` degrees (or from the direction `dir`, [dx, dz] in the grid's frame,
 * unit): water(i, j) says whether cell (i, j) (of `n` a side; off the grid:
 * open sea) is water. → Float32Array n × n (row j after row j − 1), each in
 * [o.min, 1]. Rays march a cell at a time.
 */
export function exposureGrid(water, { n = EXPOSURE.n, size, from = 0, dir = bearingDir(from) }, o = EXPOSURE) {
  const cell = size / n;
  const steps = Math.ceil(o.reach / cell);
  const isWater = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) isWater[j * n + i] = water(i, j) ? 1 : 0;
  // each ray the wind's direction turned by its angle (as a bearing turns: clockwise seen from above)
  const rays = o.fan.map((a) => {
    const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
    return { d: [c * dir[0] - s * dir[1], s * dir[0] + c * dir[1]], w: c * c };
  });
  const wsum = rays.reduce((s, r) => s + r.w, 0);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (!isWater[k]) continue;
    let F = 0;
    for (const { d, w } of rays) {
      let f = o.reach;
      for (let s = 1; s <= steps; s++) {
        const ii = Math.floor(i + 0.5 + d[0] * s), jj = Math.floor(j + 0.5 + d[1] * s);
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) break;
        if (!isWater[jj * n + ii]) {
          f = Math.min(o.reach, s * cell);
          break;
        }
      }
      F += w * f;
    }
    out[k] = exposureOf(F / wsum, o);
  }
  // land: its most exposed water neighbour's, else the least
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (isWater[k]) continue;
    let e = o.min;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n && isWater[jj * n + ii]) e = Math.max(e, out[jj * n + ii]);
    }
    out[k] = e;
  }
  return out;
}

/**
 * The exposure the water reads (WATER.md, "Shelter") for a terrain decoded
 * from its extras (`t`: heightAt, its grid) whose world matrix is `M`
 * (column-major; its turn about the vertical and its shift; any tilt
 * ignored), for a wind from `from` degrees in the stage: { n, data (bytes,
 * 255 the open sea), origin, u, v, size }. Water is the land's heights at or
 * under its sea level. Pure.
 */
export function exposureFor(t, M, from, o = EXPOSURE) {
  const m = M ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const g = t.grid;
  const size = Math.max((g.nx - 1) * g.cell, (g.nz - 1) * g.cell);
  const n = o.n, cell = size / n, level = t.seaLevel ?? 0;
  // the land's x and z axes in the stage, unit length; the wind's bearing turned into the land's frame
  const lx = Math.hypot(m[0], m[2]) || 1, lz = Math.hypot(m[8], m[10]) || 1;
  const u = [m[0] / lx, m[2] / lx], v = [m[8] / lz, m[10] / lz];
  const ds = bearingDir(from);
  const dir = [ds[0] * u[0] + ds[1] * u[1], ds[0] * v[0] + ds[1] * v[1]];
  const water = (i, j) => {
    const h = t.heightAt(g.x0 + (i + 0.5) * cell, g.z0 + (j + 0.5) * cell);
    return h == null || h <= level;
  };
  const e = exposureGrid(water, { n, size, dir }, o);
  const data = Uint8Array.from(e, (x) => Math.round(x * 255));
  const origin = [m[12] + u[0] * g.x0 + v[0] * g.z0, m[14] + u[1] * g.x0 + v[1] * g.z0];
  return { n, data, origin, u, v, size };
}
