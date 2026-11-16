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
//
// The small solids (structures, marks, rocks, buildings, trees, a place's
// own structures) are triangle soups with no normals: a glTF loader draws a
// primitive without normals flat-shaded (three's GLTFLoader does), which is
// what they are, at two thirds of the bytes. The ground and the forest
// canopy carry smooth normals.

import { encodeGLB, computeNormals, computeBounds } from "./glb.js";
import { joinCoast, openEnds, distanceToGrid, classify } from "./coast.js";
import { burn, checkSigns, regionsOf, landFloorFor, MIN_AGREEMENT, QUALITY, QUALITY_NAMES, QUALITY_MEANING } from "./burn.js";
import { rtinErrors, rtinMesh, checkMesh } from "./rtin.js";
import { colourAt, legend } from "./colors.js";
import { structureMesh, rockMesh } from "./structures.js";
import { markMesh } from "./marks.js";
import { sampler, int16ToBytes, toBase64, packQuality } from "./terrain-sample.js";
import { localFrame, PROJECTION } from "./tmerc.js";
import { coverGrid, distanceToWater, COVER, COVERS } from "./cover.js";
import { groundRGB, linear, naturalLegend, COLOURS, toRGB } from "./palette.js";
import { shoreSlabs, levelsOf, cutShore } from "./shore.js";
import { SURF, coastPieces, surfMesh, reefPatches, boulders } from "./surf.js";
import { CLOUDS, sheetsAt, capsAt, cloudMesh } from "./cloud.js";
import { effectiveCanopy, placeTrees, forestRoof, treeInstances, builtMask, scrubCover, skinZone, placeSkin, skinInstances } from "./forest.js";
import { buildingMesh } from "./buildings.js";
import { siteMesh, inBox } from "./site.js";
import { unpackLayers, FILLED, FLOOR } from "./layered.js";
import { mooredBoats, boatMesh, BOATS } from "./boats.js";

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
  forest: true,
  buildings: true,
  site: true,
  boats: true,
  crispShore: true,
  surf: true,
  clouds: true,
});

/** The GLB's layers (scene README, "GLB conventions"): what can be shown or hidden. The ground is on none: always shown. */
export const LAYERS = Object.freeze([
  { id: "forest", name: "Forest (canopy and trees)" },
  { id: "buildings", name: "Buildings (OpenStreetMap footprints)" },
  { id: "harbour", name: "Docks, floats and breakwaters (OpenStreetMap)" },
  { id: "marks", name: "Lights, buoys and beacons" },
  { id: "landmarks", name: "Landmarks" },
  { id: "boats", name: "Moored boats (dressing: not data)" },
  { id: "surf", name: "Surf on the exposed coast (dressing: from the swell and the shore's shape)" },
  { id: "weather", name: "Low cloud and mist (dressing)" },
]);

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
export function shape(grid, dem, demRec, features, { datum = null, landFloor = landFloorFor(datum), scale = HEIGHT_SCALE, made = null } = {}) {
  const chains = joinCoast(features.coast ?? []);
  const cls = classify(grid, chains);
  const ends = openEnds(chains).map((e) => ({ ...e, away: distanceToGrid(grid, e.point) }));
  const near = ends.filter((e) => e.away <= cls.band + grid.cell);
  const problems = [...cls.problems];
  if (near.length) problems.push(`The coastline data stops inside the grid at ${near.map((e) => `${e.id} (${e.end})`).join(", ")}.`);
  const { heights, quality, islets, agreement } = burn(grid, dem, demRec, cls, chains, { scale, landFloor, made });
  const wrong = checkSigns(heights, cls.label);
  if (wrong.length) problems.push(`${wrong.length} nodes are on the wrong side of the water after burning the shore in.`);
  if (islets.low.length) problems.push(`${islets.low.length} islets stay below the land floor (${islets.low.slice(0, 5).map((r) => r.id).join(", ")}).`);
  // the DEM's position: OSM's coastline sets every node's side, so only this catches heights that are flipped, mirrored or shifted
  if (agreement.total >= 100 && agreement.share < MIN_AGREEMENT) {
    problems.push(`The heights don't line up with OpenStreetMap's coastline: away from the shore only ${(agreement.share * 100).toFixed(1)}% of the DEM's nodes are on OSM's side of the water (at least ${MIN_AGREEMENT * 100}% expected), so the DEM is likely flipped, mirrored or shifted.`);
  }
  return { chains, cls, heights, quality, islets, agreement, landFloor, ends, problems, scale };
}

/** Every `stride`-th node of an n × n grid. */
function subsample(n, values, stride) {
  if (stride === 1) return { n, values };
  const m = (n - 1) / stride + 1;
  const out = new values.constructor(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) out[j * m + i] = values[j * stride * n + i * stride];
  return { n: m, values: out };
}

/** The land nodes inside a { south, west, north, east } box: 1, else 0. */
export function apronMask(grid, frame, box, label) {
  const { n, cell, x0, z0 } = grid;
  const out = new Uint8Array(n * n);
  const corners = [[box.south, box.west], [box.south, box.east], [box.north, box.east], [box.north, box.west]].map(([la, lo]) => frame.toLocal(la, lo));
  const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cell) - 1), i1 = Math.min(n - 1, Math.ceil((Math.max(...xs) - x0) / cell) + 1);
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / cell) - 1), j1 = Math.min(n - 1, Math.ceil((Math.max(...zs) - z0) / cell) + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * n + i;
    if (label[k] <= 0) continue;
    const [lat, lon] = frame.toLatLon(x0 + i * cell, z0 + j * cell);
    if (inBox(box, lat, lon)) out[k] = 1;
  }
  return out;
}

/** What is built on, as rings of [x, z]: OSM's building footprints, the site's clear box and each site structure's corners. */
export function builtRings(doc, look, frame) {
  // to the millimetre, as site.js: the projection's last bits may differ between engines, the mask mustn't
  const L = ([lat, lon]) => frame.toLocal(lat, lon).map((v) => Math.round(v * 1000) / 1000);
  const rings = (look?.buildings ?? []).map((b) => b.points);
  const box = doc.site?.clear?.box;
  if (box) rings.push([[box.south, box.west], [box.south, box.east], [box.north, box.east], [box.north, box.west]].map(L));
  for (const st of doc.site?.structures ?? []) if (st.corners?.length >= 3) rings.push(st.corners.map(L));
  return rings;
}

/**
 * Build the GLB.
 * @param {{ doc: object, dem: Int16Array, features: object, layers?: Uint8Array | null, look?: object | null, params?: object }} input
 *   doc: the Terrain doc's fields (origin, grid, heightScale, exaggeration, datum, demToMWL, places, sources, attribution, look, site, landmarks);
 *   layers: the layered heights' source layer and canopy (layered.js packLayers); look: the OSM buildings and land cover (look-osm.js)
 * @returns {{ glb: Uint8Array, meta: { bounds, notes }, stats: object, heights: Int16Array, cls: object }}
 */
export function buildTerrain({ doc, dem, features, layers = null, look = null, params = {} }) {
  const p = { ...DEFAULTS, ...params };
  const grid = { n: doc.grid.n, cell: doc.grid.cell, x0: doc.grid.x0, z0: doc.grid.z0 };
  if (dem.length !== grid.n * grid.n) throw new Error(`The DEM has ${dem.length} heights, not ${grid.n}².`);
  const frame = localFrame(doc.origin);
  const S = doc.heightScale ?? HEIGHT_SCALE;
  const demRec = { scale: doc.data?.dem?.scale ?? S, offset: doc.data?.dem?.offset ?? 0, toMWL: doc.demToMWL ?? 0 };
  const t0 = Date.now();
  // the layered heights' own record: which source each node took, the canopy; a node no source measured is flagged by burn()
  const lay = layers ? unpackLayers(layers, grid.n * grid.n) : null;
  const layerNames = doc.data?.layers?.names ?? null;
  let madeUp = null;
  if (lay && layerNames) {
    const filled = layerNames.indexOf(FILLED), floor = layerNames.indexOf(FLOOR);
    madeUp = new Uint8Array(lay.source.length);
    for (let k = 0; k < madeUp.length; k++) if (lay.source[k] === filled || lay.source[k] === floor) madeUp[k] = 1;
  }
  const sh = shape(grid, dem, demRec, features, { datum: doc.datum, scale: S, made: madeUp });
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
    h[k] = heights[k] * S;
    tol[k] = toleranceAt(h[k], p);
    if (h[k] < hmin) hmin = h[k];
    if (h[k] > hmax) hmax = h[k];
  }
  const mesh = rtinMesh(n, rtinErrors(n, h, tol));
  const check = checkMesh(n, h, tol, mesh);
  if (!check.ok) throw new Error(`The ground mesh strays from the heights: ${JSON.stringify(check)}`);
  const yOf = (v) => (v > 0 ? v * ex : v);
  // the look: what covers the ground (OSM), the canopy (lidar, or assumed in OSM's woods), the distance to the water
  const natural = !!(look || doc.look);
  const cover = natural ? coverGrid(grid, look) : null;
  const measured = lay && doc.heights?.canopy && layerNames ? (() => {
    const dtm = layerNames.indexOf(doc.heights.canopy.dtm);
    const m = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (lay.source[k] === dtm) m[k] = 1;
    return m;
  })() : null;
  // no forest where something is built (the lidar's canopy is a roof's height there too): OSM's footprints, the site's lot and its structures
  const built = natural ? builtMask(grid, builtRings(doc, look, frame)) : null;
  const canopy = natural ? effectiveCanopy({ n, label: cls.label, cover, canopy: lay?.canopy ?? null, measured, assumed: doc.look?.trees?.assumed, built }) : null;
  const colours = { ...COLOURS, ...(doc.look?.colours ?? {}) };
  // each land node's distance to the water: the splash zone's bands are drawn within a cell and a half of it; the forest's fringe is measured by it
  const toWater = natural ? distanceToWater(n, cls.label, grid.cell) : null;
  const tide = doc.datum?.tide ?? {};
  // the bare rock band under any cover but a beach, where the place says its shore is rock under the lots (look.shoreRock)
  const shoreRock = !!doc.look?.shoreRock;
  // the site's apron (site.apron): its land inside the clear box one even tone above the highest normal tide, its edge the shore cut's (crisp)
  const apronAbove = tide.MHHW ?? 0.9;
  const apron = natural && doc.site?.apron && doc.site?.clear?.box ? apronMask(grid, frame, doc.site.clear.box, cls.label) : null;
  const apronRGB = apron ? linear(toRGB(doc.site.apron.colour)) : null;
  const V = mesh.nodes.length;
  const positions = new Float32Array(V * 3);
  const colors = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    const k = mesh.nodes[v];
    const i = k % n, j = (k - i) / n;
    positions[v * 3] = grid.x0 + i * grid.cell;
    positions[v * 3 + 1] = yOf(h[k]);
    positions[v * 3 + 2] = grid.z0 + j * grid.cell;
    const c = apron?.[k] && h[k] > apronAbove ? apronRGB : natural ? linear(groundRGB(h[k], cover[k], canopy[k], tide, colours, k, toWater[k] <= 1.5 * grid.cell, { shoreRock })) : colourAt(h[k]);
    colors[v * 3] = c[0];
    colors[v * 3 + 1] = c[1];
    colors[v * 3 + 2] = c[2];
  }
  const normals = computeNormals(positions, mesh.triangles);
  // the shore's bands, crisp: its triangles cut where their height crosses a band's edge, a piece a band (shore.js)
  let ground = { positions, normals, colors, triangles: mesh.triangles };
  let shoreCut = { cut: 0, pieces: 0, added: 0 };
  if (natural && p.crispShore) {
    const slabs = shoreSlabs(tide);
    const hv = Float32Array.from(mesh.nodes, (k) => h[k]);
    const atShore = (t) => [0, 1, 2].some((e) => toWater[mesh.nodes[mesh.triangles[t * 3 + e]]] <= 1.5 * grid.cell);
    const topNode = (t) => {
      let best = -1;
      for (let e = 0; e < 3; e++) {
        const k = mesh.nodes[mesh.triangles[t * 3 + e]];
        if (best < 0 || h[k] > h[best] || (h[k] === h[best] && k < best)) best = k;
      }
      return best;
    };
    // each band one colour (no variation by node, so pieces share their corners), the wet ones darker
    const flat = slabs.map((s) => linear(toRGB(colours[s.key]).map((c) => c * (s.wet ? 0.75 : 1))));
    const paint = (q, t) => {
      // above the splash zone: the vertices' own colours
      if (q >= slabs.length) return null;
      const s = slabs[q], top = topNode(t), cv = cover[top];
      // the apron above the highest normal tide is the apron
      if (apron?.[top] && s.lo >= apronAbove - 1e-9) return apronRGB;
      // a beach is beach above the water; bare rock above the lichen only where nothing else covers the ground (as groundRGB), or under anything where the place's shore is rock
      if ((cv === COVER.beach && s.hi > 0) || (s.key === "rock" && !shoreRock && cv !== COVER.none && cv !== COVER.rock)) return null;
      return flat[q];
    };
    const r = cutShore(ground, hv, mesh.nodes, levelsOf(slabs), atShore, paint);
    ground = r;
    shoreCut = { cut: r.cut, pieces: r.pieces, added: r.added };
  }
  const meshes = [
    {
      name: "Ground",
      primitives: tiles(ground.positions, ground.normals, ground.colors, ground.triangles, 65535).map((t) => ({ ...t, roughness: 0.95 })),
      extras: { legend: natural ? naturalLegend(hmin, hmax, tide, colours) : legend(hmin, hmax) },
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
  const hf = sampler({ nx: n, nz: n, x0: grid.x0, z0: grid.z0, cell: grid.cell }, heights, S);
  const inside = (x, z) => hf.heightAt(x, z) != null;
  const groundAt = (x, z) => {
    const g = hf.heightAt(x, z);
    return g == null ? null : yOf(g);
  };
  // how far below the true ground a foot must reach for the drawn (simplified) ground not to show beneath it
  const sinkAt = (g) => toleranceAt(g, p) + 0.4;
  const layerTable = [...LAYERS.map((l) => ({ ...l }))];
  const add = (name, mesh, layer, extras) => {
    meshes.push({ name, ...mesh });
    nodes.push({ name, mesh: meshes.length - 1, ...(layer || extras ? { extras: { ...(layer ? { layer } : {}), ...(extras ?? {}) } } : {}) });
  };
  // the place's own structures (site.js): drawn from its doc; OSM's drawing of the same things is left out
  const site = p.site && (doc.site || doc.landmarks?.length) ? siteMesh(doc.site ?? null, doc.landmarks ?? [], frame, groundAt, sinkAt) : null;
  const clear = doc.site?.clear ?? null;
  const clearIds = new Set(clear?.osm ?? []);
  let made = 0, placed = [];
  if (p.structures) {
    const st = structureMesh((features.structures ?? []).filter((x) => !clearIds.has(x.id)), { inside });
    made = st.made;
    if (st.positions.length) add("Harbour structures", { positions: st.positions, colors: st.colors, roughness: 0.9 }, "harbour");
  }
  // boats along the floats: dressing (boats.js)
  let boatCount = 0;
  if (p.boats && natural && p.structures) {
    const moored = mooredBoats((features.structures ?? []).filter((x) => !clearIds.has(x.id)), { inside });
    boatCount = moored.length;
    if (moored.length) {
      const bm = boatMesh(moored);
      add("Moored boats", { positions: bm.positions, colors: bm.colors, roughness: 0.6 }, "boats", { dressing: "Boats placed by hash along the floats: not data." });
    }
  }
  if (site) {
    for (const l of doc.site?.layers ?? []) if (!layerTable.some((x) => x.id === l.id)) layerTable.push({ ...l });
    for (const [layer, m] of Object.entries(site.layers)) {
      if (!layerTable.some((x) => x.id === layer)) layerTable.push({ id: layer, name: layer });
      const name = layerTable.find((x) => x.id === layer)?.name ?? layer;
      add(name, { positions: m.positions, colors: m.colors, roughness: 0.85 }, layer);
    }
  }
  // buildings from OSM's footprints (buildings.js); inside the site's lot, the site draws them
  let buildingsMade = 0;
  if (p.buildings && look?.buildings?.length) {
    const coverAt = (x, z) => {
      const i = Math.round((x - grid.x0) / grid.cell), j = Math.round((z - grid.z0) / grid.cell);
      return i >= 0 && j >= 0 && i < n && j < n ? cover[j * n + i] : 0;
    };
    // and what a landmark draws itself (its `replaces`: the lighthouse, the radome) is left out too
    const replacedBuildings = site?.replaces ?? new Set();
    const leaveOut = (b) => {
      if (replacedBuildings.has(b.id)) return true;
      if (!clear?.box) return false;
      const cx = b.points.reduce((a, q) => a + q[0], 0) / b.points.length, cz = b.points.reduce((a, q) => a + q[1], 0) / b.points.length;
      const [lat, lon] = frame.toLatLon(cx, cz);
      return inBox(clear.box, lat, lon);
    };
    const bm = buildingMesh(look.buildings, { groundAt, sinkAt, coverAt, leaveOut });
    buildingsMade = bm.made;
    if (bm.primitives.length) add("Buildings", { primitives: bm.primitives.map((q) => ({ ...q, roughness: 0.8 })) }, "buildings");
  }
  // the forest: its roof, and trees in front of it (forest.js)
  let treeCount = 0, roofTriangles = 0, scrubNodes = 0, skinCount = 0;
  if (p.forest && natural) {
    const dist = toWater;
    const trees = doc.look?.trees ?? { fringe: { fir: 60, cedar: 20, oak: 20 }, inland: { fir: 70, cedar: 30 }, town: { fir: 40, oak: 30, cedar: 30 }, wetland: { pine: 100 }, max: 20000 };
    const roof = forestRoof({ grid, heights: Float32Array.from(h, (v) => yOf(v)), label: cls.label, cover, canopy, dist, setback: trees.roofSetback ?? 20, ...(trees.roofColours ? { colours: trees.roofColours } : {}), jitter: trees.roofJitter ?? 0 });
    if (roof) {
      roofTriangles = roof.indices.length / 3;
      const normalsR = computeNormals(roof.positions, roof.indices);
      add("Forest canopy", { primitives: tiles(roof.positions, normalsR, roof.colors, roof.indices, 65535).map((t) => ({ ...t, roughness: 1 })) }, "forest");
    }
    // salal and shore pine where the canopy is under 5 m, where the place has them (forest.js scrubCover)
    if (trees.scrub) {
      const sc = scrubCover({ grid, heights: Float32Array.from(h, (v) => yOf(v)), label: cls.label, cover, canopy, dist, built, setback: trees.roofSetback ?? 20, ...trees.scrub });
      if (sc) {
        scrubNodes = sc.roofNodes;
        add("Low scrub", { primitives: tiles(sc.positions, computeNormals(sc.positions, sc.indices), sc.colors, sc.indices, 65535).map((t) => ({ ...t, roughness: 1 })) }, "forest");
      }
    }
    const placedTrees = placeTrees({ grid, label: cls.label, cover, canopy, dist, trees, built });
    treeCount = placedTrees.trees.length;
    if (treeCount) {
      const inst = treeInstances(placedTrees.trees, (x, z) => groundAt(x, z) ?? 0, sinkAt, { meshBase: meshes.length });
      for (const m of inst.meshes) meshes.push(m);
      // one group node on the forest layer, every tree a child sharing its species' mesh (the scene draws a species as one InstancedMesh)
      const first = nodes.length;
      for (const nd of inst.nodes) nodes.push(nd);
      nodes.push({ name: "Trees", children: inst.nodes.map((_, q) => first + q), extras: { layer: "forest", trees: { count: treeCount, before: placedTrees.before, species: inst.species } } });
    }
    // the forest's skin: crowns over the roof where people look from close by, where the place has one (forest.js skinAt)
    if (trees.skin?.within?.length) {
      const circles = trees.skin.within.map((c) => {
        const [x, z] = frame.toLocal(c.at[0], c.at[1]).map((v) => Math.round(v * 1000) / 1000);
        return { x, z, radius: c.radius };
      });
      const zone = skinZone(grid, circles);
      const placed = placeSkin({ grid, label: cls.label, cover, canopy, dist, zone, skin: trees.skin, setback: trees.roofSetback ?? 20, built });
      skinCount = placed.clumps.length;
      if (skinCount) {
        const inst = skinInstances(placed.clumps, (x, z) => groundAt(x, z) ?? 0, { meshBase: meshes.length, cell: grid.cell, ...(trees.skin.colours ? { colours: trees.skin.colours } : {}) });
        for (const m of inst.meshes) meshes.push(m);
        const first = nodes.length;
        for (const nd of inst.nodes) nodes.push(nd);
        nodes.push({ name: "Forest skin", children: inst.nodes.map((_, q) => first + q), extras: { layer: "forest", skin: { count: skinCount, before: placed.before, kinds: inst.kinds } } });
      }
    }
  }
  // a few boats about the harbour, where the place says (dressing: its look's boats)
  if (p.boats && natural && doc.look?.boats?.length) {
    const about = doc.look.boats.map((b, q) => {
      const [x, z] = frame.toLocal(b.lat, b.lon).map((v) => Math.round(v * 100) / 100);
      return { id: b.id ?? `harbour#${q}`, type: b.type, x, z, heading: (b.heading * Math.PI) / 180, length: b.length, beam: Math.round(b.length * BOATS[b.type].beam * 100) / 100, trim: b.trim ?? BOATS[b.type].trim[0] };
    }).filter((b) => inside(b.x, b.z));
    if (about.length) {
      const bm = boatMesh(about);
      boatCount += about.length;
      add("Boats about the harbour", { positions: bm.positions, colors: bm.colors, roughness: 0.6 }, "boats", { dressing: "Boats placed by the place's look: assumed, not data." });
    }
  }
  // surf on the exposed coast (surf.js): where the place has a swell
  let surf = null;
  if (p.surf && natural && Number.isFinite(doc.swell?.from) && doc.look?.surf) {
    const so = { ...SURF, ...doc.look.surf };
    const pieces = coastPieces(sh.chains, grid, cls.label, doc.swell.from, so);
    const sm = surfMesh(pieces, so);
    // white water over the exposed shallows, and black boulders at the most exposed waterline, where the place's surf asks for them
    const reef = so.reef ? reefPatches(grid, h, cls.label, doc.swell.from, { ...so, ...so.reef }) : null;
    const rocksAt = so.boulders ? boulders(pieces, so.boulders) : null;
    surf = { pieces: pieces.length, exposed: sm.pieces, runs: sm.runs, ...(reef ? { reef: reef.patches } : {}), ...(rocksAt ? { boulders: rocksAt.boulders } : {}) };
    const foam = reef?.patches ? { positions: concat(sm.positions, reef.positions), colors: concat(sm.colors, reef.colors) } : sm;
    if (foam.positions.length) add("Surf", { positions: foam.positions, colors: foam.colors, unlit: true }, "surf", { dressing: `Foam where the coast is open to the swell from ${doc.swell.from}° (exposure by rays over the grid): not observed.` });
    if (rocksAt?.boulders) add("Boulders at the exposed shore", { positions: rocksAt.positions, colors: rocksAt.colors, roughness: 0.7 }, "surf", { dressing: "Boulders by hash at the most exposed waterline: assumed, not mapped." });
  }
  // low cloud on the hills and mist in the forest's hollows (cloud.js): where the place's look has clouds
  let clouds = null;
  if (p.clouds && natural && doc.look?.clouds) {
    const co = { ...CLOUDS, ...doc.look.clouds };
    const ground = Float32Array.from(h, (v) => yOf(v));
    // banks on the slopes and in the hollows, and a cap round each summit the place names
    const caps = (co.caps ?? []).map((c) => {
      const [x, z] = frame.toLocal(c.at[0], c.at[1]).map((v) => Math.round(v * 1000) / 1000);
      return { ...c, x, z };
    });
    const sheets = [...sheetsAt(grid, ground, canopy, co), ...capsAt(grid, ground, caps)];
    const cm = cloudMesh(grid, ground, sheets, co);
    clouds = { sheets: sheets.length };
    if (cm.positions.length) add("Low cloud and mist", { positions: cm.positions, colors: cm.colors, indices: cm.indices, unlit: true, blend: true }, "weather", { dressing: "Stratus caught on the hills and mist over the forest, by the heights: not observed." });
  }
  const rocks = rockMesh(islets.rocks, (x, z) => hf.heightAt(x, z), yOf);
  const replaced = site?.replaces ?? new Set();
  if (rocks.positions.length) {
    meshes.push({ name: "Rocks", positions: rocks.positions, colors: rocks.colors, roughness: 0.95 });
    nodes.push({ name: "Rocks", mesh: meshes.length - 1 });
  }
  if (p.marks) {
    const mk = markMesh((features.marks ?? []).filter((m) => !replaced.has(m.id)), (x, z) => {
      const g = hf.heightAt(x, z);
      return g == null ? null : yOf(g);
    });
    placed = mk.placed;
    if (mk.positions.length) add("Marks", { positions: mk.positions, colors: mk.colors, roughness: 0.6 }, natural ? "marks" : null, { marks: placed });
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
    heights: { encoding: "int16le-base64", scale: S, offset: 0, data: toBase64(int16ToBytes(hfOut.values)) },
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
    // which source each node's height is from (layered heights only): 4 bits a node, the first in a byte's low bits
    ...(lay && layerNames ? { source: sourceLayer(subsample(n, lay.source, stride), layerNames) } : {}),
    outside: null,
    seaLevel: 0,
    exaggeration: ex,
    datum: doc.datum ?? null,
    places,
    sources: (doc.sources ?? []).map(({ id, name, url, fetched, licence, attribution: a, accuracy, requests }) => ({ id, name, url: url ?? null, fetched: fetched ?? null, licence, attribution: a, ...(accuracy ? { accuracy } : {}), ...(requests ? { requests: [...requests] } : {}) })),
    attribution,
    credit: doc.credit ?? "",
  };
  const usedLayers = new Set(nodes.map((nd) => nd.extras?.layer).filter(Boolean));
  const layerList = layerTable.filter((l) => usedLayers.has(l.id) || layerTable.some((c) => c.parent === l.id && usedLayers.has(c.id)));
  const glb = encodeGLB({ meshes, nodes, extras: { terrain, ...(layerList.length ? { layers: layerList } : {}) }, generator: "patchwork terrain", copyright: attribution || undefined });
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
    buildings: buildingsMade,
    boats: boatCount,
    trees: treeCount,
    roofTriangles,
    scrubNodes,
    skin: skinCount,
    shore: shoreCut,
    surf,
    clouds,
    site: site ? site.made.length : 0,
    measures: site?.measures ?? null,
  };
  const notes = `${stats.triangles.toLocaleString("en")} triangles over ${n}² nodes (every node within tolerance, none on the wrong side of the water), ${made} structures, ${placed.length} marks${natural ? `, ${buildingsMade} buildings, ${treeCount.toLocaleString("en")} trees before a ${roofTriangles.toLocaleString("en")}-triangle forest canopy` : ""}${site ? `, ${site.made.length} of the place's own structures` : ""}; ${hmin.toFixed(1)} to ${hmax.toFixed(1)} m. The DEM is on OSM's side of the water at ${(sh.agreement.share * 100).toFixed(1)}% of nodes off the shore. ${islets.raised.length} OSM islets raised above the land floor (+${sh.landFloor.toFixed(2)} m), ${islets.rocks.length} too small for the grid drawn as rocks; ${counts.clamped.toLocaleString("en")} water nodes in ${clamped.length} places where the DEM is shallower than the water floor have made-up depths (extras.terrain.quality).`;
  return { glb, meta: { bounds, notes }, stats, heights, cls };
}

const round = (v) => Math.round(v * 100) / 100;

/** Two Float32Arrays end to end. */
function concat(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** A source layer for extras.terrain: { encoding, names, counts, data } (4 bits a node). */
function sourceLayer({ values }, names) {
  const N = values.length;
  const bytes = new Uint8Array(Math.ceil(N / 2));
  const counts = Object.fromEntries(names.map((s) => [s, 0]));
  for (let k = 0; k < N; k++) {
    bytes[k >> 1] |= (values[k] & 15) << ((k & 1) * 4);
    counts[names[values[k]]]++;
  }
  return { encoding: "uint4-base64", names: [...names], counts, data: toBase64(bytes) };
}

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
