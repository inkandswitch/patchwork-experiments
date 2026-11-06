// Publish a ship at sea to a real sync server and print its Patchwork URL.
//
//   node probes/publish-ship.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-ship.mjs --dry-run
//
// Makes NEW docs on every run (no dedupe): an empty scene, made the way the
// scene datatype makes one, then the "Ship at sea" template run on it with a
// context built on this node repo, exactly as the start screen runs it. So
// the doc is what a maker gets from New → scene → Ship at sea: the sea trait,
// the sloop and its stations, landmarks, one GLB file doc per part, and
// `view.activity` "play", so whoever opens it is aboard.
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing. Otherwise it flushes and asks a repo that has never seen
// them for every doc it made (as the arena's publish-level does).

import template from "../src/template.js";

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
  view: { units: "m", grid: true, axes: true, bounds: false, snap: true },
});

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
  notify: (text) => console.log(`  (the template says: ${text})`),
});

// ─── checks: it opens in play, with a sea, a ship and its stations ───────────
const d = scene.doc();
const objects = Object.values(d.objects);
const has = (trait) => objects.filter((o) => o.traits?.[trait]).length;
const problems = [];
if (d.view?.activity !== "play") problems.push(`view.activity is ${JSON.stringify(d.view?.activity)}, not "play"`);
if (!d.traits?.["sailing.sea"]) problems.push("no sailing.sea trait");
for (const t of ["sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor"]) if (has(t) !== 1) problems.push(`${has(t)} objects with ${t}`);
const glbs = [...new Set(objects.map((o) => o.sourceUrl).filter(Boolean))];
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const made = [scene.url, ...glbs];
console.log(`scene ${scene.url}: ${objects.length} objects, ${glbs.length} GLBs, starts in ${d.view.activity}`);
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
