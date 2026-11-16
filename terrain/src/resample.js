// Rasters to a terrain's grid. A source's raster is read (tiff.js) and
// sampled at every node of the grid: bilinearly between the four pixel
// centres round the node, and nothing (NaN) where any of the four has no
// value or the node is off the raster. So a value is never made from a
// mixture of data and nodata, and a raster that is linear in its own
// coordinates comes back exactly linear (tested on every node).
//
// - In latitude and longitude (EPSG:4326: CHS's NONNA, NRCan's HRDEM): each
//   node's (lat, lon) is the frame's (tmerc.js toLatLon), so nothing
//   else reprojects.
// - In the grid's own frame (NCEI's exportImage asked for exactly the
//   grid): pixel (i, j) must be node (i, j), checked to a micrometre, or it
//   is refused.
//
// Pure.

/** Whether v is a value of `tiff` (finite, not its nodata, not a float's ±3.4e38 fill). */
export function hasValue(tiff, v) {
  return Number.isFinite(v) && v !== tiff.nodata && Math.abs(v) < 1e30 && v > -9998 && !(tiff.nodata != null && Math.abs(v - tiff.nodata) <= 1e-6 * Math.abs(tiff.nodata));
}

/**
 * Bilinear at a model point (x, y) of the raster's own CRS (lon, lat for
 * 4326): NaN off the raster or where any of the four pixels is missing.
 */
export function sampleModel(tiff, x, y) {
  const g = tiff.geo;
  const c = g.point ? 0 : 0.5;
  const fx = (x - g.x0) / g.dx - c, fy = (y - g.y0) / g.dy - c;
  if (!(fx >= 0 && fy >= 0 && fx <= tiff.width - 1 && fy <= tiff.height - 1)) return NaN;
  const i = Math.min(Math.floor(fx), tiff.width - 2), j = Math.min(Math.floor(fy), tiff.height - 2);
  const u = fx - i, w = fy - j;
  const W = tiff.width, d = tiff.data;
  const a = d[j * W + i], b = d[j * W + i + 1], p = d[(j + 1) * W + i], q = d[(j + 1) * W + i + 1];
  // a corner with no value is missing only if it is weighed (a node exactly on a pixel centre needs just that one)
  const need = (v, wt) => wt === 0 || hasValue(tiff, v);
  if (!need(a, (1 - u) * (1 - w)) || !need(b, u * (1 - w)) || !need(p, (1 - u) * w) || !need(q, u * w)) return NaN;
  const z = (v, wt) => (wt === 0 ? 0 : v * wt);
  return z(a, (1 - u) * (1 - w)) + z(b, u * (1 - w)) + z(p, (1 - u) * w) + z(q, u * w);
}

/**
 * A 4326 raster at every node of the grid (row 0 north), plus `offset`
 * (to move it to mean water level): Float32Array, NaN where it has nothing.
 * @param {{ width, height, data, nodata, geo }} tiff
 * @param {{ n, cell, x0, z0 }} grid
 * @param {{ toLatLon(x, z): [number, number] }} frame
 */
export function resampleLatLon(tiff, grid, frame, offset = 0) {
  if (!tiff.geo) throw new Error("A raster with no georeference.");
  const { n, cell, x0, z0 } = grid;
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [lat, lon] = frame.toLatLon(x0 + i * cell, z0 + j * cell);
      const v = sampleModel(tiff, lon, lat);
      out[j * n + i] = Number.isNaN(v) ? NaN : v + offset;
    }
  }
  return out;
}

/**
 * A raster already in the grid's frame (northing = −z), one pixel a node:
 * its values plus `offset`, NaN where it has none. Refused unless pixel
 * (i, j)'s centre is node (i, j).
 */
export function atNodes(tiff, grid, offset = 0) {
  const { n, cell, x0, z0 } = grid;
  const g = tiff.geo;
  const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const c = g?.point ? 0 : 0.5;
  if (tiff.width !== n || tiff.height !== n) throw new Error(`A raster of ${tiff.width} × ${tiff.height}, not ${n} × ${n}.`);
  if (!g || !near(g.dx, cell) || !near(g.dy, -cell) || !near(g.x0 + c * g.dx, x0) || !near(g.y0 + c * g.dy, -z0)) throw new Error(`A raster whose pixels aren't the grid's nodes (${JSON.stringify(g)}).`);
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = hasValue(tiff, tiff.data[k]) ? tiff.data[k] + offset : NaN;
  return out;
}

/**
 * The height of what stands on the ground at each node: the largest
 * (surface − terrain) over the raster pixels whose centres are within half
 * a cell of the node (lidar's first return less its bare earth: the
 * canopy, or a roof), 0 where neither has a value. Both rasters must be
 * the same grid of pixels. Float32Array, metres.
 */
export function canopyAtNodes(dtm, dsm, grid, frame) {
  if (dtm.width !== dsm.width || dtm.height !== dsm.height || JSON.stringify(dtm.geo) !== JSON.stringify(dsm.geo)) throw new Error("The surface and the terrain aren't the same raster.");
  const { n, cell, x0, z0 } = grid;
  const g = dtm.geo, c = g.point ? 0 : 0.5;
  const W = dtm.width, H = dtm.height;
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      const [la0, lo0] = frame.toLatLon(x - cell / 2, z - cell / 2), [la1, lo1] = frame.toLatLon(x + cell / 2, z + cell / 2);
      const c0 = Math.ceil((Math.min(lo0, lo1) - g.x0) / g.dx - c), c1 = Math.floor((Math.max(lo0, lo1) - g.x0) / g.dx - c);
      const r0 = Math.ceil((Math.max(la0, la1) - g.y0) / g.dy - c), r1 = Math.floor((Math.min(la0, la1) - g.y0) / g.dy - c);
      let best = 0;
      for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++) {
        for (let q = Math.max(0, c0); q <= Math.min(W - 1, c1); q++) {
          const a = dtm.data[r * W + q], b = dsm.data[r * W + q];
          if (hasValue(dtm, a) && hasValue(dsm, b) && b - a > best) best = b - a;
        }
      }
      out[j * n + i] = best;
    }
  }
  return out;
}
