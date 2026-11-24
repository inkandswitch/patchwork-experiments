// The weather extension in the built scene tool, in headless Chrome (W3).
//
//   (in scene/ and weather/) pnpm build
//   node probes/weather-run.mjs [--shots <dir>]      (the caller holds the machine's Chrome lock)
//
// Mounts the BUILT scene tool with the BUILT weather plugin on a scene whose
// only trait is `weather` (index.js's init), opened in Edit. Then:
// - the extension runs, and the world's `wind` and `atmosphere` are exactly
//   the pure functions of the trait (weather.js windOf, atmosphere.js
//   atmosphereOf), evaluated in the page from the doc: the same engine and
//   time-zone data as the stage's, so exact JSON equality;
// - at hours 9, 15 and 21 (a field written as a slider writes it) the sun's
//   direction is solar.js's sunDirection to 1e-9, and the viewport's key
//   light shines from along it (position - target, to 1e-9);
// - the same functions in node, from the same doc: the sun's direction to
//   1e-9 (Decision 15: no time-zone data enters it, so two engines agree
//   but for the last bit, Decision 25), at every hour checked, a winter
//   date among them;
// - the toolbar shows the Place picker (Cadboro Bay chosen) and the Now
//   and Fetch for this time buttons, and no Fetch now (Decision 42);
//   picking Ucluelet writes
//   Ucluelet's lat and lon and moves the sun to Ucluelet's; Now writes the
//   present quarter hour on the weather's clock;
// - Now then Fetch for this time (W4), on the real network: one fetch, of
//   the present conditions, at a URL whose keys are the whitelist, with no credentials and no referrer; one write of the
//   snapshot and its source; the label then reads "Fetched for this time",
//   a notice says it, and the ambients are those of the fetched weather;
// - Fetch for this time, answered by an error reply: a notice, and the doc
//   as it was;
// - a second scene with a weather of its own, linked in and then entered:
//   the world's wind stays the outermost's, and the toolbar still shows
//   one each of the three commands, the outermost's (Decision 31);
// - the scene inspector (the toolbar's Inspector, nothing selected) shows
//   the Weather behaviour with its fields and none of weather's commands:
//   the scene inspector shows no scene commands (Decision 28);
// - no page errors or warnings.
// Prints a JSON checklist; exits non-zero if any check fails.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";
import { atmosphereOf, sunOf } from "../src/atmosphere.js";
import { sunDirection } from "../src/solar.js";
import { localOf } from "../src/time.js";
import { provenance, weatherParams, windOf } from "../src/weather.js";
import { QUERY } from "../src/open-meteo.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene/dist/index.js", "weather/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "weather-shots"));
mkdirSync(SHOTS, { recursive: true });

const b = await browser({ root: ROOT, port: 4781, cdp: 9781, page: "/weather/probes/weather-probe.html", width: 1200, height: 760, timeout: 300_000 });
const c = checklist();
const P = (e) => b.js(`window.__p.${e}`);
const maxDiff = (a, b) => (a && b && a.length === b.length ? Math.max(...a.map((x, i) => Math.abs(x - b[i]))) : Infinity);
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

let code = 1;
try {
  await b.waitFor(`!!window.__p && (window.__p.errors.length > 0 || (window.__p.running?.().includes("weather") && !!window.__p.ambient("atmosphere")))`, 60_000);
  const setup = await P("errors");
  c.check("the page mounts with no errors", setup.length === 0, setup);
  c.check("the weather extension runs", (await P("running()")).includes("weather"), await P("running()"));
  c.check("the scene opens holding the editor", (await P("editing()")) === true, await P("body()"));

  /** The view's ambients against the pure functions of the doc's trait, and the key light against the sun. */
  async function agree(label) {
    const e = await P("expected()");
    const p = e.params;
    const want = e.atmosphere;
    const sun = e.sun;
    const dir = e.direction;
    // the same in node, another engine: no time-zone data enters the sun, so the two agree to the last bits
    const np = weatherParams(await P("weather()"));
    const nsun = sunOf(np);
    const ndir = sunDirection(nsun.azimuth, nsun.apparent);
    crossEngine.push({ label, nodeVsPage: maxDiff(ndir, dir), atmosphereSame: JSON.stringify(atmosphereOf(np)) === JSON.stringify(want) });
    c.check(`${label}: node computes the same sun from the doc, to 1e-9`, maxDiff(ndir, dir) <= 1e-9, { node: ndir, page: dir });
    await b.waitFor(`JSON.stringify(window.__p.ambient("atmosphere")) === ${JSON.stringify(JSON.stringify(want))}`, 10_000).catch(() => {});
    const atm = await P(`ambient("atmosphere")`);
    const wind = await P(`ambient("wind")`);
    c.check(`${label}: atmosphere is atmosphereOf(the doc's weather)`, JSON.stringify(atm) === JSON.stringify(want), { atm, want });
    c.check(`${label}: wind is windOf(the doc's weather)`, JSON.stringify(wind) === JSON.stringify(e.wind), { wind, want: e.wind });
    c.check(`${label}: wind is the doc's own numbers, the same in node`, JSON.stringify(wind) === JSON.stringify(windOf(np)), { wind, node: windOf(np) });
    const dSun = maxDiff(atm?.sun?.direction, dir);
    c.check(`${label}: sun direction is sunDirection(sunAt) to 1e-9`, dSun <= 1e-9, { got: atm?.sun?.direction, want: dir, diff: dSun });
    // the key light moves to its shadow frame on the next draw: wait for it to settle along the sun
    await b.waitFor(`(() => { const k = window.__p.key(); const v = k.position.map((x, i) => x - k.target[i]); const n = Math.hypot(...v); const d = ${JSON.stringify(dir)}; return Math.max(...v.map((x, i) => Math.abs(x / n - d[i]))) <= 1e-9; })()`, 5_000).catch(() => {});
    const k = await P("key()");
    const from = unit(k.position.map((x, i) => x - k.target[i]));
    const dKey = maxDiff(from, dir);
    c.check(`${label}: the viewport's key light shines from along the sun to 1e-9`, dKey <= 1e-9, { from, dir, diff: dKey, key: k });
    return { hour: p.hour, date: p.date, lat: p.lat, lon: p.lon, azimuth: sun.azimuth, apparent: sun.apparent, geometric: sun.geometric, direction: dir, intensity: atm?.sun?.intensity, exposure: atm?.exposure, sky: atm?.sky, key: { intensity: k.intensity, color: k.color, shadows: k.shadows } };
  }

  const crossEngine = [];
  const seen = [];
  seen.push(await agree("init (15:00)"));
  for (const h of [9, 15, 21]) {
    await P(`set("hour", ${h})`);
    seen.push(await agree(`hour ${h}`));
    await sleep(400);
    await b.shot(join(SHOTS, `weather-hour-${h}.png`));
  }
  const nine = seen[1], three = seen[2], nightish = seen[3];
  c.check("the sun moves with the hour: east of south at 9, west at 15 and 21", nine.azimuth < 180 && three.azimuth > 180 && nightish.azimuth > three.azimuth, seen.map((s) => [s.hour, s.azimuth]));

  // the toolbar: Place (a picker, Cadboro Bay chosen), Now and Fetch for this time
  await b.waitFor(`window.__p.toolbar().some((t) => t.ext === "weather")`, 10_000).catch(() => {});
  const bar = (await P("toolbar()")).filter((t) => t.ext === "weather");
  const place = bar.find((t) => t.command === "place");
  const now = bar.find((t) => t.command === "now");
  c.check("the toolbar shows Place as a picker: Cadboro Bay chosen, Cadboro Bay and Ucluelet offered", place?.tag === "select" && place.text === "Cadboro Bay" && JSON.stringify(place.options) === JSON.stringify(["Cadboro Bay", "Ucluelet"]), place);
  c.check("Place's tooltip says what picking does", place?.title === "Where the weather is: picking a place moves it there, at the same hour on its clock", place?.title);
  c.check("the toolbar shows Now as a button", now?.tag === "button" && now.text === "Now", now);
  const fetchBtn = bar.find((t) => t.command === "fetch");
  c.check("the toolbar shows Fetch for this time as a button, its tooltip the provenance", fetchBtn?.tag === "button" && fetchBtn.text === "Fetch for this time" && fetchBtn.title.startsWith("Weather: dialled by hand. Fetch Open-Meteo's conditions at "), fetchBtn);
  c.check("in that order, after Place and Now, and no Fetch now (Now then Fetch is it: Decision 42)", bar.map((t) => t.command).join() === "place,now,fetch", bar.map((t) => t.command));

  // a winter date: the sun the same in node and the page (the zone-data disagreement W3 found is gone by construction)
  await P(`set("date", "2026-12-15")`);
  seen.push(await agree("15 December, 21:00"));
  await P(`set("date", "2026-07-15")`);

  await P(`pick("place", "Ucluelet")`);
  await b.waitFor(`window.__p.weather().lat === 48.95`, 5_000).catch(() => {});
  const w = await P("weather()");
  c.check("picking Ucluelet writes Ucluelet's lat and lon (the clock was already its, UTC-7)", w.lat === 48.95 && w.lon === -125.558 && w.offset === -7 && !("place" in w) && !("zone" in w), w);
  seen.push(await agree("Ucluelet at 21:00"));
  c.check("Ucluelet's sun is not Cadboro's at the same hour", maxDiff(seen.at(-1).direction, nightish.direction) > 1e-4, [seen.at(-1).direction, nightish.direction]);

  const t0 = Date.now();
  await b.click(now.rect.x, now.rect.y);
  await b.waitFor(`window.__p.weather().hour !== 21`, 5_000).catch(() => {});
  const t1 = Date.now();
  const after = await P("weather()");
  const Q = 15 * 60_000;
  const lo = await P(`localOf(${Math.floor(t0 / Q) * Q}, -7)`);
  const hi = await P(`localOf(${Math.floor(t1 / Q) * Q}, -7)`);
  c.check("Now (clicked) writes the present quarter hour on the weather's clock (UTC-7)", [lo, hi].some((x) => x.date === after.date && x.hour === after.hour) && Number.isInteger(after.hour * 4), { after: { date: after.date, hour: after.hour }, lo, hi });
  seen.push(await agree("Now"));

  // Now (above), then Fetch for this time, on the real network: the present conditions
  const before = await P("weather()");
  await b.waitFor(`window.__p.toolbar().find((t) => t.command === "fetch")?.title?.includes(${JSON.stringify(before.date)})`, 5_000).catch(() => {});
  const fn = (await P("toolbar()")).find((t) => t.command === "fetch");
  await b.click(fn.rect.x, fn.rect.y);
  await b.waitFor(`!!window.__p.weather().source || window.__p.notices().some(([k]) => k === "error")`, 20_000).catch(() => {});
  const fetched = await P("weather()");
  const calls = await P("fetches()");
  c.check("Fetch for this time, after Now, makes exactly one fetch", calls.length === 1, calls);
  const url = calls[0] && new URL(calls[0][0]);
  c.check("of Open-Meteo's present conditions, the URL's keys exactly the whitelist", url?.origin === "https://api.open-meteo.com" && JSON.stringify([...url.searchParams.keys()]) === JSON.stringify(QUERY.current) && url.searchParams.get("latitude") === "48.95" && url.searchParams.get("longitude") === "-125.558", calls[0]?.[0]);
  c.check("with no credentials and no referrer", JSON.stringify(calls[0]?.[1]) === JSON.stringify({ signal: "AbortSignal", credentials: "omit", referrerPolicy: "no-referrer" }), calls[0]?.[1]);
  c.check("one write: the snapshot and its source (Open-Meteo, forecast), and it reads fetched", fetched.source?.name === "Open-Meteo" && fetched.source?.api === "forecast" && provenance(fetched) === "fetched" && fetched.lat === 48.95 && fetched.seed === before.seed && fetched.date === before.date && fetched.hour === before.hour, { before, fetched });
  c.check("source.for is the present conditions' own time, within 30 minutes of the press", Math.abs(Date.parse(fetched.source?.for) - Date.parse(fetched.source?.fetched)) <= 30 * 60_000, fetched.source);
  c.check("a notice says it", (await P("notices()")).some(([k, t]) => k === "info" && t.startsWith("Weather fetched from Open-Meteo (forecast) for ")), await P("notices()"));
  await b.waitFor(`window.__p.toolbar().find((t) => t.command === "fetch")?.text === "Fetched for this time"`, 5_000).catch(() => {});
  const label = (await P("toolbar()")).find((t) => t.command === "fetch");
  c.check("Fetch for this time's label now reads Fetched for this time", label?.text === "Fetched for this time", label);
  seen.push(await agree("fetched"));
  await b.shot(join(SHOTS, "weather-fetched.png"));

  // Fetch for this time, refused: a notice, and nothing written
  await P(`setFetch("error")`);
  const refusedBefore = JSON.stringify(await P("weather()"));
  await b.click(label.rect.x, label.rect.y);
  await b.waitFor(`window.__p.notices().some(([k]) => k === "error")`, 5_000).catch(() => {});
  c.check("Fetch for this time, refused: an error notice with the reason", (await P("notices()")).some(([k, t]) => k === "error" && t === "Couldn't fetch the weather: the probe refused it"), await P("notices()"));
  c.check("and the doc's weather as it was", JSON.stringify(await P("weather()")) === refusedBefore);
  c.check("two fetches in all, one per press", (await P("fetches()")).length === 2, (await P("fetches()")).length);

  // a linked world with a weather of its own: not the world's (the outermost rule), so neither its wind nor its commands
  const windBefore = await P(`ambient("wind")`);
  const linkId = await P("linkBoat()");
  c.check("a second scene with its own weather (12 m/s from 90) links in and runs the weather extension", typeof linkId === "string", linkId);
  await sleep(300);
  c.check("the world's wind is still the outermost's", JSON.stringify(await P(`ambient("wind")`)) === JSON.stringify(windBefore), { now: await P(`ambient("wind")`), before: windBefore });
  const entered = await P(`enter(${JSON.stringify(linkId)})`);
  await b.waitFor(`window.__p.focus().length === 1`, 5_000).catch(() => {});
  c.check("Enter moves the focus into the linked world", entered && (await P("focus()")).length === 1, await P("focus()"));
  await sleep(300);
  const inside = (await P("toolbar()")).filter((t) => t.ext === "weather");
  c.check("inside the linked world the toolbar shows one of each command (the outermost's), not the linked weather's too", inside.map((t) => t.command).sort().join() === "fetch,now,place", inside.map((t) => [t.command, t.text]));
  c.check("its Place shows the world's weather (Ucluelet), not the linked world's (Cadboro Bay)", inside.find((t) => t.command === "place")?.text === "Ucluelet", inside);
  c.check("the world's wind is still the outermost's, inside", JSON.stringify(await P(`ambient("wind")`)) === JSON.stringify(windBefore), await P(`ambient("wind")`));
  await b.shot(join(SHOTS, "weather-linked-entered.png"));
  // back out to the outermost, for the inspector below
  await b.js(`document.querySelector(".scene-stage").__sceneDebug.view.leave()`);
  await b.waitFor(`window.__p.focus().length === 0`, 5_000).catch(() => {});

  // the scene inspector: the Weather behaviour, its fields, and no scene commands
  const inspectorBtn = (await P("toolbar()")).find((t) => t.command === "inspector");
  if (inspectorBtn) await b.click(inspectorBtn.rect.x, inspectorBtn.rect.y);
  await b.waitFor(`!!window.__p.inspector()`, 5_000).catch(() => {});
  const ins = await P("inspector()");
  const wb = ins?.behaviours?.find((x) => x.trait === "weather");
  c.check("the scene inspector shows the Weather behaviour with its 14 fields", ins?.kind === "scene" && wb?.name === "Weather" && wb.fields === 14, ins);
  c.check("the scene inspector shows no weather commands (Decision 28: the toolbar carries them)", !!ins && !ins.commands.some((x) => x.startsWith("weather/")), ins?.commands);
  await b.shot(join(SHOTS, "weather-edit-toolbar-inspector.png"));

  const findings = { engines: { page: await P("engine()"), node: `node ${process.versions.node}` }, crossEngine };

  const errors = await P("errors");
  c.check("no page errors or warnings", errors.length === 0, errors);
  console.log(JSON.stringify({ checks: c.checks, details: c.details, seen, findings, shots: SHOTS }, null, 1));
  code = c.failed ? 1 : 0;
} catch (e) {
  console.error(e);
  console.log(JSON.stringify({ checks: c.checks, details: c.details, error: String(e?.stack ?? e) }));
} finally {
  b.stop(code);
}
