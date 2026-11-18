// Swap links in a Patchwork folder doc in ONE change: each named entry gets a
// new url and keeps its name, type and icon; entries listed as removed go.
// Then it reads the folder back from a fresh repo and checks every swap and
// removal, and that every entry's url resolves to a doc. Never makes a folder.
//
//   (in scene/) node probes/folder-swap.mjs <folderUrl> <tsv> [--dry-run] [--sync wss://…] [--settle 8000]
//
// The tsv: one row per entry, `NAME<TAB>automerge:…` (swap) or
// `NAME<TAB>removed`; more columns are ignored, and so are blank rows and rows
// starting with `#`. A name that isn't in the folder, or is there more than
// once, refuses the whole change. --dry-run prints what would change.
import { readFileSync } from "node:fs";

const [folderUrl, tsv] = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
if (!BARE.test(folderUrl ?? "") || !tsv) {
  console.error("usage: node probes/folder-swap.mjs <folderUrl> <tsv> [--dry-run] [--sync wss://…] [--settle 8000]");
  process.exit(2);
}
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const DRY = process.argv.includes("--dry-run");
const rows = readFileSync(tsv, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .map(([name, to]) => ({ name: name.trim(), to: to?.trim() }));
for (const r of rows) if (r.to !== "removed" && !BARE.test(r.to ?? "")) throw new Error(`${JSON.stringify(r.name)}: want a bare automerge url or "removed", got ${JSON.stringify(r.to)}`);

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out after ${ms} ms`)), ms))]);
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const h = await within(60000, repo.find(folderUrl), "the folder");
const before = h.doc();
if (before?.["@patchwork"]?.type !== "folder" || !Array.isArray(before.docs)) throw new Error(`${folderUrl} isn't a folder doc`);
const problems = [];
for (const r of rows) {
  const n = before.docs.filter((e) => e.name === r.name).length;
  if (n !== 1) problems.push(`${JSON.stringify(r.name)} is in the folder ${n} times`);
}
if (problems.length) {
  console.error(`refused, nothing changed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
for (const r of rows) {
  const e = before.docs.find((x) => x.name === r.name);
  console.error(`${r.to === "removed" ? "remove" : "swap  "} ${r.name}: ${e.url}${r.to === "removed" ? "" : ` → ${r.to}`}`);
}
if (DRY) process.exit(0);

h.change((d) => {
  for (const r of rows) {
    const i = d.docs.findIndex((x) => x.name === r.name);
    if (r.to === "removed") d.docs.splice(i, 1);
    else d.docs[i].url = r.to;
  }
});
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(arg("--settle", 8000))));

// back from a fresh repo: the swaps, the removals, and every entry resolving
const fresh = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const got = (await within(60000, fresh.find(folderUrl), "the folder, fresh")).doc();
for (const r of rows) {
  const e = got.docs.filter((x) => x.name === r.name);
  if (r.to === "removed") {
    if (e.length) problems.push(`${r.name} is still there`);
  } else if (e.length !== 1 || e[0].url !== r.to) problems.push(`${r.name} doesn't link ${r.to}`);
  else {
    const was = before.docs.find((x) => x.name === r.name);
    for (const k of ["type", "icon"]) if (was[k] !== e[0][k]) problems.push(`${r.name}'s ${k} changed`);
  }
}
const resolved = await Promise.all(
  got.docs.map(async (e) => {
    try {
      const d = (await within(90000, fresh.find(e.url), e.name)).doc();
      return d ? null : `${e.name} (${e.url}) came back empty`;
    } catch (err) {
      return `${e.name} (${e.url}) doesn't resolve: ${err.message}`;
    }
  }),
);
problems.push(...resolved.filter(Boolean));
console.log(JSON.stringify({ folder: folderUrl, entries: got.docs.length, resolved: resolved.filter((x) => !x).length, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
