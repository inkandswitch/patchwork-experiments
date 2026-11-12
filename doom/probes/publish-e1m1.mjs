// Publish Freedoom's E1M1 as a scene to a real sync server, and print its
// Patchwork URL: the map laid out by the doom package from a WAD file doc,
// walked in first person with the arena's play.
//
//   (in scene/, arena/, joints/, traversal/ and doom/) pnpm build
//   node probes/publish-e1m1.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>] [--exit <url>]
//   node probes/publish-e1m1.mjs --set-exit <scene url> <url> [--sync wss://…] [--settle 8000] [--dry-run]
//
// Makes NEW docs on every run (no dedupe).
//
// The WAD is the tests' E1M1 slice (src/test/e1m1.wad: Freedoom 0.13.0's
// E1M1 and only what drawing it needs, 1.5 MB; its notice is
// src/test/COPYING.txt), not the 28 MB IWAD.
//
// The scene is made the way a person makes it, by the tools themselves: in
// headless Chrome, the BUILT scene tool with the BUILT arena, joints,
// traversal and doom plugins is mounted on an EMPTY scene (e1m1-probe.html:
// real Automerge docs), the WAD's URL is pasted into it, and the doom package
// lays out its first map. Then the scene is set to start in play with its
// camera at the player 1 start's eye. It checks:
// - the layout: the static part, 11 doors with slides, one exit switch (an
//   exit with the verb "Exit" and, unless --exit, nowhere to go), arena's
//   spawn point at the player 1 start, all in one group under the static part;
// - the scene is a level that starts in play, its home view at the spawn;
// - every part is built and loaded, nothing failed, no errors on the page;
// - Freedoom's notice is on the WAD doc and in the About.
// Then (unless --dry-run) it publishes: the WAD file doc, the About, the
// scene's files (the spawn point's GLB), a render doc per map object (unbuilt:
// the first view to open the scene builds them, about a second's work), and
// the scene, each made anew with the urls between them rewritten. --exit
// <url> makes the exit switch lead there (its `to`). It checks every doc from
// a fresh repo.
//
// --set-exit changes only where a published scene's exit switch leads: one
// change to its doc, checked from a fresh repo; nothing new is made.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { packageProblems, withPackages } from "./scene-packages.mjs";

// The published scene names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"): the
// scene, the map's (doom), the doors' (joints), the exit's (traversal) and
// play's (arena). The probe page has no registry that says where its plugins
// come from, so they're stated here.
const PACKAGES = ["scene", "doom", "joints", "traversal", "arena"];

// --flag (no value), --flag <value>, and --set-exit <scene> <url>
const ARITY = { sync: 1, settle: 1, "dry-run": 0, show: 0, shots: 1, exit: 1, "set-exit": 2 };
const args = {};
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) {
    bad.push(a);
    continue;
  }
  const vals = process.argv.slice(i + 1, i + 1 + ARITY[k]);
  if (vals.length < ARITY[k] || vals.some((v) => v.startsWith("--"))) {
    bad.push(`${a} (wants ${ARITY[k]} value${ARITY[k] === 1 ? "" : "s"})`);
    continue;
  }
  args[k] = ARITY[k] === 0 ? true : ARITY[k] === 1 ? vals[0] : vals;
  i += ARITY[k];
}
const LINK = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
if (typeof args.exit === "string" && !LINK.test(args.exit)) bad.push(`--exit ${args.exit} (not a bare automerge URL)`);
if (args["set-exit"] && !args["set-exit"].every((u) => LINK.test(u))) bad.push(`--set-exit ${args["set-exit"].join(" ")} (not two bare automerge URLs)`);
if (args.exit && args["set-exit"]) bad.push("--exit with --set-exit (one publishes a new scene, the other changes a published one)");
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before any repo exists, with the usage above.
if (bad.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  const help = bad.length === 1 && bad[0] === "--help";
  if (!help) console.error(`unknown or bad argument${bad.length === 1 ? "" : "s"}: ${bad.join(" ")}\n`);
  console.error(usage);
  process.exit(help ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const EXIT_TO = args.exit ?? null;
const EXIT = "traversal.exit";
const J = JSON.stringify;

if (args["set-exit"]) {
  await setExit(...args["set-exit"]);
  process.exit(0);
}

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const WAD = join(PKG, "src/test/e1m1.wad");
for (const p of ["scene/dist/index.js", "arena/dist/index.js", "joints/dist/index.js", "traversal/dist/index.js", "doom/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "doom-e1m1"));

// ─── make it in the browser, with the tools ─────────────────────────────────
const { browser, checklist, sleep } = await import("./cdp.mjs");
const b = await browser({ root: ROOT, port: 4931, cdp: 9931, page: "/doom/probes/e1m1-probe.html", width: 1200, height: 720, show: !!args.show, timeout: 600_000, mounts: { "/wad": WAD } });
const P = (e) => b.js(`window.__p.${e}`);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
let snapshot = null;
try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await P("errors").catch(() => null));
  check("the empty scene takes pastes (editing's Add)", await b.waitFor(`window.__p.running().includes("scene.add")`, 30_000));
  await P("paste()");
  const all = await b.waitFor(`(() => { const l = window.__p.loaded(); return l.total >= 14 && l.loaded === l.total; })()`, 120_000);
  check("pasted, the map is laid out, built and loaded", all, { loaded: await P("loaded()"), status: await P("status()") });
  const doc = await P("doc()");
  const objs = Object.entries(doc.objects);
  const group = objs.find(([, o]) => o.kind === "group");
  const parts = objs.filter(([, o]) => o.kind !== "group");
  const statics = parts.filter(([, o]) => o.providerId === "doom-map" && !o.parent);
  const root = statics[0]?.[0];
  const doors = parts.filter(([, o]) => o.traits?.["joints.slide"]);
  const exits = parts.filter(([, o]) => o.traits?.[EXIT]);
  const spawns = parts.filter(([, o]) => o.traits?.["arena.spawn"]);
  const renders = {};
  for (const [id, o] of parts) if (o.renderUrl) renders[id] = await P(`find(${J(o.renderUrl)})`);
  report.details.layout = parts.map(([id, o]) => `${o.name}: ${o.providerId} ${J(renders[id]?.params ?? null)}`);
  check("one group, E1M1: the static part, 11 doors, one exit switch and arena's spawn point, all under the static part", parts.length === 14 && group?.[1].name === "E1M1" && statics.length === 1 && doors.length === 11 && exits.length === 1 && spawns.length === 1 && parts.every(([id, o]) => id === root || o.parent === root) && parts.every(([, o]) => o.group === group[0]));
  check("each door slides up by its travel and closes itself after its wait, shut", doors.every(([, o]) => { const s = o.traits["joints.slide"]; return s.at === "closed" && s.axis.join() === "0,1,0" && s.stops.open > 0 && s.wait > 4; }));
  const [exitId, exit] = exits[0] ?? [];
  check("the exit switch is its own part of the map (line 407), an exit called Exit that leads nowhere yet", exit?.name === "Exit switch" && renders[exitId]?.params?.map === "E1M1" && renders[exitId]?.params?.line === 407 && renders[exitId]?.params?.door == null && J(exit.traits[EXIT]) === J({ verb: "Exit" }) && exit.locked === true, exit && { traits: exit.traits, params: renders[exitId]?.params });
  check("every map part is the WAD seen through doom-map", parts.filter(([, o]) => o.providerId === "doom-map").every(([id, o]) => o.sourceUrl === doc.objects[root].sourceUrl && renders[id]?.parent === o.sourceUrl));
  const home = await P("startHere()");
  const after = await P("doc()");
  const spawnAt = spawns[0] && after.objects[spawns[0][0]].transform.position;
  check("it starts in play, a level under its own sky, its home view at the player 1 start's eye", after.view.activity === "play" && after.traits["arena.level"]?.look === "sky" && !home.error && Math.abs(home.position[1] - home.target[1]) < 1e-9, { home, spawnAt, view: after.view });
  const wadDoc = await P(`find(${J(doc.objects[root].sourceUrl)})`);
  const about = group ? await P(`find(${J(group[1].infoUrl)})`) : null;
  check("Freedoom's notice is on the WAD doc and in the About, which says it isn't Freedoom", /Redistribution and use/.test(wadDoc.origin?.notice ?? "") && /All rights reserved/.test(about?.content ?? "") && /not Freedoom/.test(about?.content ?? ""), { origin: wadDoc.origin?.name });
  check("nothing failed to load", Object.values(await P("status()")).every((s) => s?.state !== "error"), await P("status()"));
  check("no notices", (await P("notices()")).length === 0, await P("notices()"));
  await sleep(800);
  report.shots.push(await b.shot(join(SHOTS, "e1m1-start.png")));
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
  snapshot = await P("snapshot()");
  snapshot.exit = exitId;
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(J(report, null, 2));
if (list.failed || !snapshot) b.stop(1);
else await publish(snapshot);

// ─── publish ────────────────────────────────────────────────────────────────
async function publish(snap) {
  const docs = { ...snap.docs, [snap.scene]: withPackages(snap.docs[snap.scene], PACKAGES) };
  // where the exit switch leads, when asked: its `to`, and nothing else
  if (EXIT_TO) {
    const scene = structuredClone(docs[snap.scene]);
    scene.objects[snap.exit].traits[EXIT].to = EXIT_TO;
    docs[snap.scene] = scene;
  }
  const leads = Object.values(docs[snap.scene].objects).filter((o) => o.traits?.[EXIT]).map((o) => o.traits[EXIT].to ?? null);
  if (leads.length !== 1 || leads[0] !== EXIT_TO) {
    console.error(`  the exit switch should lead to ${EXIT_TO ?? "nowhere"}; the exits lead to ${J(leads)}`);
    return b.stop(1);
  }
  const stamped = packageProblems(docs[snap.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  // the render docs go unbuilt: a build is of its source at its heads, and the
  // WAD is made anew; the first view to open the scene builds each part
  const renderUrls = Object.values(docs[snap.scene].objects).map((o) => o.renderUrl).filter(Boolean);
  for (const u of renderUrls) {
    const r = docs[u];
    docs[u] = { "@patchwork": r["@patchwork"], title: r.title, parent: r.parent, providerId: r.providerId, params: r.params, glbUrl: null, builtFrom: null, builtAt: null, bounds: r.bounds ?? null, status: "idle", error: null, pinned: false };
  }
  const count = Object.keys(docs).length;
  console.log(`the exit switch leads ${EXIT_TO ? `to ${EXIT_TO}` : "nowhere"}`);
  if (DRY) {
    console.log(`dry run: ${count} docs (the scene, the WAD, the About, ${renderUrls.length} render docs and ${count - 3 - renderUrls.length} file${count - 3 - renderUrls.length === 1 ? "" : "s"}; nothing published)`);
    return b.stop(0);
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
  const fromBytes = (v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? new Uint8Array(Buffer.from(v.$bytes, "base64")) : v);
  const revive = (doc) => JSON.parse(JSON.stringify(doc), (k, v) => fromBytes(v));
  const renamed = new Map();
  const rewrite = (doc) => {
    let text = JSON.stringify(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  // nobody who made it is here: claims don't travel
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  // what's pointed at first: the WAD, the About and the files; then the render docs; then the scene
  const leaves = Object.keys(docs).filter((u) => u !== snap.scene && !renderUrls.includes(u));
  for (const u of leaves) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  for (const u of renderUrls) renamed.set(u, (await repo.create2(rewrite(docs[u]))).url);
  const scene = await repo.create2(rewrite(unclaimed(docs[snap.scene])));
  const made = [scene.url, ...renamed.values()];
  const wadUrl = renamed.get(snap.wad);

  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const url of made) {
    try {
      const got = (await within(30000, checker.find(url))).doc();
      let problem = !got || !Object.keys(got).length ? "empty" : null;
      if (!problem && url === scene.url) {
        const os = Object.values(got.objects ?? {}).filter((o) => o.kind !== "group");
        const exits = os.filter((o) => o.traits?.[EXIT]);
        if (packageProblems(got, PACKAGES).length) problem = `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
        else if (got.view?.activity !== "play") problem = `came back with view.activity ${J(got.view?.activity)}`;
        else if (os.length !== 14) problem = `came back with ${os.length} objects`;
        else if (exits.length !== 1 || (exits[0].traits[EXIT].to ?? null) !== EXIT_TO) problem = `came back with its exit leading somewhere else than ${EXIT_TO ?? "nowhere"}`;
        else if (got.claims) problem = "came back with claims";
      }
      if (!problem && renderUrls.map((u) => renamed.get(u)).includes(url) && got.parent !== wadUrl) problem = "a render doc not of the WAD";
      if (!problem && url === wadUrl && !(got.content?.byteLength > 0)) problem = "a WAD doc with no bytes";
      if (problem) missing.push(`${url} (${problem})`);
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    return b.stop(1);
  }
  console.log(`\n  scene  https://patchwork.inkandswitch.com/#doc=${scene.url}\n`);
  return b.stop(0);
}

// ─── --set-exit: where a published scene's exit switch leads ────────────────
async function setExit(sceneUrl, url) {
  if (DRY) {
    console.log(`dry run: would set ${sceneUrl}'s exit switch to lead to ${url} (one change), and check it from a fresh repo; nothing touched`);
    return;
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
  const handle = await within(30000, repo.find(sceneUrl));
  const doc = handle.doc();
  const exits = Object.entries(doc?.objects ?? {}).filter(([, o]) => o.traits?.[EXIT]);
  if (doc?.["@patchwork"]?.type !== "scene" || exits.length !== 1 || exits[0][1].name !== "Exit switch") {
    console.error(`  ${sceneUrl} isn't a scene with one exit, its exit switch (it has ${exits.length} exit${exits.length === 1 ? "" : "s"}: ${exits.map(([, o]) => o.name).join(", ") || "none"})`);
    process.exit(1);
  }
  const [id] = exits[0];
  const before = exits[0][1].traits[EXIT].to ?? null;
  handle.change((d) => {
    d.objects[id].traits[EXIT].to = url;
  });
  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const got = (await within(30000, checker.find(sceneUrl))).doc();
  const now = got?.objects?.[id]?.traits?.[EXIT]?.to ?? null;
  console.log(`the exit switch led to ${before ?? "nowhere"}; from a fresh repo it now leads to ${now ?? "nowhere"}`);
  if (now !== url) {
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    process.exit(1);
  }
  process.exit(0);
}
