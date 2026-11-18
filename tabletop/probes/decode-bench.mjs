#!/usr/bin/env node
// What "Set up a table" costs a browser to draw, decoding images one at a
// time against several at once (look.js's drawer: `decodes`, pieces.js's
// `draws`). setup-bench.mjs measures the rest in Node, where an image costs
// nothing to decode; this measures the drawing in headless Chrome, with the
// browser's own image backend (look/images.js: createImageBitmap, an
// OffscreenCanvas) on stand-in images of realistic sizes. Offline: nothing
// leaves this machine.
//
//   node probes/decode-bench.mjs [--mod <Workshop/<id>.json>] [--runs 2] [--draws 1,4] [--made]
//
// Node imports the mod (Terraforming Mars + Expansions, 2104525488, from
// this machine's TTS cache, by default) as setup-bench does, and hands the
// page what a table lays out (setup.js kindsLaid) and what each image they're
// drawn from stands in as: by default a real image from this machine's TTS
// image cache (Mods/Images, mostly PNGs, as TTS's tokens and tiles are; taken
// in turn, since the mod's own aren't cached here), or with --made a JPEG of
// setup-bench's size (a face sheet 4096 × 2880, a back 1024 × 1434, any other
// 1024²), made in the page. Each is read before timing starts. The page
// then runs pieceDrawer.ensure over those
// kinds against an in-memory repo, once per `draws` setting per run,
// alternating; it reports each run's time and decodes (count, and how many
// ran at once at most). Prints JSON.
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { browser } from "./cdp.mjs";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) { return /\\.css(\\?inline)?$/.test(s) ? { url: "data:text/javascript,export default ''", shortCircuit: true } : next(s, c); }`),
);
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MOD = arg("mod", join(homedir(), "Library/Tabletop Simulator/Mods/Workshop/2104525488.json"));
const RUNS = Number(arg("runs", 2));
const DRAWS = arg("draws", "1,4").split(",").map(Number);
const MADE = process.argv.includes("--made");
const CACHE = join(homedir(), "Library/Tabletop Simulator/Mods/Images");

// ─── the game, as setup-bench imports it ───────────────────────────────────
const { readSave, collectAssets } = await import("../src/tts/tts.js");
const { runImport, source } = await import("../src/tts/importer.js");
const { kindsLaid } = await import("../src/setup.js");
const { filesOf } = await import("../src/pieces.js");
const { FakeRepo } = await import("../src/test/fake-repo.js");
const text = readFileSync(MOD, "utf8");
const save = readSave(text);
const faces = new Set();
const backs = new Set();
const walk = (os) => {
  for (const o of os ?? []) {
    for (const d of Object.values(o.CustomDeck ?? {})) {
      if (d.FaceURL) faces.add(d.FaceURL.trim());
      if (d.BackURL) backs.add(d.BackURL.trim());
    }
    walk(o.ContainedObjects);
    for (const s of Object.values(o.States ?? {})) walk([s]);
  }
};
walk(save.objects);
const models = new Set([...collectAssets(save.objects, { tableURL: save.tableURL }).values()].filter((a) => a.type === "model").map((a) => a.url.trim()));
const repo = new FakeRepo();
const { gameUrl } = await runImport({ sources: [source(`Mods/Workshop/${MOD.split("/").pop()}`, statSync(MOD).size, async () => new TextEncoder().encode(text))], repo, fetch: null, settings: { fetchNow: false }, shrink: null });
const game = (await repo.find(gameUrl)).doc();
const kinds = kindsLaid(game);
const pieces = Object.fromEntries(kinds.map((k) => [k, game.pieces[k]]));
const cached = MADE ? [] : readdirSync(CACHE).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
if (!MADE && !cached.length) throw new Error(`nothing in ${CACHE}: try --made`);
const assets = {};
let turn = 0;
for (const u of new Set(kinds.flatMap((k) => filesOf(pieces[k])))) {
  const t = decodeURI(u).trim();
  if (models.has(t) || /\.obj(\?|#|$)/i.test(t)) assets[u] = { obj: 150_000 };
  else if (!MADE) assets[u] = { cached: cached[turn++ % cached.length] };
  else assets[u] = faces.has(t) ? { w: 4096, h: 2880 } : backs.has(t) ? { w: 1024, h: 1434 } : { w: 1024, h: 1024 };
}
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "decode-bench-"));
writeFileSync(join(dir, "game.json"), JSON.stringify({ kinds, pieces, assets, runs: RUNS, draws: DRAWS }));
const images = Object.values(assets).filter((a) => !a.obj).length;
const cachedMB = Math.round(Object.values(assets).filter((a) => a.cached).reduce((n, a) => n + statSync(join(CACHE, a.cached)).size, 0) / 1e6);
console.error(`${save.saveName}: ${kinds.length} kinds laid, ${images} images (${MADE ? "made" : `from the TTS cache, ${cachedMB} MB`}), ${Object.values(assets).filter((a) => a.obj).length} models`);

// ─── the browser ───────────────────────────────────────────────────────────
const b = await browser({ root: PKG, port: 4781, cdp: 9781, page: "/probes/decode-bench.html", mounts: { "/bench/": dir, "/tts-images/": CACHE }, timeout: 600_000 });
try {
  const done = await b.waitFor("window.__result || window.__error", 540_000, 500);
  const out = await b.js("window.__error ? { error: String(window.__error) } : window.__result");
  console.log(JSON.stringify({ mod: save.saveName, kinds: kinds.length, images, standIns: MADE ? "made" : `TTS cache (${cachedMB} MB)`, ...out }, null, 2));
  b.stop(done && !out.error ? 0 : 1);
} catch (err) {
  console.error(err);
  b.stop(1);
}
