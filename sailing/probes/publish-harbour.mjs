// Publish a harbour (water/WATER.md, "Water bodies", "Doc shapes"): a scene
// with the weather and a Sea of its own (open water with a sea on it), and
// boats already published linked into it live, each a doc of her own,
// unchanged and uncopied. In it they float on the harbour's open water, sail
// in its wind, and the one open surface drawn is its; water a boat holds as
// a thing (a tank, a basin) stays hers. Its Sea has no clip (WATER Decision
// 103): a boat's clip is silent here, where the harbour offers water.
// Nothing in the harbour names a boat but its links; nothing in a boat names
// the harbour. Prints its Patchwork URL.
//
//   (in sailing/) node probes/publish-harbour.mjs \
//     --boat "Ship at sea=automerge:…@-45,0,-125" \
//     --boat "Lost Cities aboard=automerge:…@-13,0,4" --home 6,28,70:0,0,-10 \
//     [--title Harbour] [--wind 5,250] [--seed 7] [--scale 0.5] [--home px,py,pz:tx,ty,tz] [--dry-run] [--offline] [--sync wss://…] [--settle 8000]
//
// --boat NAME=URL@x,y,z places a live, locked link there. Each boat is turned
// so the harbour's wind meets her as her own weather's did (her yaw is her
// wind's `from` less the harbour's, Decision 22), so a boat laid out on a reach is on a
// reach here and one at anchor lies head to wind. People start in Look over
// the boats, from --home if given, else from far enough out to see every
// link's origin.
//
// It checks each boat on the server first (a scene, with an open water
// object and her weather: a boat published before water bodies has neither
// and is refused, so republish her first), and after, from a fresh repo,
// that the harbour came back whole. --dry-run prints the doc and
// publishes nothing (a package with no pushwork URL yet is shown as
// "<unsynced: name>"); --offline also skips reading the boats from the
// server. Makes a NEW doc on every run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packageProblems, pushworkUrl } from "./scene-packages.mjs";

const ARITY = { title: 1, boat: 1, wind: 1, seed: 1, scale: 1, home: 1, "dry-run": 0, offline: 0, sync: 1, settle: 1 };
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
const OFFLINE = !!args.offline;
if (OFFLINE && !DRY) throw new Error("--offline is for a dry run: publishing reads the boats first");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const J = JSON.stringify;
const LINK = "scene.link";
const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
const PACKAGES = ["scene", "water", "sailing", "weather"];

const [windSpeed, windFrom] = (args.wind ?? "5,250").split(",").map(Number);
// the weather package's trait, the air of it (every other field its default: a fair afternoon at Cadboro Bay)
const weather = { wind: windSpeed, from: windFrom, seed: Number(args.seed ?? 7) };
const sea = { seed: weather.seed, scale: Number(args.scale ?? 0.5) };
if (![windSpeed, windFrom, sea.seed, sea.scale].every(Number.isFinite)) throw new Error(`--wind, --seed, --scale: numbers, please (${J({ weather, sea })})`);
/** Is this object open water (the water package's trait with no size)? */
const isOpen = (o) => !!o?.traits?.water && o.traits.water.size == null;

const boats = args.boat.map((spec, i) => {
  const m = /^(.+?)=(automerge:[^@]+)@([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(spec);
  if (!m || !BARE.test(m[2])) throw new Error(`--boat ${J(spec)}: want NAME=automerge:…@x,y,z`);
  return { id: `boat-${i + 1}`, name: m[1], url: m[2], position: [+m[3], +m[4], +m[5]] };
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
if (!OFFLINE) {
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  // each boat: a scene on the server, with open water of her own (which gives way to the harbour's) and her weather
  for (const b of boats) {
    const d = (await within(60000, repo.find(b.url))).doc();
    if (d?.["@patchwork"]?.type !== "scene" || !d.objects) throw new Error(`${b.name} (${b.url}) isn't a scene doc on the server`);
    b.from = Number(d.traits?.weather?.from);
    const open = Object.values(d.objects).filter(isOpen);
    if (!open.length) problems.push(`${b.name} (${b.url}) has no open water object: she was published before water bodies; republish her first`);
    // a weather that leaves `from` out blows from the weather package's default, which this publisher doesn't copy (a
    // package's defaults are its own): such a boat is refused by name, to be given an explicit `from` (sailing's parts
    // and templates always write one)
    if (!d.traits?.weather) problems.push(`${b.name} (${b.url}) has no weather of her own to turn her by`);
    else if (!Number.isFinite(b.from)) problems.push(`${b.name} (${b.url}): her weather leaves its wind's \`from\` at the weather package's default; write it into her doc to turn her by`);
    console.error(`boat: ${b.name} = ${d.title} (${Object.keys(d.objects).length} objects, wind from ${b.from}, open water ${open.map((o) => o.name).join(", ") || "none"})`);
  }
}

// each boat turned so the harbour's wind meets her as her own did: a wind from f in her frame is from f − yaw in the world
// the harbour's own Sea first: open water with a sea on it, at y = 0
const objects = {
  sea: {
    name: "Sea", sourceUrl: null, providerId: null, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: false,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    traits: { water: {}, "sailing.sea": sea },
  },
};
for (const b of boats) {
  const yaw = Number.isFinite(b.from) ? (((b.from - windFrom) % 360) * Math.PI) / 180 : 0;
  objects[b.id] = {
    name: b.name, sourceUrl: b.url, providerId: LINK, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: true,
    transform: { position: b.position, rotation: [0, +yaw.toFixed(6), 0], scale: 1 },
  };
}
const span = Math.max(40, ...boats.map((b) => Math.hypot(b.position[0], b.position[2])));
const home = args.home
  ? (([p, t]) => ({ position: p, target: t }))(args.home.split(":").map((s) => s.split(",").map(Number)))
  : { position: [0, +(span * 0.9).toFixed(2), +(span * 2.2).toFixed(2)], target: [0, 0, 0] };
if (![...home.position, ...home.target].every(Number.isFinite) || home.position.length !== 3 || home.target.length !== 3) throw new Error(`--home ${J(args.home)}: want px,py,pz:tx,ty,tz`);
const doc = {
  "@patchwork": { type: "scene", suggestedImportUrl: urlOf("scene") },
  title: args.title ?? "Harbour",
  objects,
  order: ["sea", ...boats.map((b) => b.id)],
  dimensions: {},
  // the world's wind and sky (its Sea is an object, above)
  traits: { weather },
  assets: {},
  packages: PACKAGES.map((p) => ({ url: urlOf(p) })),
  clock: { running: true, t: 0 },
  view: { units: "m", grid: false, axes: false, bounds: false, snap: true, start: { home } },
};
// the Harbour's Sea has no clip (WATER Decision 103): placed in a dry world, its boats each keep their own block, and a
// harbour block under them would overlap theirs. Its boats keep their clips: silent here, where the harbour offers water.
if (objects.sea.traits.water.clip != null || objects.sea.traits.water.size != null) problems.push("the Harbour's Sea must be open water with no clip");
console.error(J({ title: doc.title, weather, sea, boats: boats.map((b) => ({ id: b.id, name: b.name, at: b.position, yawDeg: Number.isFinite(b.from) ? (b.from - windFrom) % 360 : null })), start: doc.view.start }, null, 1));
if (problems.length) console.error(`${DRY ? "would NOT publish" : "NOT publishing"}:\n  ${problems.join("\n  ")}`);
if (DRY) {
  console.log(J(doc, null, 2));
  process.exit(0);
}
if (problems.length) process.exit(1);

const h = repo.create(doc);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const { Repo } = await import("@automerge/automerge-repo");
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(30000, checker.find(h.url))).doc();
const after = packageProblems(got, PACKAGES);
if (J(Object.keys(got?.objects ?? {}).sort()) !== J(["sea", ...boats.map((b) => b.id)].sort())) after.push("came back without its Sea and its boats");
for (const b of boats) if (got?.objects?.[b.id]?.sourceUrl !== b.url) after.push(`${b.id} doesn't link ${b.url}`);
if (!isOpen(got?.objects?.sea) || !got.objects.sea.traits?.["sailing.sea"] || !got?.traits?.weather) after.push("came back without its Sea or its weather");
if (got?.objects?.sea?.traits?.water?.clip != null) after.push("came back with a clip on its Sea (the Harbour's has none: WATER Decision 103)");
if (after.length) {
  console.error(`NOT verified from a fresh repo:\n  ${after.join("\n  ")}`);
  process.exit(1);
}
console.log(`verified from a fresh repo\n\n  ${doc.title}  https://patchwork.inkandswitch.com/#doc=${h.url}\n`);
process.exit(0);
