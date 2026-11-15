// Publish "Arcade" to a real sync server and print its Patchwork URL: a small
// scene with two machines already published standing in it as cabinets, and
// doom/'s whole map of the Doom's level laid out beside it, in which its game
// is drawn (machine/HOST.md, phase 2b). A machine in a scene: something
// nobody wrote for the stage, composed into one.
//
//   (in machine/) node probes/publish-arcade.mjs \
//     [--doom automerge:…] [--snes automerge:…] [--title Arcade] [--dry-run] [--sync wss://…] [--settle 8000]
//
// --doom and --snes default to the published "Doom · Freedoom E1M1 · co-op"
// and "Super Nintendo · Unarmed" machine docs. Each cabinet's source IS that
// machine doc, linked, never copied: the doc's own `session` stays the
// Machine tool's, on the wall clock; the cabinet's session and its seats (one
// per port) are its trait's, made by the first view that can write the scene
// (extension.js, sessionMaker), so the published doc carries none.
//
// The world is what "Lay out its world" writes (extension.js layOut): a file
// doc of the game's IWAD (worlds.js wadFile's shape, its bytes the machine's
// own content's), doom/'s `doom-map` source asked for by id with `whole:
// true`, placed by worlds.js besideCabinet, carrying `machine.world: {
// machine, source }`. Its map is the level the game boots on (its start
// arguments' -warp), worked out here as the command works it out from the
// running engine.
//
// Render docs are fresh (newRenderDoc's shape: scene/src/datatype.js): the
// first view builds them, as for any object put in. It lists scene, machine,
// doom and seats (the cabinets lay their seats through the seats package's
// roster). People start in Look, in front of the cabinets. Checks the
// machine docs on the server first, and the scene from a fresh repo after.
// Makes NEW docs on every run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";
import { doomArgs, doomWads } from "../src/patchwork/load.js";
import { doomWorld } from "../src/present/doom-world.js";
import { besideCabinet, MAP_SOURCE, WORLD } from "../src/scene/worlds.js";
import { PROVIDER, TRAIT } from "../src/scene/extension.js";

const ARITY = { doom: 1, snes: 1, title: 1, "dry-run": 0, sync: 1, settle: 1 };
const args = {};
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) { bad.push(a); continue; }
  const v = process.argv[i + 1];
  if (ARITY[k] && (v == null || v.startsWith("--"))) { bad.push(`${a} (wants a value)`); continue; }
  args[k] = ARITY[k] ? v : true;
  i += ARITY[k];
}
if (bad.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.error(`bad arguments: ${bad.join(" ")}\n\n${lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n")}`);
  process.exit(2);
}
const DOOM = args.doom ?? "automerge:ZR6RKbevuhxk8VvGeg4SGGdHc7B";
const SNES = args.snes ?? "automerge:eyTsnCUoD3qSDnX5FY6dza9Yz35";
const TITLE = args.title ?? "Arcade";
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const PACKAGES = ["scene", "machine", "doom", "seats"];
const J = JSON.stringify;

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
const find = async (url) => (await within(120000, repo.find(url))).doc();

// ─── the machines, as published ─────────────────────────────────────────────
const doom = await find(DOOM);
const snes = await find(SNES);
for (const [d, url, kind] of [[doom, DOOM, "doom"], [snes, SNES, "snes"]])
  if (d?.["@patchwork"]?.type !== "machine" || d.kind !== kind || typeof d.content !== "string") throw new Error(`${url} isn't a published ${kind} machine doc (${J({ type: d?.["@patchwork"]?.type, kind: d?.kind })})`);
const content = (await find(doom.content))?.bytes;
if (!(content instanceof Uint8Array)) throw new Error(`the Doom's content ${doom.content} has no bytes`);
const wads = doomWads(content);
if (wads.length !== 1) throw new Error(`the Doom boots ${wads.length} WADs: doom/ builds a map from one`);
// the level it boots on: -warp E M (or -warp M for a game without episodes), else the first
const a = doomArgs(content);
const w = a.indexOf("-warp");
const episodic = (() => { try { doomWorld(wads, "E1M1"); return true; } catch { return false; } })();
const MAP = w < 0 ? (episodic ? "E1M1" : "MAP01") : episodic ? `E${a[w + 1]}M${a[w + 2]}` : `MAP${String(a[w + 1]).padStart(2, "0")}`;
const extent = doomWorld(wads, MAP).extent;
console.error(`doom: ${doom.title} (${MAP}, args ${J(a)}); snes: ${snes.title}`);

// ─── the scene ──────────────────────────────────────────────────────────────
const base = (doom.title ?? "Doom").split(" · ")[0];
const render = (title, parent, providerId, params) => ({
  "@patchwork": { type: "scene-render" }, title, parent, providerId, params,
  glbUrl: null, builtFrom: null, builtAt: null, bounds: null, status: "idle", error: null, pinned: false,
});
const record = (name, sourceUrl, providerId, renderUrl, transform, traits) => ({
  name, sourceUrl, providerId, renderUrl, parent: null, group: null,
  visible: true, color: null, opacity: 1, wireframe: false, transform, traits,
});
const at = (x, z = 0, yaw = 0) => ({ position: [x, 0, z], rotation: [0, yaw, 0], scale: 1 });
const DOOM_AT = at(-1.6), SNES_AT = at(-2.8);
const matrix = (t) => new THREE.Matrix4().compose(new THREE.Vector3(...t.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation)), new THREE.Vector3(t.scale, t.scale, t.scale)).toArray();
const WORLD_AT = besideCabinet(THREE, matrix(DOOM_AT), extent);

if (DRY) {
  console.log(J({ title: TITLE, map: MAP, doomAt: DOOM_AT, snesAt: SNES_AT, worldAt: WORLD_AT, extent }, null, 1));
  process.exit(0);
}

const file = await repo.create2({ "@patchwork": { type: "file" }, name: `${base}.wad`, extension: "wad", mimeType: "application/octet-stream", content: wads[0] });
const rDoom = await repo.create2(render(doom.title, DOOM, PROVIDER, {}));
const rSnes = await repo.create2(render(snes.title, SNES, PROVIDER, {}));
const rWorld = await repo.create2(render(`${MAP} · ${base}`, file.url, MAP_SOURCE, { map: MAP, door: null, line: null, whole: true }));
const objects = {
  doom: record(doom.title, DOOM, PROVIDER, rDoom.url, DOOM_AT, { [TRAIT]: {} }),
  snes: record(snes.title, SNES, PROVIDER, rSnes.url, SNES_AT, { [TRAIT]: {} }),
  world: record(`${MAP} · ${base}`, file.url, MAP_SOURCE, rWorld.url, WORLD_AT, { [WORLD]: { machine: "doom", source: DOOM } }),
};
// in front of the cabinets and the map, looking at them, a person's eye high
const home = { position: [-0.4, 2.2, 5.2], target: [-0.4, 0.9, 0] };
const doc = {
  "@patchwork": scenePatchwork(),
  title: TITLE,
  objects,
  order: ["doom", "snes", "world"],
  dimensions: {},
  traits: {},
  assets: { wad: file.url },
  packages: scenePackages(PACKAGES),
  clock: { running: true, t: 0 },
  view: { units: "m", grid: true, axes: false, bounds: false, snap: true, start: { home } },
};
const h = repo.create(doc);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 15000)));

// ─── checked from a repo that never saw it ──────────────────────────────────
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(60000, checker.find(h.url))).doc();
const problems = packageProblems(got, PACKAGES);
if (J(Object.keys(got?.objects ?? {}).sort()) !== J(["doom", "snes", "world"])) problems.push(`came back with objects ${J(Object.keys(got?.objects ?? {}))}`);
if (got?.objects?.doom?.sourceUrl !== DOOM || got?.objects?.snes?.sourceUrl !== SNES) problems.push("a cabinet doesn't link its machine doc");
if (got?.objects?.world?.traits?.[WORLD]?.machine !== "doom") problems.push("the world doesn't name its cabinet");
for (const [k, u] of [["doom", rDoom.url], ["snes", rSnes.url], ["world", rWorld.url]]) {
  const r = (await within(60000, checker.find(u))).doc();
  if (r?.["@patchwork"]?.type !== "scene-render" || got?.objects?.[k]?.renderUrl !== u) problems.push(`${k}'s render doc didn't come back`);
}
const f = (await within(120000, checker.find(file.url))).doc();
if (!(f?.content instanceof Uint8Array) || f.content.length !== wads[0].length) problems.push(`the WAD file doc came back with ${f?.content?.length} bytes, not ${wads[0].length}`);
if (problems.length) {
  console.error(`NOT verified from a fresh repo:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`verified from a fresh repo\n\n  ${TITLE}  https://patchwork.inkandswitch.com/#doc=${h.url}\n  wad    ${file.url}\n`);
process.exit(0);
