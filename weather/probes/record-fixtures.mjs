// Records the Open-Meteo replies open-meteo.test.js reads (WEATHER.md,
// "Fetch"): real replies, committed, so the snapshot's tables are of what the
// API actually sends. Each is { name, note, request, json }, `request` as
// requestFor made it (its URL is what was fetched, except where `note` says).
// Only coordinates, dates and variable names are sent; nothing about anyone.
//   node probes/record-fixtures.mjs        (writes src/fixtures/*.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACES, weatherParams } from "../src/weather.js";
import { ENDPOINTS, VARIABLES, isoDate, requestFor } from "../src/open-meteo.js";
import { localOf } from "../src/time.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/fixtures");
mkdirSync(out, { recursive: true });
const [CADBORO, UCLUELET] = PLACES;
const DAY = 86_400_000;
const Q = 15 * 60_000;
const now = Date.now();
const at = (place, t) => weatherParams({ lat: place.lat, lon: place.lon, offset: place.offset, ...localOf(Math.floor(t / Q) * Q, place.offset) });
const clock = (place, date, hour) => weatherParams({ lat: place.lat, lon: place.lon, offset: place.offset, date, hour });

async function get(url) {
  const r = await fetch(url);
  return r.json();
}
async function record(name, request, note = null, url = request.url) {
  const json = await get(url);
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify({ name, note, request: { ...request, url }, json }, null, 1)}\n`);
  console.log(name, url, json.error ? `error: ${json.reason}` : "ok");
}

const tomorrow = isoDate(now + DAY);
// 1. the present conditions at Cadboro Bay (Fetch now)
await record("cadboro-current", requestFor(at(CADBORO, now), now));
// 2. tomorrow 15:00 at Ucluelet: the forecast's hours
await record("ucluelet-forecast", requestFor(clock(UCLUELET, tomorrow, 15), now));
// 3. 15 July 2025 15:00 at Ucluelet: the archive (visibility comes back null, its unit "undefined")
await record("ucluelet-archive", requestFor(clock(UCLUELET, "2025-07-15", 15), now));
// 4. tomorrow 15:00 at Cadboro Bay from GEM explicitly (visibility null): `models` is not a key requests carry
const gem = requestFor(clock(CADBORO, tomorrow, 15), now);
await record("cadboro-gem", gem, "models=gem_seamless added to the URL by this script; requests never carry it", `${gem.url}&models=gem_seamless`);
// 5. an error reply: the forecast's hours 30 days ahead, which routing never asks for (requestFor gives null)
const far = isoDate(now + 30 * DAY);
const farRequest = { ...requestFor(clock(UCLUELET, tomorrow, 15), now), date: far };
await record("error", farRequest, "the forecast's hours 30 days ahead: a URL routing never makes", farRequest.url.replaceAll(tomorrow, far));
// 6. a clear hour (all cloud 0): the first such afternoon hour of July 2025 at Cadboro Bay, from the archive
const month = await get(`${ENDPOINTS.archive}?${new URLSearchParams({ latitude: String(CADBORO.lat), longitude: String(CADBORO.lon), hourly: "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high", start_date: "2025-07-01", end_date: "2025-07-31", timezone: "GMT" })}`);
const h = month.hourly;
const i = h.time.findIndex((t, k) => t.endsWith(":00") && +t.slice(11, 13) >= 18 && +t.slice(11, 13) <= 23 && [h.cloud_cover, h.cloud_cover_low, h.cloud_cover_mid, h.cloud_cover_high].every((v) => v[k] === 0));
if (i < 0) throw new Error("no clear hour in July 2025");
const t = Date.parse(`${h.time[i]}Z`);
await record("cadboro-clear", requestFor(at(CADBORO, t), now));
console.log("variables", VARIABLES.length);
