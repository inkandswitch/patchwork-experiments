// A terrain's GLB from its cached data: pure, no network, no docs. The
// scene:source (source.js) reads the doc and its file docs and calls this;
// tests and probes call it directly.
//
//   coast (OSM) ──classify──▶ land/water at every node ─┐
//   DEM (NCEI, NAVD88) ──to MWL──────────────────────────┴─burn──▶ heights (int16, 2 cm)
//   heights ──RTIN (tolerance by height)──▶ ground mesh, checked at every node
//   + harbour structures + marks + extras.terrain (the heights, for depth)
//
// The GLB is in the terrain's local frame (tmerc.js): metres, x east, y up,
// z south, y = 0 mean water level, the origin the doc's `origin`.

import { encodeGLB, computeNormals, computeBounds } from "./glb.js";
import { joinCoast, openEnds, distanceToGrid, classify } from "./coast.js";
import { burn, checkSigns, regionsOf, landFloorFor, MIN_AGREEMENT, QUALITY, QUALITY_NAMES, QUALITY_MEANING } from "./burn.js";
import { rtinErrors, rtinMesh, checkMesh } from "./rtin.js";
import { colourAt, legend } from "./colors.js";
import { structureMesh, rockMesh } from "./structures.js";
import { markMesh } from "./marks.js";
import { sampler, int16ToBytes, toBase64, packQuality } from "./terrain-sample.js";
import { localFrame, PROJECTION } from "./tmerc.js";

export const HEIGHT_SCALE = 0.02;
export const FRAME = "x east, y up, z south; metres; y = 0 mean water level";

/** The provider's params, with their defaults (index.js repeats them as ParamSpecs). */
export const DEFAULTS = Object.freeze({
  shoreTolerance: 0.25,
  landTolerance: 1.5,
  deepTolerance: 6,
  heightfieldCell: 8,
  structures: true,
  marks: true,
  skirt: true,
});

/**
 * How far the mesh may stray from the grid at a node of height h (metres):
 * fine at the shore, coarser on land and in deep water, and never more than
 * half the node's height, so the mesh keeps every node's side of the water.
 */
export function toleranceAt(h, p = DEFAULTS) {
  const t = h >= 0 ? Math.max(p.shoreTolerance, Math.min(p.landTolerance, p.shoreTolerance + h * 0.1)) : Math.max(p.shoreTolerance, Math.min(p.deepTolerance, -h * 0.1));
  return Math.min(t, 0.5 * Math.abs(h));
}

/**
 * The shore, the heights and the checks, without any geometry: what the
 * tool's preview, fetch-data's refusal and the probes use too.
 * @param {{ n, cell, x0, z0 }} grid
 * @param {Int16Array} dem  the DEM's steps
 * @param {{ scale, offset?, toMWL? }} demRec
 * @param {{ coast: object[] }} features
 * @param {{ landFloor?: number, datum?: object }} [o]  the land floor (default: 0.3 m above the datum's HHWLT)
 */
export function shape(grid, dem, demRec, features, { datum = null, landFloor = landFloorFor(datum) } = {}) {
  const chains = joinCoast(features.coast ?? []);
  const cls = classify(grid, chains);
  const ends = openEnds(chains).map((e) => ({ ...e, away: distanceToGrid(grid, e.point) }));
  const near = ends.filter((e) => e.away <= cls.band + grid.cell);
  const problems = [...cls.problems];
  if (near.length) problems.push(`The coastline data stops inside the grid at ${near.map((e) => `${e.id} (${e.end})`).join(", ")}.`);
  const { heights, quality, islets, agreement } = burn(grid, dem, demRec, cls, chains, { scale: HEIGHT_SCALE, landFloor });
  const wrong = checkSigns(heights, cls.label);
  if (wrong.length) problems.push(`${wrong.length} nodes are on the wrong side of the water after burning the shore in.`);
  if (islets.low.length) problems.push(`${islets.low.length} islets stay below the land floor (${islets.low.slice(0, 5).map((r) => r.id).join(", ")}).`);
  // the DEM's position: OSM's coastline sets every node's side, so only this catches heights that are flipped, mirrored or shifted
  if (agreement.total >= 100 && agreement.share < MIN_AGREEMENT) {
    problems.push(`The heights don't line up with OpenStreetMap's coastline: away from the shore only ${(agreement.share * 100).toFixed(1)}% of the DEM's nodes are on OSM's side of the water (at least ${MIN_AGREEMENT * 100}% expected), so the DEM is likely flipped, mirrored or shifted.`);
  }
  return { chains, cls, heights, quality, islets, agreement, landFloor, ends, problems };
}

/** Every `stride`-th node of an n × n grid. */
function subsample(n, values, stride) {
  if (stride === 1) return { n, values };
  const m = (n - 1) / stride + 1;
  const out = new values.constructor(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) out[j * m + i] = values[j * stride * n + i * stride];
  return { n: m, values: out };
}

/**
 * Build the GLB.
 * @param {{ doc: object, dem: Int16Array, features: object, params?: object }} input
 *   doc: the Terrain doc's fields (origin, grid, exaggeration, datum, demToMWL, places, sources, attribution)
 * @returns {{ glb: Uint8Array, meta: { bounds, notes }, stats: object, heights: Int16Array, cls: object }}
 */
export function buildTerrain({ doc, dem, features, params = {} }) {
  const p = { ...DEFAULTS, ...params };
  const grid = { n: doc.grid.n, cell: doc.grid.cell, x0: doc.grid.x0, z0: doc.grid.z0 };
  if (dem.length !== grid.n * grid.n) throw new Error(`The DEM has ${dem.length} heights, not ${grid.n}².`);
  const frame = localFrame(doc.origin);
  const demRec = { scale: doc.data?.dem?.scale ?? HEIGHT_SCALE, offset: doc.data?.dem?.offset ?? 0, toMWL: doc.demToMWL ?? 0 };
  const t0 = Date.now();
  const sh = shape(grid, dem, demRec, features, { datum: doc.datum });
  if (sh.problems.length) throw new Error(`Can't tell land from water: ${sh.problems.join(" ")}`);
  const { heights, cls, quality, islets } = sh;
  const n = grid.n;
  const N = n * n;
  const ex = Number.isFinite(doc.exaggeration) && doc.exaggeration > 0 ? doc.exaggeration : 1;

  // ─── the ground: an RTIN over every node, checked at every node ───
  const h = new Float32Array(N);
  const tol = new Float32Array(N);
  let hmin = Infinity, hmax = -Infinity;
  for (let k = 0; k < N; k++) {
    h[k] = heights[k] * HEIGHT_SCALE;
    tol[k] = toleranceAt(h[k], p);
    if (h[k] < hmin) hmin = h[k];
    if (h[k] > hmax) hmax = h[k];
  }
  const mesh = rtinMesh(n, rtinErrors(n, h, tol));
  const check = checkMesh(n, h, tol, mesh);
  if (!check.ok) throw new Error(`The ground mesh strays from the heights: ${JSON.stringify(check)}`);
  const yOf = (v) => (v > 0 ? v * ex : v);
  const V = mesh.nodes.length;
  const positions = new Float32Array(V * 3);
  const colors = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    const k = mesh.nodes[v];
    const i = k % n, j = (k - i) / n;
    positions[v * 3] = grid.x0 + i * grid.cell;
    positions[v * 3 + 1] = yOf(h[k]);
    positions[v * 3 + 2] = grid.z0 + j * grid.cell;
    const c = colourAt(h[k]);
    colors[v * 3] = c[0];
    colors[v * 3 + 1] = c[1];
    colors[v * 3 + 2] = c[2];
  }
  const normals = computeNormals(positions, mesh.triangles);
  const meshes = [
    {
      name: "Ground",
      primitives: tiles(positions, normals, colors, mesh.triangles, 65535).map((t) => ({ ...t, roughness: 0.95 })),
      extras: { legend: legend(hmin, hmax) },
    },
  ];
  const nodes = [{ name: "Ground", mesh: 0 }];

  // ─── a skirt round the edge, down past the deepest point, so the ground reads as a solid block ───
  if (p.skirt) {
    const onEdge = (k) => {
      const i = k % n, j = (k - i) / n;
      return i === 0 || j === 0 || i === n - 1 || j === n - 1;
    };
    const base = Math.min(hmin, 0) - 10;
    const sp = [], sc = [];
    const tri = mesh.triangles;
    const wall = colourAt(-60).slice(0, 3).map((x) => x * 0.6);
    for (let t = 0; t < tri.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tri[t + e], b = tri[t + ((e + 1) % 3)];
        const ka = mesh.nodes[a], kb = mesh.nodes[b];
        if (!onEdge(ka) || !onEdge(kb)) continue;
        const ia = ka % n, ja = (ka - ia) / n, ib = kb % n, jb = (kb - ib) / n;
        // both on one side of the square
        if (!((ia === ib && (ia === 0 || ia === n - 1)) || (ja === jb && (ja === 0 || ja === n - 1)))) continue;
        const A = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]], B = [positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]];
        // the triangle runs a→b counter-clockwise from above, so outward is to the right of a→b: wall a, A-low, B-low, b
        const Al = [A[0], base, A[2]], Bl = [B[0], base, B[2]];
        sp.push(...A, ...Al, ...Bl, ...A, ...Bl, ...B);
        for (let r = 0; r < 6; r++) sc.push(...wall);
      }
    }
    if (sp.length) {
      const pos = new Float32Array(sp);
      meshes.push({ name: "Skirt", positions: pos, normals: computeNormals(pos), colors: new Float32Array(sc), roughness: 1 });
      nodes.push({ name: "Skirt", mesh: meshes.length - 1 });
    }
  }

  // ─── what stands on it ───
  const hf = sampler({ nx: n, nz: n, x0: grid.x0, z0: grid.z0, cell: grid.cell }, heights, HEIGHT_SCALE);
  const inside = (x, z) => hf.heightAt(x, z) != null;
  let made = 0, placed = [];
  if (p.structures) {
    const st = structureMesh(features.structures ?? [], { inside });
    made = st.made;
    if (st.positions.length) {
      meshes.push({ name: "Harbour structures", positions: st.positions, normals: computeNormals(st.positions), colors: st.colors, roughness: 0.9 });
      nodes.push({ name: "Harbour structures", mesh: meshes.length - 1 });
    }
  }
  const rocks = rockMesh(islets.rocks, (x, z) => hf.heightAt(x, z), yOf);
  if (rocks.positions.length) {
    meshes.push({ name: "Rocks", positions: rocks.positions, normals: computeNormals(rocks.positions), colors: rocks.colors, roughness: 0.95 });
    nodes.push({ name: "Rocks", mesh: meshes.length - 1 });
  }
  if (p.marks) {
    const mk = markMesh(features.marks ?? [], (x, z) => {
      const g = hf.heightAt(x, z);
      return g == null ? null : yOf(g);
    });
    placed = mk.placed;
    if (mk.positions.length) {
      meshes.push({ name: "Marks", positions: mk.positions, normals: computeNormals(mk.positions), colors: mk.colors, roughness: 0.6 });
      nodes.push({ name: "Marks", mesh: meshes.length - 1, extras: { marks: placed } });
    }
  }

  // ─── the heightfield, for whatever needs a depth (sailing: grounding, the anchor) ───
  const stride = Math.max(1, Math.round(p.heightfieldCell / grid.cell));
  if ((n - 1) % stride) throw new Error(`A ${p.heightfieldCell} m heightfield doesn't divide the ${grid.cell} m grid.`);
  const hfOut = subsample(n, heights, stride);
  const qOut = subsample(n, quality, stride);
  const counts = Object.fromEntries(QUALITY_NAMES.map((k) => [k, 0]));
  for (const q of quality) counts[QUALITY_NAMES[q]]++;
  const clamped = regionsOf(grid, quality, QUALITY.CLAMPED);
  const places = (doc.places ?? []).map((pl) => {
    const [x, z] = frame.toLocal(pl.lat, pl.lon);
    const g = hf.heightAt(x, z);
    return { name: pl.name, kind: pl.kind, position: [round(x), round(g == null ? 0 : Math.max(yOf(g), 0)), round(z)] };
  });
  const attribution = doc.attribution ?? "";
  const terrain = {
    version: 1,
    frame: FRAME,
    origin: { lat: frame.origin.lat, lon: frame.origin.lon },
    projection: PROJECTION,
    grid: { nx: hfOut.n, nz: hfOut.n, x0: grid.x0, z0: grid.z0, cell: grid.cell * stride },
    heights: { encoding: "int16le-base64", scale: HEIGHT_SCALE, offset: 0, data: toBase64(int16ToBytes(hfOut.values)) },
    // what each node's height is made from (burn.js): read it with the sampler's qualityAt; treat "clamped" depths as unknown
    quality: {
      encoding: "uint2-base64",
      names: [...QUALITY_NAMES],
      meaning: { ...QUALITY_MEANING },
      data: toBase64(packQuality(qOut.values)),
      counts,
      clamped: clamped.slice(0, 12).map((r) => ({ ...r, area: r.nodes * grid.cell * grid.cell })),
    },
    // rings of OSM coastline too small to hold a node: not in the heights, so here, for anything that can run aground
    rocks: islets.rocks.map((r) => ({ id: r.id, top: r.top, points: r.points })),
    outside: null,
    seaLevel: 0,
    exaggeration: ex,
    datum: doc.datum ?? null,
    places,
    sources: (doc.sources ?? []).map(({ id, name, url, fetched, licence, attribution: a, accuracy, requests }) => ({ id, name, url: url ?? null, fetched: fetched ?? null, licence, attribution: a, ...(accuracy ? { accuracy } : {}), ...(requests ? { requests: [...requests] } : {}) })),
    attribution,
    credit: doc.credit ?? "",
  };
  const glb = encodeGLB({ meshes, nodes, extras: { terrain }, generator: "patchwork terrain", copyright: attribution || undefined });
  const all = computeBounds(positions);
  const bounds = { min: [all.min[0], Math.min(all.min[1], Math.min(hmin, 0) - 10), all.min[2]], max: all.max };
  const stats = {
    ms: Date.now() - t0,
    nodes: N,
    vertices: V,
    triangles: mesh.triangles.length / 3,
    land: cls.stats.land,
    water: cls.stats.water,
    band: cls.stats.band,
    regions: cls.stats.regions,
    check,
    min: hmin,
    max: hmax,
    structures: made,
    marks: placed.length,
    bytes: glb.byteLength,
    quality: counts,
    clampedRegions: clamped.length,
    isletsRaised: islets.raised.length,
    rocks: islets.rocks.length,
    agreement: sh.agreement.share,
  };
  const notes = `${stats.triangles.toLocaleString("en")} triangles over ${n}² nodes (every node within tolerance, none on the wrong side of the water), ${made} structures, ${placed.length} marks; ${hmin.toFixed(1)} to ${hmax.toFixed(1)} m. The DEM is on OSM's side of the water at ${(sh.agreement.share * 100).toFixed(1)}% of nodes off the shore. ${islets.raised.length} OSM islets raised above the land floor (+${sh.landFloor.toFixed(2)} m), ${islets.rocks.length} too small for the grid drawn as rocks; ${counts.clamped.toLocaleString("en")} water nodes in ${clamped.length} places where the DEM is shallower than the water floor have made-up depths (extras.terrain.quality).`;
  return { glb, meta: { bounds, notes }, stats, heights, cls };
}

const round = (v) => Math.round(v * 100) / 100;

/**
 * An indexed mesh cut into pieces of at most `max` vertices (so each takes
 * 16-bit indices: half the bytes), by the square tile its triangles'
 * middles fall in. Normals are the whole mesh's, so the cuts don't show.
 */
export function tiles(positions, normals, colors, triangles, max) {
  const V = positions.length / 3;
  if (V <= max) return [{ positions, normals, colors, indices: triangles }];
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let v = 0; v < V; v++) {
    minx = Math.min(minx, positions[v * 3]);
    maxx = Math.max(maxx, positions[v * 3]);
    minz = Math.min(minz, positions[v * 3 + 2]);
    maxz = Math.max(maxz, positions[v * 3 + 2]);
  }
  for (let k = 2; ; k++) {
    const parts = Array.from({ length: k * k }, () => ({ map: new Map(), tris: [] }));
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
      const cx = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3, cz = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
      const ti = Math.min(k - 1, Math.floor(((cx - minx) / (maxx - minx || 1)) * k)), tj = Math.min(k - 1, Math.floor(((cz - minz) / (maxz - minz || 1)) * k));
      const part = parts[tj * k + ti];
      for (const v of [a, b, c]) {
        if (!part.map.has(v)) part.map.set(v, part.map.size);
        part.tris.push(part.map.get(v));
      }
    }
    if (parts.some((p) => p.map.size > max)) continue;
    return parts
      .filter((p) => p.tris.length)
      .map(({ map, tris }) => {
        const m = map.size;
        const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), col = new Float32Array(m * 3);
        for (const [v, i] of map) {
          for (let e = 0; e < 3; e++) {
            pos[i * 3 + e] = positions[v * 3 + e];
            nor[i * 3 + e] = normals[v * 3 + e];
            col[i * 3 + e] = colors[v * 3 + e];
          }
        }
        return { positions: pos, normals: nor, colors: col, indices: Uint16Array.from(tris) };
      });
  }
}
