// Publish a Model room (water/WATER.md, "Clipped open water"; WATER Decision
// 106): a dry room, no water and no weather, with boats already published
// linked into it live as dioramas at 1:25. Each boat's open water carries a
// clip, so in a world with no open water each floats on a block of her own
// sea: the host's link says where and how big, the boat's clip how much sea
// comes along. Nothing in the room names a boat but its links; nothing in a
// boat names the room. Prints its Patchwork URL.
//
//   (in sailing/) node probes/publish-model-room.mjs \
//     --boat "Ship at anchor=automerge:…" --boat "Lost Cities aboard=automerge:…" \
//     [--title "Model room"] [--scale 25] [--gap 0.6] [--weather 5,270] [--pitch 27] [--home px,py,pz:tx,ty,tz]
//     [--dry-run] [--offline <docs.json>] [--sync wss://…] [--settle 8000]
//
// Each boat's link is turned against her Sea's heading, so every block lies
// square to the room, and laid left to right with --gap metres between the
// blocks; its height is her clip's depth (less her Sea's level) at the scale,
// so her block's floor rests on the room's floor (y = 0). --weather gives the
// room the world's wind (the weather package's `weather`) and no water: the Breezy pavilion,
// where both blocks get waves. People start in Look from --home if given,
// else from the nearest place looking down --pitch degrees (27) from the
// front from which every block, up to the top of what her doc draws, and
// every drawn thing of each boat (hull, mast, islet …) is inside the middle
// 90% of Patchwork's narrow pane (640 × 800), so inside every wider one too
// (frame.mjs fitHome; water-boxes.mjs). Either way it checks that home in the
// narrow pane and the whole window (1440 × 900), as frame-check.mjs does, and
// refuses a home that leaves any of it out.
//
// It reads each boat from the server first (a scene whose one Sea is open
// water with a valid clip: a boat published before clips has none and is
// refused, so republish her first), and after, from a fresh repo, that the
// room came back whole. --offline reads the boats from a JSON file
// ({ [url]: doc }, publish-ship.mjs --dry-run --out writes one) and needs
// --dry-run: nothing is asked of any server. --dry-run prints the doc and
// publishes nothing. Makes a NEW doc on every run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packageProblems, pushworkUrl } from "./scene-packages.mjs";
import { contentOf, fitHome, panesReport } from "./frame.mjs";
import { waterBoxes } from "./water-boxes.mjs";

const ARITY = { title: 1, boat: 1, scale: 1, gap: 1, weather: 1, pitch: 1, home: 1, "dry-run": 0, offline: 1, sync: 1, settle: 1 };
const args = { boat: [] };
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) { bad.push(a); continue; }
  const v = process.argv[i + 1];
  if (ARITY[k] && (v == null || v.startsWith("--"))) { bad.push(`${a} (wants a value)`); continue; }
  if (k === "boat") args.boat.push(v);
  else args[k] = ARITY[k] ? v : true;
  i += ARITY[k];
}
if (bad.length || !args.boat.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.error(`${bad.length ? `bad arguments: ${bad.join(" ")}\n\n` : ""}${lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n")}`);
  process.exit(2);
}
const DRY = !!args["dry-run"];
const OFFLINE = args.offline ?? null;
if (OFFLINE && !DRY) throw new Error("--offline is for a dry run: publishing reads the boats from the server");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const J = JSON.stringify;
const LINK = "scene.link";
const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
const S = 1 / Number(args.scale ?? 25);
const GAP = Number(args.gap ?? 0.6);
const PITCH = Number(args.pitch ?? 27);
const weather = args.weather ? (([wind, from]) => ({ wind, from, seed: 7 }))(args.weather.split(",").map(Number)) : null;
if (!(S > 0) || !(GAP >= 0) || !(PITCH > 0 && PITCH < 90) || (weather && ![weather.wind, weather.from].every(Number.isFinite))) throw new Error(`--scale, --gap, --pitch (0 to 90), --weather: numbers, please`);
const isBox = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isFinite(v) && v > 0);
const tidy = (v) => Math.round(v * 1e6) / 1e6 + 0;

const boats = args.boat.map((spec, i) => {
  const m = /^(.+?)=(automerge:[^@]+)$/.exec(spec);
  if (!m || !BARE.test(m[2])) throw new Error(`--boat ${J(spec)}: want NAME=automerge:…`);
  return { id: `boat-${i + 1}`, name: m[1], url: m[2] };
});

/** A package's URL; in a dry run, a placeholder for one not synced yet. */
const urlOf = (pkg) => {
  try {
    return pushworkUrl(pkg);
  } catch (err) {
    if (!DRY) throw err;
    return `<unsynced: ${pkg}>`;
  }
};

let repo = null;
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
const problems = [];
const offline = OFFLINE ? JSON.parse(readFileSync(OFFLINE, "utf8")) : null;
if (!offline) {
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
}
// each boat: a scene whose one Sea is open water with a valid clip, level
for (const b of boats) {
  const d = offline ? offline[b.url] : (await within(60000, repo.find(b.url))).doc();
  if (d?.["@patchwork"]?.type !== "scene" || !d.objects) throw new Error(`${b.name} (${b.url}) isn't a scene doc ${offline ? "in " + OFFLINE : "on the server"}`);
  const seas = Object.values(d.objects).filter((o) => o.traits?.water && o.traits.water.size == null);
  const sea = seas[0] ?? null;
  const t = sea?.transform ?? {};
  if (seas.length !== 1) problems.push(`${b.name} (${b.url}) has ${seas.length} open water objects, not one`);
  else if (!isBox(sea.traits.water.clip)) problems.push(`${b.name} (${b.url})'s Sea has no clip: she was published before clips; republish her first`);
  else if ((t.rotation?.[0] ?? 0) !== 0 || (t.rotation?.[2] ?? 0) !== 0 || (t.scale ?? 1) !== 1) problems.push(`${b.name}'s Sea is tilted or scaled: its block would be no water`);
  b.doc = d;
  b.clip = sea?.traits.water.clip ?? null;
  b.sea = { at: t.position ?? [0, 0, 0], yaw: t.rotation?.[1] ?? 0 };
  console.error(`boat: ${b.name} = ${d.title} (${Object.keys(d.objects).length} objects, clip ${J(b.clip)} at ${J(b.sea.at)} turned ${tidy((b.sea.yaw * 180) / Math.PI)}°)`);
}
if (problems.length) {
  console.error(`NOT publishing:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// the blocks, square to the room, left to right along x, centred on the origin, each floor on y = 0
const widths = boats.map((b) => b.clip[0] * S);
const total = widths.reduce((s, w) => s + w, 0) + GAP * (boats.length - 1);
let x = -total / 2;
const objects = {};
for (const [i, b] of boats.entries()) {
  const theta = -b.sea.yaw;
  const cx = x + widths[i] / 2;
  x += widths[i] + GAP;
  // the Sea's centre carried through the link (turned by theta, scaled): p + S·R(θ)·c is the block's centre
  const c = b.sea.at;
  const rx = c[0] * Math.cos(theta) + c[2] * Math.sin(theta), rz = -c[0] * Math.sin(theta) + c[2] * Math.cos(theta);
  const y = S * (b.clip[1] - c[1]);
  b.block = { centre: [tidy(cx), 0, 0], w: widths[i], l: b.clip[2] * S, floor: tidy(y + S * (c[1] - b.clip[1])) };
  objects[b.id] = {
    name: b.name, sourceUrl: b.url, providerId: LINK, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: true,
    transform: { position: [tidy(cx - S * rx), tidy(y), tidy(-S * rz)], rotation: [0, tidy(theta), 0], scale: S },
  };
}
// checks: every floor on the room's floor; no two blocks overlap
for (const b of boats) if (Math.abs(b.block.floor) > 1e-6) problems.push(`${b.name}'s block floor is at ${b.block.floor}, not the room's floor`);
for (let i = 0; i < boats.length; i++)
  for (let j = i + 1; j < boats.length; j++) {
    const a = boats[i].block, c = boats[j].block;
    if (Math.abs(a.centre[0] - c.centre[0]) < (a.w + c.w) / 2 && Math.abs(a.centre[2] - c.centre[2]) < (a.l + c.l) / 2) problems.push(`${boats[i].name}'s and ${boats[j].name}'s blocks overlap`);
  }
// what the room shows: each boat's block (her clip up to the top of what her doc draws) and every drawn
// thing of hers, through her link; a link inside a boat (her game) isn't read: it is on her deck, under the lid
const shown = contentOf({ objects, assets: {} }, Object.fromEntries(boats.map((b) => [b.url, b.doc])), { more: waterBoxes });
for (const b of boats) {
  const blocks = shown.boxes.filter((x) => x.via[0] === b.id && x.kind === "clip");
  const lo = (k) => Math.min(...blocks.flatMap((x) => x.points.map((p) => p[k]))), hi = (k) => Math.max(...blocks.flatMap((x) => x.points.map((p) => p[k])));
  // the block as water-boxes.mjs sees it through the link is the block laid out above
  // (to 1e-5: the link's transform is written to 1e-6)
  const off = (a, b) => Math.abs(a - b) > 1e-5;
  if (blocks.length !== 1 || off(lo(1), b.block.floor) || off((lo(0) + hi(0)) / 2, b.block.centre[0]) || off(hi(0) - lo(0), b.block.w) || off((lo(2) + hi(2)) / 2, 0) || off(hi(2) - lo(2), b.block.l))
    problems.push(`${b.name}'s block through her link isn't the block laid out (${blocks.length} clip boxes: x ${lo(0)}..${hi(0)}, y ${lo(1)}, z ${lo(2)}..${hi(2)})`);
}
const points = shown.boxes.flatMap((x) => x.points);
const home = args.home
  ? (([p, t]) => ({ position: p, target: t }))(args.home.split(":").map((s) => s.split(",").map(Number)))
  : fitHome(points, { pitch: PITCH });
if (![...home.position, ...home.target].every(Number.isFinite) || home.position.length !== 3 || home.target.length !== 3) throw new Error(`--home ${J(args.home)}: want px,py,pz:tx,ty,tz`);
const framed = panesReport(home, points);
for (const f of framed) if (!f.inside) problems.push(`from ${J(home)} the room's blocks and boats aren't all inside the ${f.pane} pane (x ${f.x.map((v) => v.toFixed(2))}, y ${f.y.map((v) => v.toFixed(2))})`);
// the pavilion's own doc calls for the weather alone (its boats list sailing and water themselves)
const PACKAGES = weather ? ["scene", "weather"] : ["scene"];
const doc = {
  "@patchwork": { type: "scene", suggestedImportUrl: urlOf("scene") },
  title: args.title ?? (weather ? "Breezy pavilion" : "Model room"),
  objects,
  order: boats.map((b) => b.id),
  dimensions: {},
  // no water, ever; the world's wind only for the pavilion
  traits: weather ? { weather } : {},
  assets: {},
  packages: PACKAGES.map((p) => ({ url: urlOf(p) })),
  clock: { running: true, t: 0 },
  view: { units: "m", grid: true, axes: false, bounds: false, snap: true, start: { home } },
};
console.error(J({ title: doc.title, scale: `1:${1 / S}`, weather, blocks: boats.map((b) => ({ id: b.id, name: b.name, ...b.block })), start: doc.view.start, framed: framed.map((f) => ({ pane: f.pane, x: f.x.map(tidy), y: f.y.map(tidy), inside: f.inside })), boxes: shown.boxes.length, notRead: shown.missing.map((m) => `${m.depth ? "inside a boat: " : ""}${m.url}`) }, null, 1));
if (problems.length) {
  console.error(`${DRY ? "would NOT publish" : "NOT publishing"}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
if (DRY) {
  console.log(J(doc, null, 2));
  process.exit(0);
}

const h = repo.create(doc);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const { Repo } = await import("@automerge/automerge-repo");
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(30000, checker.find(h.url))).doc();
const after = packageProblems(got, PACKAGES);
if (J(Object.keys(got?.objects ?? {}).sort()) !== J(boats.map((b) => b.id).sort())) after.push("came back without its boats");
for (const b of boats) if (got?.objects?.[b.id]?.sourceUrl !== b.url || got.objects[b.id].transform?.scale !== S) after.push(`${b.id} doesn't link ${b.url} at 1:${1 / S}`);
if (Object.values(got?.objects ?? {}).some((o) => o.traits?.water)) after.push("came back with water of its own");
if (after.length) {
  console.error(`NOT verified from a fresh repo:\n  ${after.join("\n  ")}`);
  process.exit(1);
}
console.log(`verified from a fresh repo\n\n  ${doc.title}  https://patchwork.inkandswitch.com/#doc=${h.url}\n`);
process.exit(0);
