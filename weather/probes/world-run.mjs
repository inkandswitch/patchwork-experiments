// The weather reaches the sky, the water and the boat (WEATHER.md, W7), in
// headless Chrome, end to end.
//
//   (in scene/, sailing/, water/, weather/, joints/, traversal/) pnpm build
//   node probes/world-run.mjs [--shots <dir>]      (the caller holds the machine's Chrome lock)
//
// world-probe.html mounts the BUILT scene tool with the BUILT sailing, water,
// weather, joints and traversal plugins, on a manual clock, and makes a sloop
// under way on a Sea by clicking sailing's "Ship at sea" template: her doc is
// the world and carries a `weather` trait. Each case writes the weather's
// fields as the inspector would (one change), and every expectation is this
// package's own pure functions of the doc (weatherParams, atmosphereOf,
// windOf, sunOf, sunDirection, bandAt), evaluated in the page:
//   (a) at 6, 12, 18, 21 and 23 on 15 July at Cadboro Bay (clear): the
//       world's atmosphere is atmosphereOf(the weather) exactly, its sun's
//       direction is W1's sunDirection(sunAt) to 1e-9 and node computes the
//       same from the doc; the viewport's key light shines from along it,
//       at the sun's intensity times the exposure, and its sky is the
//       atmosphere's; the water's sun direction, sun intensity and sky are
//       the atmosphere's. At 23 the sun is more than 12° down: no sun
//       (intensity 0, colour black, no key light, the water's sun at 0) and
//       the exposure is the night band's (W2's BANDS, whose value W2's tables
//       pin: this checks the wiring, not the number);
//   (b) noon, cover 0 then 1: the sky's top changes (in the atmosphere, the
//       viewport and the water alike); the water's uClouds is the clouds
//       field ((0, 0, 1, 1): none, at cover 0); the sun's shadows go off, in
//       the key light too, so the water's scatter takes its overcast third
//       (uScatterGain 1 → 0.35); then a fog (visibility 300 m): no deck;
//   (c) wind 10 m/s from 270, gustiness 0.4 (gusts to 14; not 0.3, the
//       default the weather and sailing share, so a sailing that ignored
//       the weather's gustiness would show): her stage's wind ambient is the
//       weather's (seed included) and her sea's wind is those numbers; the
//       world, held at t = 0 since her doc was made (the frames loading took
//       passed no world time), runs from here, and the true wind at her mast,
//       sampled each second of 60 s of her clock as she sails and averaged
//       as a vector, is 10 ± 1.5 m/s from 270 ± 5°. Held until now, on a
//       fixed seed, the run gives the same numbers every time;
//   Edit is entered as a person does: the body chip, then its menu's Edit.
//   (e) Ucluelet, 15 July 2025 at 15:00, then Fetch for this time on a fake
//       fetch (the committed archive reply): exactly one request, of the
//       fixture's URL; exactly one change to the weather, its source
//       written (Open-Meteo, archive) and it reads fetched; the ambients
//       are those of the fetched weather;
//   (d) her doc linked live into a harbour whose weather differs in every
//       field of the wind (5 m/s from 90, seed 7, gustiness 0.6) and in the
//       sky (09:00, cover 0.6), turned 30°: the world's wind and sky are the
//       harbour's; the wind ambient her linked stage's sailing reads is the
//       harbour's, whole (not hers: mine false), and the wind she sails in,
//       turned back into the world, is the harbour's speed, from and
//       gustiness (not her own);
//   no page errors or warnings.
// Screenshots for the lead: dawn (6), noon (12), afternoon (18), dusk (21),
// night (23), overcast, fog, fetched, harbour. Prints a JSON checklist;
// exits non-zero if any check fails.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";
import { atmosphereOf, sunOf } from "../src/atmosphere.js";
import { sunDirection } from "../src/solar.js";
import { weatherParams } from "../src/weather.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "sailing", "water", "weather", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "world-shots"));
mkdirSync(SHOTS, { recursive: true });

const b = await browser({ root: ROOT, port: 4783, cdp: 9783, page: "/weather/probes/world-probe.html", width: 1200, height: 760, timeout: 900_000 });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const c = checklist();
const { check } = c;
const J = JSON.stringify;
const maxDiff = (a, b) => (a && b && a.length === b.length ? Math.max(...a.map((x, i) => Math.abs(x - b[i]))) : Infinity);
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const report = { shots: [], seen: [], numbers: {} };
const shot = async (name) => { await b.advance(300); report.shots.push(await b.shot(join(SHOTS, `world-${name}.png`))); };
// Chrome's own chatter in headless SwiftShader, not the page's
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;

/** Write fields of the world's weather in one change, then step until the world's atmosphere is the weather's. */
async function dial(fields) {
  await P(`set(${J(fields)})`);
  const settled = await b.soon(`JSON.stringify(window.__p.ambient("atmosphere")) === JSON.stringify(window.__p.expected().atmosphere) && !!window.__p.water() && window.__p.water().skyTop === window.__p.expected().atmosphere.sky.top`, { frames: 120 });
  await b.advance(100);
  return settled;
}

/** The sky, the water and the light against the pure functions of the doc's weather. */
async function agree(label) {
  const e = await P("expected()");
  const atm = await P(`ambient("atmosphere")`);
  const wind = await P(`ambient("wind")`);
  const vp = await P("viewport()");
  const w = await P("water()");
  const want = e.atmosphere;
  // another engine, the same doc: no time-zone data enters the sun (Decision 15), so the two agree but for the last bits (Decision 25)
  const np = weatherParams(await P("weather()"));
  const ns = sunOf(np);
  const ndir = sunDirection(ns.azimuth, ns.apparent);
  check(`${label}: the world's atmosphere is atmosphereOf(the weather), and its wind windOf`, J(atm) === J(want) && J(wind) === J(e.wind), { atm, want, wind, windWant: e.wind });
  check(`${label}: the sun's direction is W1's sunDirection(sunAt) to 1e-9, and node's from the same doc`, maxDiff(atm?.sun?.direction, e.direction) <= 1e-9 && maxDiff(ndir, e.direction) <= 1e-9, { got: atm?.sun?.direction, want: e.direction, node: ndir });
  const from = unit(vp.key.from);
  check(`${label}: the viewport's sky is the atmosphere's, its key light shines from along the sun at the sun's intensity × exposure, shadows as the sun's`, J(vp.sky) === J(want.sky) && maxDiff(from, e.direction) <= 1e-9 && Math.abs(vp.key.intensity - want.sun.intensity * want.exposure) <= 1e-12 && vp.key.shadows === want.sun.shadows, { vp, from, want: { sky: want.sky, dir: e.direction, intensity: want.sun.intensity * want.exposure, shadows: want.sun.shadows } });
  check(`${label}: the water's sun (direction, intensity) and sky (top, horizon) are the atmosphere's`, !!w && w.sunOn === 1 && maxDiff(w.sunDir, e.direction) <= 1e-9 && w.sunIntensity === want.sun.intensity && w.skyTop === want.sky.top && w.skyHorizon === want.sky.horizon, { water: w, want: { dir: e.direction, intensity: want.sun.intensity, sky: want.sky } });
  const seen = { label, hour: e.params.hour, cover: e.params.cover, visibility: e.params.visibility, azimuth: e.sun.azimuth, geometric: e.sun.geometric, exposure: want.exposure, intensity: want.sun.intensity, sun: want.sun.color, shadows: want.sun.shadows, sky: want.sky, clouds: want.clouds ?? null, water: w && { clouds: w.clouds, scatterGain: w.scatterGain } };
  report.seen.push(seen);
  return { e, atm, vp, w };
}

let code = 1;
try {
  await b.waitFor(`window.__ready === true`, 120_000);
  const setup = await P("errors");
  check("the page mounts with no errors", setup.length === 0, setup);
  const built = await P("build()", 300_000);
  check("Ship at sea makes a sloop on a Sea whose doc carries a weather, and its stage runs sailing, water and weather", !!built.hull && !!built.mast && !!built.weather && ["sailing", "water", "weather"].every((x) => built.running.includes(x)), built);
  check("her world is held at t = 0 (her doc was made with its clock paused), on the fixed seed", built.clock.t === 0 && built.clock.running === false && built.weather.seed === 4242, { clock: built.clock, seed: built.weather.seed });

  // ─── (a) the sun through the day, clear, at Cadboro Bay ─────────────────
  const BASE = { lat: 48.454, lon: -123.2915, offset: -7, date: "2026-07-15", cover: 0, rain: 0, visibility: 30000, wind: 10, from: 270, gustiness: 0.3 };
  const day = {};
  for (const [hour, name] of [[6, "dawn"], [12, "noon"], [18, "afternoon"], [21, "dusk"], [23, "night"]]) {
    check(`hour ${hour}: the world settles on the weather`, await dial({ ...BASE, hour }), hour);
    day[hour] = await agree(`hour ${hour}`);
    await shot(name);
  }
  {
    const { e, atm, vp, w } = day[23];
    const noon = day[12].atm;
    check("hour 23: the sun is below the night band's edge (−12°), so it gives no light: intensity 0, colour black, no key light, the water's sun at 0", e.sun.geometric < e.night.at && atm.sun.intensity === 0 && atm.sun.color === "#000000" && vp.key.intensity === 0 && w.sunIntensity === 0, { geometric: e.sun.geometric, sun: atm.sun, key: vp.key, water: w });
    check("hour 23: the exposure is the night band's, that fraction of noon's (the same sky, the day band at noon)", e.band.exposure === e.night.exposure && Math.abs(atm.exposure / noon.exposure - e.night.exposure) <= 1e-12 && day[12].e.band.exposure === 1, { night: atm.exposure, noon: noon.exposure, band: e.band, nightBand: e.night });
    // solar noon at 123.3° W on UTC-7 in mid-July is about 13:20, and sunset about 21:10
    const hs = [6, 12, 18, 21, 23];
    check("the sun moves with the hour: its azimuth grows hour by hour, east of south at 6 and 12, west at 18, 21 and 23; up from 6 to 21, down at 23", hs.every((x, i) => i === 0 || day[x].e.sun.azimuth > day[hs[i - 1]].e.sun.azimuth) && day[6].e.sun.azimuth < 90 && day[12].e.sun.azimuth < 180 && day[18].e.sun.azimuth > 180 && [6, 12, 18, 21].every((x) => day[x].e.sun.geometric > 0) && day[23].e.sun.geometric < 0, Object.fromEntries(Object.entries(day).map(([h, d]) => [h, [d.e.sun.azimuth, d.e.sun.geometric]])));
  }

  // ─── (b) cloud cover at noon, then a fog ─────────────────────────────────
  check("noon, cover 0: settles", await dial({ ...BASE, hour: 12, cover: 0 }), null);
  const clear = await agree("noon, cover 0");
  check("noon, cover 0: no deck; the water's uClouds is none (0, 0, 1, 1); the sun casts shadows, so the scatter is whole (1)", !clear.atm.clouds && J(clear.w.clouds) === J([0, 0, 1, 1]) && clear.atm.sun.shadows === true && clear.w.scatterGain === 1, { clouds: clear.atm.clouds ?? null, water: clear.w, sun: clear.atm.sun });
  check("noon, cover 1: settles", await dial({ cover: 1 }), null);
  const overcast = await agree("noon, cover 1");
  const k = overcast.atm.clouds;
  check("noon, cover 1: the sky's top changes, in the atmosphere, the viewport and the water", overcast.atm.sky.top !== clear.atm.sky.top && overcast.vp.sky.top === overcast.atm.sky.top && overcast.w.skyTop === overcast.atm.sky.top, { clear: clear.atm.sky.top, overcast: overcast.atm.sky.top });
  check("noon, cover 1: the water's uClouds is the clouds field (cover, contrast, scale, base)", !!k && J(overcast.w.clouds) === J([k.cover, k.contrast, k.scale, k.base]), { clouds: k, uClouds: overcast.w.clouds });
  check("noon, cover 1: the sun's shadows go off (the atmosphere's and the key light's), so the water's scatter takes its overcast third (0.35)", overcast.atm.sun.shadows === false && overcast.vp.key.shadows === false && overcast.w.scatterGain === 0.35, { sun: overcast.atm.sun, key: overcast.vp.key, scatterGain: overcast.w.scatterGain });
  await shot("overcast");
  check("fog (visibility 300 m): settles", await dial({ visibility: 300 }), null);
  const fog = await agree("fog, 300 m");
  check("fog: the atmosphere's fog closes in under 300 m and has no deck; the viewport draws it in the horizon's colour; the water's uClouds is none", fog.atm.fog.far <= 300 && !fog.atm.clouds && fog.vp.sceneFog === fog.atm.fog.color && fog.atm.fog.color === fog.atm.sky.horizon && J(fog.w.clouds) === J([0, 0, 1, 1]), { fog: fog.atm.fog, sceneFog: fog.vp.sceneFog, clouds: fog.atm.clouds ?? null, uClouds: fog.w.clouds });
  await shot("fog");

  // ─── (c) her true wind at the mast over 60 s ─────────────────────────────
  check("wind 10 from 270, gustiness 0.4, clear noon: settles", await dial({ ...BASE, hour: 12, gustiness: 0.4 }), null);
  await b.soon(`window.__p.mastWind()?.mean.speed === 10 && window.__p.mastWind()?.mean.from === 270 && window.__p.mastWind()?.mean.gustiness === 0.4`, { frames: 60 });
  const m0 = await P("mastWind()");
  const wa = await P(`ambient("wind")`);
  check("her sea's wind is the weather's: 10 m/s from 270, gustiness 0.4 (gusts to 14), the world's wind ambient, which her stage's sailing reads as its own (seed included)", m0?.mean.speed === 10 && Math.abs(m0.mean.from - 270) <= 1e-9 && m0.mean.gustiness === 0.4 && wa.speed === 10 && wa.from === 270 && wa.gustiness === 0.4 && wa.seed === 4242 && m0.ambient.mine === true && J(m0.ambient.value) === J(wa), { mean: m0?.mean, ambient: wa, read: m0?.ambient });
  const held = await P("clock()");
  check("still held at t = 0 after (a), (b) and the settling: then the clock chip's ▶ runs it", held.t === 0 && held.running === false && (await P("resume()")) === 0, held);
  const samples = [];
  for (let s = 0; s < 60; s++) {
    await b.advance(1000);
    samples.push(await P("mastWind()"));
  }
  const mv = [0, 1].map((i) => samples.reduce((a, x) => a + x.v[i], 0) / samples.length);
  const speeds = samples.map((x) => Math.hypot(...x.v));
  const meanSpeed = Math.hypot(...mv);
  const meanFrom = ((Math.atan2(-mv[0], mv[1]) * 180) / Math.PI + 360) % 360;
  const travelled = Math.hypot(samples.at(-1).at[0] - samples[0].at[0], samples.at(-1).at[1] - samples[0].at[1]);
  report.numbers.mastWind = { meanSpeed, meanFrom, scalarMean: speeds.reduce((a, x) => a + x, 0) / speeds.length, min: Math.min(...speeds), max: Math.max(...speeds), seconds: samples.at(-1).t - samples[0].t + 1, travelled };
  check("her clock ran the 60 s, and she sailed (moved more than 30 m)", Math.abs(report.numbers.mastWind.seconds - 60) < 0.05 && travelled > 30, report.numbers.mastWind);
  check("the true wind at her mast over 60 s averages 10 ± 1.5 m/s from 270 ± 5°", Math.abs(meanSpeed - 10) <= 1.5 && Math.abs(meanFrom - 270) <= 5, report.numbers.mastWind);
  check("and it gusts: the samples are not all the mean", report.numbers.mastWind.max - report.numbers.mastWind.min > 0.5, report.numbers.mastWind);

  // ─── (e) Fetch for this time, on a fake fetch ────────────────────────────
  // the fixture's moment: Ucluelet, 15 July 2025 15:00 on UTC-7 (the archive)
  check("Ucluelet, 15 July 2025 at 15:00: settles", await dial({ lat: 48.95, lon: -125.558, offset: -7, date: "2025-07-15", hour: 15 }), null);
  // the weather's commands are editing commands: the editor picked up as a person does (her template left her in Look, not editing): Edit, beside the body chip
  {
    const was = await P("editing()");
    const toggle = await P("editToggle()");
    if (toggle) await b.click(toggle.x, toggle.y);
    await b.soon(`window.__p.editing()`, { frames: 60 });
    check("the editor picked up by Edit beside the body chip, from Look", was === false && !!toggle && (await P("editing()")) && (await P("body()")) === "look", { was, toggle, now: await P("body()") });
  }
  const before = await P("weather()");
  const changes0 = await P("weatherChanges()");
  await b.soon(`window.__p.toolbar().some((t) => t.command === "fetch" && !t.disabled)`, { frames: 60 });
  const fetchBtn = (await P("toolbar()")).find((t) => t.command === "fetch");
  check("the toolbar shows Fetch for this time", fetchBtn?.text === "Fetch for this time" && !fetchBtn.disabled, await P("toolbar()"));
  if (fetchBtn) await b.click(fetchBtn.rect.x, fetchBtn.rect.y);
  await b.soon(`!!window.__p.weather().source || window.__p.notices().some(([k]) => k === "error")`, { frames: 600 });
  await b.advance(500);
  const fetched = await P("weather()");
  const calls = await P("fetches()");
  const fixture = await P("fixture");
  const ex = await P("expected()");
  check("Fetch for this time makes exactly one request, of the fixture's URL (Open-Meteo's archive at Ucluelet's moment)", calls.length === 1 && calls[0] === fixture.url, { calls, fixture: fixture.url });
  check("exactly one change to the weather", (await P("weatherChanges()")) - changes0 === 1, { changes: (await P("weatherChanges()")) - changes0 });
  check("its source written (Open-Meteo, archive, for 15:00 on 15 July 2025 at Ucluelet), and the weather reads fetched", !before.source && fetched.source?.name === "Open-Meteo" && fetched.source?.api === "archive" && Date.parse(fetched.source?.for) === fixture.at && ex.provenance === "fetched" && fetched.lat === 48.95 && fetched.date === "2025-07-15" && fetched.hour === 15 && fetched.seed === before.seed, { before, fetched });
  check("the fetched weather is not the dialled one (the archive's wind and sky)", ["wind", "from", "cover"].some((x) => fetched[x] !== before[x]), { before, fetched });
  check("a notice says it", (await P("notices()")).some(([kind, t]) => kind === "info" && t.startsWith("Weather fetched from Open-Meteo (archive) for ")), await P("notices()"));
  await b.soon(`JSON.stringify(window.__p.ambient("atmosphere")) === JSON.stringify(window.__p.expected().atmosphere)`, { frames: 120 });
  await agree("fetched");
  await shot("fetched");
  const own = await P("weather()");

  // ─── (d) linked into a harbour whose weather differs ─────────────────────
  const h = await P("harbour()", 300_000);
  check("the harbour opens her stage (running sailing) and runs water and weather itself", h.ok, h);
  await b.soon(`JSON.stringify(window.__p.ambient("atmosphere")) === JSON.stringify(window.__p.expected().atmosphere)`, { frames: 120 });
  await b.advance(500);
  const hw = await P(`ambient("wind")`);
  const hx = await P("expected()");
  check("the world's wind is the harbour's weather (5 m/s from 90, seed 7), not hers", J(hw) === J(hx.wind) && hw.speed === 5 && hw.from === 90 && hw.seed === 7 && hw.speed !== own.wind, { world: hw, hers: { wind: own.wind, from: own.from, seed: own.seed } });
  const harbourSky = await agree("the harbour");
  check("the sky is the harbour's (09:00, cover 0.6), not hers", J(harbourSky.atm) === J(hx.atmosphere) && hx.params.hour === 9 && hx.params.cover === 0.6 && harbourSky.atm.sky.top !== atmosphereOf(weatherParams(own)).sky.top, { harbour: harbourSky.atm.sky, hers: atmosphereOf(weatherParams(own)).sky });
  const linked = await P(`mastWind("LB")`);
  check("the harbour's wind differs from hers in every field (speed, from, seed, gustiness)", ["speed", "from", "seed", "gustiness"].every((x) => hw[x] !== own[x === "speed" ? "wind" : x]) && hw.gustiness === 0.6, { harbour: hw, hers: own });
  check("her linked stage's sailing reads the harbour's wind ambient, whole (speed, from, seed, gustiness), not its own", linked?.ambient.mine === false && J(linked.ambient.value) === J(hw), { read: linked?.ambient, harbour: hw });
  check("she sails in the harbour's wind: her sea's wind, turned back into the world, is 5 m/s from 90, gustiness 0.6 (not her own)", linked?.mean.speed === 5 && Math.abs(linked.mean.from - 90) <= 1e-9 && linked.mean.gustiness === 0.6, { linked: linked?.mean, own: { wind: own.wind, from: own.from, gustiness: own.gustiness } });
  await shot("harbour");

  const errs = (await P("errors")).filter((x) => !EXPECTED.test(x));
  check("no page errors or warnings", errs.length === 0, errs.slice(0, 10));
  code = c.failed ? 1 : 0;
} catch (err) {
  check(`ran to the end (${err.message})`, false, String(err?.stack || err));
}
console.log(J({ checks: c.checks, details: c.details, ...report }, null, 1));
b.stop(code);
