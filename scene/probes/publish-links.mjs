// Publish a scene made of nothing but links to scenes already published: a
// mashup (scene/COMPOSITION.md §1, a link). Each linked doc is used as it is,
// unchanged and uncopied, where a person would drop it; the new doc lists only
// the scene package, since one packages prompt covers every open doc's
// (COMPOSITION.md, Decisions, links loose ends 1). Prints its Patchwork URL.
//
//   (in scene/) node probes/publish-links.mjs --title "Games night" \
//     --link "Quiet games room=automerge:…@0,0,0" \
//     --link "Liar's dice=automerge:…@-4.2,0.035,1.95@90" \
//     [--start 1] [--home px,py,pz:tx,ty,tz] [--view-like 1] [--frame [--pitch 27] [--heading 0]]
//     [--box "[N:]cx,cy,cz:w,h,l[@yaw]"]... [--dry-run] [--offline <docs.json>] [--sync wss://…] [--settle 8000]
//
// --link NAME=URL@x,y,z[@yawDegrees[@scale]] places a locked link (as a game
// part's link is) at that position on the doc's root, turned and at that
// uniform scale (1 when not given: 0.04 is a diorama at 1:25). --start N makes people arrive
// through the Nth link (1-based), as that doc starts people (TOOLS.md §2: a
// start placed on a link). --view-like N copies the Nth linked doc's display
// prefs (grid, axes, bounds, units, snap), so a room stays a room. --home sets
// the home view; without it the started link's doc's home, moved by its link.
//
// --frame works the home out instead (unless --home is given): the nearest
// place looking down --pitch degrees (27) along --heading (0: towards −z)
// from which everything the doc shows is inside the middle 90% of
// Patchwork's narrow pane (640 × 800), so inside every wider one too
// (frame.mjs fitHome). What it shows is each linked doc's drawn things (the
// bounds its files' hints state, carried through the links), and each
// --box: a box the scene can't see from hints (a package's own, such as a
// body of water; sailing's publish-basin --mashup prints them), its centre,
// size and turn (degrees) in link N's doc (1-based), or in this doc with no
// N. With --frame or a --box, the home (whichever it is) is checked in the
// narrow pane and the whole window (1440 × 900), and one that leaves any of
// it out is refused.
//
// It checks, before publishing, that each linked doc is a scene on the server,
// and after, from a fresh repo, that the doc came back whole. --offline reads
// the linked docs from a JSON file ({ [url]: doc }) instead, and needs
// --dry-run: nothing is asked of any server. Makes a NEW doc on every run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packageProblems, scenePackages, scenePatchwork } from "./scene-packages.mjs";
import { contentOf, fitHome, matrixOf, panesReport, specPoints } from "./frame.mjs";

const ARITY = { title: 1, link: 1, start: 1, home: 1, "view-like": 1, frame: 0, pitch: 1, heading: 1, box: 1, "dry-run": 0, offline: 1, sync: 1, settle: 1 };
const args = { link: [], box: [] };
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) { bad.push(a); continue; }
  const v = process.argv[i + 1];
  if (ARITY[k] && (v == null || v.startsWith("--"))) { bad.push(`${a} (wants a value)`); continue; }
  if (k === "link" || k === "box") args[k].push(v);
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
  const m = /^(.+?)=(automerge:[^@]+)@([-\d.]+),([-\d.]+),([-\d.]+)(?:@([-\d.]+)(?:@([\d.]+))?)?$/.exec(spec);
  if (!m || !BARE.test(m[2])) throw new Error(`--link ${J(spec)}: want NAME=automerge:…@x,y,z[@yaw[@scale]]`);
  const scale = m[7] == null ? 1 : +m[7];
  if (!(scale > 0)) throw new Error(`--link ${J(spec)}: a scale is a positive number`);
  return { id: `link-${i + 1}`, name: m[1], url: m[2], position: [+m[3], +m[4], +m[5]], yaw: ((+(m[6] ?? 0)) * Math.PI) / 180, scale };
});
const start = args.start != null ? links[Number(args.start) - 1] : null;
if (args.start != null && !start) throw new Error(`--start ${args.start}: there are ${links.length} links`);
const PITCH = Number(args.pitch ?? 27), HEADING = Number(args.heading ?? 0);
if (!(PITCH > 0 && PITCH < 90) || !Number.isFinite(HEADING)) throw new Error(`--pitch (0 to 90) and --heading: degrees, please`);
const linkMatrix = (l) => matrixOf({ position: l.position, rotation: [0, l.yaw, 0], scale: l.scale });
const boxes = args.box.map((spec) => {
  const m = /^(?:(\d+):)?(.+)$/.exec(spec);
  const l = m?.[1] != null ? links[Number(m[1]) - 1] : null;
  if (m?.[1] != null && !l) throw new Error(`--box ${J(spec)}: there are ${links.length} links`);
  const points = m && specPoints(m[2], l ? linkMatrix(l) : undefined);
  if (!points) throw new Error(`--box ${J(spec)}: want [N:]cx,cy,cz:w,h,l[@yawDegrees]`);
  return { name: `box ${spec}`, points };
});
const FRAMING = !!args.frame || boxes.length > 0;

if (args.offline && !args["dry-run"]) throw new Error("--offline is for a dry run: publishing reads the links from the server");
const offline = args.offline ? JSON.parse(readFileSync(args.offline, "utf8")) : null;
let repo = null;
if (!offline) {
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
}
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);

// each linked doc: a scene on the server
const linked = [];
for (const l of links) {
  const d = offline ? offline[l.url] : (await within(60000, repo.find(l.url))).doc();
  if (d?.["@patchwork"]?.type !== "scene" || !d.objects) throw new Error(`${l.name} (${l.url}) isn't a scene doc ${offline ? "in " + args.offline : "on the server"}`);
  linked.push(d);
  console.error(`linked: ${l.name} = ${d.title} (${Object.keys(d.objects).length} objects, starts ${J(d.view?.start ?? null)})`);
}

// the home view: as asked, else the started doc's home carried through its link (a scale, a yaw and a move)
const turn = (p, l) => [l.position[0] + l.scale * (p[0] * Math.cos(l.yaw) + p[2] * Math.sin(l.yaw)), l.position[1] + l.scale * p[1], l.position[2] + l.scale * (-p[0] * Math.sin(l.yaw) + p[2] * Math.cos(l.yaw))];
let home = null;
if (args.home) {
  const [p, t] = args.home.split(":").map((s) => s.split(",").map(Number));
  home = { position: p, target: t };
} else if (start) {
  const h = linked[links.indexOf(start)].view?.start?.home;
  if (h) home = { position: turn(h.position, start).map((v) => +v.toFixed(4)), target: turn(h.target, start).map((v) => +v.toFixed(4)) };
}
// what the doc shows, for --frame and --box: each linked doc's drawn things through its link, and the boxes
let shown = null;
if (FRAMING) {
  const held = Object.fromEntries(links.map((l, i) => [l.url, linked[i]]));
  shown = contentOf({ objects: Object.fromEntries(links.map((l) => [l.id, { name: l.name, sourceUrl: l.url, providerId: LINK, parent: null, transform: { position: l.position, rotation: [0, l.yaw, 0], scale: l.scale } }])), assets: {} }, held);
  shown.boxes.push(...boxes.map((b) => ({ ...b, via: [] })));
  if (!shown.boxes.length) throw new Error("--frame: the linked docs state no bounds and there's no --box: nothing to frame");
  if (args.frame && !args.home) home = fitHome(shown.boxes.flatMap((b) => b.points), { pitch: PITCH, heading: HEADING });
  if (!home) throw new Error("--box: no home to check (give --home, --frame or --start)");
}
const like = args["view-like"] != null ? linked[Number(args["view-like"]) - 1]?.view ?? {} : {};
const prefs = Object.fromEntries(["units", "grid", "axes", "bounds", "snap"].filter((k) => k in like).map((k) => [k, like[k]]));

const objects = {};
for (const l of links)
  objects[l.id] = {
    name: l.name, sourceUrl: l.url, providerId: LINK, renderUrl: null, parent: null, group: null,
    visible: true, color: null, opacity: 1, wireframe: false, locked: true,
    transform: { position: l.position, rotation: [0, l.yaw, 0], scale: l.scale },
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
const framed = shown ? panesReport(home, shown.boxes.flatMap((b) => b.points)) : null;
console.error(J({ title: doc.title, order: doc.order, start: doc.view.start, prefs, ...(framed ? { framed, boxes: shown.boxes.length, notRead: shown.missing.map((m) => m.url) } : {}) }, null, 1));
const out = (framed ?? []).filter((f) => !f.inside);
if (out.length) {
  console.error(`${args["dry-run"] ? "would NOT publish" : "NOT publishing"}: from ${J(home)} what the doc shows isn't all inside the ${out.map((f) => f.pane).join(" and ")} pane${out.length > 1 ? "s" : ""}`);
  process.exit(1);
}
if (args["dry-run"]) {
  console.log(J(doc, null, 2));
  process.exit(0);
}

const { Repo } = await import("@automerge/automerge-repo");
const h = repo.create(doc);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(30000, checker.find(h.url))).doc();
const problems = packageProblems(got, ["scene"]);
if (J(Object.keys(got?.objects ?? {}).sort()) !== J(links.map((l) => l.id).sort())) problems.push("came back without its links");
for (const l of links) if (got?.objects?.[l.id]?.sourceUrl !== l.url || got.objects[l.id].transform?.scale !== l.scale) problems.push(`${l.id} doesn't link ${l.url} at scale ${l.scale}`);
if (start && got?.view?.start?.place !== start.id) problems.push("came back without its start");
if (problems.length) {
  console.error(`NOT verified from a fresh repo:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`verified from a fresh repo\n\n  ${args.title}  https://patchwork.inkandswitch.com/#doc=${h.url}\n`);
process.exit(0);
