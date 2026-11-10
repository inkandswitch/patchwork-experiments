// Publish a ship at sea to a real sync server and print its Patchwork URL.
//
//   node probes/publish-ship.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-ship.mjs --dry-run
//
// Makes NEW docs on every run (no dedupe): an empty scene, made the way the
// scene datatype makes one, then the "Ship at sea" template run on it with a
// context built on this node repo, exactly as the start screen runs it. So
// the doc is what a maker gets from New → scene → Ship at sea: the sea trait,
// the sloop and its stations, landmarks, the scene's one GLB file doc per
// kind of piece (recorded at doc.assets[key] by ctx.file, as the stage's
// sceneFile does), and `view.activity` "play", so whoever opens it is aboard.
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing. Otherwise it flushes and asks a repo that has never seen
// them for every doc it made (as the arena's publish-level does).

import template from "../src/template.js";
import { fileKey } from "../src/parts.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
if (!DRY) console.log(`connected to ${SYNC}`);

// ─── an empty scene, as SceneDatatype.init writes it (scene/src/datatype.js) ──
const scene = await repo.create2({
  "@patchwork": { type: "scene" },
  title: "Ship at sea",
  objects: {},
  order: [],
  dimensions: {},
  traits: {},
  assets: {},
  view: { units: "m", grid: true, axes: true, bounds: false, snap: true },
});

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
  id: "ship-at-sea",
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
if (d.view?.activity !== "play") problems.push(`view.activity is ${JSON.stringify(d.view?.activity)}, not "play"`);
if (!d.traits?.["sailing.sea"]) problems.push("no sailing.sea trait");
for (const t of ["sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor"]) if (has(t) !== 1) problems.push(`${has(t)} objects with ${t}`);
const KINDS = ["hull", "rig", "mast", "jib", "winch", "windlass", "mainsheet", "wheel", "anchor", "islet", "ladder", "redBuoy", "greenBuoy"];
const keys = KINDS.map(fileKey).sort();
const assets = d.assets ?? {};
if (JSON.stringify(Object.keys(assets).sort()) !== JSON.stringify(keys)) problems.push(`doc.assets has ${JSON.stringify(Object.keys(assets).sort())}, not ${JSON.stringify(keys)}`);
for (const [k, a] of Object.entries(assets)) {
  if (typeof a?.url !== "string" || !a.hint?.bounds) problems.push(`doc.assets[${k}] is not { url, hint }`);
  else if (JSON.stringify(Object.keys(a).sort()) !== '["hint","url"]') problems.push(`doc.assets[${k}] has ${Object.keys(a)}`);
}
const glbs = Object.values(assets).map((a) => a.url);
if (new Set(glbs).size !== glbs.length) problems.push("two asset keys share a file");
for (const o of objects) if (o.providerId === "file-glb" && !glbs.includes(o.sourceUrl)) problems.push(`${o.name}'s sourceUrl ${o.sourceUrl} is not one of the scene's assets`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const made = [scene.url, ...glbs];
console.log(`scene ${scene.url}: ${objects.length} objects, ${glbs.length} GLBs (doc.assets), starts in ${d.view.activity}`);
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
    else if (url === scene.url && !got.traits?.["sailing.sea"]) missing.push(`${url} (came back without its sea)`);
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
