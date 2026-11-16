// Fetch Ucluelet's data from the open sources, record every answer, and
// check what came back: the same fetch-data.js (layered.js) the tool and the
// template run, in node.
//
//   node probes/fetch-ucluelet.mjs [--cache <dir>] [--offline] [--seed <dir>] [--out <dir>]
//
// --cache  where the recording lives (default $TMPDIR/terrain-ucluelet): an
//          index.json and one file per answer, replayed on later runs.
// --seed   a folder of answers already fetched by hand (the research's
//          downloads, data/<source>/ each beside its exact request): a
//          request not yet recorded whose URL (and body) is one of those is
//          recorded from that file instead of fetched again, and says so.
// --offline  never touch the network.
// --out    also write dem.bin, layers.bin, features.json, look.json, fetched.json.
//
// Checks (finite, on the real data): the grid; every node classified, no
// conflicts, no open end of the coastline near the grid; the lidar lines up
// with OSM's coastline (and flipped, mirrored or shifted it would be
// refused); every water node has a depth from a survey or a flagged fill,
// every land node a height or a flagged floor, in the counts research found;
// every islet clears the land floor; known places are land or water; the
// data is what was checked (SHA-256, OSM pinned); the anchorage is deep
// enough for a 2 m keel at the lowest normal tide all round a 30 m swing;
// the yard's lidar heights the site is conformed to (ucluelet.js YARD) are
// the fetched lidar's, and the hangar's slab is within 0.3 m of the drawn
// ground; the depths at the haul-out pier's head (its `headDepth`) are the
// fetched heights'.

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fetchTerrainData, nceiUrl, overpassQuery, latLonBox } from "../src/fetch-data.js";
import { lookQuery } from "../src/look-osm.js";
import { uclueletDoc, DATUM, EXPECTED, OSM_DATE, ANCHORAGE, HEIGHTS, YARD, SITE } from "../src/ucluelet.js";
import { readTiff } from "../src/tiff.js";
import { resampleLatLon, sampleModel } from "../src/resample.js";
import { QUALITY, regionsOf } from "../src/burn.js";
import { shape } from "../src/build.js";
import { unpackLayers, sourceAgreement } from "../src/layered.js";
import { bytesToInt16, sampler } from "../src/terrain-sample.js";
import { localFrame } from "../src/tmerc.js";
import { requestKey, replayFetch } from "./recorded-fetch.js";
import { KNOWN_UCLUELET as KNOWN } from "./known-ucluelet.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const CACHE = resolve(arg("--cache") ?? join(process.env.TMPDIR || tmpdir(), "terrain-ucluelet"));
const OFFLINE = process.argv.includes("--offline");
const SEED = arg("--seed") ? resolve(arg("--seed")) : null;
const OUT = arg("--out") ? resolve(arg("--out")) : null;
mkdirSync(join(CACHE, "answers"), { recursive: true });
const indexPath = join(CACHE, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};

const spec = uclueletDoc();
const frame = localFrame(spec.origin);
const box = latLonBox(spec.grid, frame, 600);
const body = (q) => `data=${encodeURIComponent(q)}`;

// the research's downloads (2026-11-15), each with the request it answered
const seeds = SEED
  ? [
      ["GET", HEIGHTS.rasters["chs-nonna-10"].url, "", "chs-nonna/nonna10-final-native.tif", "chs-nonna/request-nonna10-final.txt"],
      ["GET", HEIGHTS.rasters["chs-nonna-100"].url, "", "chs-nonna/nonna100-final.tif", "chs-nonna/request-nonna100-final.txt"],
      ["GET", nceiUrl(spec.grid, frame, 147), "", "ncei/barkley-1s-raster147-final.tif", "ncei/request-147-final.txt"],
      ["GET", nceiUrl(spec.grid, frame, 182), "", "ncei/bc-3s-raster182-final.tif", "ncei/request-182-final.txt"],
      ["GET", HEIGHTS.rasters["nrcan-hrdem-dtm"].url, "", "nrcan-hrdem/hrdem-dtm-final-10m.tif", "nrcan-hrdem/request-hrdem-dtm-final-10m.txt"],
      ["GET", HEIGHTS.rasters["nrcan-hrdem-dsm"].url, "", "nrcan-hrdem/hrdem-dsm-final-10m.tif", "nrcan-hrdem/request-hrdem-dsm-final-10m.txt"],
      ["POST", "https://overpass-api.de/api/interpreter", body(overpassQuery(box, { date: OSM_DATE })), "osm-overpass/terrain-features.json", "osm-overpass/query-terrain.overpassql"],
      ["POST", "https://overpass-api.de/api/interpreter", body(lookQuery(box, { date: OSM_DATE })), "osm-overpass/look-features.json", "osm-overpass/query-look.overpassql"],
    ]
  : [];
// each seed's request, as this package makes it, must be exactly the one the file answered
for (const [method, url, b, , req] of seeds) {
  const was = readFileSync(join(SEED, req), "utf8");
  const same = method === "GET" ? was.trim() === url : was === decodeURIComponent(b.slice(5));
  if (!same) throw new Error(`The seed ${req} answered a different request from the one this package makes: refusing to replay it.`);
}

const record = async (input, init, bytes, status, contentType, extra = {}) => {
  const key = await requestKey(input, init);
  const file = `answers/${key.slice(0, 16)}.bin`;
  writeFileSync(join(CACHE, file), bytes);
  index[key] = { url: String(input), method: (init.method ?? "GET").toUpperCase(), status, contentType, file, fetched: new Date().toISOString(), bytes: bytes.length, ...extra };
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
};
const live = async (input, init = {}) => {
  const seed = seeds.find(([m, u, b]) => m === (init.method ?? "GET").toUpperCase() && u === String(input) && b === (typeof init.body === "string" ? init.body : ""));
  if (seed) {
    const bytes = readFileSync(join(SEED, seed[3]));
    await record(input, init, bytes, 200, /\.json$/.test(seed[3]) ? "application/json" : "image/tiff", { fetched: statSync(join(SEED, seed[3])).mtime.toISOString(), seededFrom: seed[3] });
    console.error(`  seeded ${bytes.length.toLocaleString("en")} bytes from ${seed[3]}`);
    return new Response(bytes, { status: 200 });
  }
  if (OFFLINE) throw new Error(`offline, and not recorded: ${String(input).slice(0, 120)}`);
  const res = await fetch(input, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (res.ok) await record(input, init, bytes, res.status, res.headers.get("content-type"));
  console.error(`  fetched ${res.status} ${bytes.length.toLocaleString("en")} bytes ${String(input).slice(0, 80)}…`);
  return new Response(bytes, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "" } });
};
const seen = [];
const recorded = replayFetch({ index, load: (f) => readFileSync(join(CACHE, f)), fallback: live, seen });

const t0 = Date.now();
const got = await fetchTerrainData(spec, { fetch: recorded, log: (s) => console.error(`  ${s}`) });
console.error(`  ${seen.length} answers replayed from ${CACHE}; ${Date.now() - t0} ms`);

// ─── checks ───
const checks = {};
const check = (name, ok, detail) => {
  checks[name] = !!ok;
  console.error(`${ok ? "ok  " : "FAIL"} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};
const grid = spec.grid, n = grid.n, N = n * n;
const dem = bytesToInt16(got.dem.bytes);
const features = JSON.parse(new TextDecoder().decode(got.features.bytes));
const look = got.look ? JSON.parse(new TextDecoder().decode(got.look.bytes)) : null;
const { source, canopy } = unpackLayers(got.layers.bytes, N);
const names = got.layers.record.names;
const S = spec.heightScale;
const sh = shape(grid, dem, { scale: S, toMWL: 0 }, features, { datum: spec.datum, scale: S });
check("the heights are the grid asked for", dem.length === N, { n, values: dem.length });
const sums = { dem: got.dem.record.sha256, layers: got.layers.record.sha256, features: got.features.record.sha256, look: got.look?.record.sha256 };
check("the data is what was checked on 2026-11-15 (OSM as of its pinned moment)", Object.keys(EXPECTED).every((k) => EXPECTED[k] === sums[k]) && features.osmBase === OSM_DATE && look?.osmBase === OSM_DATE, { sums, osmBase: [features.osmBase, look?.osmBase] });
check("the coastline tells land from water at every node", sh.problems.length === 0 && sh.cls.stats.unknown === 0, { problems: sh.problems, stats: sh.cls.stats });
check("every open end of the coastline is well outside the grid", sh.ends.every((e) => e.away > sh.cls.band + grid.cell), sh.ends.map((e) => ({ id: e.id, away: Math.round(e.away) })));
check("the lidar lines up with OSM's coastline (off the shore, above +1 m exactly where OSM says land)", got.summary.check?.share >= 0.98, got.summary.check);
// the lidar's bare earth, as fetched
const dtmKey = Object.keys(index).find((k) => index[k].url === HEIGHTS.rasters["nrcan-hrdem-dtm"].url);
const dtm = readTiff(readFileSync(join(CACHE, index[dtmKey].file)));
// the lidar, misplaced: each must be refused
{
  const v = resampleLatLon(dtm, grid, frame, HEIGHTS.rasters["nrcan-hrdem-dtm"].toMWL);
  const shifted = (f) => {
    const out = new Float32Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = f(i, j);
    return sourceAgreement(out, sh.cls).share;
  };
  const variants = {
    "flipped north–south": shifted((i, j) => v[(n - 1 - j) * n + i]),
    "mirrored east–west": shifted((i, j) => v[j * n + (n - 1 - i)]),
    "shifted 200 m east": shifted((i, j) => v[j * n + Math.max(0, i - 10)]),
    "shifted 200 m south": shifted((i, j) => v[Math.max(0, j - 10) * n + i]),
  };
  check("the same lidar flipped, mirrored or shifted 200 m would be refused (below 98%)", Object.values(variants).every((s) => s < 0.98), Object.fromEntries(Object.entries(variants).map(([k, s]) => [k, +s.toFixed(4)])));
}
const counts = got.layers.record.counts;
check("every water node has a survey's depth or a flagged fill; every land node a height or a flagged floor", Object.values(counts).reduce((a, b) => a + b, 0) === N, counts);
check("NONNA-10 gives most of the water's depths, and few are filled", counts["chs-nonna-10"] > 0.9 * sh.cls.stats.water && counts.filled < 3000, { nonna10: counts["chs-nonna-10"], water: sh.cls.stats.water, filled: counts.filled, sweeps: got.summary.filled });
check("every OSM islet with a node clears the highest normal tide (the land floor)", sh.islets.low.length === 0, { rings: sh.islets.rings, raised: sh.islets.raised.length, rocks: sh.islets.rocks.length, low: sh.islets.low, landFloor: sh.landFloor });
const label = (lat, lon) => {
  const [x, z] = frame.toLocal(lat, lon);
  const i = Math.round((x - grid.x0) / grid.cell), j = Math.round((z - grid.z0) / grid.cell);
  return sh.cls.label[j * n + i];
};
const wrong = KNOWN.filter((k) => label(k.lat, k.lon) !== (k.land ? 1 : -1));
check(`${KNOWN.length} known places are land or water as they should be`, wrong.length === 0, wrong);
let canopyNodes = 0, tall = 0;
const lidar = names.indexOf("nrcan-hrdem-dtm");
for (let k = 0; k < N; k++) if (sh.cls.label[k] > 0 && source[k] === lidar) (canopyNodes++, canopy[k] > 5 && tall++);
check("the canopy: most lidar-covered land is forest over 5 m (research: 89%)", tall / canopyNodes > 0.8, { land: canopyNodes, over5m: tall, share: +(tall / canopyNodes).toFixed(3) });
const hf = sampler({ nx: n, nz: n, x0: grid.x0, z0: grid.z0, cell: grid.cell }, sh.heights, S);
const [ax, az] = frame.toLocal(ANCHORAGE.lat, ANCHORAGE.lon);
const swing = [];
for (let a = 0; a < 16; a++) for (const r of [0, 10, 20, 30]) swing.push(-hf.heightAt(ax + r * Math.cos((a * Math.PI) / 8), az + r * Math.sin((a * Math.PI) / 8)));
const shallowest = Math.min(...swing);
check("the anchorage is deep enough for a 2 m keel at the lowest normal tide, all round a 30 m swing", shallowest + DATUM.tide.LLWLT > 2.2, { at: [Math.round(ax), Math.round(az)], depth: +(-hf.heightAt(ax, az)).toFixed(2), shallowest: +shallowest.toFixed(2), llwlt: DATUM.tide.LLWLT });
// the yard: the survey and the lidar disagree; the site is drawn on the lidar's ground (ucluelet.js YARD)
{
  const toMWL = HEIGHTS.rasters[YARD.lidar.source].toMWL;
  const got = YARD.lidar.points.map(([lat, lon, h]) => ({ recorded: h, lidar: +(sampleModel(dtm, lon, lat) + toMWL).toFixed(2) }));
  const mean = got.reduce((a, p) => a + p.lidar, 0) / got.length;
  check("the yard's lidar heights the site is conformed to are the fetched lidar's (each to 2 cm; their mean, and the survey's offset from it)", got.every((p) => Math.abs(p.lidar - p.recorded) <= 0.02) && Math.abs(mean - YARD.lidar.mean) <= 0.01 && Math.abs(Math.round((mean - YARD.surveySlab) * 100) / 100 - YARD.offset) <= 0.01, { mean: +mean.toFixed(3), offset: YARD.offset, points: got });
  const hangar = SITE.structures.find((st) => st.id === "hangar");
  const pts = [...hangar.corners, [hangar.corners.reduce((a, p) => a + p[0], 0) / 4, hangar.corners.reduce((a, p) => a + p[1], 0) / 4]];
  const drawn = pts.map(([lat, lon]) => hf.heightAt(...frame.toLocal(lat, lon)));
  const drawnMean = drawn.reduce((a, b) => a + b, 0) / drawn.length;
  check("the hangar's slab is within 0.3 m of the drawn ground (its middle, and the mean of its corners and middle)", Math.abs(hangar.floor - drawnMean) <= 0.3 && Math.abs(hangar.floor - drawn[4]) <= 0.3, { floor: hangar.floor, drawn: drawn.map((v) => +v.toFixed(2)), mean: +drawnMean.toFixed(2) });
  // the haul-out pier's seaward ends, in the fetched heights (before the shore's burn and the water floor)
  const raw = sampler({ nx: n, nz: n, x0: grid.x0, z0: grid.z0, cell: grid.cell }, dem, S);
  const haul = SITE.structures.find((st) => st.id === "haulout");
  const heads = haul.runways.map((r) => +raw.heightAt(...frame.toLocal(...r[1])).toFixed(2));
  check("the depths recorded at the haul-out pier's head are the fetched heights' (to 5 cm)", heads.every((h, q) => Math.abs(h - haul.headDepth.mwl[q]) <= 0.05), { heads, recorded: haul.headDepth.mwl });
}
const clamped = regionsOf(grid, sh.quality, QUALITY.CLAMPED);
console.log(JSON.stringify({ summary: got.summary, stats: sh.cls.stats, agreement: sh.agreement, islets: { rings: sh.islets.rings, raised: sh.islets.raised.length, rocks: sh.islets.rocks.length }, clamped: clamped.slice(0, 6), sources: got.sources.map(({ id, url, fetched, sha256 }) => ({ id, url: url?.slice(0, 100), fetched, sha256 })), sums, cache: CACHE, names }, null, 2));
// the forest on the real data (forest.js, as build.js lays it): inside the skin's circles every node the lidar says is forest (canopy over 5 m, nothing built) carries crowns, a stand or a clump, never both
{
  const { coverGrid, distanceToWater } = await import("../src/cover.js");
  const F = await import("../src/forest.js");
  const { builtRings } = await import("../src/build.js");
  const lb = sh.cls.label;
  const cover = coverGrid(grid, look);
  const measured = Uint8Array.from(source, (v) => (v === lidar ? 1 : 0));
  const built = F.builtMask(grid, builtRings(spec, look, frame));
  const eff = F.effectiveCanopy({ n, label: lb, cover, canopy, measured, assumed: spec.look.trees.assumed, built });
  const dist = distanceToWater(n, lb, grid.cell);
  const trees = spec.look.trees;
  const circles = trees.skin.within.map((c) => {
    const [x, z] = frame.toLocal(c.at[0], c.at[1]).map((v) => Math.round(v * 1000) / 1000);
    return { x, z, radius: c.radius };
  });
  const zone = F.skinZone(grid, circles), beyond = F.beyondCircles(grid, circles);
  const placed = F.placeTrees({ grid, label: lb, cover, canopy: eff, dist, trees, built, zone, beyond });
  const skin = F.placeSkin({ grid, label: lb, cover, canopy: eff, dist, zone, skin: trees.skin, setback: trees.roofSetback ?? 20, built, trees, beyond });
  const standAt = new Set(placed.trees.filter((t) => t.crowns).map((t) => t.k)), clumpAt = new Set(skin.clumps.map((c) => c.k));
  let forest = 0, bare = 0, both = 0;
  for (let k = 0; k < N; k++) {
    if (!zone[k] || !F.isForest(k, lb, cover, eff)) continue;
    forest++;
    if (!standAt.has(k) && !clumpAt.has(k)) bare++;
    if (standAt.has(k) && clumpAt.has(k)) both++;
  }
  check("inside the skin's circles every forest node carries crowns (a stand at the water or a clump), never both, and nothing is thinned away", bare === 0 && both === 0 && placed.trees.length === placed.before && skin.clumps.length === skin.before, { forest, bare, both, trees: { before: placed.before, kept: placed.trees.length, threshold: placed.threshold }, clumps: { before: skin.before, kept: skin.clumps.length } });
}

if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "dem.bin"), got.dem.bytes);
  writeFileSync(join(OUT, "layers.bin"), got.layers.bytes);
  writeFileSync(join(OUT, "features.json"), got.features.bytes);
  if (got.look) writeFileSync(join(OUT, "look.json"), got.look.bytes);
  writeFileSync(join(OUT, "fetched.json"), JSON.stringify({ dem: got.dem.record, layers: got.layers.record, features: got.features.record, look: got.look?.record ?? null, sources: got.sources, summary: got.summary }, null, 2));
  console.error(`  wrote ${OUT}`);
}
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
