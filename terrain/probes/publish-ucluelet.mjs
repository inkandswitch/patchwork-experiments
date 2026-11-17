// Publish "Ucluelet" to a real sync server and print its Patchwork URL: the
// waters in and around Ucluelet, from open data, with Rising Tide Boat
// Works' boatyard at the old seaplane base, the stock sloop at anchor off
// the planned dock, people starting in Look at a home view over the
// boatyard. A copy of publish-rvyc.mjs for this place.
//
//   (in scene/, sailing/, water/, weather/ and terrain/) pnpm build
//   node probes/publish-ucluelet.mjs [--dry-run] [--sync wss://…] [--settle 8000] [--cache <dir>] [--seed <dir>] [--shots <dir>] (--lock <dir> | $CHROME_LOCK) [--show] [--gpu]
//
// Makes NEW docs on every run (no dedupe).
//
// 1. The data: probes/fetch-ucluelet.mjs fetches (or replays its recording
//    in --cache; --seed records from downloads already made) and checks it.
// 2. The scene, made the way a person makes it: in headless Chrome, the
//    BUILT scene, sailing, water, weather and terrain plugins on an EMPTY scene
//    (ucluelet-probe.html, an in-memory repo); the start screen's "Ucluelet
//    (Rising Tide Boat Works)" is clicked, its fetches answered from the
//    recording. Chrome runs only while holding the lock (--lock, else
//    $CHROME_LOCK; refused with neither: chrome-lock.mjs, a directory made
//    with mkdir, one Chrome at a time across every probe and session;
//    retried every 20 s, kept fresh while held, taken over after 30 min
//    untouched, removed however the probe ends). It
//    checks:
//    - the terrain at the origin, locked, built by terrain-mesh from its four
//      data files (heights, sources and canopy, OSM features, OSM look),
//      sources and attribution traced; the credit shown;
//    - the world's weather is the template's (the weather package's trait:
//      Ucluelet, 15:00 on 15 July on UTC−7, 5 m/s from 300°, Ukee grey), and
//      it is the world's: the atmosphere Ukee grey exactly (its old colours,
//      fog and deck), the sun within 1° of the one once hand-set for that
//      moment, the wind 5 m/s from 300°; the place (terrain.place) offers no
//      sky; the harbour's open water with sailing's sea at scale 0.6; people
//      start in Look at the home view;
//    - the sloop at anchor off the dock, head to wind, deep enough for her
//      keel at the lowest normal tide all round her swing (from the GLB's
//      own extras.terrain, through the copyable sampler);
//    - known places land or water; the source layer and quality travel;
//    - the GLB's layers (forest, buildings, boatyard and its sub-layers, the
//      planned pier and dock), the removed buildings and today's pier arm
//      hidden by default; the
//      trees drawn as instanced meshes (a species a tile);
//    - the Terrain doc's fingerprint is the render's when it's built, and
//      nothing writes to the doc after (each write logged, with its stack);
//    - node builds the same GLB from the same docs, byte for byte; the
//      fingerprint survives every url rewritten; a viewer without the
//      terrain plugin still sees it;
//    - screens: the home view, the boatyard close, the inlet, Amphitrite Point,
//      the town's waterfront from the water, the surf, the cloud on Mount
//      Ozzard, three low on the water (off the yard, off the town, under
//      the lighthouse), the basins' floats, Whiskey Dock and mid-harbour, and
//      the third look critic's four (among the basin's trees, low over the
//      pile decks, the waterfront as a postcard, the yard's shore); the
//      top of every one isn't black; the water off the yard glassy (under 8%
//      of its pixels darker than half their median); no height legend (the
//      ground is coloured by what covers it);
//    - every view's frame time (40 frames of the stage's render and a
//      1-pixel readPixels: median, p90, draw calls, triangles); with --gpu
//      (the machine's GPU, Metal on a Mac, not SwiftShader) the home view's
//      median within FRAME_BUDGET.
// 3. Unless --dry-run: as publish-rvyc.mjs, every doc made anew on the
//    server and read back from a fresh repo.

import { join, resolve, dirname } from "node:path";
import { packageProblems, withPackages } from "./scene-packages.mjs";
import { publishDocs } from "./publish-stamp.mjs";
import { lockDir } from "./chrome-lock.mjs";
import { pngPixel, pngRegion } from "./png-pixel.mjs";

// The published scene names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"):
// the scene, the terrain's, the weather's (the world's weather is its trait)
// and the sloop's (with joints and traversal, for her companionway's hatch
// and exit). In a real shell the stage works
// these out from the registry; the probe page has none that says where its
// plugins come from, so they're stated here.
const PACKAGES = ["scene", "terrain", "weather", "sailing", "water", "joints", "traversal"];
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []),
);
const KNOWN_ARGS = new Set(["sync", "settle", "dry-run", "show", "shots", "cache", "seed", "lock", "gpu"]);
const unknown = Object.keys(args).filter((k) => !KNOWN_ARGS.has(k));
if (unknown.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.error(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"));
  process.exit(unknown.includes("help") ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const TMP = process.env.TMPDIR || tmpdir();
const CACHE = resolve(typeof args.cache === "string" ? args.cache : join(TMP, "terrain-ucluelet"));
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(TMP, "terrain-ucluelet-shots"));
const LOCK = lockDir(args);
// never Chrome without the lock: refused before anything is fetched
if (!LOCK) {
  console.error("No Chrome lock: pass --lock <dir> or set CHROME_LOCK (one Chrome at a time across every probe and session).");
  process.exit(2);
}
const SNAP = join(SHOTS, "snap");
mkdirSync(SNAP, { recursive: true });
for (const p of ["scene/dist/index.js", "sailing/dist/index.js", "water/dist/index.js", "weather/dist/index.js", "terrain/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);

// ─── 1. the data ────────────────────────────────────────────────────────────
console.error(`fetching (or replaying) the data into ${CACHE}`);
const fetched = spawnSync(process.execPath, ["--max-old-space-size=4096", join(PKG, "probes/fetch-ucluelet.mjs"), "--cache", CACHE, ...(typeof args.seed === "string" ? ["--seed", args.seed] : [])], { stdio: ["ignore", "ignore", "inherit"] });
if (fetched.status !== 0) {
  console.error("the data didn't check out: see above");
  process.exit(1);
}

// ─── 2. the scene, in the browser (one Chrome at a time: the lock) ──────────
const { browser, checklist, sleep } = await import("./cdp.mjs");
// one Chrome at a time across every probe and session: --lock or $CHROME_LOCK, never without (chrome-lock.mjs)
await (await import("./chrome-lock.mjs")).chromeLock(LOCK);
const PORT = 4853;
const b = await browser({ root: ROOT, port: PORT, cdp: 9853, page: "/terrain/probes/ucluelet-probe.html", width: 1280, height: 760, show: !!args.show, gpu: !!args.gpu, timeout: 1_500_000, mounts: { "/terrain-cache/": CACHE, "/snap/": SNAP } });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 100);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const J = JSON.stringify;
const DRAFT = 2.0; // the sloop's keel, near enough
const FRAME_BUDGET = 22.7; // ms, the home view's median before the denser forest (Apple M4, Metal, 1280 × 760)
const LLWLT = -2.11; // the lowest normal tide, below mean water (CHS 08595 Ucluelet)
const { HOME, WIND, GRID, WATER_COLOUR } = await import("../src/ucluelet.js");
const { UKEE_GREY } = await import("../src/test/ukee-grey.js");
// The world's weather as the template writes it (template-ucluelet.test.js pins the same), and Ukee grey as the
// weather package draws it there (weather's atmosphere.test.js pins the same; terrain's tests use UKEE_GREY's copy)
const WEATHER = (seed) => ({ lat: 48.95, lon: -125.558, date: "2026-07-15", hour: 15, offset: -7, wind: 5, from: 300, seed, cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000 });
const GREY = { sky: { top: "#c4cacc", horizon: UKEE_GREY.horizon, bottom: "#7a8487" }, fog: UKEE_GREY.fog, exposure: 1.05, clouds: { cover: 1, contrast: 0.12, scale: 500, base: 600 } };
const OLD_SUN = [-0.36, 0.84, 0.4]; // hand-set for 15:00 PDT on 15 July (the old terrain.sky)
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const degreesBetween = (a, b) => (Math.acos(Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / Math.hypot(...a) / Math.hypot(...b))) * 180) / Math.PI;
let snapshot = null;
try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("the start screen offers Ucluelet (Rising Tide Boat Works)", await until("templates().includes('terrain.ucluelet')", 20_000), await P("templates()"));
  const t0 = Date.now();
  const ids = await P("build()", 600_000);
  check("built through the start screen", !ids.error && ids.terrain && ids.hull, ids);
  check("the terrain built and loaded", await until("terrain().loaded", 600_000), await P(`status(${J(ids.terrain)})`));
  report.numbers.buildSeconds = (Date.now() - t0) / 1000;
  check("everything loaded", await until("loaded().loaded === __p.loaded().total", 120_000), await P("loaded()"));
  const s = await P("shape()");
  report.numbers.shape = { ...s, terrainDoc: { ...s.terrainDoc, summary: undefined } };
  report.numbers.summary = s.terrainDoc?.summary ?? null;
  check("the template's fetches were all answered from the recording (nothing reached the network)", (await P("fetched")).length === 8, await P("fetched"));
  check("the terrain is at the origin, locked, by the terrain-mesh source", s.terrain?.locked && s.terrain.providerId === "terrain-mesh" && J(s.terrain.transform) === J({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }) && s.terrain.parent === null, s.terrain);
  check("the Terrain doc has its four data files, its sources and their attribution", s.terrainDoc?.type === "terrain" && J(s.terrainDoc.files) === J(["dem", "features", "layers", "look"]) && ["chs-nonna-10", "nrcan-hrdem-dtm", "nrcan-hrdem-dsm", "ncei-barkley-sound-1s", "osm-overpass", "osm-overpass-look", "chs-iwls", "eccc-climate-hourly", "site-survey", "rising-tide-public"].every((x) => s.terrainDoc.sources.includes(x)) && /OpenStreetMap/.test(s.terrainDoc.attribution) && /Bennett/.test(s.terrainDoc.attribution), { files: s.terrainDoc?.files, sources: s.terrainDoc?.sources });
  check("every source can be traced: a url each", s.terrainDoc.sourceUrls.every((u) => /^https:\/\//.test(u ?? "")), s.terrainDoc.sourceUrls.map((u) => u?.slice(0, 90)));
  check("OSM pinned to the checked moment, and the data is what was checked", s.terrainDoc.osmDate === "2026-11-16T05:30:00Z" && s.terrainDoc.matchesChecked === true, { osmDate: s.terrainDoc.osmDate, matchesChecked: s.terrainDoc.matchesChecked });
  check("the OSM features file says it is ODbL, with the notice", s.featuresFile?.licence === "ODbL-1.0" && /OpenStreetMap contributors/.test(s.featuresFile.attribution), s.featuresFile);
  check("the terrain's About is its Terrain doc; it is the place, with its credit, and no sky of its own (exactly terrain.credit and terrain.place)", s.terrain.infoUrl === s.terrain.sourceUrl && s.terrain.credit && J(sorted(s.terrain.traits)) === J({ "terrain.credit": {}, "terrain.place": {} }), s.terrain);
  check("the world's weather is the template's: Ucluelet, 15:00 on 15 July on UTC−7, 5 m/s from 300°, Ukee grey (and the scene's only trait)", J(sorted(s.weather)) === J(sorted(WEATHER(s.weather?.seed))) && Number.isSafeInteger(s.weather.seed) && J(s.traits) === J(["weather"]), { weather: s.weather, traits: s.traits });
  const atBuild = await P("terrainNow()");
  check("the Terrain doc's fingerprint when its render is built is the render's", atBuild.fingerprint === s.render?.builtFrom?.fingerprint, { now: atBuild.fingerprint, heads: atBuild.heads, built: s.render?.builtFrom?.fingerprint });
  check("its render is built, fingerprinted, its four data files keyed by content", s.render?.status === "idle" && s.render.glbUrl && s.render.builtFrom?.fingerprint && Object.values(s.render.builtFrom.deps ?? {}).length === 4 && Object.values(s.render.builtFrom.deps).every((v) => String(v[0]).startsWith("fp:")) && s.render.builtFrom.providerVersion === 2, s.render);
  check(`a summer afternoon: ${WIND.speed} m/s from ${WIND.from}°, the sea at scale ${WIND.scale} on one open water at the chart's y = 0`, s.weather?.wind === WIND.speed && s.weather.from === WIND.from && s.sea?.scale === WIND.scale && s.sea.waters === 1 && s.sea.open && s.sea.level === 0, s.sea);
  // the terrain's grid (ucluelet.js GRID: 1025 nodes 20 m apart from (-3440, -6900)), down to the hint's deepest seabed (130 m)
  check("the harbour's Sea keeps the terrain's footprint where its world has no open water (its clip: the grid, 130 m deep, centred on it)", J(s.sea?.clip) === J([20480, 130, 20480]) && J(s.sea?.at) === J([6800, 0, 3340]), { clip: s.sea?.clip, at: s.sea?.at });
  check("the harbour's water is the inlet's own grey-green (its water trait's colour)", J(s.sea?.colour) === J(WATER_COLOUR), s.sea?.colour);
  check("it starts people in Look (no body named) at the home view over the boatyard", !s.start?.body && (await P("bodyLabel()")) === "Look" && J(s.home) === J({ position: [...HOME.position], target: [...HOME.target] }), { start: s.start, here: await P("bodyLabel()"), home: s.home });
  check("the sloop lies at anchor off the dock, head to wind, main down, jib rolled away, anchor down", s.hull && Math.abs(Math.cos(s.hull.rotation[1] + (WIND.from * Math.PI) / 180) - 1) < 1e-9 && s.sail?.raised === 0 && s.jib?.furl === 1 && s.anchor?.down === true, { hull: s.hull, sail: s.sail, jib: s.jib, anchor: s.anchor });
  const t = await P("terrain()");
  report.numbers.terrain = { ...t, places: undefined };
  check(`deep enough for her ${DRAFT} m keel at the lowest normal tide, all round a 30 m swing (read from the GLB's extras.terrain)`, t.depthUnderHull + LLWLT > DRAFT && t.shallowestInSwing + LLWLT > DRAFT, { depthUnderHull: t.depthUnderHull, shallowestInSwing: t.shallowestInSwing, hullAt: t.hullAt });
  check("places known to be land or water are so in the heightfield", t.known.every((k) => k.ok), t.known.filter((k) => !k.ok));
  check("the heightfield is the whole grid at 20 m", J(t.grid) === J({ nx: GRID.n, nz: GRID.n, x0: GRID.x0, z0: GRID.z0, cell: GRID.cell }), t.grid);
  check("the boatyard and the lighthouse are among its places", ["Rising Tide Boat Works (the hangar), 1970 Harbour Crescent", "Amphitrite Point Lighthouse"].every((n) => t.places.some((p) => p.name === n)), t.places.map((p) => p.name));
  check("the depth under her is a survey's (NONNA), and the heightfield says which source each depth is from and where depths are made up", t.qualityUnderHull === "dem" && t.source?.counts?.["chs-nonna-10"] > 0 && t.quality?.clamped > 0, { under: t.qualityUnderHull, source: t.source, quality: t.quality });
  check("the GLB's layers: forest, buildings, boats, surf, the shore's dressing, the boatyard's kept / removed (hidden) / wharf / planned / today's pier arm (hidden) (no cloud mesh: the stratus is baked into the hills)", ["forest", "buildings", "boats", "surf", "shore", "boatyard", "boatyard.kept", "boatyard.removed", "boatyard.wharf", "boatyard.planned", "boatyard.today", "landmarks"].every((id) => t.layers.some((l) => l.id === id)) && t.layers.find((l) => l.id === "boatyard.removed")?.visible === false && t.layers.find((l) => l.id === "boatyard.today")?.visible === false, t.layers);
  check("the trees are drawn instanced (a species a tile, so the stage culls the forest a tile at a time)", t.instanced.instancedMeshes >= 3 && t.instanced.instances > 10000, t.instanced);
  // the weather's, as every peer computes it from the trait (the place offers none)
  const a = t.atmosphere;
  check("the world's atmosphere is the weather's Ukee grey, exactly as the place had it (sky, fog, exposure, its stratocumulus deck; the sun soft, no shadows)", a && J(sorted({ sky: a.sky, fog: a.fog, exposure: a.exposure, clouds: a.clouds })) === J(sorted(GREY)) && a.sun?.color === "#eef0f0" && a.sun.intensity === 1.1 && a.sun.shadows === false, a);
  report.numbers.sunFromOld = a?.sun?.direction ? +degreesBetween(a.sun.direction, OLD_SUN).toFixed(3) : null;
  check("the sun is where it is at 15:00 PDT on 15 July: within 1° of the one hand-set for that moment", report.numbers.sunFromOld != null && report.numbers.sunFromOld < 1, { direction: a?.sun?.direction, degrees: report.numbers.sunFromOld });
  check("the world's wind is the weather's: 5 m/s from 300°, the trait's seed, the stock gustiness", t.wind?.speed === 5 && t.wind.from === 300 && t.wind.seed === s.weather?.seed && t.wind.gustiness === 0.3, t.wind);
  check("the view credits the data (OpenStreetMap, linked to its copyright page)", /OpenStreetMap contributors/.test(t.credit.text) && t.credit.link === "https://www.openstreetmap.org/copyright" && t.credit.shown, t.credit);

  check("no height legend over a ground coloured by what covers it", !t.legend, { legend: t.legend });

  // a view's frame time: 40 frames, each the stage's render and a 1-pixel readPixels (so the GPU's work is in it), the median and p90; draw calls and triangles
  const frames = {};
  const timeFrames = async (name) => {
    frames[name] = await js(`(async () => {
      const v = __p.dbg.viewport, gl = v.renderer.getContext(), px = new Uint8Array(4), ms = [];
      for (let i = 0; i < 40; i++) { v.invalidate(); const t = performance.now(); v.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t); await new Promise((r) => setTimeout(r, 5)); }
      ms.sort((a, b) => a - b);
      return { median: +ms[20].toFixed(2), p90: +ms[36].toFixed(2), calls: v.stats.calls, triangles: v.stats.triangles };
    })()`);
  };

  // screens
  await sleep(2500);
  check("the home view, in Look", (await P("atHome()")) === "Look");
  await sleep(4000);
  report.shots.push(await b.shot(join(SHOTS, "ucluelet-home.png")));
  await timeFrames("ucluelet-home");
  // the top of every view (the sky, or the ground from high up) is never black: the pixel at the top's middle, under the toolbar and the hint
  const topPixels = { "ucluelet-home": pngPixel(join(SHOTS, "ucluelet-home.png"), 640, 140) };
  const views = {
    "ucluelet-boatyard": [[-20, 16, -48], [24, 7, 95]],
    "ucluelet-hangar-doors": [[-55, 9, 40], [18, 8, 100]],
    "ucluelet-boatyard-dock": [[120, 30, -140], [60, 4, 40]],
    "ucluelet-inlet": [[1100, 260, 900], [-1600, 0, -1900]],
    "ucluelet-amphitrite": [[1080, 32, 3340], [1228, 9, 3203]],
    "ucluelet-overview": [[2600, 1800, 6500], [3800, 0, 1200]],
    // from the water: the town's waterfront, the surf under the lighthouse, the cloud on Mount Ozzard
    "ucluelet-low-harbour": [[1450, 4, 650], [800, 10, 820]],
    "ucluelet-surf": [[930, 22, 3480], [1228, 6, 3203]],
    "ucluelet-ozzard": [[600, 40, 300], [4770, 320, -1045]],
    // low on the water where people sail: off the boatyard, off the town (where the sky once went black), under the lighthouse
    "ucluelet-low-yard": [[220, 3, -330], [0, 8, 0]],
    "ucluelet-low-town": [[700, 3, 150], [1300, 12, 750]],
    "ucluelet-lighthouse-sea": [[1150, 5, 3600], [1228, 10, 3203]],
    // the Inner and Outer Basins' floats from above, the waterfront at Whiskey Dock, mid-harbour toward the town
    "ucluelet-basin-high": [[220, 45, 330], [390, 0, 520]],
    "ucluelet-whiskey": [[1000, 5, 520], [910, 6, 710]],
    "ucluelet-midharbour": [[560, 6, 60], [1000, 10, 800]],
    // the yard close: the red Quonset, the galvanised one, the courtyard's slab and the frontage's stones, from a standing eye (1.75 m over the yard's +3.06; at 4 m the eye was at a knee, and the ground strip under it a few metres of one shading)
    "ucluelet-courtyard": [[-50, 4.8, 150], [0, 4.8, 95]],
    // the third look critic's: among the basin's trees, low over the waterfront's pile decks, the town's waterfront as a postcard from the harbour, the yard's shore
    "ucluelet-x-basin-mid": [[300, 14, 300], [370, 1, 470]],
    "ucluelet-x-basin-low": [[420, 3, 240], [360, 3, 450]],
    "ucluelet-x-harbour-postcard": [[900, 40, 250], [400, 5, 650]],
    "ucluelet-x-yard-shore": [[60, 6, -60], [-30, 3, 90]],
  };
  for (const [name, [pos, tgt]] of Object.entries(views)) {
    await P(`setCamera(${J(pos)}, ${J(tgt)})`);
    await sleep(4000);
    report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
    topPixels[name] = pngPixel(join(SHOTS, `${name}.png`), 640, 140);
    await timeFrames(name);
  }
  report.numbers.frames = frames;
  console.error(`frame times (${args.gpu ? "GPU" : "software: not a budget"}), median ms: ${Object.entries(frames).map(([k, v]) => `${k.replace("ucluelet-", "")} ${v.median}`).join(", ")}`);
  // on the machine's GPU (--gpu): the home view within the budget it had before the forest was made denser (22.7 ms on an M4, 2026-11-16)
  if (args.gpu) check(`the home view renders in ${FRAME_BUDGET} ms or less (median of 40, GPU)`, frames["ucluelet-home"].median <= FRAME_BUDGET, frames["ucluelet-home"]);
  const grain = await P("grain()");
  check("the ground carries its grain and the place dresses it (every ground mesh's material, a program compiled with it)", grain.meshes > 0 && grain.dressed === grain.meshes && grain.grainPrograms > 0, grain);
  check("no view's top is black (the sky drawn at every eye)", Object.values(topPixels).every((c) => Math.max(...c) > 24), topPixels);
  // The pixel rows below were read off shots whose stage canvas was 733 px tall from row 27 (2026-11-16). The canvas
  // moves and shrinks as the page's chrome does (scene's bar of tools since N8 starts it lower), and a perspective
  // camera puts a thing at the same FRACTION of the canvas's height whatever that height is (its fov is vertical), so
  // each row is carried to the canvas the page has now: the same view, not the same pixel row.
  const canvas = await js("(() => { const c = [...document.querySelectorAll('canvas')].sort((a, z) => z.clientWidth * z.clientHeight - a.clientWidth * a.clientHeight)[0]; const r = c.getBoundingClientRect(); return { top: r.top, height: r.height }; })()");
  const row = (y) => Math.round(canvas.top + ((y - 27) * canvas.height) / 733);
  report.numbers.canvas = canvas;
  // calm overcast water is a glassy mirror, not a camouflage of dark blobs: off the yard, the water's pixels (the frame's lower third) darker than half their median luminance are under 8% of them
  const waterLum = pngRegion(join(SHOTS, "ucluelet-low-yard.png"), 0, row(470), 1280, row(720)).map(([r, g, bl]) => 0.2126 * r + 0.7152 * g + 0.0722 * bl).sort((a, z) => a - z);
  const waterMedian = waterLum[waterLum.length >> 1];
  const darkShare = (f) => waterLum.filter((l) => l < f * waterMedian).length / waterLum.length;
  report.numbers.lowYardWater = { median: +waterMedian.toFixed(1), darkerThanHalf: +darkShare(0.5).toFixed(4), darkerThan08: +darkShare(0.8).toFixed(4) };
  check("the water off the yard is glassy: under 8% of its pixels darker than half its median", darkShare(0.5) < 0.08, report.numbers.lowYardWater);
  // the sheltered harbour mirrors its shore in vertical streaks, not horizontal stripes: in the strip 10–60 px under the shoreline (where these two views put it), the mean absolute vertical luminance gradient at most 1.3 times the horizontal one
  const L = ([r, g, bl]) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const gradients = (file, y0, y1, x0 = 100, x1 = 1180) => {
    const px = pngRegion(join(SHOTS, file), x0, y0, x1, y1).map(L), w = x1 - x0, h = y1 - y0;
    let gx = 0, gy = 0, c = 0;
    for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
      gx += Math.abs(px[y * w + x + 1] - px[y * w + x]);
      gy += Math.abs(px[(y + 1) * w + x] - px[y * w + x]);
      c++;
    }
    return { horizontal: +(gx / c).toFixed(3), vertical: +(gy / c).toFixed(3), ratio: +(gy / Math.max(gx, 1e-6)).toFixed(3) };
  };
  report.numbers.stripes = { "low-town": gradients("ucluelet-low-town.png", row(418), row(468)), ozzard: gradients("ucluelet-ozzard.png", row(525), row(575)) };
  check("no horizontal stripes in the harbour's mirror: vertical gradient at most 1.3 times the horizontal under the shore (low-town, ozzard)", Object.values(report.numbers.stripes).every((g) => g.ratio <= 1.3), report.numbers.stripes);
  // the yard's ground worked and wet, not a featureless plane: the ground strip's luminance standard deviation over its mean at least 8% (courtyard, hangar-doors);
  // the courtyard's strip the yard within about 30 m of its standing eye (rows 460–740, under the yard's horizon at about 430: rows 620–740 alone are only 4.6–7 m of ground there, a puddle or two)
  const spread = (file, y0, y1, x0 = 200, x1 = 1080) => {
    const l = pngRegion(join(SHOTS, file), x0, y0, x1, y1).map(L);
    const m = l.reduce((a, b) => a + b, 0) / l.length;
    return +(Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length) / m).toFixed(4);
  };
  report.numbers.yardGround = { courtyard: spread("ucluelet-courtyard.png", row(460), row(740)), "hangar-doors": spread("ucluelet-hangar-doors.png", row(620), row(740)) };
  check("the yard's ground varies by at least 8% (courtyard, hangar-doors: the ground strip's standard deviation over its mean)", Object.values(report.numbers.yardGround).every((v) => v >= 0.08), report.numbers.yardGround);
  const tool = await P("terrainTool()", 60_000);
  check("the Terrain tool draws the place and lists its sources", /1025 × 1025 nodes/.test(tool.legend) && !/Problems/.test(tool.legend) && tool.sources >= 10 && !tool.empty, tool);
  await sleep(500);
  report.shots.push(await b.shot(join(SHOTS, "ucluelet-terrain-tool.png")));
  await P("closeTerrainTool()");
  // (nothing to switch back to: the sloop sails on whatever anyone does)
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));

  // the docs, out of the page
  const posted = await P("postSnapshot()", 120_000);
  for (let i = 0; i < 100 && !b.reports.length; i++) await sleep(100);
  snapshot = JSON.parse(b.reports.shift());
  writeFileSync(join(SNAP, "snapshot.json"), JSON.stringify(snapshot));
  check("a snapshot of every doc the scene reaches", posted.docs >= 8, posted);

  // node builds the same GLB from the same docs, with the same source module
  const same = await sameGlb(snapshot);
  check("node builds the same GLB from the same docs, byte for byte", same.ok, same);
  check("the GLB's asset.copyright credits the data", /OpenStreetMap contributors/.test(same.copyright ?? "") && /NOAA/.test(same.copyright ?? ""), same.copyright);
  report.numbers.glb = same;
  // publishing remakes every doc under a new url: the render must still be fresh for its source
  // nothing writes to the Terrain doc once its render is built (or the render is stale for it)
  const writes = await P("terrainWrites");
  const renderDoc = snapshot.docs[Object.values(snapshot.docs[snapshot.scene].objects).find((o) => o.providerId === "terrain-mesh").renderUrl];
  const atEnd = await P("terrainNow()");
  const changed = (() => {
    const a = JSON.parse(atBuild.json), z = JSON.parse(atEnd.json);
    const out = [];
    const walk = (x, y, path) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      if (x && y && typeof x === "object" && typeof y === "object" && out.length < 12) for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`);
      else out.push({ path, was: JSON.stringify(x)?.slice(0, 160), now: JSON.stringify(y)?.slice(0, 160) });
    };
    walk(a, z, "");
    return out;
  })();
  check("nothing writes to the Terrain doc after its render is built", writes.every((w) => w.at <= renderDoc.builtAt) && atEnd.fingerprint === atBuild.fingerprint && !changed.length, { builtAt: renderDoc.builtAt, writes, fingerprints: [atBuild.fingerprint, atEnd.fingerprint], heads: [atBuild.heads, atEnd.heads], changed });
  const moved = await fingerprintAfterRewrite(snapshot);
  check("the terrain's fingerprint is the same once every url is rewritten (a published copy isn't stale)", moved.ok, moved);

  // a viewer without the terrain plugin
  await b.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/terrain/probes/ucluelet-probe.html?replay=1` });
  await sleep(500);
  check("the replay page set up (no terrain plugin)", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("without the terrain plugin, the terrain still shows, with its extras.terrain", await until("terrain().loaded", 300_000), await P(`status(__p.ids().terrain)`));
  const rt = await P("terrain()");
  check("…and reads the same depths (the mooring field, and every known place)", rt.depthAtMooring === t.depthAtMooring && J(rt.known) === J(t.known), { replay: rt.depthAtMooring, made: t.depthAtMooring });
  check("…under the same sky: the atmosphere is the weather's, not the terrain package's", J(rt.atmosphere) === J(t.atmosphere), { replay: rt.atmosphere, made: t.atmosphere });
  await until("loaded().loaded === __p.loaded().total", 60_000);
  await sleep(2000);
  report.shots.push(await b.shot(join(SHOTS, "ucluelet-replay.png")));
  const rerrors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the replay page", rerrors.length === 0, rerrors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
if (list.failed || !snapshot) b.stop(1);
else await publish(snapshot);

/** Build the terrain in node from the snapshot's docs, through source.js, and compare with the GLB the page made. */
async function sameGlb(snap) {
  const { default: source } = await import("../src/source.js");
  const docs = Object.fromEntries(Object.entries(snap.docs).map(([u, d]) => [u, revive(d)]));
  const repo = { find: async (u) => ({ doc: () => docs[u] }) };
  const scene = docs[snap.scene];
  const obj = Object.values(scene.objects).find((o) => o.providerId === "terrain-mesh");
  const render = docs[obj.renderUrl];
  const out = await source.build({ doc: docs[obj.sourceUrl], repo, params: render.params ?? {} });
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const page = docs[render.glbUrl].content;
  const { parseGLB } = await import("../src/glb.js");
  return { ok: sha(out.glb) === sha(page), node: sha(out.glb), page: sha(page), bytes: page.length, notes: out.meta.notes, copyright: parseGLB(page).json.asset.copyright ?? null };
}

/** Rewrite every snapshot url as publishing does, and recompute the terrain's fingerprint: it must be what the render was built from. */
async function fingerprintAfterRewrite(snap) {
  const { default: source } = await import("../src/source.js");
  const urls = Object.keys(snap.docs);
  let text = JSON.stringify(snap.docs);
  urls.forEach((u, k) => (text = text.split(u).join(`automerge:Rewritten${k}xxxxxxxxxxxxxxxxxx`)));
  // as a fresh peer on automerge reads them back: every map's keys sorted (this page's repo keeps them in the order set)
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const docs = sorted(JSON.parse(text));
  const to = Object.fromEntries(urls.map((u, k) => [u, `automerge:Rewritten${k}xxxxxxxxxxxxxxxxxx`]));
  const obj = Object.values(snap.docs[snap.scene].objects).find((o) => o.providerId === "terrain-mesh");
  const terrain = docs[to[obj.sourceUrl]], render = docs[to[obj.renderUrl]];
  const fp = source.fingerprint(terrain);
  const deps = source.dependencies(terrain);
  return { ok: fp === render.builtFrom.fingerprint && deps.every((u) => render.builtFrom.deps?.[u]?.[0]?.startsWith("fp:")), built: render.builtFrom.fingerprint, rewritten: fp, depsRecorded: deps.every((u) => !!render.builtFrom.deps?.[u]) };
}

function revive(doc) {
  return JSON.parse(JSON.stringify(doc), (k, v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? new Uint8Array(Buffer.from(v.$bytes, "base64")) : v));
}

// ─── 3. publish ─────────────────────────────────────────────────────────────
async function publish(snap) {
  // the contact doc left out, claims dropped, the scene stamped with its packages (publish-stamp.mjs: a dry run goes on without them where nothing's synced)
  const { docs, problems: stamped, note } = publishDocs(snap, PACKAGES, { dry: DRY, withPackages, packageProblems });
  const urls = Object.keys(docs);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  if (note) console.log(`dry run: ${note}`);
  if (DRY) {
    console.log(`dry run: ${urls.length} docs to publish (${urls.map((u) => docs[u]["@patchwork"]?.type).join(", ")}; nothing published)`);
    return b.stop(0);
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
  // which snapshot docs each doc names
  const refs = new Map(urls.map((u) => [u, urls.filter((v) => v !== u && JSON.stringify(docs[u]).includes(v))]));
  const renamed = new Map();
  const rewrite = (doc) => {
    let text = JSON.stringify(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  // leaves first
  const left = new Set(urls);
  const made = new Map(); // old url → the new handle
  while (left.size) {
    const ready = [...left].filter((u) => refs.get(u).every((v) => renamed.has(v)));
    if (!ready.length) throw new Error(`docs that name each other: ${[...left].join(", ")}`);
    for (const u of ready) {
      const doc = rewrite(docs[u]);
      // a render was built from its source at the probe repo's heads: as published, the source's are these
      if (doc["@patchwork"]?.type === "scene-render" && doc.builtFrom && docs[u].parent && made.has(docs[u].parent)) doc.builtFrom.heads = [...made.get(docs[u].parent).heads()];
      const h = await repo.create2(doc);
      made.set(u, h);
      renamed.set(u, h.url);
      left.delete(u);
    }
  }
  const sceneUrl = renamed.get(snap.scene);
  const madeUrls = [...renamed.values()];
  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const [from, url] of renamed) {
    try {
      const got = (await within(60000, checker.find(url))).doc();
      const want = docs[from];
      let problem = !got || !Object.keys(got).length ? "empty" : null;
      if (!problem && url === sceneUrl) {
        if (packageProblems(got, PACKAGES).length) problem = `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
        else if (!got.view?.start?.home) problem = `came back without view.start.home: ${J(got.view)}`;
        else if (!Object.values(got.objects ?? {}).some((o) => o.traits?.["sailing.ship"])) problem = "came back without the sloop";
        else if (!Object.values(got.objects ?? {}).some((o) => o.providerId === "terrain-mesh" && madeUrls.includes(o.sourceUrl) && madeUrls.includes(o.renderUrl))) problem = "came back without the terrain";
        else if (got.claims) problem = "came back with claims";
      }
      if (!problem && want.content?.$bytes && !(got.content?.byteLength === Buffer.from(want.content.$bytes, "base64").length)) problem = "a file doc without all its bytes";
      if (problem) missing.push(`${url} (${problem})`);
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  // the terrain's render, read fresh: built from its source as published (so nobody rebuilds it on opening)
  const terrainObj0 = Object.values(docs[snap.scene].objects).find((o) => o.providerId === "terrain-mesh");
  try {
    const { default: source } = await import("../src/source.js");
    const th = await within(60000, checker.find(renamed.get(terrainObj0.sourceUrl)));
    const rh = await within(60000, checker.find(renamed.get(terrainObj0.renderUrl)));
    const t = th.doc(), r = rh.doc();
    const fp = source.fingerprint(t);
    const heads = [...th.heads()].sort().join(","), built = [...(r.builtFrom?.heads ?? [])].sort().join(",");
    const depsOk = source.dependencies(t).every((u) => String(r.builtFrom?.deps?.[u]?.[0] ?? "").startsWith("fp:"));
    console.log(`terrain render, fresh: fingerprint ${fp === r.builtFrom?.fingerprint ? "matches" : `DIFFERS (${fp} vs ${r.builtFrom?.fingerprint})`}; built from heads ${heads === built ? "= the source's" : `${built} (source ${heads})`}; deps by content ${depsOk ? "ok" : "MISSING"}`);
    if (fp !== r.builtFrom?.fingerprint || heads !== built || !depsOk) missing.push(`${renamed.get(terrainObj0.renderUrl)} (stale as published)`);
  } catch (err) {
    missing.push(`terrain render check (${err?.message ?? err})`);
  }
  console.log(`verified ${madeUrls.length - missing.length}/${madeUrls.length} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    return b.stop(1);
  }
  console.log(`\n  scene    https://patchwork.inkandswitch.com/#doc=${sceneUrl}`);
  console.log(`  terrain  ${renamed.get(terrainObj0.sourceUrl)}`);
  console.log(`  render   ${renamed.get(terrainObj0.renderUrl)}`);
  const t0 = docs[terrainObj0.sourceUrl];
  console.log(`  data     ${renamed.get(t0.data.dem.url)} (heights), ${renamed.get(t0.data.features.url)} (OSM features, ODbL)\n`);
  return b.stop(0);
}
