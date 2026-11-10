// Publish an arena level to a real sync server and print its Patchwork URL.
//
//   node probes/publish-level.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-level.mjs --dry-run
//
// Makes NEW docs on every run (no dedupe): an empty scene, made the way the
// scene datatype makes one, then the "Arena level" template run on it with a
// context built on this node repo, exactly as the start screen runs it. So
// the doc is what a maker gets from New → scene → Arena level: the sample
// arena in a group, one GLB file doc per kind of block (kept in the scene's
// assets, as the stage's ctx.file keeps them), the arena's look, and
// `view.activity` "play", so whoever opens it is in the game.
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing.
//
// Then, as the showcase script does, it flushes and asks a repo that has
// never seen them for every doc it made, and checks the scene still says
// what it should once it comes back.

import template from "../src/template.js";
import { kindKey } from "../src/layout.js";
import { KINDS } from "../src/level.js";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
let repo;
if (DRY) {
  repo = new Repo({ network: [] });
} else {
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
}

// ─── an empty scene, as SceneDatatype.init writes it (scene/src/datatype.js) ──
// with the scene package as its suggested import, and the packages its
// contents come from listed (scene/STAGE.md, "Packages"): in the browser the
// stage works these out from the registry; here they're stated
const PACKAGES = ["scene", "arena"];
const scene = await repo.create2({
  "@patchwork": scenePatchwork(),
  title: "Arena level",
  objects: {},
  order: [],
  dimensions: {},
  traits: {},
  assets: {},
  packages: scenePackages(PACKAGES),
  view: { units: "m", grid: true, axes: true, bounds: false, snap: true },
});

// ─── the template's create(ctx), with the drop context's parts it uses ──────
// (scene/src/stage/stage.js makeDropContext; the stage's newId is the same)
const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const ctx = {
  id: "arena-level",
  repo,
  handle: scene,
  url: scene.url,
  doc: () => scene.doc(),
  change: (fn) => scene.change(fn),
  newId,
  notify: (text) => console.log(`  (the template says: ${text})`),
  // the scene's own file doc for a key, made once (doc.assets[key])
  async file(key, make) {
    const known = scene.doc().assets?.[key];
    if (known) return known;
    const { name, bytes, extension, mimeType, hint = null } = make();
    const file = await repo.create2({ "@patchwork": { type: "file" }, name, extension, mimeType, content: bytes });
    scene.change((d) => {
      if (!d.assets[key]) d.assets[key] = { url: file.url, hint };
    });
    return scene.doc().assets[key];
  },
};
await template.create(ctx);

// ─── checks: it opens in play, and every block shows a GLB made here ─────────
const d = scene.doc();
const assets = d.assets ?? {};
const glbs = Object.values(assets).map((a) => a.url);
const problems = [];
if (d.view?.activity !== "play") problems.push(`view.activity is ${JSON.stringify(d.view?.activity)}, not "play"`);
if ("kits" in (d.view ?? {})) problems.push("view still has kits");
problems.push(...packageProblems(d, PACKAGES));
for (const kind of Object.keys(KINDS)) if (!assets[kindKey(kind)]?.url) problems.push(`no GLB for ${kind}`);
const blocks = Object.entries(d.objects).filter(([, o]) => o.kind !== "group");
for (const kind of Object.keys(KINDS)) if (!assets[kindKey(kind)]?.hint?.bounds) problems.push(`the ${kind} GLB has no hint`);
if (Object.keys(d.traits?.["arena.level"] ?? {}).join() !== "look") problems.push(`the level trait holds ${JSON.stringify(d.traits?.["arena.level"])}, not just its look`);
for (const [id, o] of blocks) {
  if (!glbs.includes(o.sourceUrl)) problems.push(`${id} (${o.name}) shows a GLB that isn't the level's`);
  if (!o.hint?.bounds) problems.push(`${id} (${o.name}) has no hint`);
  if (o.traits?.["arena.target"]?.down) problems.push(`${id} (${o.name}) starts knocked down`);
}
const targets = blocks.filter(([, o]) => o.traits?.["arena.target"]).length;
const spawns = blocks.filter(([, o]) => o.traits?.["arena.spawn"]).length;
if (!targets || !spawns) problems.push(`${targets} targets and ${spawns} spawn points`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const made = [scene.url, ...glbs];
console.log(`scene ${scene.url}: ${blocks.length} blocks (${targets} targets, ${spawns} spawn points), ${glbs.length} GLBs, starts in ${d.view.activity}`);

if (DRY) {
  console.log(`dry run: ${made.length} docs (nothing published)`);
  process.exit(0);
}

// ─── flush, then prove every doc is there from a repo that has never seen it ──
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
const missing = [];
for (const url of made) {
  try {
    const got = (await within(30000, checker.find(url))).doc();
    if (!got || !Object.keys(got).length) missing.push(`${url} (empty)`);
    else if (url === scene.url && packageProblems(got, PACKAGES).length) missing.push(`${url} (came back wrong: ${packageProblems(got, PACKAGES).join("; ")})`);
    else if (url === scene.url && got.view?.activity !== "play") missing.push(`${url} (came back without view.activity "play")`);
    else if (url !== scene.url && !(got.content?.byteLength > 0)) missing.push(`${url} (a GLB doc with no bytes)`);
  } catch (err) {
    missing.push(`${url} (${err?.message ?? err})`);
  }
}
console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`);
if (missing.length) {
  for (const m of missing) console.error(`  missing ${m}`);
  console.error(`\nNOT verified: re-run, or raise --settle.`);
  process.exit(1);
}
console.log(`\n  https://patchwork.inkandswitch.com/#doc=${scene.url}\n`);
process.exit(0);
