// Does a doc's home frame what it shows? Every box it shows (each drawn
// thing's hinted bounds: a hull, her mast, an islet; each body of water's
// box up to its lid: a basin, a boat's block, water-boxes.mjs), its own and
// through every link it holds, carried to its frame, projected from its
// `view.start.home` by the stage's camera (frame.mjs project, held to three's
// PerspectiveCamera by scene's frame-home test) into Patchwork's narrow pane
// (640 × 800) and the whole window (1440 × 900): each box must be in front
// of the camera and inside the pane. Prints a row per box and pane, and
// exits 1 if any box is out, or one of the doc's own links can't be read
// (a link inside a linked doc, a boat's game say, is listed, not checked).
//
//   node probes/frame-check.mjs <doc.json> [--offline <docs.json>]...
//   node probes/frame-check.mjs automerge:… [--sync wss://…]
//
// <doc.json> is the doc a publisher's --dry-run prints (or { [url]: doc }
// with one doc), its links read from the --offline files ({ [url]: doc },
// as publish-ship --dry-run --out writes). A URL reads the doc and every doc
// it links, all the way down, from the sync server: for checking what was
// published. Reads only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LINK, PANES, contentOf, framing } from "./frame.mjs";
import { waterBoxes } from "./water-boxes.mjs";

const argv = process.argv.slice(2);
const offlineFiles = [];
let target = null;
let SYNC = process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--offline" && argv[i + 1]) offlineFiles.push(argv[++i]);
  else if (argv[i] === "--sync" && argv[i + 1]) SYNC = argv[++i];
  else if (!argv[i].startsWith("--") && target == null) target = argv[i];
  else target = "";
}
if (!target) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.error(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"));
  process.exit(2);
}

const docs = {};
for (const f of offlineFiles) Object.assign(docs, JSON.parse(readFileSync(f, "utf8")));
let host, hostUrl = null;
if (target.startsWith("automerge:")) {
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const read = async (url) => {
    if (url in docs) return;
    docs[url] = null;
    try {
      docs[url] = JSON.parse(JSON.stringify((await within(60000, repo.find(url))).doc()));
    } catch (err) {
      console.error(`couldn't read ${url}: ${err?.message ?? err}`);
      delete docs[url];
      return;
    }
    for (const o of Object.values(docs[url]?.objects ?? {})) if (o?.providerId === LINK && o.sourceUrl) await read(o.sourceUrl);
  };
  await read(target);
  host = docs[target];
  hostUrl = target;
} else {
  const j = JSON.parse(readFileSync(target, "utf8"));
  if (j?.objects) host = j;
  else {
    const entries = Object.entries(j ?? {});
    if (entries.length !== 1) throw new Error(`${target}: want a doc, or { [url]: doc } with one doc`);
    [[hostUrl, host]] = entries;
  }
}
if (!host?.objects) throw new Error(`${target}: not a scene doc`);
const home = host.view?.start?.home;
if (!home?.position || !home?.target) throw new Error(`${target}: no view.start.home to check`);

const { boxes, missing } = contentOf(host, docs, { more: waterBoxes, inside: hostUrl ? [hostUrl] : [] });
const fails = [];
const f2 = (v) => (v >= 0 ? " " : "") + v.toFixed(2);
console.log(`${host.title ?? "(untitled)"}: home ${JSON.stringify(home)}; ${boxes.length} boxes`);
for (const pane of PANES) {
  console.log(`\n  ${pane.name}`);
  for (const b of boxes) {
    const fr = framing(home, b.points, pane);
    const name = [...b.via.map((id) => host.objects[id]?.name ?? id), b.name].join(" / ");
    console.log(`  ${fr.inside ? "ok " : "OUT"} x ${f2(fr.x[0])}..${f2(fr.x[1])}  y ${f2(fr.y[0])}..${f2(fr.y[1])}  ${name}${b.kind ? ` (${b.kind}, lid ${b.lid.toFixed(2)})` : ""}`);
    if (!fr.inside) fails.push(`${name} is out of the ${pane.name} pane`);
  }
}
for (const m of missing) {
  if (m.depth === 0) fails.push(`link ${m.id} (${m.url}) wasn't read: its content can't be checked`);
  else console.log(`  (not checked: a link ${m.depth} deep, ${m.id} → ${m.url})`);
}
const total = boxes.length * PANES.length;
console.log(`\nframe-check: ${total - fails.filter((f) => f.includes(" pane")).length}/${total} box-panes inside${fails.length ? `\n  ${fails.join("\n  ")}` : ""}`);
process.exit(fails.length || !boxes.length ? 1 : 0);
