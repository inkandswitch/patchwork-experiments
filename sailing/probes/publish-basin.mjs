// Publish the Model basin (water/WATER.md, "Water bodies", the exhibit for
// the lead's yes to an inner world keeping its own water) to a real sync
// server and print its Patchwork URL.
//
//   node probes/publish-basin.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-basin.mjs --dry-run [--out <file.json>]
//   node probes/publish-basin.mjs --mashup --basin <url> --ship <url> [--offline <docs.json>] [--sync wss://…]
//
// The basin is a doc with no open water and no weather: a box of water, 30 m
// across and 3 m deep (an object with the water package's trait, `{ size }`,
// and no source), and the sloop in it, sails down, at rest. Its water is a
// thing, so it travels with the doc: linked into a dry room beside Ship at
// sea, the basin's sloop still floats on it, flat and still (the room has no
// wind), and Ship at sea, whose water is open (weather) but clipped, floats on
// a block of her own sea that comes along into the dry room (WATER.md,
// "Clipped open water", Decision 91). That page is published by
// scene/probes/publish-links.mjs, laid out so her block (116 x 223 m) clears
// the basin by 11.1 m (WATER.md Decision 121; at the old -18/+18 it covered
// it), its home worked out by publish-links --frame to hold the basin, her
// block and both boats in Patchwork's narrow pane (WATER.md Decision 122).
// The scene package can't see a body of water, so the basin's box and her
// block go to publish-links as --box arguments; --mashup prints the whole
// command with them, read from the two published docs (or from --offline
// docs: { [url]: doc }, as --dry-run --out and publish-ship --dry-run --out
// write), and publishes nothing:
//
//   (in sailing/) node probes/publish-basin.mjs --mashup --basin <basin> --ship <ship>
//   (in scene/)   node probes/publish-links.mjs --title "Model basin and Ship at sea" \
//     --link "Model basin=<basin>@-20,0,35@20" --link "Ship at sea=<ship>@20,0,0" \
//     --frame --heading <her block's turn> --box "1:…" --box "2:…"
//
// No glass tank is drawn round the basin: no part makes one, and the box's
// edges are where its patch of water ends (WATER.md Decision 59).
//
// Makes NEW docs on every run (no dedupe). --dry-run makes them in a repo
// with no network and checks them, but publishes nothing; --out (with
// --dry-run) writes the scene doc as JSON, { [url]: doc }.

import { sloopFiles, sloopObjects, writeObjects } from "../src/parts.js";
import { JIB, SAIL } from "../src/traits.js";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";
import { emptyScene } from "./empty-scene.js";
import { waterBoxes } from "./water-boxes.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const J = JSON.stringify;
/** Where Model basin and Ship at sea places them (WATER.md Decision 121): its --link arguments' places. */
const MASHUP = { basin: "-20,0,35@20", ship: "20,0,0" };

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();

// ─── --mashup: the publish-links command for Model basin and Ship at sea ──────
if (args.mashup) {
  const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
  if (!BARE.test(args.basin ?? "") || !BARE.test(args.ship ?? "")) {
    console.error("--mashup wants --basin <url> and --ship <url>");
    process.exit(2);
  }
  const offline = typeof args.offline === "string" ? JSON.parse(readFileSync(args.offline, "utf8")) : null;
  const net = offline ? null : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const specs = [];
  for (const [n, name, url, kind] of [[1, "Model basin", args.basin, "size"], [2, "Ship at sea", args.ship, "clip"]]) {
    const d = offline ? offline[url] : (await within(60000, net.find(url))).doc();
    const w = waterBoxes(d);
    // the basin is one bounded body; she is one open Sea with a clip (a boat published before clips has none)
    if (w.length !== 1 || w[0].kind !== kind) {
      console.error(`${name} (${url}) has ${J(w.map((b) => b.kind))} bodies of water, not one ${kind === "size" ? "basin" : "clipped Sea"}`);
      process.exit(1);
    }
    specs.push(`--box "${n}:${w[0].spec}"`);
    // looked at along her block's length: her block is the most there is to frame (her Sea's turn, as her link
    // doesn't turn her), with the basin in front of it
    if (kind === "clip") specs.unshift(`--heading ${w[0].yaw}`);
  }
  console.log(`(in scene/) node probes/publish-links.mjs --title "Model basin and Ship at sea" \\\n  --link "Model basin=${args.basin}@${MASHUP.basin}" --link "Ship at sea=${args.ship}@${MASHUP.ship}" \\\n  --frame ${specs.join(" ")}`);
  process.exit(0);
}
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
if (!DRY) console.log(`connected to ${SYNC}`);

// the sloop's companionway needs joints and traversal; the basin is water's; the sloop sailing's
const PACKAGES = ["scene", "water", "sailing", "joints", "traversal"];
/** The basin: 30 m across, 3 m deep. */
const BASIN = [30, 3, 30];
const scene = await repo.create2(emptyScene({ title: "Model basin", patchwork: scenePatchwork(), packages: scenePackages(PACKAGES) }));

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

// ─── the basin and the sloop in it, in one change ───────────────────────────
const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const files = await sloopFiles({ repo, file: sceneFile, newId });
// at rest in the middle, her sails down (the basin has no wind: there is no weather here)
const ship = sloopObjects({ position: [0, 0, 0], yaw: 0 }, files, newId, {}, { settings: { [SAIL]: { raised: 0 }, [JIB]: { furl: 1 } } });
scene.change((d) => {
  d.objects.basin = {
    name: "Basin", sourceUrl: null, providerId: null, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    traits: { water: { size: [...BASIN] } },
  };
  d.order.push("basin");
  writeObjects(d, ship);
  // people start in Look over the basin's corner, where they see her afloat in it
  d.view.start = { home: { position: [22, 12, 26], target: [0, 1, 0] } };
});

// ─── checks ─────────────────────────────────────────────────────────────────
const d = scene.doc();
const objects = Object.values(d.objects);
const problems = [];
const waters = objects.filter((o) => o.traits?.water);
if (waters.length !== 1 || JSON.stringify(waters[0].traits.water.size) !== JSON.stringify(BASIN)) problems.push(`want one bounded water (the basin), have ${JSON.stringify(waters.map((o) => o.traits.water))}`);
if (Object.keys(d.traits ?? {}).length) problems.push(`scene traits ${JSON.stringify(Object.keys(d.traits))}: the basin has no weather and no open water`);
const has = (trait) => objects.filter((o) => o.traits?.[trait]).length;
for (const t of ["sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor"]) if (has(t) !== 1) problems.push(`${has(t)} objects with ${t}`);
const hull = objects.find((o) => o.traits?.["sailing.ship"]);
if (!hull || hull.transform.position.some((v) => v !== 0)) problems.push("the sloop isn't in the middle of the basin");
problems.push(...packageProblems(d, PACKAGES));
const glbs = Object.values(d.assets ?? {}).map((a) => a.url);
for (const o of objects) if (o.providerId === "file-glb" && !glbs.includes(o.sourceUrl)) problems.push(`${o.name}'s sourceUrl ${o.sourceUrl} is not one of the scene's assets`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const made = [scene.url, ...glbs];
console.log(`scene ${scene.url}: ${objects.length} objects (the basin ${JSON.stringify(BASIN)} and the sloop), ${glbs.length} GLBs, starts people ${JSON.stringify(d.view.start)}`);
if (DRY) {
  if (typeof args.out === "string") {
    writeFileSync(args.out, JSON.stringify({ [scene.url]: d }));
    console.log(`wrote ${args.out}`);
  }
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
    else if (url === scene.url && JSON.stringify(got.objects?.basin?.traits?.water?.size) !== JSON.stringify(BASIN)) missing.push(`${url} (came back without its basin)`);
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
