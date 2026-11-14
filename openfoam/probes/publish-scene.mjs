// Publish an example scene: a case's hull (its GLB file, hidden: the results
// draw the same hull coloured, and two coincident surfaces would fight) and
// the case itself, drawn by this package's scene:source as its finished run's
// results. Both sit at the origin: the results are in the hull's own frame.
//
//   node probes/publish-scene.mjs --case automerge:… [--sync wss://…] [--title "…"]
//
// Borrows the scene package's own doc builders at dev time (a probe may; no
// package imports another), so the doc is exactly what the scene's init
// makes. Makes NEW docs on every run.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const SCENE = resolve(PKG, "../scene");
const { emptyScene } = await import(join(SCENE, "src/test/empty-scene.js"));
const { newRenderDoc } = await import(join(SCENE, "src/datatype.js"));
const { SCENE_PARAMS } = await import("../src/scene-params.js");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
if (!args.case) throw new Error("--case automerge:…");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const pushworkUrl = (dir) => JSON.parse(readFileSync(join(dir, ".pushwork/config.json"), "utf8")).rootUrl;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out`)), ms))]);

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const c = (await within(60_000, repo.find(args.case), "loading the case")).doc();
if (c?.["@patchwork"]?.type !== "openfoam-case") throw new Error("--case isn't an openfoam-case");
const hullUrl = c.hull?.url;
const hullDoc = (await within(60_000, repo.find(hullUrl), "loading the hull")).doc();
if (hullDoc?.["@patchwork"]?.type !== "file") throw new Error("this publisher wants a case whose hull is a GLB file");

const params = Object.fromEntries(SCENE_PARAMS.map((p) => [p.key, p.default]));
const render = await repo.create2(newRenderDoc({ title: c.title, parent: args.case, providerId: "openfoam-results", params }));
const T = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
const object = (name, sourceUrl, providerId, renderUrl, extra = {}) => ({
  kind: "object", name, group: null, parent: null, sourceUrl, providerId, renderUrl,
  visible: true, color: null, opacity: 1, wireframe: false, transform: T, ...extra,
});
// frame the camera on the hull: its length from the selected run's frozen hull
const sel = c.selected ?? c.runs?.[c.runs.length - 1];
const L = sel ? (await within(60_000, repo.find(sel), "loading the run")).doc()?.hull?.info?.loa ?? 10 : 10;
const scene = emptyScene({
  "@patchwork": { suggestedImportUrl: pushworkUrl(SCENE) },
  title: args.title ?? `${c.title} (scene)`,
  objects: {
    hull: object(hullDoc.name ?? "Hull", hullUrl, "file-glb", null, { visible: false }),
    results: object("CFD results", args.case, "openfoam-results", render.url),
  },
  order: ["hull", "results"],
  packages: [{ url: pushworkUrl(SCENE) }, { url: pushworkUrl(PKG) }],
  view: { units: "m", start: { home: { position: [-0.6 * L, 0.55 * L, 0.9 * L], target: [0.45 * L, -0.05 * L, 0] } } },
});
const h = await repo.create2(scene);
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const back = (await within(30_000, checker.find(h.url), "reading the scene back")).doc();
const ok = back?.objects?.results?.renderUrl === render.url;
console.log(JSON.stringify({ scene: h.url, render: render.url, verified: ok, open: `https://patchwork.inkandswitch.com/#doc=${h.url}` }, null, 2));
process.exit(ok ? 0 : 1);
