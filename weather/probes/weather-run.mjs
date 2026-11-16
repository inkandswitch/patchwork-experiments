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
// - the same functions in node, from the same doc, for comparison: the
//   direction across engines (to 1e-9; Decision 25 expects the last bit to
//   differ), and each engine's time-zone offset for the weather's zone at
//   a few instants (Decision 15: peers agree only where their zone data
//   does). These are reported under "findings", not checked;
// - the toolbar shows the Place picker (Cadboro Bay chosen, its tooltip the
//   provenance) and the Now button; picking Ucluelet writes Ucluelet's
//   place, lat and lon and moves the sun to Ucluelet's; Now writes the
//   present minute in the zone;
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
import { localOf, offsetAt } from "../src/time.js";
import { weatherParams, windOf } from "../src/weather.js";

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
  c.check("the scene opens in Edit", (await P("body()")) === "edit", await P("body()"));

  /** The view's ambients against the pure functions of the doc's trait, and the key light against the sun. */
  async function agree(label) {
    const e = await P("expected()");
    const p = e.params;
    const want = e.atmosphere;
    const sun = e.sun;
    const dir = e.direction;
    // the same in node (another engine, maybe other zone data): reported, not checked
    const np = weatherParams(await P("weather()"));
    const nsun = sunOf(np);
    const ndir = sunDirection(nsun.azimuth, nsun.apparent);
    crossEngine.push({ label, nodeVsPage: maxDiff(ndir, dir), atmosphereSame: JSON.stringify(atmosphereOf(np)) === JSON.stringify(want) });
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
    return { hour: p.hour, place: p.place, azimuth: sun.azimuth, apparent: sun.apparent, geometric: sun.geometric, direction: dir, intensity: atm?.sun?.intensity, exposure: atm?.exposure, sky: atm?.sky, key: { intensity: k.intensity, color: k.color, shadows: k.shadows } };
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

  // the toolbar: Place (a picker, Cadboro Bay chosen, the provenance its tooltip) and Now
  await b.waitFor(`window.__p.toolbar().some((t) => t.ext === "weather")`, 10_000).catch(() => {});
  const bar = (await P("toolbar()")).filter((t) => t.ext === "weather");
  const place = bar.find((t) => t.command === "place");
  const now = bar.find((t) => t.command === "now");
  c.check("the toolbar shows Place as a picker: Cadboro Bay chosen, Cadboro Bay and Ucluelet offered", place?.tag === "select" && place.text === "Cadboro Bay" && JSON.stringify(place.options) === JSON.stringify(["Cadboro Bay", "Ucluelet"]), place);
  c.check("Place's tooltip is the provenance", place?.title === "Weather: dialled by hand", place?.title);
  c.check("the toolbar shows Now as a button", now?.tag === "button" && now.text === "Now", now);

  await P(`pick("place", "Ucluelet")`);
  await b.waitFor(`window.__p.weather().place === "Ucluelet"`, 5_000).catch(() => {});
  const w = await P("weather()");
  c.check("picking Ucluelet writes Ucluelet's place, lat and lon (the zone was already its)", w.place === "Ucluelet" && w.lat === 48.95 && w.lon === -125.558 && w.zone === "America/Vancouver", w);
  seen.push(await agree("Ucluelet at 21:00"));
  c.check("Ucluelet's sun is not Cadboro's at the same hour", maxDiff(seen.at(-1).direction, nightish.direction) > 1e-4, [seen.at(-1).direction, nightish.direction]);

  const t0 = Date.now();
  await b.click(now.rect.x, now.rect.y);
  await b.waitFor(`window.__p.weather().hour !== 21`, 5_000).catch(() => {});
  const t1 = Date.now();
  const after = await P("weather()");
  const lo = await P(`localOf(${Math.floor(t0 / 60_000) * 60_000}, "America/Vancouver")`);
  const hi = await P(`localOf(${Math.floor(t1 / 60_000) * 60_000}, "America/Vancouver")`);
  c.check("Now (clicked) writes the present minute in the zone", [lo, hi].some((x) => x.date === after.date && x.hour === after.hour), { after: { date: after.date, hour: after.hour }, lo, hi });
  seen.push(await agree("Now"));

  // the scene inspector: the Weather behaviour, its fields, and no scene commands
  const inspectorBtn = (await P("toolbar()")).find((t) => t.command === "inspector");
  if (inspectorBtn) await b.click(inspectorBtn.rect.x, inspectorBtn.rect.y);
  await b.waitFor(`!!window.__p.inspector()`, 5_000).catch(() => {});
  const ins = await P("inspector()");
  const wb = ins?.behaviours?.find((x) => x.trait === "weather");
  c.check("the scene inspector shows the Weather behaviour with its 15 fields", ins?.kind === "scene" && wb?.name === "Weather" && wb.fields === 15, ins);
  c.check("the scene inspector shows no weather commands (Decision 28: the toolbar carries them)", !!ins && !ins.commands.some((x) => x.startsWith("weather/")), ins?.commands);
  await b.shot(join(SHOTS, "weather-edit-toolbar-inspector.png"));

  // findings: each engine's offset for the weather's zone at a few instants (Decision 15)
  const instants = ["2026-07-15T22:00:00Z", "2026-11-01T12:00:00Z", "2026-11-16T21:00:00Z", "2027-01-15T21:00:00Z", "2027-07-15T22:00:00Z"];
  const zones = [];
  for (const iso of instants) {
    const t = Date.parse(iso);
    const page = await P(`offsetAt("America/Vancouver", ${t})`);
    const node = offsetAt("America/Vancouver", t);
    zones.push({ at: iso, pageHours: page / 3_600_000, nodeHours: node / 3_600_000, agree: page === node });
  }
  const findings = { engines: { page: await P("icu()"), node: `node ${process.versions.node}, icu ${process.versions.icu}, tz ${process.versions.tz}` }, vancouverOffsets: zones, crossEngine };

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
