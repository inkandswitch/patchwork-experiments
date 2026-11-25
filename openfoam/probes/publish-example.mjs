// Publish an example OpenFOAM case to the sync server: the narrow-transom
// hull as a GLB file doc, and a case that links it and adopts finished runs
// (made by probes/net-run.mjs through a real OpenFOAM host). Every doc suggests this
// package (its pushwork url), so a viewer without it is offered it.
//
//   node probes/publish-example.mjs --runs automerge:…,automerge:… [--sync wss://…] [--glb path] [--title "…"]
//
// The case has no server: whoever opens it pastes their own task queue.
// Makes NEW docs on every run; the runs are re-pointed at the new case.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { initCase, CASE_TYPE } from "../src/protocol.js";
import { normalizeSetup } from "../src/setup.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
if (!args.runs) throw new Error("--runs automerge:…,automerge:…");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const glb = resolve(args.glb ?? join(PKG, "../naval/src/test/fixtures/camber/narrow-transom.glb"));
const pkgUrl = JSON.parse(readFileSync(join(PKG, ".pushwork/config.json"), "utf8")).rootUrl;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out`)), ms))]);

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const runs = [];
for (const u of String(args.runs).split(",")) runs.push(await within(60_000, repo.find(u.trim()), `loading ${u}`));
for (const r of runs) if (r.doc().status !== "done") throw new Error(`${r.url} isn't done (${r.doc().status})`);

const file = await repo.create2({ "@patchwork": { type: "file" }, name: glb.split("/").pop(), extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(readFileSync(glb)) });
const doc = { "@patchwork": { type: CASE_TYPE, suggestedImportUrl: pkgUrl } };
initCase(doc, normalizeSetup(runs[runs.length - 1].doc().setup));
doc.title = args.title ?? "Narrow-transom sloop: resistance at 6 kn";
doc.hull = { url: file.url };
doc.runs = runs.map((r) => r.url);
doc.selected = runs[runs.length - 1].url;
const c = await repo.create2(doc);
for (const r of runs)
  r.change((d) => {
    d.case = c.url;
    d["@patchwork"].suggestedImportUrl = pkgUrl;
    if (d.hull?.source) d.hull.source.url = file.url;
  });
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
// read it back from a fresh repo
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const back = (await within(30_000, checker.find(c.url), "reading the case back")).doc();
const ok = back?.runs?.length === runs.length && back.hull?.url === file.url;
console.log(JSON.stringify({ package: pkgUrl, hull: file.url, case: c.url, runs: doc.runs, verified: ok, open: `https://patchwork.inkandswitch.com/#doc=${c.url}` }, null, 2));
process.exit(ok ? 0 : 1);
