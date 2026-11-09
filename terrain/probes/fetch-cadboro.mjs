// Fetch Cadboro Bay's data from the open sources, record every answer, and
// check what came back: the same fetch-data.js the tool and the template
// run, in node.
//
//   node probes/fetch-cadboro.mjs [--cache <dir>] [--offline] [--out <dir>]
//
// --cache  where the recording lives (default $TMPDIR/terrain-cadboro): an
//          index.json and one file per answer. Answers already recorded are
//          replayed, not fetched again, so a second run is offline and
//          gives the same bytes.
// --offline  never touch the network (fail on anything not recorded).
// --out    also write the cached data there: dem.bin (int16le), features.json, fetched.json.
//
// Checks (finite, on the real data): the DEM is the grid asked for; the
// coastline tells land from water at every node with no conflicts; the
// burned heights keep every node on its side of the water; the DEM lines up
// with OSM's coastline (and the same DEM flipped, mirrored or shifted 200 m
// would be refused); every OSM islet with a node clears the highest tide;
// the data is what was checked on 2026-11-09 (SHA-256, OSM pinned to that
// moment); a list of places known to be land or water (the clubhouse, the
// islands, the channels) come out so; the water under the mooring field is
// deep enough for a 2 m keel at the lowest normal tide.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fetchTerrainData } from "../src/fetch-data.js";
import { cadboroDoc, DATUM, EXPECTED, OSM_DATE } from "../src/cadboro.js";
import { QUALITY, regionsOf } from "../src/burn.js";
import { shape } from "../src/build.js";
import { bytesToInt16, sampler } from "../src/terrain-sample.js";
import { localFrame } from "../src/tmerc.js";
import { requestKey, replayFetch } from "./recorded-fetch.js";
import { KNOWN } from "./known-places.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const CACHE = resolve(arg("--cache") ?? join(process.env.TMPDIR || tmpdir(), "terrain-cadboro"));
const OFFLINE = process.argv.includes("--offline");
const OUT = arg("--out") ? resolve(arg("--out")) : null;
mkdirSync(join(CACHE, "answers"), { recursive: true });
const indexPath = join(CACHE, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};

// record what isn't recorded yet
const live = async (input, init = {}) => {
  if (OFFLINE) throw new Error(`offline, and not recorded: ${String(input).slice(0, 120)}`);
  const res = await fetch(input, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const key = await requestKey(input, init);
  if (res.ok) {
    const file = `answers/${key.slice(0, 16)}.bin`;
    writeFileSync(join(CACHE, file), bytes);
    index[key] = { url: String(input), method: (init.method ?? "GET").toUpperCase(), status: res.status, contentType: res.headers.get("content-type"), file, fetched: new Date().toISOString(), bytes: bytes.length };
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
  console.error(`  fetched ${res.status} ${bytes.length.toLocaleString("en")} bytes ${String(input).slice(0, 80)}…`);
  return new Response(bytes, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "" } });
};
const seen = [];
const recorded = replayFetch({ index, load: (f) => readFileSync(join(CACHE, f)), fallback: live, seen });

const spec = cadboroDoc();
const t0 = Date.now();
const got = await fetchTerrainData(spec, { fetch: recorded, log: (s) => console.error(`  ${s}`) });
console.error(`  ${seen.length} answers replayed from ${CACHE}; ${Date.now() - t0} ms`);

// ─── checks ───
const checks = {};
const check = (name, ok, detail) => {
  checks[name] = !!ok;
  console.error(`${ok ? "ok  " : "FAIL"} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
};
const grid = spec.grid;
const dem = bytesToInt16(got.dem.bytes);
const features = JSON.parse(new TextDecoder().decode(got.features.bytes));
const demRec = { scale: got.dem.record.scale, toMWL: spec.demToMWL };
const sh = shape(grid, dem, demRec, features, { datum: spec.datum });
check("the DEM is the grid asked for", dem.length === grid.n * grid.n, { n: grid.n, values: dem.length });
check("the data is what was checked on 2026-11-09 (OSM as of its pinned moment)", got.dem.record.sha256 === EXPECTED.dem && got.features.record.sha256 === EXPECTED.features && features.osmBase === OSM_DATE, { dem: got.dem.record.sha256, features: got.features.record.sha256, osmBase: features.osmBase });
check("the DEM lines up with OSM's coastline: off the shore, its nodes are on OSM's side of the water", sh.agreement.share >= 0.98, sh.agreement);
// the same DEM, misplaced: each must be refused (the sign agreement is the only thing that sees the DEM's position)
const n = grid.n;
const variants = {
  "flipped north–south": (i, j) => dem[(n - 1 - j) * n + i],
  "mirrored east–west": (i, j) => dem[j * n + (n - 1 - i)],
  "shifted 200 m east": (i, j) => dem[j * n + Math.max(0, i - 25)],
  "shifted 200 m south": (i, j) => dem[Math.max(0, j - 25) * n + i],
};
const caught = {};
for (const [name, at] of Object.entries(variants)) {
  const v = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = at(i, j);
  const s2 = shape(grid, v, demRec, features, { datum: spec.datum });
  caught[name] = { share: +s2.agreement.share.toFixed(4), refused: s2.problems.some((p) => /flipped, mirrored or shifted/.test(p)) };
}
check("the same DEM flipped, mirrored or shifted 200 m would be refused", Object.values(caught).every((c) => c.refused), caught);
check("every OSM islet with a node in the grid clears the highest normal tide (the land floor)", sh.islets.low.length === 0, { rings: sh.islets.rings, raised: sh.islets.raised.length, rocks: sh.islets.rocks.length, low: sh.islets.low, landFloor: sh.landFloor });
const clamped = regionsOf(grid, sh.quality, QUALITY.CLAMPED);
let clampedNodes = 0, raisedNodes = 0;
for (const q of sh.quality) (q === QUALITY.CLAMPED ? clampedNodes++ : q === QUALITY.RAISED ? raisedNodes++ : 0);
check("the coastline tells land from water at every node", sh.problems.length === 0 && sh.cls.stats.unknown === 0, { problems: sh.problems, stats: sh.cls.stats });
check("every open end of the coastline is well outside the grid", sh.ends.every((e) => e.away > sh.cls.band + grid.cell), sh.ends.map((e) => ({ id: e.id, away: Math.round(e.away) })));
const frame = localFrame(spec.origin);
const hf = sampler({ nx: grid.n, nz: grid.n, x0: grid.x0, z0: grid.z0, cell: grid.cell }, sh.heights, 0.02);
const nodeLabel = (x, z) => {
  const i = Math.round((x - grid.x0) / grid.cell), j = Math.round((z - grid.z0) / grid.cell);
  return sh.cls.label[j * grid.n + i];
};
const wrong = [];
for (const k of KNOWN) {
  const [x, z] = frame.toLocal(k.lat, k.lon);
  const l = nodeLabel(x, z);
  if (l !== (k.land ? 1 : -1)) wrong.push({ ...k, x: Math.round(x), z: Math.round(z), label: l });
}
check(`${KNOWN.length} known places are land or water as they should be`, wrong.length === 0, wrong);
const depth = -hf.heightAt(0, 0);
const swing = [];
for (let a = 0; a < 16; a++) for (const r of [10, 20, 30]) swing.push(-hf.heightAt(r * Math.cos((a * Math.PI) / 8), r * Math.sin((a * Math.PI) / 8)));
const shallowest = Math.min(depth, ...swing);
check("the mooring field is deep enough for a 2 m keel at the lowest normal tide, all round a 30 m swing", shallowest + DATUM.tide.LLWLT > 2.2, { atMooring: +depth.toFixed(2), shallowestInSwing: +shallowest.toFixed(2), llwlt: DATUM.tide.LLWLT });

console.log(JSON.stringify({ summary: got.summary, stats: sh.cls.stats, agreement: sh.agreement, islets: { rings: sh.islets.rings, raised: sh.islets.raised.length, rocks: sh.islets.rocks.length }, raisedNodes, clamped: { nodes: clampedNodes, regions: clamped.length, largest: clamped.slice(0, 6).map((r) => ({ ...r, ha: (r.nodes * 64) / 1e4 })) }, sources: got.sources.map(({ id, url, fetched, sha256 }) => ({ id, url: url?.slice(0, 100), fetched, sha256 })), depthAtMooring: depth, cache: CACHE }, null, 2));
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "dem.bin"), got.dem.bytes);
  writeFileSync(join(OUT, "features.json"), got.features.bytes);
  writeFileSync(join(OUT, "fetched.json"), JSON.stringify({ dem: got.dem.record, features: got.features.record, sources: got.sources, summary: got.summary }, null, 2));
  console.error(`  wrote ${OUT}`);
}
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
