// Publish upstream's examples as ink-scene docs, and one folder doc listing
// them, to a real sync server. Prints the folder's URL.
//
//   (in ink-studio/, after `pnpm build` and a pushwork sync of this package)
//   node probes/publish-examples.mjs [--dry-run] [--only a.js,b.json] [--sync wss://…]
//
// Which examples: every row of probes/examples.tsv (sweep.mjs in real Chrome)
// whose state is `drawn` and that builds in under SLOW_MS, plus the toolkit's
// seven built-in demos. Each doc holds the example and the files it requires
// (one folder, plain names), named by the scene's own name (file stem added
// when two share one), credited to upstream at UPSTREAM-COMMIT. Each names this
// package as its suggested import (its pushwork url). Every run makes NEW docs.
// Afterwards the folder is read back from a fresh repo and every entry checked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScene } from "../src/load-scene.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes("--dry-run");
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const SLOW_MS = 20000;
const COMMIT = readFileSync(join(here, "vendor/ink-studio/UPSTREAM-COMMIT"), "utf8").trim();
const EXAMPLES = join(here, "vendor/ink-studio/examples");
const UPSTREAM = "https://github.com/siliconjungle/shapeshift-labs-ink-studio";

const config = join(here, ".pushwork/config.json");
if (!existsSync(config) && !DRY) throw new Error("ink-studio has no .pushwork/config.json: sync the package with pushwork first (its url goes on every doc)");
const pkgUrl = existsSync(config) ? JSON.parse(readFileSync(config, "utf8")).rootUrl : "automerge:DRYRUN";

const rows = readFileSync(join(here, "probes/examples.tsv"), "utf8").split("\n")
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("name\t"))
  .map((l) => l.split("\t")).map(([name, state, splats, ms]) => ({ name, state, splats: +splats, ms: +ms }));
const only = arg("--only")?.split(",");
const chosen = rows.filter((r) => r.state === "drawn" && r.ms < SLOW_MS && (!only || only.includes(r.name)));
const left = rows.filter((r) => !chosen.includes(r) && (!only || only.includes(r.name)));

/** The example and every file it requires beside it. */
function filesOf(main) {
  const files = {};
  (function collect(name) {
    if (name in files) return;
    const path = join(EXAMPLES, name);
    if (!existsSync(path)) return;
    files[name] = readFileSync(path, "utf8");
    for (const [, req] of files[name].matchAll(/require\(\s*['"]\.\/([^'"/]+)['"]\s*\)/g)) collect(/\.(js|json)$/.test(req) ? req : `${req}.js`);
  })(main);
  return files;
}

const toolkit = await import("../src/generated/toolkit.js");
const docs = [];
for (const s of toolkit.SCENES)
  docs.push({ file: s.id, title: s.name, doc: { kind: "builtin", main: s.id, files: {}, credit: `Ink Studio's built-in demo "${s.id}" (${UPSTREAM} at ${COMMIT}, MIT)` } });
for (const r of chosen) {
  const files = filesOf(r.name);
  const doc = { kind: r.name.endsWith(".json") ? "diorama" : "js", main: r.name, files, credit: `Ink Studio's examples/${r.name} (${UPSTREAM} at ${COMMIT}, MIT)` };
  const scene = await loadScene(toolkit, doc); // the name only; the sweep built it
  docs.push({ file: r.name, title: String(scene.name || r.name), doc });
}
const counts = new Map();
for (const d of docs) counts.set(d.title, (counts.get(d.title) ?? 0) + 1);
for (const d of docs) if (counts.get(d.title) > 1) d.title = `${d.title} (${d.file.replace(/\.(js|json)$/, "")})`;

console.log(`${docs.length} docs (${toolkit.SCENES.length} demos, ${chosen.length} examples); left out:`);
for (const r of left) console.log(`  ${r.name}: ${r.state === "drawn" ? `builds in ${Math.round(r.ms / 1000)} s` : r.state}`);
if (DRY) {
  for (const d of docs) console.log(`  ${d.title}  ←  ${d.file}  (${Object.keys(d.doc.files).length} files)`);
  process.exit(0);
}

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const create = (value) => (repo.create2 ? repo.create2(value) : repo.create(value));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out after ${ms} ms`)), ms))]);
console.log(`connected to ${SYNC}; package ${pkgUrl}`);

const entries = [];
for (const d of docs) {
  const h = await create({ "@patchwork": { type: "ink-scene", suggestedImportUrl: pkgUrl }, title: d.title, ...d.doc });
  entries.push({ name: d.title, type: "ink-scene", url: h.url });
}
const left_ = left.map((r) => `${r.name} (${r.state === "drawn" ? `builds in ${Math.round(r.ms / 1000)} s` : r.state})`).join(", ");
const folder = await create({
  "@patchwork": { type: "folder" },
  title: "Ink Studio examples",
  docs: entries,
});
console.log(`folder ${folder.url}; settling…`);
await new Promise((r) => setTimeout(r, 8000));

// read it all back from a fresh repo
const fresh = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(60000, fresh.find(folder.url), "the folder")).doc();
const problems = [];
if (got?.docs?.length !== entries.length) problems.push(`the folder lists ${got?.docs?.length} docs, not ${entries.length}`);
for (const e of entries) {
  try {
    const d = (await within(30000, fresh.find(e.url), e.name)).doc();
    if (d?.["@patchwork"]?.type !== "ink-scene" || !d.main) problems.push(`${e.name}: not an ink-scene doc`);
  } catch (err) {
    problems.push(`${e.name}: ${err.message}`);
  }
}
console.log(problems.length ? `PROBLEMS:\n  ${problems.join("\n  ")}` : `all ${entries.length} resolve`);
console.log(`left out: ${left_ || "none"}`);
console.log(`\nInk Studio examples: https://patchwork.inkandswitch.com/#doc=${folder.url}`);
process.exit(problems.length ? 1 : 0);
