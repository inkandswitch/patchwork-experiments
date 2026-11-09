/**
 * terrain-sample.js — reading the heightfield a terrain GLB carries.
 *
 * COPY THIS FILE into a package that needs depths or heights (sailing, for
 * grounding and the anchor's depth); never import it across packages. It has
 * no imports and no DOM use. The copy in terrain/src is the original.
 *
 * A terrain GLB (terrain/src/build.js) puts this on its glTF scene's extras,
 * which a scene extension reads as `api.content(id).extras.terrain`:
 *
 *   { version: 1,
 *     frame: "x east, y up, z south; metres; y = 0 mean water level",
 *     grid: { nx, nz, x0, z0, cell },      // node (i, j) is at x0 + i·cell, z0 + j·cell; row j = 0 is the north edge
 *     heights: { encoding: "int16le-base64", scale, offset, data },   // height = offset + scale·v, row-major (i fastest)
 *     quality: { encoding: "uint2-base64", names, meaning, data, counts, clamped },  // what each node's height is made from
 *     rocks: [{ id, top, points: [[x, z], …] }],   // islets too small for the grid: not in the heights
 *     outside: null,                        // off the grid: open water with no bottom
 *     seaLevel: 0, datum, origin, projection, places, sources, attribution, credit }
 *
 * Positions are in the terrain object's own frame; a terrain is meant to
 * sit at the scene's identity (it is placed so, and locked), else take a
 * world point into its frame first.
 *
 *   const t = decodeTerrain(extras.terrain)
 *   t.heightAt(x, z)          // metres above mean water level, bilinear between nodes; null off the grid
 *   t.depthAt(x, z, level)    // water depth under a point when the sea is at `level` (default 0): level − height, or null off the grid
 *   t.qualityAt(x, z)         // the least trustworthy of the (up to) four nodes a sample there reads, or null off the grid / unknown:
 *                             //   "dem"      the DEM's own height (see the source's `accuracy`: for NCEI's Port Townsend DEM,
 *                             //              CHS multibeam ~0.1 m where present; Canadian land coarse, CDED 5–10 m)
 *                             //   "shore"    within ~11 m of OSM's shoreline: a 1 in 20 slope drawn through it, not measured
 *                             //   "raised"   land held up to the land floor (above the highest normal tide), or an islet raised to it
 *                             //   "clamped"  water where the DEM says shallower than the water floor (or land): the depth is
 *                             //              made up (−0.57 m); treat it as unknown (a marina, a drying flat, a DEM error)
 *   t.rockAt(x, z)            // the rock (extras.terrain.rocks) whose outline holds the point, or null: ground there at rock.top
 */

/** Base64 to bytes (no atob/Buffer needed). */
export function fromBase64(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const map = new Int16Array(128).fill(-1);
  for (let k = 0; k < 64; k++) map[A.charCodeAt(k)] = k;
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let k = 0; k < clean.length; k++) {
    acc = (acc << 6) | map[clean.charCodeAt(k)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/** Bytes to base64. */
export function toBase64(bytes) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const parts = [];
  let chunk = "";
  let k = 0;
  for (; k + 2 < bytes.length; k += 3) {
    const v = (bytes[k] << 16) | (bytes[k + 1] << 8) | bytes[k + 2];
    chunk += A[v >> 18] + A[(v >> 12) & 63] + A[(v >> 6) & 63] + A[v & 63];
    if (chunk.length >= 65536) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (k < bytes.length) {
    const v = (bytes[k] << 16) | ((k + 1 < bytes.length ? bytes[k + 1] : 0) << 8);
    chunk += A[v >> 18] + A[(v >> 12) & 63] + (k + 1 < bytes.length ? A[(v >> 6) & 63] : "=") + "=";
  }
  parts.push(chunk);
  return parts.join("");
}

/** int16 values to little-endian bytes, and back. */
export function int16ToBytes(values) {
  const out = new Uint8Array(values.length * 2);
  const dv = new DataView(out.buffer);
  for (let k = 0; k < values.length; k++) dv.setInt16(k * 2, values[k], true);
  return out;
}
export function bytesToInt16(bytes) {
  const out = new Int16Array(bytes.length >> 1);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let k = 0; k < out.length; k++) out[k] = dv.getInt16(k * 2, true);
  return out;
}

/** Node qualities (0…3) to bytes, four nodes a byte, the first in the low bits. */
export function packQuality(values) {
  const out = new Uint8Array(Math.ceil(values.length / 4));
  for (let k = 0; k < values.length; k++) out[k >> 2] |= (values[k] & 3) << ((k & 3) * 2);
  return out;
}
export function unpackQuality(bytes, count) {
  const out = new Uint8Array(count);
  for (let k = 0; k < count; k++) out[k] = (bytes[k >> 2] >> ((k & 3) * 2)) & 3;
  return out;
}

/** Is (x, z) inside the ring (even-odd)? */
export function insideRing(pts, x, z) {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, za] = pts[a], [xb, zb] = pts[b];
    if (za > z !== zb > z && x < xa + ((z - za) * (xb - xa)) / (zb - za)) c = !c;
  }
  return c;
}

/**
 * A sampler over a grid of heights: node (i, j) at (x0 + i·cell, z0 + j·cell), value offset + scale·v.
 * @param {{ nx: number, nz: number, x0: number, z0: number, cell: number }} grid
 * @param {Int16Array} v
 * @param {number} scale
 * @param {number} [offset]
 */
export function sampler(grid, v, scale, offset = 0) {
  const { nx, nz, x0, z0, cell } = grid;
  if (v.length !== nx * nz) throw new Error(`${v.length} heights for a ${nx} × ${nz} grid.`);
  const at = (i, j) => offset + scale * v[j * nx + i];
  function heightAt(x, z) {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (!(fx >= 0 && fz >= 0 && fx <= nx - 1 && fz <= nz - 1)) return null;
    const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
    const u = fx - i, w = fz - j;
    return (1 - w) * ((1 - u) * at(i, j) + u * at(i + 1, j)) + w * ((1 - u) * at(i, j + 1) + u * at(i + 1, j + 1));
  }
  return {
    grid: { nx, nz, x0, z0, cell },
    heightAt,
    depthAt(x, z, level = 0) {
      const h = heightAt(x, z);
      return h == null ? null : level - h;
    },
    /** The value at node (i, j). */
    node: at,
  };
}

/**
 * Read `extras.terrain`. Throws on anything malformed (a sampler that
 * silently said "deep water" would put ships on rocks).
 */
export function decodeTerrain(t) {
  if (!t || t.version !== 1) throw new Error("Not a terrain (extras.terrain version 1).");
  const g = t.grid ?? {};
  for (const k of ["nx", "nz", "x0", "z0", "cell"]) if (!Number.isFinite(g[k])) throw new Error(`The terrain's grid has no ${k}.`);
  const h = t.heights ?? {};
  if (h.encoding !== "int16le-base64") throw new Error(`Heights encoded as ${h.encoding}, not int16le-base64.`);
  const bytes = fromBase64(h.data ?? "");
  if (bytes.length !== g.nx * g.nz * 2) throw new Error(`${bytes.length} bytes of heights for a ${g.nx} × ${g.nz} grid.`);
  const base = sampler(g, bytesToInt16(bytes), h.scale, h.offset ?? 0);
  let q = null, names = null;
  if (t.quality?.encoding === "uint2-base64") {
    const qb = fromBase64(t.quality.data ?? "");
    if (qb.length !== Math.ceil((g.nx * g.nz) / 4)) throw new Error(`${qb.length} bytes of quality for a ${g.nx} × ${g.nz} grid.`);
    q = unpackQuality(qb, g.nx * g.nz);
    names = t.quality.names;
  }
  const rocks = Array.isArray(t.rocks) ? t.rocks : [];
  return {
    ...base,
    seaLevel: t.seaLevel ?? 0,
    datum: t.datum ?? null,
    places: t.places ?? [],
    rocks,
    qualityAt(x, z) {
      if (!q) return null;
      const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
      if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.nz - 1)) return null;
      const i = Math.min(Math.floor(fx), g.nx - 2), j = Math.min(Math.floor(fz), g.nz - 2);
      const u = fx - i, w = fz - j;
      let worst = 0;
      for (const [di, dj, wt] of [[0, 0, (1 - u) * (1 - w)], [1, 0, u * (1 - w)], [0, 1, (1 - u) * w], [1, 1, u * w]]) if (wt > 0) worst = Math.max(worst, q[(j + dj) * g.nx + i + di]);
      return names?.[worst] ?? null;
    },
    rockAt(x, z) {
      for (const r of rocks) if (insideRing(r.points, x, z)) return r;
      return null;
    },
  };
}
