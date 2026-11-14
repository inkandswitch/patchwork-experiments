// Publish a scene made of nothing but links to scenes already published: a
// mashup (scene/COMPOSITION.md §1, a link). Each linked doc is used as it is,
// unchanged and uncopied, where a person would drop it; the new doc lists only
// the scene package, since one packages prompt covers every open doc's
// (COMPOSITION.md, Decisions, links loose ends 1). Prints its Patchwork URL.
//
//   (in scene/) node probes/publish-links.mjs --title "Games night" \
//     --link "Quiet games room=automerge:…@0,0,0" \
//     --link "Liar's dice=automerge:…@-4.2,0.035,1.95@90" \
//     [--start 1] [--home px,py,pz:tx,ty,tz] [--view-like 1] [--dry-run] [--sync wss://…] [--settle 8000]
//
// --link NAME=URL@x,y,z[@yawDegrees] places a locked link (as a game part's
// link is) at that position on the doc's root. --start N makes people arrive
// through the Nth link (1-based), as that doc starts people (TOOLS.md §2: a
// start placed on a link). --view-like N copies the Nth linked doc's display
// prefs (grid, axes, bounds, units, snap), so a room stays a room. --home sets
// the home view; without it the started link's doc's home, moved by its link.
//
// It checks, before publishing, that each linked doc is a scene on the server,
// and after, from a fresh repo, that the doc came back whole. Makes a NEW doc
// on every run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";

const ARITY = { title: 1, link: 1, start: 1, home: 1, "view-like": 1, "dry-run": 0, sync: 1, settle: 1 };
const args = { link: [] };
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) { bad.push(a); continue; }
  const v = process.argv[i + 1];
  if (ARITY[k] && (v == null || v.startsWith("--"))) { bad.push(`${a} (wants a value)`); continue; }
  if (k === "link") args.link.push(v);
  else args[k] = ARITY[k] ? v : true;
  i += ARITY[k];
}
if (bad.length || !args.title || !args.link.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.error(`${bad.length ? `bad arguments: ${bad.join(" ")}\n\n` : ""}${lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n")}`);
  process.exit(2);
}
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const J = JSON.stringify;
const LINK = "scene.link";
const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;

const links = args.link.map((spec, i) => {
  const m = /^(.+?)=(automerge:[^@]+)@([-\d.]+),([-\d.]+),([-\d.]+)(?:@([-\d.]+))?$/.exec(spec);
  if (!m || !BARE.test(m[2])) throw new Error(`--link ${J(spec)}: want NAME=automerge:…@x,y,z[@yaw]`);
  return { id: `link-${i + 1}`, name: m[1], url: m[2], position: [+m[3], +m[4], +m[5]], yaw: ((+(m[6] ?? 0)) * Math.PI) / 180 };
});
const start = args.start != null ? links[Number(args.start) - 1] : null;
if (args.start != null && !start) throw new Error(`--start ${args.start}: there are ${links.length} links`);

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);

// each linked doc: a scene on the server
const linked = [];
for (const l of links) {
  const d = (await within(60000, repo.find(l.url))).doc();
  if (d?.["@patchwork"]?.type !== "scene" || !d.objects) throw new Error(`${l.name} (${l.url}) isn't a scene doc on the server`);
  linked.push(d);
  console.error(`linked: ${l.name} = ${d.title} (${Object.keys(d.objects).length} objects, starts ${J(d.view?.start ?? null)})`);
}

// the home view: as asked, else the started doc's home carried through its link (a yaw and a move)
const turn = (p, l) => [l.position[0] + p[0] * Math.cos(l.yaw) + p[2] * Math.sin(l.yaw), l.position[1] + p[1], l.position[2] - p[0] * Math.sin(l.yaw) + p[2] * Math.cos(l.yaw)];
let home = null;
if (args.home) {
  const [p, t] = args.home.split(":").map((s) => s.split(",").map(Number));
  home = { position: p, target: t };
} else if (start) {
  const h = linked[links.indexOf(start)].view?.start?.home;
  if (h) home = { position: turn(h.position, start).map((v) => +v.toFixed(4)), target: turn(h.target, start).map((v) => +v.toFixed(4)) };
}
const like = args["view-like"] != null ? linked[Number(args["view-like"]) - 1]?.view ?? {} : {};
const prefs = Object.fromEntries(["units", "grid", "axes", "bounds", "snap"].filter((k) => k in like).map((k) => [k, like[k]]));

const objects = {};
for (const l of links)
  objects[l.id] = {
    name: l.name, sourceUrl: l.url, providerId: LINK, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: true,
    transform: { position: l.position, rotation: [0, l.yaw, 0], scale: 1 },
  };
const doc = {
  "@patchwork": scenePatchwork(),
  title: args.title,
  objects,
  order: links.map((l) => l.id),
  dimensions: {},
  traits: {},
  assets: {},
  packages: scenePackages(["scene"]),
  clock: { running: true, t: 0 },
  view: { units: "m", grid: true, axes: true, bounds: false, snap: true, ...prefs, start: { ...(start ? { place: start.id } : {}), ...(home ? { home } : {}) } },
};
console.error(J({ title: doc.title, order: doc.order, start: doc.view.start, prefs }, null, 1));
if (args["dry-run"]) {
  console.log(J(doc, null, 2));
  process.exit(0);
}

const h = repo.create(doc);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(30000, checker.find(h.url))).doc();
const problems = packageProblems(got, ["scene"]);
if (J(Object.keys(got?.objects ?? {}).sort()) !== J(links.map((l) => l.id).sort())) problems.push("came back without its links");
for (const l of links) if (got?.objects?.[l.id]?.sourceUrl !== l.url) problems.push(`${l.id} doesn't link ${l.url}`);
if (start && got?.view?.start?.place !== start.id) problems.push("came back without its start");
if (problems.length) {
  console.error(`NOT verified from a fresh repo:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`verified from a fresh repo\n\n  ${args.title}  https://patchwork.inkandswitch.com/#doc=${h.url}\n`);
process.exit(0);
