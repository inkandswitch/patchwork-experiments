// Heights from several open sources, layered per node (README, "Ucluelet"):
// where one survey is good for the sea, another for the land, and neither
// covers everything. The place names its sources (a Terrain doc's
// `heights`, plain data): for water nodes, in order, which to use; for land
// nodes the same; and optionally a lidar surface and terrain for the
// canopy. Each source is a GeoTIFF asked for once: in latitude and
// longitude (resampled here, resample.js) or, for NCEI's exportImage, in the
// grid's own frame. Each node takes the first source on its side of the
// water (OSM's coastline, coast.js) that has a value there:
//
//   water: NONNA-10 → NONNA-100 → NCEI 1″ → NCEI 3″ → filled (harmonic, fill.js), flagged
//   land:  HRDEM lidar → NCEI 1″ → the land floor, flagged
//
// and the source it took is kept per node (4 bits), beside the canopy (the
// lidar's first return less its bare earth, 0.25 m a step), in a `layers`
// file doc. The heights are stored about mean water level (toMWL applied),
// so the build reads them as Cadboro's are read, with demToMWL 0.
//
// The position check (build.js shape(): heights flipped, mirrored or
// shifted against OSM) can't run on the merged heights, which take their
// side from OSM; it runs on the land's first source alone, off the shore
// band: that source must be above +1 m exactly where OSM says land at
// MIN_AGREEMENT of the nodes it covers, or the data is refused.

import { readTiff } from "./tiff.js";
import { resampleLatLon, atNodes, canopyAtNodes } from "./resample.js";
import { harmonicFill } from "./fill.js";
import { joinCoast, classify } from "./coast.js";
import { MIN_AGREEMENT, landFloorFor } from "./burn.js";

/** The source layer's names beyond the place's own sources. */
export const FILLED = "filled", FLOOR = "land-floor";
export const CANOPY_SCALE = 0.25;

/** Every source id a place's `heights` names, in the order of the source layer's codes (≤ 14, so 4 bits hold them with FILLED and FLOOR). */
export function sourceNames(heights) {
  const ids = [...new Set([...(heights.water ?? []), ...(heights.land ?? [])])];
  if (ids.length > 14) throw new Error("A place may layer at most 14 height sources.");
  return [...ids, FILLED, FLOOR];
}

/**
 * Choose each node's height (pure). `values[id]` is each source's
 * Float32Array at the nodes (metres about MWL, NaN where it has none).
 * → { heights: Float32Array, source: Uint8Array, names, counts, want }
 */
export function layerHeights({ n, heights, values, label, landFloor }) {
  const names = sourceNames(heights);
  const code = Object.fromEntries(names.map((s, k) => [s, k]));
  const N = n * n;
  const out = new Float32Array(N), source = new Uint8Array(N), want = new Uint8Array(N);
  const water = (heights.water ?? []).map((id) => [code[id], values[id]]), land = (heights.land ?? []).map((id) => [code[id], values[id]]);
  for (let k = 0; k < N; k++) {
    const list = label[k] > 0 ? land : label[k] < 0 ? water : [...water, ...land];
    let got = false;
    for (const [c, v] of list) {
      const x = v?.[k];
      if (x === undefined || Number.isNaN(x)) continue;
      out[k] = x;
      source[k] = c;
      got = true;
      break;
    }
    if (got) continue;
    if (label[k] > 0) {
      out[k] = landFloor;
      source[k] = code[FLOOR];
    } else {
      out[k] = NaN;
      source[k] = code[FILLED];
      want[k] = 1;
    }
  }
  const counts = Object.fromEntries(names.map((s) => [s, 0]));
  for (let k = 0; k < N; k++) counts[names[source[k]]]++;
  return { heights: out, source, names, counts, want };
}

/**
 * The position check on one source: off the shore band, at the nodes it
 * has a value, the share above +1 m where OSM says land and not where it
 * says water. → { agree, total, share }
 */
export function sourceAgreement(values, cls) {
  let agree = 0, total = 0;
  for (let k = 0; k < values.length; k++) {
    const l = cls.label[k], v = values[k];
    if (!l || Number.isNaN(v) || cls.dist[k] <= cls.band) continue;
    total++;
    if (v > 1 === l > 0) agree++;
  }
  return { agree, total, share: total ? agree / total : 1 };
}

/** The canopy at each land node as uint8 steps of CANOPY_SCALE (0 on water, capped at 63.75 m). */
export function canopyBytes(canopy, label) {
  const out = new Uint8Array(label.length);
  if (!canopy) return out;
  for (let k = 0; k < out.length; k++) out[k] = label[k] > 0 ? Math.min(255, Math.max(0, Math.round(canopy[k] / CANOPY_SCALE))) : 0;
  return out;
}

/** The layers file: the source layer (4 bits a node, the first in a byte's low bits) then the canopy (a byte a node). */
export function packLayers(source, canopy) {
  const N = source.length;
  const half = Math.ceil(N / 2);
  const out = new Uint8Array(half + N);
  for (let k = 0; k < N; k++) out[k >> 1] |= (source[k] & 15) << ((k & 1) * 4);
  out.set(canopy, half);
  return out;
}

/** The layers file back: { source: Uint8Array, canopy: Float32Array (metres) }. */
export function unpackLayers(bytes, N) {
  const half = Math.ceil(N / 2);
  if (bytes.length !== half + N) throw new Error(`The layers file has ${bytes.length} bytes, not ${half + N}.`);
  const source = new Uint8Array(N), canopy = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    source[k] = (bytes[k >> 1] >> ((k & 1) * 4)) & 15;
    canopy[k] = bytes[half + k] * CANOPY_SCALE;
  }
  return { source, canopy };
}

/**
 * Fetch, resample and layer the place's heights. Each raster is asked for
 * once (`urlOf(id)`), in the order the place lists them.
 * @param {{ grid, heights, datum? }} spec
 * @param {{ frame, coast: object[], fetch, urlOf: (id: string) => string, log? }} io
 */
export async function fetchLayers(spec, { frame, coast, fetch, urlOf, log = () => {} }) {
  const { grid, heights } = spec;
  const n = grid.n;
  const ids = [...new Set([...(heights.water ?? []), ...(heights.land ?? []), ...(heights.canopy ? [heights.canopy.dtm, heights.canopy.dsm] : [])])];
  const tiffs = {}, urls = {};
  for (const id of ids) {
    const src = heights.rasters?.[id];
    if (!src) throw new Error(`The place names a height source it doesn't describe: ${id}.`);
    urls[id] = urlOf(id);
    log(`Asking for ${src.name}…`);
    const res = await fetch(urls[id]);
    if (!res.ok) throw new Error(`${src.name} answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (String.fromCharCode(bytes[0], bytes[1]) !== "II" && String.fromCharCode(bytes[0], bytes[1]) !== "MM") throw new Error(`${src.name} sent something other than a TIFF: ${new TextDecoder().decode(bytes.subarray(0, 200))}`);
    tiffs[id] = readTiff(bytes);
  }
  const values = {};
  for (const id of new Set([...(heights.water ?? []), ...(heights.land ?? [])])) {
    const src = heights.rasters[id];
    values[id] = src.crs === "frame" ? atNodes(tiffs[id], grid, src.toMWL ?? 0) : resampleLatLon(tiffs[id], grid, frame, src.toMWL ?? 0);
  }
  log("Telling land from water…");
  const chains = joinCoast(coast);
  const cls = classify(grid, chains);
  const landFloor = landFloorFor(spec.datum);
  const waterFloor = 0.05 * cls.band;
  const lay = layerHeights({ n, heights, values, label: cls.label, landFloor });
  const fill = harmonicFill(n, lay.heights, lay.want, cls.label, { shore: -waterFloor });
  const check = heights.check && values[heights.check] ? sourceAgreement(values[heights.check], cls) : null;
  const problems = [];
  if (check && check.total >= 100 && check.share < MIN_AGREEMENT) problems.push(`${heights.rasters[heights.check].name} doesn't line up with OpenStreetMap's coastline: away from the shore only ${(check.share * 100).toFixed(1)}% of its nodes are on OSM's side of the water (at least ${MIN_AGREEMENT * 100}% expected): flipped, mirrored or shifted?`);
  let canopy = null;
  if (heights.canopy) canopy = canopyAtNodes(tiffs[heights.canopy.dtm], tiffs[heights.canopy.dsm], grid, frame);
  return { heights: fill.values, source: lay.source, names: lay.names, counts: lay.counts, canopy: canopyBytes(canopy, cls.label), check, filled: { nodes: fill.filled, sweeps: fill.sweeps, change: fill.change }, urls, problems, cls };
}
