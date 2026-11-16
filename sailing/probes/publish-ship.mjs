// Publish a ship at sea to a real sync server and print its Patchwork URL.
//
//   node probes/publish-ship.mjs [--anchor] [--sync wss://…] [--settle 8000]
//   node probes/publish-ship.mjs [--anchor] --dry-run
//
// --anchor runs the "Ship at anchor" template instead (titled so).
//
// Makes NEW docs on every run (no dedupe): an empty scene, made the way the
// scene datatype makes one, then the "Ship at sea" template run on it with a
// context built on this node repo, exactly as the start screen runs it. So
// the doc is what a maker gets from New → scene → Ship at sea: the weather
// and a Sea (open water with a sea on it), the sloop and its stations, landmarks, the scene's one GLB file doc per
// kind of piece (recorded at doc.assets[key] by ctx.file, as the stage's
// sceneFile does), and `view.start` off her quarter (Look, no body named, where a click
// comes aboard).
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing. Otherwise it flushes and asks a repo that has never seen
// them for every doc it made (as the arena's publish-level does).

import shipAtSea, { atAnchor } from "../src/template.js";
import { fileKey } from "../src/parts.js";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";
import { emptyScene } from "./empty-scene.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
const DRY = !!args["dry-run"];
const ANCHORED = !!args.anchor;
const template = ANCHORED ? atAnchor : shipAtSea;
const TITLE = ANCHORED ? "Ship at anchor" : "Ship at sea";
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
if (!DRY) console.log(`connected to ${SYNC}`);

// ─── an empty scene, as SceneDatatype.init writes it (empty-scene.js) ──────
// with the scene package as its suggested import, and the packages its
// contents come from listed (scene/STAGE.md, "Packages"): in the browser the
// stage works these out from the registry; here they're stated (joints and
// traversal for the sloop's companionway: its hatch's slide, its exit)
const PACKAGES = ["scene", "sailing", "water", "joints", "traversal"];
const scene = await repo.create2(emptyScene({ title: TITLE, patchwork: scenePatchwork(), packages: scenePackages(PACKAGES) }));

// ─── ctx.file, as the stage's sceneFile (scene/src/stage/stage.js) ──────────
// The scene's own file doc for `key`: the one doc.assets[key] names, else one
// made now from make() and recorded there as { url, hint } ({ url } when make
// gives no hint). Two calls for one key at once make one doc.
const filesMaking = new Map();
async function sceneFile(key, make) {
  if (typeof key !== "string" || !key) throw new Error("A file needs a key.");
  const known = () => {
    const a = scene.doc().assets?.[key];
    // fresh copies: automerge won't take a value that is already in a document
    return typeof a?.url === "string" ? { url: a.url, hint: a.hint ? JSON.parse(JSON.stringify(a.hint)) : null } : null;
  };
  const have = known();
  if (have) return have;
  if (filesMaking.has(key)) return filesMaking.get(key);
  const making = (async () => {
    const f = await make();
    if (!f?.bytes) throw new Error(`Nothing to make “${key}” from.`);
    const file = await repo.create2({
      "@patchwork": { type: "file" },
      name: String(f.name ?? key),
      extension: String(f.extension ?? ""),
      mimeType: String(f.mimeType ?? "application/octet-stream"),
      content: f.bytes,
    });
    const hint = f.hint ? JSON.parse(JSON.stringify(f.hint)) : null;
    scene.change((d) => {
      if (!d.assets[key]?.url) d.assets[key] = hint ? { url: file.url, hint } : { url: file.url };
    });
    return known() ?? { url: file.url, hint };
  })();
  filesMaking.set(key, making);
  try {
    return await making;
  } finally {
    filesMaking.delete(key);
  }
}

// ─── the template's create(ctx), with the drop context's parts it uses ──────
const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
await template.create({
  id: ANCHORED ? "ship-at-anchor" : "ship-at-sea",
  repo,
  handle: scene,
  url: scene.url,
  doc: () => scene.doc(),
  change: (fn) => scene.change(fn),
  newId,
  file: sceneFile,
  notify: (text) => console.log(`  (the template says: ${text})`),
});

// ─── checks: it opens in play, with a sea, a ship and its stations, and every
// piece shows the scene's one file for its kind ──────────────────────────────
const d = scene.doc();
const objects = Object.values(d.objects);
const has = (trait) => objects.filter((o) => o.traits?.[trait]).length;
const problems = [];
if (!d.view?.start?.home || "body" in d.view.start || "activity" in (d.view ?? {})) problems.push(`view is ${JSON.stringify(d.view)}: no view.start.home, a body named (she starts people in Look), or an old view.activity`);
if (!d.traits?.["sailing.weather"]) problems.push("no sailing.weather trait");
const seas = objects.filter((o) => o.traits?.water);
if (seas.length !== 1 || seas[0].traits.water.size != null || !seas[0].traits["sailing.sea"] || d.objects[d.order[0]] !== seas[0]) problems.push(`want one Sea first in the order (open water with a sea on it), have ${JSON.stringify(seas.map((o) => o.name))}`);
if (d.traits?.["sailing.sea"] || d.traits?.water) problems.push("a sea or water trait left on the scene (they are a Sea object's now)");
for (const t of ["sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor"]) if (has(t) !== 1) problems.push(`${has(t)} objects with ${t}`);
const KINDS = ["hull", "rig", "mast", "jib", "winch", "windlass", "mainsheet", "wheel", "anchor", "islet", "ladder", "companionway", "hatch", "redBuoy", "greenBuoy"];
const keys = KINDS.map(fileKey).sort();
const assets = d.assets ?? {};
if (JSON.stringify(Object.keys(assets).sort()) !== JSON.stringify(keys)) problems.push(`doc.assets has ${JSON.stringify(Object.keys(assets).sort())}, not ${JSON.stringify(keys)}`);
for (const [k, a] of Object.entries(assets)) {
  if (typeof a?.url !== "string" || !a.hint?.bounds) problems.push(`doc.assets[${k}] is not { url, hint }`);
  else if (JSON.stringify(Object.keys(a).sort()) !== '["hint","url"]') problems.push(`doc.assets[${k}] has ${Object.keys(a)}`);
}
const glbs = Object.values(assets).map((a) => a.url);
problems.push(...packageProblems(d, PACKAGES));
if (new Set(glbs).size !== glbs.length) problems.push("two asset keys share a file");
for (const o of objects) if (o.providerId === "file-glb" && !glbs.includes(o.sourceUrl)) problems.push(`${o.name}'s sourceUrl ${o.sourceUrl} is not one of the scene's assets`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const made = [scene.url, ...glbs];
console.log(`scene ${scene.url}: ${objects.length} objects, ${glbs.length} GLBs (doc.assets), starts people ${JSON.stringify(d.view.start)}`);
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
    else if (url === scene.url && !Object.values(got.objects ?? {}).some((o) => o.traits?.water && o.traits["sailing.sea"])) missing.push(`${url} (came back without its Sea)`);
    else if (url === scene.url && Object.keys(got.assets ?? {}).length !== keys.length) missing.push(`${url} (came back without its assets)`);
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
