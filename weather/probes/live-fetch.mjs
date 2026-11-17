// Live check of the fetch (WEATHER.md, "Fetch"): both places, now (Now, then Fetch for this time)
// and 15 July 2025 15:00 PDT (Fetch for this time, from the archive), through
// the package's own requestFor, fetchWeather and snapshotFrom. Every summed
// field must be finite, in its range and on its step, and the URL's keys the
// whitelist. Sends only coordinates, dates and variable names.
//   node probes/live-fetch.mjs        (exit 0 when every case passes)
import { FIELDS, PLACES, weatherParams } from "../src/weather.js";
import { QUERY, fetchWeather, onStep, requestFor, snapshotFrom } from "../src/open-meteo.js";
import { localOf } from "../src/time.js";

const Q = 15 * 60_000;
const now = Date.now();
let failed = 0;
for (const place of PLACES)
  for (const [label, when] of [
    ["now", localOf(Math.floor(now / Q) * Q, place.offset)],
    ["2025-07-15 15:00 PDT", { date: "2025-07-15", hour: 15 }],
  ]) {
    const p = weatherParams({ lat: place.lat, lon: place.lon, offset: place.offset, ...when });
    const request = requestFor(p, now);
    const problems = [];
    let snap = null;
    try {
      const keys = [...new URL(request.url).searchParams.keys()];
      if (JSON.stringify(keys) !== JSON.stringify(QUERY[request.route])) problems.push(`keys ${keys}`);
      snap = snapshotFrom(await fetchWeather(request), request);
      for (const f of FIELDS.filter((f) => f.kind === "number")) {
        const v = snap[f.key];
        if (!Number.isFinite(v) || v < f.min || v > f.max) problems.push(`${f.key} ${v}`);
        else if (!["lat", "lon", "hour", "offset"].includes(f.key) && onStep(f.key, v) !== v) problems.push(`${f.key} ${v} off its step`);
      }
    } catch (e) {
      problems.push(String(e?.message ?? e));
    }
    if (problems.length) failed++;
    const { source, ...fields } = snap ?? {};
    console.log(JSON.stringify({ place: place.name, when: label, api: request.api, route: request.route, ok: !problems.length, problems, fields, for: source?.for }));
  }
process.exit(failed ? 1 : 0);
