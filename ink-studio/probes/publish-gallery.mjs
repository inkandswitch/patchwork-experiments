// Publish "Ink Studio gallery": the Quiet games room (a published scene,
// read from the sync server, never written) copied as a gallery of ink-scene
// docs from the Ink Studio examples folder. The room's architecture is kept,
// its GLB file docs shared by URL. Its three game tables go, with everything on
// and under them. In their places stand plinths with ink worlds on them, and
// one more world stands in the tokonoma. Prints the new scene's URL. Every run
// makes NEW docs: one plinth GLB file doc, one render doc per exhibit (left
// unbuilt: the first viewer's stage builds it), the scene.
//
//   (in ink-studio/) node probes/publish-gallery.mjs [--room <url>] [--folder <url>] [--add-to-folder] [--dry-run]
//
// --add-to-folder puts the gallery first in the Ink Studio examples folder.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadScene } from "../src/load-scene.js";
import { proxyMesh } from "../src/proxy.js";
import { encodeGLB } from "../src/glb.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ROOM = arg("--room", "automerge:3eFg6Q8p68TXaqwEcLvxZ9oxeUzH");
const FOLDER = arg("--folder", "automerge:2iDSvEtX4YC5BZY1aabfrC3geUBv");
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const DRY = process.argv.includes("--dry-run");
const PACKAGES = { scene: "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F", walk: "automerge:3PVDGS93diw3TJyJePBzHDSMQhXp" };
const INK = JSON.parse(readFileSync(join(here, ".pushwork/config.json"), "utf8")).rootUrl;

// the room's tables, by name: they go, and all that hangs on them
const TABLES = ["Lost Cities table", "Santorini table", "Dominoes table", "Draw Dominoes table"];
const PLINTH = { size: [0.9, 0.8, 0.9], on: 0.035 }; // metres; `on`: the tatami's top, as the tables stood
const FOOTPRINT = 0.8; // an exhibit's widest side, metres
// where the exhibits stand: on the tatami (x, z, metres; facing +z, the door), or in the tokonoma (its floor and depth)
const SLOTS = [
  { example: "Gear Lantern", tokonoma: { x: -7.0, y: 0.14, z: 0.07, depth: 0.6, turn: Math.PI / 2 } },
  { example: "Flooded shrine", at: [-3.6, -2.4] },
  { example: "Spiral specimens", at: [0, -2.4] },
  { example: "The lantern court", at: [3.6, -2.4] },
  { example: "Carved stone", at: [-3.6, 1.0] },
  { example: "Beacon pool", at: [3.6, 1.0] },
];

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const create = (v) => (repo.create2 ? repo.create2(v) : repo.create(v));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out`)), ms))]);
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Uint8Array ? undefined : x)));

const room = plain((await within(60000, repo.find(ROOM), "the room")).doc());
const folder = plain((await within(60000, repo.find(FOLDER), "the folder")).doc());
if (room?.["@patchwork"]?.type !== "scene") throw new Error(`${ROOM} isn't a scene`);

// --- the room without its tables
const objects = { ...room.objects };
const tables = Object.keys(objects).filter((id) => TABLES.includes(objects[id].name) && objects[id].providerId === "file-glb");
const gone = new Set(tables);
for (let grew = true; grew; ) {
  grew = false;
  for (const [id, o] of Object.entries(objects)) if (!gone.has(id) && gone.has(o.parent)) gone.add(id), (grew = true);
}
for (const id of gone) delete objects[id];
const tatami = Object.keys(objects).find((id) => objects[id].name === "Tatami");
const roomGroup = Object.keys(objects).find((id) => objects[id].kind === "group" && objects[id].name === "Room") ?? null;
console.log(`room "${room.title}": ${Object.keys(room.objects).length} objects, ${gone.size} go with the tables (${tables.length} tables)`);

/**
 * Walking (walk's supports): the room's ground holds the garden backdrop, 640 m across, which walk
 * refuses to bake (130 M columns of 5 cm; its cap is 5 M), leaving nothing to stand on, so Walk never
 * starts. The Floor becomes a `walk.support` and everything of the room's own (not the garden) hangs
 * under it, so walk bakes the 13 × 9 m interior alone. The Floor is at the origin, unturned: nothing moves.
 * (The published Quiet games room has the same problem; it isn't written here.)
 */
export function walkable(objects) {
  const floor = Object.keys(objects).find((id) => objects[id].name === "Floor");
  if (!floor) return;
  objects[floor] = { ...objects[floor], traits: { ...(objects[floor].traits ?? {}), "walk.support": {} } };
  for (const [id, o] of Object.entries(objects))
    if (id !== floor && o.kind !== "group" && o.parent == null && o.name !== "Garden") objects[id] = { ...o, parent: floor };
  // the garden is a backdrop: walked through, never baked (walk.moves with neither swept nor blocks), so the ground has nothing to refuse
  const garden = Object.keys(objects).find((id) => objects[id].name === "Garden");
  if (garden) objects[garden] = { ...objects[garden], traits: { ...(objects[garden].traits ?? {}), "walk.moves": {} } };
}

// --- the exhibits: each world built here, for its size
const toolkit = await import("../src/generated/toolkit.js");
let n = 0;
const newId = (p = "o") => `${p}${Date.now().toString(36).slice(-5)}${(n++).toString(36).padStart(3, "0")}`;
const placed = [];
for (const slot of SLOTS) {
  const entry = folder.docs.find((e) => e.name === slot.example);
  if (!entry) throw new Error(`no "${slot.example}" in the examples folder`);
  const doc = plain((await within(60000, repo.find(entry.url), slot.example)).doc());
  const scene = await loadScene(toolkit, doc);
  const world = await scene.build(scene.seed);
  const { bounds } = proxyMesh(world, { cells: 32 });
  const [w, h, d] = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
  const size = slot.tokonoma ? slot.tokonoma.depth : FOOTPRINT;
  const scale = +(size / Math.max(w, d)).toFixed(5);
  const cx = (bounds.min[0] + bounds.max[0]) / 2, cz = (bounds.min[2] + bounds.max[2]) / 2;
  placed.push({ slot, entry, doc, scale, bounds, offset: [-cx * scale, -bounds.min[1] * scale, -cz * scale], height: h * scale, splats: world.count });
  console.log(`  ${slot.example.padEnd(20)} ${String(world.count).padStart(6)} splats, ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)} → scale ${scale} (${(h * scale).toFixed(2)} m tall)`);
}

// --- the plinth: a plain box, its base at its origin
const [px, py, pz] = PLINTH.size.map((v) => v / 2);
const box = [];
const normals = [], positions = [], indices = [];
for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
  const u = (axis + 1) % 3, v = (axis + 2) % 3, half = [px, py, pz];
  const base = positions.length / 3;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = [0, 0, 0];
    p[axis] = sign * half[axis];
    p[u] = a * half[u];
    p[v] = b * half[v];
    p[1] += py; // base at y = 0
    positions.push(...p);
    const nrm = [0, 0, 0];
    nrm[axis] = sign;
    normals.push(...nrm);
  }
  indices.push(...(sign > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
}
void box;
const plinthGlb = encodeGLB({ meshes: [{ name: "plinth", positions, normals, indices, color: "#e8e1d4", roughness: 0.9 }], generator: "ink-studio gallery" });

if (DRY) {
  console.log(`dry run: ${placed.length} exhibits, ${placed.reduce((s, p) => s + p.splats, 0)} splats in all; plinth GLB ${plinthGlb.byteLength} bytes`);
  process.exit(0);
}

// --- write
const plinthFile = await create({ "@patchwork": { type: "file" }, name: "plinth.glb", extension: "glb", mimeType: "model/gltf-binary", content: plinthGlb });
const gallery = newId("g");
objects[gallery] = { kind: "group", name: "Gallery", group: null, visible: true, opacity: 1 };
const order = room.order.filter((id) => !gone.has(id));
order.push(gallery);
const transform = (position, turn = 0, scale = 1) => ({ position: position.map((v) => +v.toFixed(5)), rotation: [0, +turn.toFixed(5), 0], scale });
for (const p of placed) {
  let parent, position, turn = 0;
  if (p.slot.tokonoma) {
    const t = p.slot.tokonoma;
    parent = null;
    turn = t.turn;
    // the offset turned by `turn` about y, then the tokonoma's floor
    const [ox, oy, oz] = p.offset, c = Math.cos(turn), s = Math.sin(turn);
    position = [t.x + c * ox + s * oz, t.y + oy, t.z - s * ox + c * oz];
  } else {
    const plinth = newId();
    objects[plinth] = {
      name: `Plinth (${p.slot.example})`, sourceUrl: plinthFile.url, providerId: "file-glb", renderUrl: null,
      parent: tatami ?? null, group: gallery, visible: true, color: null, opacity: 1, wireframe: false, locked: true,
      transform: transform([p.slot.at[0], PLINTH.on, p.slot.at[1]]),
      hint: { bounds: { min: [-px, 0, -pz], max: [px, PLINTH.size[1], pz] } },
    };
    order.push(plinth);
    parent = plinth;
    position = [p.offset[0], PLINTH.size[1] + p.offset[1], p.offset[2]];
  }
  const render = await create({
    "@patchwork": { type: "scene-render" }, title: p.entry.name, parent: p.entry.url, providerId: "ink-scene", params: { cells: 48 },
    pinned: false, result: null, failure: null,
  });
  const id = newId();
  objects[id] = {
    name: p.entry.name, sourceUrl: p.entry.url, providerId: "ink-scene", renderUrl: render.url,
    parent, group: gallery, visible: true, color: null, opacity: 1, wireframe: false,
    transform: transform(position, turn, p.scale),
    hint: { bounds: { min: p.bounds.min.map((v) => +v.toFixed(4)), max: p.bounds.max.map((v) => +v.toFixed(4)) } },
    traits: { "ink.scene": { px: 3 } },
  };
  order.push(id);
}

walkable(objects);

const doc = {
  ...room,
  "@patchwork": { type: "scene", suggestedImportUrl: PACKAGES.scene },
  title: "Ink Studio gallery",
  objects,
  order,
  // arrive looking in from the door; walk from the body chip (the entrance mat is a spawn)
  view: { ...room.view, start: { home: room.view.start?.home ?? { position: [-1.35, 1.45, 4.2], target: [0.45, 0.85, -3] } } },
  packages: [{ url: PACKAGES.scene }, { url: PACKAGES.walk }, { url: INK }],
  clock: { running: true, t: 0 },
};
const scene = await create(doc);
console.log(`gallery ${scene.url}; settling…`);
await new Promise((r) => setTimeout(r, 6000));

if (process.argv.includes("--add-to-folder")) {
  const fh = await repo.find(FOLDER);
  fh.change((d) => {
    if (!d.docs.some((e) => e.url === scene.url)) d.docs.unshift({ name: "Ink Studio gallery (in the quiet games room)", type: "scene", url: scene.url });
  });
  await new Promise((r) => setTimeout(r, 4000));
}

// read back
const fresh = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = plain((await within(60000, fresh.find(scene.url), "the gallery")).doc());
const inks = Object.values(got.objects).filter((o) => o.providerId === "ink-scene");
console.log(`read back: ${Object.keys(got.objects).length} objects, ${inks.length} ink exhibits, packages ${got.packages.map((p) => p.url).join(" ")}`);
console.log(`\nInk Studio gallery: https://patchwork.inkandswitch.com/#doc=${scene.url}`);
process.exit(0);
