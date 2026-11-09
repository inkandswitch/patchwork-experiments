// Fetching a terrain's data, once, from open sources: the one place in this
// package that touches the network. The tool's "Fetch data", the Cadboro
// Bay template and probes/fetch-cadboro.mjs all run this; what it returns
// is stored in file docs (store.js), and build() reads only those, so a
// build is a pure function of the docs.
//
// - Heights: NOAA NCEI's Port Townsend 1/3 arc-second NAVD88 coastal DEM
//   (one seamless land-and-sea surface, ~10 m), asked for directly in the
//   terrain's own frame and grid: the server resamples (bilinear) to
//   exactly the grid's nodes, so nothing is reprojected here. The answer is
//   checked to be that grid (size, pixel scale, tie point) or refused.
// - Shoreline, harbour structures and marks: OpenStreetMap through the
//   Overpass API (retried: it answers 502 now and then).
//
// `fetch` is passed in (the browser's, node's, or a probe's recording).

import { localFrame } from "./tmerc.js";
import { readTiff } from "./tiff.js";
import { featuresFromOsm } from "./osm.js";
import { sha256Hex } from "./hash.js";
import { shape } from "./build.js";
import { bytesToInt16 } from "./terrain-sample.js";

export const NCEI = Object.freeze({
  id: "ncei-port-townsend-navd88",
  name: "NOAA NCEI Port Townsend, WA 1/3 arc-second NAVD88 Coastal DEM (2011)",
  service: "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage",
  raster: 171,
  metadata: "https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ngdc.mgg.dem:1786/xml",
  licence: "Public domain (U.S. Government work); please cite NOAA NCEI",
  attribution: "Elevation and bathymetry: NOAA National Centers for Environmental Information, Port Townsend, WA 1/3 arc-second NAVD88 Coastal DEM (2011)",
  // NCEI's metadata (above), "Vertical/Horizontal Positional Accuracy Report", as it states them
  accuracy:
    "NCEI's stated accuracy. Vertical: Canadian land heights are CDED, 5 to 10 m (coarse); bathymetry 30 m to 5% of water depth (as stated), CHS and NGDC multibeam about 0.1 m, early 20th-century soundings sparse. Horizontal: CDED 8 m; bathymetry a few tens to several hundreds of metres, CHS multibeam about 5 m. Checked here: in Cadboro Bay it agrees with CHS NONNA-10 (606 cells, median −0.29 m, 10th/90th percentile about ±1 m; 8.04 m at the mooring field, NONNA 8.57 m).",
});

export const OVERPASS = Object.freeze({
  id: "osm-overpass",
  name: "OpenStreetMap (Overpass API)",
  service: "https://overpass-api.de/api/interpreter",
  licence: "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/): share-alike applies to a published derivative database",
  attribution: "Shoreline, harbour structures and marks © OpenStreetMap contributors (ODbL)",
  accuracy: "OSM's natural=coastline is the mean high water line as mapped (from imagery); this terrain puts it at mean water level.",
});

const IWLS = "https://api-iwls.dfo-mpo.gc.ca/api/v1";
export const TIDES = Object.freeze({
  id: "chs-iwls",
  name: "Canadian Hydrographic Service water level stations 07140 Finnerty Cove, 07130 Oak Bay",
  service: `${IWLS}/stations`,
  url: `${IWLS}/stations/5cebf1df3d0f4a073c4bbd24/metadata`,
  requests: Object.freeze([
    `${IWLS}/stations?code=07140`,
    `${IWLS}/stations/5cebf1df3d0f4a073c4bbd24/metadata`,
    `${IWLS}/stations/5cebf1df3d0f4a073c4bbd22/metadata`,
    `${IWLS}/height-types`,
  ]),
  derivation:
    "07140 Finnerty Cove's metadata, `heights` (named by /height-types) in metres above chart datum: MWL 1.99, HHWLT 3.19, MHHW 2.83, MLLW 0.77, LLWLT −0.15; `datums`: CGVD2013 offset −1.88. So MWL is 0.11 m above CGVD2013, and the tide levels about MWL are HHWLT +1.20, MHHW +0.84, MLLW −1.22, LLWLT −2.14. (07130 Oak Bay, 3 km south: MWL 2.00.)",
  fetched: "2026-11-09",
  licence: "Open Government Licence – Canada",
  attribution: "Datum and tide levels: Fisheries and Oceans Canada, Canadian Hydrographic Service",
});

const climate = (year) => `https://api.weather.gc.ca/collections/climate-hourly/items?f=json&CLIMATE_IDENTIFIER=1012475&datetime=${year}-06-15T00%3A00%3A00Z%2F${year}-09-15T23%3A00%3A00Z&limit=10000&properties=LOCAL_DATE,LOCAL_HOUR,WIND_DIRECTION,WIND_SPEED,LOCAL_MONTH,UTC_DATE`;
export const WINDS = Object.freeze({
  id: "eccc-climate-hourly",
  name: "ECCC climate-hourly, station 1012475 Discovery Island",
  service: "https://api.weather.gc.ca/collections/climate-hourly/items",
  url: climate(2019),
  requests: Object.freeze([2019, 2020, 2021, 2022, 2023, 2024, 2025].map(climate)),
  derivation:
    "Of those answers, LOCAL_MONTH 7 or 8 and LOCAL_HOUR 12 to 17 (ECCC's local standard time: 13:00 to 18:00 PDT) with both WIND_SPEED (km/h) and WIND_DIRECTION (tens of degrees): 2,599 hours. Resultant direction (from): 235° weighted by speed, 237° unweighted; speed median 3.3 m/s, 75th percentile 4.2, 90th 5.3.",
  fetched: "2026-11-09",
  licence: "Open Government Licence – Canada",
  attribution: "Wind climatology: Environment and Climate Change Canada",
});

/** The short credit a scene shows (the credit extension; extras.terrain.credit). */
export const CREDIT = "Terrain: © OpenStreetMap contributors (ODbL) · NOAA NCEI · CHS · ECCC · not for navigation";

/** The geographic box (degrees) that holds the grid, `margin` metres wider on every side. */
export function latLonBox(grid, frame, margin = 0) {
  const x1 = grid.x0 - margin, x2 = grid.x0 + (grid.n - 1) * grid.cell + margin;
  const z1 = grid.z0 - margin, z2 = grid.z0 + (grid.n - 1) * grid.cell + margin;
  const corners = [[x1, z1], [x2, z1], [x1, z2], [x2, z2], [(x1 + x2) / 2, z1], [(x1 + x2) / 2, z2]].map(([x, z]) => frame.toLatLon(x, z));
  const lats = corners.map((c) => c[0]), lons = corners.map((c) => c[1]);
  return { south: Math.min(...lats), west: Math.min(...lons), north: Math.max(...lats), east: Math.max(...lons) };
}

/** NCEI's exportImage request for exactly the grid's nodes, in the grid's own frame. */
export function nceiUrl(grid, frame) {
  const { n, cell, x0, z0 } = grid;
  const sr = JSON.stringify({ wkt: frame.wkt });
  // pixel centres on the nodes: the box is half a cell wider than the nodes on every side (northing = −z)
  const bbox = [x0 - cell / 2, -(z0 + (n - 1) * cell) - cell / 2, x0 + (n - 1) * cell + cell / 2, -z0 + cell / 2].join(",");
  const q = new URLSearchParams({
    bbox,
    bboxSR: sr,
    imageSR: sr,
    size: `${n},${n}`,
    format: "tiff",
    pixelType: "F32",
    noData: "-99999",
    interpolation: "RSP_BilinearInterpolation",
    compression: "None",
    mosaicRule: JSON.stringify({ mosaicMethod: "esriMosaicLockRaster", lockRasterIds: [NCEI.raster] }),
    f: "image",
  });
  return `${NCEI.service}?${q}`;
}

/**
 * Check a decoded TIFF is the grid asked for: n × n, the pixel scale the
 * cell, and the tie point the north-west node's cell corner. Throws with
 * what differs; else the heights as a Float32Array, row 0 the north.
 */
export function checkDem(tiff, grid) {
  const { n, cell, x0, z0 } = grid;
  const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (tiff.width !== n || tiff.height !== n) throw new Error(`NCEI sent ${tiff.width} × ${tiff.height}, not ${n} × ${n}.`);
  const ps = tiff.pixelScale, tp = tiff.tiepoint;
  if (!ps || !near(ps[0], cell) || !near(ps[1], cell)) throw new Error(`NCEI's pixels are ${ps?.slice(0, 2).join(" × ")} m, not ${cell} m.`);
  if (!tp || tp[0] !== 0 || tp[1] !== 0 || !near(tp[3], x0 - cell / 2) || !near(tp[4], -z0 + cell / 2)) throw new Error(`NCEI's grid is tied at ${tp?.slice(3, 5).join(", ")}, not ${x0 - cell / 2}, ${-z0 + cell / 2}.`);
  let missing = 0;
  for (const v of tiff.data) if (!Number.isFinite(v) || v === tiff.nodata || v <= -99998) missing++;
  if (missing) throw new Error(`NCEI's DEM has no height at ${missing} of the grid's ${n * n} nodes.`);
  return tiff.data;
}

/** Heights (metres, as the source has them) to int16 little-endian bytes at `scale` metres a step. Throws if one doesn't fit. */
export function quantize(values, scale) {
  const out = new Uint8Array(values.length * 2);
  const dv = new DataView(out.buffer);
  for (let k = 0; k < values.length; k++) {
    const v = Math.round(values[k] / scale);
    if (!(v >= -32767 && v <= 32767)) throw new Error(`A height of ${values[k]} m doesn't fit int16 at ${scale} m a step.`);
    dv.setInt16(k * 2, v, true);
  }
  return out;
}

/**
 * The Overpass query: coastline, harbour structures and seamarks in the box,
 * as OSM was at `date` (an ISO time: the same answer every time) or now.
 */
export function overpassQuery(box, { date = null } = {}) {
  const b = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  if (date != null && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date)) throw new Error(`OpenStreetMap's date must be like 2026-11-09T20:32:33Z, not ${date}.`);
  return `[out:json][timeout:120]${date ? `[date:"${date}"]` : ""};
(
  way["natural"="coastline"](${b});
  way["man_made"~"^(pier|breakwater|groyne)$"](${b});
  nwr["seamark:type"](${b});
  nwr["man_made"~"^(lighthouse|beacon)$"](${b});
);
out geom;`;
}

const USER_AGENT = "patchwork-terrain/0.1 (+https://www.inkandswitch.com/patchwork/)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST the query to Overpass, retrying 429/5xx and network errors (it is
 * often at capacity: after 3, 10, 20, 40 and 60 s). Overpass refuses
 * (406) a request that doesn't say who it's from; a browser's own
 * User-Agent does, and elsewhere this one is sent (a browser drops it).
 */
export async function fetchOverpass(query, { fetch, log = () => {}, waits = [3000, 10000, 20000, 40000, 60000] } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      const res = await fetch(OVERPASS.service, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT }, body: `data=${encodeURIComponent(query)}` });
      if (res.ok) {
        const text = await res.text();
        const json = JSON.parse(text);
        if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
        return { json, text };
      }
      last = new Error(`Overpass answered ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (err) {
      last = err;
      if (/answered 4\d\d/.test(String(err?.message)) && !/429/.test(err.message)) throw err;
    }
    if (attempt < waits.length) {
      log(`${last?.message ?? last}; trying again in ${waits[attempt] / 1000} s`);
      await sleep(waits[attempt]);
    }
  }
  throw last ?? new Error("Overpass didn't answer.");
}

/** The DEM in the grid, from NCEI: { values: Float32Array (metres NAVD88), url }. */
export async function fetchDem(grid, frame, { fetch }) {
  const url = nceiUrl(grid, frame);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NCEI answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers?.get?.("content-type") ?? "";
  if (!/tiff/i.test(type) && String.fromCharCode(bytes[0], bytes[1]) !== "II" && String.fromCharCode(bytes[0], bytes[1]) !== "MM") {
    throw new Error(`NCEI sent ${type || "something"} rather than a TIFF: ${new TextDecoder().decode(bytes.subarray(0, 200))}`);
  }
  return { values: checkDem(readTiff(bytes), grid), url };
}

/** The fixed scale the DEM is stored at: 2 cm a step, ±655 m. */
export const DEM_SCALE = 0.02;

/**
 * Fetch everything a Terrain doc caches, for its `origin` and `grid`, and
 * OpenStreetMap as it was at `osmDate` (null: now).
 * → { dem: { bytes, record }, features: { bytes, record }, sources, summary }
 * where each record is what the doc keeps beside the file doc's url.
 * Refused: a coastline that can't tell land from water, and heights that
 * don't line up with it (build.js shape()).
 * @param {{ origin, grid, demToMWL?, datum?, osmDate? }} spec
 * @param {{ fetch: typeof fetch, log?: (s: string) => void, now?: () => Date }} io
 */
export async function fetchTerrainData(spec, { fetch, log = () => {}, now = () => new Date() }) {
  const frame = localFrame(spec.origin);
  const grid = spec.grid;
  if (!Number.isInteger(Math.log2(grid.n - 1))) throw new Error(`The grid has ${grid.n} nodes a side; it needs 2^k + 1.`);
  const when = now().toISOString();
  log(`Asking NCEI for ${grid.n} × ${grid.n} heights…`);
  const [dem, osm] = await Promise.all([
    fetchDem(grid, frame, { fetch }),
    (async () => {
      const box = latLonBox(grid, frame, 600);
      log("Asking OpenStreetMap for the shoreline, structures and marks…");
      return { box, ...(await fetchOverpass(overpassQuery(box, { date: spec.osmDate ?? null }), { fetch, log })) };
    })(),
  ]);
  const demBytes = quantize(dem.values, DEM_SCALE);
  // pinned to a date, OSM is as of that date (Overpass's own osm_base is today's)
  const features = featuresFromOsm(osm.json, frame, { osmBase: spec.osmDate ?? undefined });
  // refuse data that can't be built: the coastline must tell land from water everywhere in the grid, and the heights line up with it
  const told = shape(grid, bytesToInt16(demBytes), { scale: DEM_SCALE, toMWL: spec.demToMWL ?? 0 }, features, { datum: spec.datum ?? null });
  if (told.problems.length) throw new Error(`This data can't be used: ${told.problems.join(" ")}`);
  const featuresBytes = new TextEncoder().encode(JSON.stringify(features));
  const [demSha, featuresSha] = await Promise.all([sha256Hex(demBytes), sha256Hex(featuresBytes)]);
  let min = Infinity, max = -Infinity;
  for (const v of dem.values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const sources = [
    { ...pick(NCEI), url: dem.url, fetched: when, sha256: demSha, note: "heights in NAVD88, resampled by the server (bilinear) to the grid's nodes" },
    { ...pick(OVERPASS), url: OVERPASS.service, method: "POST", query: overpassQuery(osm.box, { date: spec.osmDate ?? null }), fetched: when, osmBase: features.osmBase, sha256: featuresSha },
    // fetched by hand on that date; the values they back are in the Terrain doc (datum, wind) and cadboro.js
    pick(TIDES),
    pick(WINDS),
  ];
  return {
    dem: { bytes: demBytes, record: { encoding: "int16le", scale: DEM_SCALE, offset: 0, datum: "NAVD88", n: grid.n, cell: grid.cell, x0: grid.x0, z0: grid.z0, origin: { ...frame.origin }, sha256: demSha } },
    features: { bytes: featuresBytes, record: { encoding: "json", origin: { ...frame.origin }, sha256: featuresSha } },
    sources,
    summary: { fetched: when, min, max, land: told.cls.stats.land, water: told.cls.stats.water, coastWays: features.coast.length, structures: features.structures.length, marks: features.marks.length, osmBase: features.osmBase, agreement: told.agreement.share, isletsRaised: told.islets.raised.length, rocks: told.islets.rocks.length },
  };
}

// a source's record: everything it says (urls, requests, accuracy, how its numbers were derived), as plain data
const pick = (src) => JSON.parse(JSON.stringify(src));

/** One line crediting every source, for the GLB's copyright and the tool. */
export const ATTRIBUTION = [NCEI.attribution, OVERPASS.attribution, TIDES.attribution, WINDS.attribution].join(". ") + ". Not for navigation.";
