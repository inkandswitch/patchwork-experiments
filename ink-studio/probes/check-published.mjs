// Reads a published examples folder back from the sync server and builds a
// few of its docs through the tool's loader under Node: a plain JS example,
// one with extra files, a JSON diorama and a built-in demo.
//
//   node probes/check-published.mjs <folder url>
const { Repo, initSubduction } = await import("@automerge/automerge-repo");
const { loadScene } = await import("../src/load-scene.js");
const toolkit = await import("../src/generated/toolkit.js");
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: ["wss://subduction.sync.inkandswitch.com"] });
const folder = (await repo.find(process.argv[2])).doc();
console.log(folder.title, folder.docs.length);
const want = (e, d) => d.main === "sculpt.js" || d.kind === "diorama" || d.kind === "builtin" || Object.keys(d.files).length > 1;
const seen = new Set();
for (const e of folder.docs) {
  const d = JSON.parse(JSON.stringify((await repo.find(e.url)).doc()));
  const k = d.kind === "js" && Object.keys(d.files).length > 1 ? "multi" : d.main === "sculpt.js" ? "sculpt" : d.kind;
  if (!want(e, d) || seen.has(k)) continue;
  seen.add(k);
  const s = await loadScene(toolkit, d);
  const w = await s.build(s.seed);
  console.log(k.padEnd(8), e.name.padEnd(36), Object.keys(d.files).join(","), "→", w.count, "splats;", d["@patchwork"].suggestedImportUrl);
  if (seen.size >= 4) break;
}
process.exit(0);
