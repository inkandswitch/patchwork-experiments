// Publish "Ucluelet" to a real sync server and print its Patchwork URL: the
// waters in and around Ucluelet, from open data, with Rising Tide Boat
// Works' boatyard at the old seaplane base, the stock sloop at anchor off
// the planned dock, people starting in Look at a home view over the
// boatyard. A copy of publish-rvyc.mjs for this place.
//
//   (in scene/, sailing/, water/ and terrain/) pnpm build
//   node probes/publish-ucluelet.mjs [--dry-run] [--sync wss://…] [--settle 8000] [--cache <dir>] [--seed <dir>] [--shots <dir>] [--lock <dir>] [--show]
//
// Makes NEW docs on every run (no dedupe).
//
// 1. The data: probes/fetch-ucluelet.mjs fetches (or replays its recording
//    in --cache; --seed records from downloads already made) and checks it.
// 2. The scene, made the way a person makes it: in headless Chrome, the
//    BUILT scene, sailing, water and terrain plugins on an EMPTY scene
//    (ucluelet-probe.html, an in-memory repo); the start screen's "Ucluelet
//    (Rising Tide Boat Works)" is clicked, its fetches answered from the
//    recording. Chrome runs only while holding --lock (a directory made with
//    mkdir: one Chrome at a time across every probe that honours it; retried
//    every 20 s, taken over after 30 min as stale, removed on exit). It
//    checks:
//    - the terrain at the origin, locked, built by terrain-mesh from its four
//      data files (heights, sources and canopy, OSM features, OSM look),
//      sources and attribution traced; the credit shown;
//    - the place's sky is the world's atmosphere (over the weather's);
//    - the weather (5 m/s from 300°), the harbour's open water with
//      sailing's sea at scale 0.6; people start in Look at the home view;
//    - the sloop at anchor off the dock, head to wind, deep enough for her
//      keel at the lowest normal tide all round her swing (from the GLB's
//      own extras.terrain, through the copyable sampler);
//    - known places land or water; the source layer and quality travel;
//    - the GLB's layers (forest, buildings, boatyard and its sub-layers, the
//      planned pier and dock), the removed buildings hidden by default; the
//      trees drawn as one InstancedMesh a species;
//    - node builds the same GLB from the same docs, byte for byte; the
//      fingerprint survives every url rewritten; a viewer without the
//      terrain plugin still sees it;
//    - screens: the home view, the boatyard close, the inlet, Amphitrite Point.
// 3. Unless --dry-run: as publish-rvyc.mjs, every doc made anew on the
//    server and read back from a fresh repo.

import { join, resolve, dirname } from "node:path";
import { packageProblems, withPackages } from "./scene-packages.mjs";

// The published scene names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"):
// the scene, the terrain's and the sloop's (with joints and traversal, for her
// companionway's hatch and exit). In a real shell the stage works
// these out from the registry; the probe page has none that says where its
// plugins come from, so they're stated here.
const PACKAGES = ["scene", "terrain", "sailing", "water", "joints", "traversal"];
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []),
);
const KNOWN_ARGS = new Set(["sync", "settle", "dry-run", "show", "shots", "cache", "seed", "lock"]);
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
const LOCK = typeof args.lock === "string" ? resolve(args.lock) : null;
const SNAP = join(SHOTS, "snap");
mkdirSync(SNAP, { recursive: true });
for (const p of ["scene/dist/index.js", "sailing/dist/index.js", "water/dist/index.js", "terrain/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);

// ─── 1. the data ────────────────────────────────────────────────────────────
console.error(`fetching (or replaying) the data into ${CACHE}`);
const fetched = spawnSync(process.execPath, ["--max-old-space-size=4096", join(PKG, "probes/fetch-ucluelet.mjs"), "--cache", CACHE, ...(typeof args.seed === "string" ? ["--seed", args.seed] : [])], { stdio: ["ignore", "ignore", "inherit"] });
if (fetched.status !== 0) {
  console.error("the data didn't check out: see above");
  process.exit(1);
}

// ─── 2. the scene, in the browser (one Chrome at a time: the lock) ──────────
const { browser, checklist, sleep } = await import("./cdp.mjs");
if (LOCK) {
  const { mkdirSync: mk, rmdirSync, statSync } = await import("node:fs");
  for (;;) {
    try {
      mk(LOCK);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(LOCK).mtimeMs;
      } catch {}
      if (age > 30 * 60_000) {
        console.error(`the Chrome lock is ${Math.round(age / 60000)} min old: taking it over as stale`);
        try {
          rmdirSync(LOCK);
        } catch {}
        continue;
      }
      console.error("waiting for the Chrome lock (another probe's Chrome is running)…");
      await sleep(20_000);
    }
  }
  process.on("exit", () => {
    try {
      rmdirSync(LOCK);
    } catch {}
  });
  console.error(`holding the Chrome lock ${LOCK}`);
}
const PORT = 4853;
const b = await browser({ root: ROOT, port: PORT, cdp: 9853, page: "/terrain/probes/ucluelet-probe.html", width: 1280, height: 760, show: !!args.show, timeout: 1_500_000, mounts: { "/terrain-cache/": CACHE, "/snap/": SNAP } });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 100);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const J = JSON.stringify;
const DRAFT = 2.0; // the sloop's keel, near enough
const LLWLT = -2.11; // the lowest normal tide, below mean water (CHS 08595 Ucluelet)
const { HOME, WIND, GRID } = await import("../src/ucluelet.js");
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
  check("the terrain's About is its Terrain doc; it carries the credit and the place's sky", s.terrain.infoUrl === s.terrain.sourceUrl && s.terrain.credit && s.terrain.sky?.fog?.far === 9000, s.terrain);
  check("its render is built, fingerprinted, its four data files keyed by content", s.render?.status === "idle" && s.render.glbUrl && s.render.builtFrom?.fingerprint && Object.values(s.render.builtFrom.deps ?? {}).length === 4 && Object.values(s.render.builtFrom.deps).every((v) => String(v[0]).startsWith("fp:")) && s.render.builtFrom.providerVersion === 2, s.render);
  check(`a summer afternoon: ${WIND.speed} m/s from ${WIND.from}°, the sea at scale ${WIND.scale} on one open water at the chart's y = 0`, J(s.sea?.wind) === J({ speed: WIND.speed, from: WIND.from }) && s.sea.scale === WIND.scale && s.sea.waters === 1 && s.sea.open && s.sea.level === 0, s.sea);
  check("it starts people in Look (no body named) at the home view over the boatyard", !s.start?.body && (await P("bodyLabel()")) === "Look" && J(s.home) === J({ position: [...HOME.position], target: [...HOME.target] }), { start: s.start, here: await P("bodyLabel()"), home: s.home });
  check("the sloop lies at anchor off the dock, head to wind, main down, jib rolled away, anchor down", s.hull && Math.abs(Math.cos(s.hull.rotation[1] + (WIND.from * Math.PI) / 180) - 1) < 1e-9 && s.sail?.raised === 0 && s.jib?.furl === 1 && s.anchor?.down === true, { hull: s.hull, sail: s.sail, jib: s.jib, anchor: s.anchor });
  const t = await P("terrain()");
  report.numbers.terrain = { ...t, places: undefined };
  check(`deep enough for her ${DRAFT} m keel at the lowest normal tide, all round a 30 m swing (read from the GLB's extras.terrain)`, t.depthUnderHull + LLWLT > DRAFT && t.shallowestInSwing + LLWLT > DRAFT, { depthUnderHull: t.depthUnderHull, shallowestInSwing: t.shallowestInSwing, hullAt: t.hullAt });
  check("places known to be land or water are so in the heightfield", t.known.every((k) => k.ok), t.known.filter((k) => !k.ok));
  check("the heightfield is the whole grid at 20 m", J(t.grid) === J({ nx: GRID.n, nz: GRID.n, x0: GRID.x0, z0: GRID.z0, cell: GRID.cell }), t.grid);
  check("the boatyard and the lighthouse are among its places", ["Rising Tide Boat Works (the hangar), 1970 Harbour Crescent", "Amphitrite Point Lighthouse"].every((n) => t.places.some((p) => p.name === n)), t.places.map((p) => p.name));
  check("the depth under her is a survey's (NONNA), and the heightfield says which source each depth is from and where depths are made up", t.qualityUnderHull === "dem" && t.source?.counts?.["chs-nonna-10"] > 0 && t.quality?.clamped > 0, { under: t.qualityUnderHull, source: t.source, quality: t.quality });
  check("the GLB's layers: forest, buildings, the boatyard's kept / removed (hidden) / wharf / planned", ["forest", "buildings", "boatyard", "boatyard.kept", "boatyard.removed", "boatyard.wharf", "boatyard.planned", "landmarks"].every((id) => t.layers.some((l) => l.id === id)) && t.layers.find((l) => l.id === "boatyard.removed")?.visible === false, t.layers);
  check("the trees are drawn as one InstancedMesh a species", t.instanced.instancedMeshes >= 3 && t.instanced.instances > 10000, t.instanced);
  check("the place's sky is the world's atmosphere (Ukee grey, over the weather's bright day)", t.atmosphere?.fog?.color === "#bcc3c4" && t.atmosphere?.sky?.top === "#7f8b94" && t.atmosphere?.sun?.shadows === false, t.atmosphere);
  check("the view credits the data (OpenStreetMap, linked to its copyright page)", /OpenStreetMap contributors/.test(t.credit.text) && t.credit.link === "https://www.openstreetmap.org/copyright" && t.credit.shown, t.credit);

  // screens
  await sleep(2500);
  check("the home view, in Look", (await P("atHome()")) === "Look");
  await sleep(4000);
  report.shots.push(await b.shot(join(SHOTS, "ucluelet-home.png")));
  const views = {
    "ucluelet-boatyard": [[-75, 24, 15], [40, 6, 75]],
    "ucluelet-boatyard-dock": [[120, 30, -140], [60, 4, 40]],
    "ucluelet-inlet": [[1100, 260, 900], [-1600, 0, -1900]],
    "ucluelet-amphitrite": [[1080, 32, 3340], [1228, 9, 3203]],
    "ucluelet-overview": [[3000, 4200, 9000], [5500, 0, 2500]],
  };
  for (const [name, [pos, tgt]] of Object.entries(views)) {
    await P(`setCamera(${J(pos)}, ${J(tgt)})`);
    await sleep(4000);
    report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
  }
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
  const moved = await fingerprintAfterRewrite(snapshot);
  check("the terrain's fingerprint is the same once every url is rewritten (a published copy isn't stale)", moved.ok, moved);

  // a viewer without the terrain plugin
  await b.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/terrain/probes/ucluelet-probe.html?replay=1` });
  await sleep(500);
  check("the replay page set up (scene and sailing only)", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("without the terrain plugin, the terrain still shows, with its extras.terrain", await until("terrain().loaded", 300_000), await P(`status(__p.ids().terrain)`));
  const rt = await P("terrain()");
  check("…and reads the same depths (the mooring field, and every known place)", rt.depthAtMooring === t.depthAtMooring && J(rt.known) === J(t.known), { replay: rt.depthAtMooring, made: t.depthAtMooring });
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
  // nobody who made it is here: their claims (who simulated her) don't travel, nor their contact doc
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  const docs = Object.fromEntries(Object.entries(snap.docs).filter(([, d]) => d["@patchwork"]?.type !== "contact").map(([u, d]) => [u, u === snap.scene ? withPackages(unclaimed(d), PACKAGES) : d]));
  const urls = Object.keys(docs);
  const stamped = packageProblems(docs[snap.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
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
