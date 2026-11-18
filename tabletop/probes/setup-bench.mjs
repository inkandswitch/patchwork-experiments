#!/usr/bin/env node
// How long a big TTS mod takes to import and then to set up a table from, and
// where the time and memory go. Node only, offline: a real Automerge Repo with
// no network and no storage (nothing ever leaves this process), the game page
// (src/tool.js) mounted in happy-dom, and stand-ins for everything the
// browser would fetch or decode:
//
//   - every asset the mod names is "fetched" from a stand-in that answers
//     bytes of a realistic size (a deck's face sheet: a 4096 × 2880 JPEG of
//     ~2.5 MB; a back or another image ~0.4 MB; a model an OBJ), headed so
//     sniff reads them as TTS's would be (globalThis.fetch is the stand-in:
//     nothing reaches the network);
//   - createImageBitmap / OffscreenCanvas are stand-ins that only count:
//     opening a sheet costs nothing here, so the decodes and crops are
//     reported as counts (a browser's cost is about 100 ms a 4096² decode,
//     10 ms a crop).
//
//   node probes/setup-bench.mjs [--mod <Workshop/<id>.json>] [--scale 0.25]
//
// Defaults: Terraforming Mars + Expansions (2104525488) from this machine's
// TTS cache, at full size. --scale shrinks every stand-in asset's bytes (not
// its pixel size). Set up a table is timed from the click to the scene
// opening; `changes`/`listenerMs` are the game doc's change events and the
// time the game page spent handling them (happy-dom's DOM is slower than a
// browser's). Measured 2026-11-18 (TM, full size): 177 s and 1369 changes
// before drawn was written in batches, 15 s and 29 after.
import { register } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { readSave, collectAssets } from "../src/tts/tts.js";

// the tools' `?inline` CSS imports (vite's): nothing, here
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) { return /\\.css(\\?inline)?$/.test(s) ? { url: "data:text/javascript,export default ''", shortCircuit: true } : next(s, c); }`),
);
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MOD = arg("mod", join(homedir(), "Library/Tabletop Simulator/Mods/Workshop/2104525488.json"));
const SCALE = Number(arg("scale", 1));
const MB = 1024 * 1024;
const t0 = performance.now();
const mem = () => {
  const m = process.memoryUsage();
  return { rssMB: Math.round(m.rss / MB), heapMB: Math.round(m.heapUsed / MB), extMB: Math.round((m.external + m.arrayBuffers) / MB) };
};
const phases = [];
let last = performance.now();
const mark = (name, extra = {}) => {
  const now = performance.now();
  phases.push({ phase: name, ms: Math.round(now - last), ...mem(), ...extra });
  console.error(`${((now - t0) / 1000).toFixed(1).padStart(6)}s  ${name}  ${Math.round(now - last)} ms`, JSON.stringify({ ...mem(), ...extra }));
  last = now;
};

// ─── the browser, stood in for ──────────────────────────────────────────────
const window = new Window({ url: "http://localhost/" });
for (const k of ["document", "CustomEvent", "Event", "HTMLElement", "Node", "MutationObserver"]) globalThis[k] = window[k];
const counts = { decodes: 0, crops: 0, fetches: 0, fetchedBytes: 0 };
globalThis.createImageBitmap = async (blob) => {
  counts.decodes++;
  // the stand-in's own header (jpeg() below): its SOF0's height and width
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const d = b[3] === 0xc0 ? { height: (b[7] << 8) | b[8], width: (b[9] << 8) | b[10] } : { width: 1024, height: 1024 };
  return { width: d.width, height: d.height, close() {} };
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    Object.assign(this, { width: w, height: h });
  }
  getContext() {
    const c = this;
    return {
      drawImage() {
        if (c.width > 48) counts.crops++;
      },
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
  }
  async convertToBlob() {
    // a JPEG at 0.85 of a card-sized crop: ~0.2 bytes a pixel
    return new Blob([jpeg(this.width, this.height, Math.round(this.width * this.height * 0.2))]);
  }
};

/** Bytes that read as a JPEG of w × h (SOI, SOF0), padded to n with noise (it won't compress, as a JPEG's doesn't). */
function jpeg(w, h, n) {
  const b = new Uint8Array(Math.max(32, n));
  for (let i = 0; i < b.length; i += 4) b[i] = (i * 2654435761) >>> 24;
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03], 0);
  return b;
}
function obj(n) {
  let s = "# stand-in\n";
  for (let i = 0; s.length < n; i++) s += `v ${(i % 7) * 0.1} ${(i % 5) * 0.1} ${(i % 3) * 0.1}\nvt 0.5 0.5\n`;
  s += "f 1/1 2/2 3/3\nf 2/2 3/3 4/4\n";
  return new TextEncoder().encode(s);
}

// ─── what each of the mod's URLs is, for its stand-in ──────────────────────
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
const standIn = (url) => {
  const u = url.trim();
  if (models.has(u) || /\.obj(\?|#|$)/i.test(u)) return obj(150_000 * SCALE);
  if (faces.has(u)) return jpeg(4096, 2880, 2.5e6 * SCALE);
  if (backs.has(u)) return jpeg(1024, 1434, 0.4e6 * SCALE);
  return jpeg(1024, 1024, 0.4e6 * SCALE);
};
const fetchStub = async (url) => {
  counts.fetches++;
  const bytes = standIn(decodeURI(url));
  counts.fetchedBytes += bytes.byteLength;
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0) };
};
// what the game page fetches with (pieces.js): the stand-in, never the network
globalThis.fetch = fetchStub;
mark("read the mod", { objects: save.objects.length });

// ─── a repo that never leaves this process ─────────────────────────────────
await initSubduction();
// no network, no storage, no sync endpoints: nothing leaves this process
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [] });
const { runImport, source } = await import("../src/tts/importer.js");
const { default: TabletopGameTool } = await import("../src/tool.js");

// ─── 1. the import ─────────────────────────────────────────────────────────
let lastPhase = null;
const { gameUrl, report } = await runImport({
  sources: [source(`Mods/Workshop/${MOD.split("/").pop()}`, statSync(MOD).size, async () => new TextEncoder().encode(text))],
  repo,
  fetch: fetchStub,
  settings: { fetchNow: true },
  shrink: null,
  onProgress: (p) => {
    if (p.phase !== lastPhase) {
      if (lastPhase) mark(`import: ${lastPhase}`);
      lastPhase = p.phase;
    }
  },
});
const why = {};
for (const a of Object.values(report.assets)) if (a.error) why[a.error.replace(/https?:\S+/g, "…")] = (why[a.error.replace(/https?:\S+/g, "…")] ?? 0) + 1;
mark(`import: ${lastPhase}`, { missing: why, assets: report.counts.assets, fetches: counts.fetches, fetchedMB: Math.round(counts.fetchedBytes / MB) });

// ─── 2. the game page, then Set up a table ─────────────────────────────────
const game = await repo.find(gameUrl);
let listenerMs = 0;
let changes = 0;
const on = game.on.bind(game);
game.on = (ev, fn) =>
  on(ev, (...a) => {
    const s = performance.now();
    try {
      return fn(...a);
    } finally {
      listenerMs += performance.now() - s;
      changes++;
    }
  });
const host = document.createElement("div");
host.repo = repo;
document.body.append(host);
const opened = [];
host.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
const unmount = TabletopGameTool(game, host);
const button = () => [...host.querySelectorAll("button")].find((b) => /Set up a table|Setting up/.test(b.textContent));
const status = () => host.querySelector(".status")?.textContent ?? "";
mark("mounted the game page", { pieces: Object.keys(game.doc().pieces).length });
button().click();
let seen = "";
for (let i = 0; !opened.length && i < 36000; i++) {
  await new Promise((r) => setTimeout(r, 50));
  const s = `${button()?.textContent} | ${status()}`;
  if (s !== seen && i % 20 === 0) console.error("        ", s.slice(0, 140)), (seen = s);
  if (/Couldn't/.test(status())) break;
}
mark("set up a table", {
  opened: opened.length,
  status: status().slice(0, 200),
  changes,
  listenerMs: Math.round(listenerMs),
  decodes: counts.decodes,
  crops: counts.crops,
  fetches: counts.fetches,
  fetchedMB: Math.round(counts.fetchedBytes / MB),
  drawn: Object.keys(game.doc().drawn ?? {}).length,
});
unmount();
const scene = opened[0] ? (await repo.find(opened[0].url)).doc() : null;
console.log(JSON.stringify({ mod: save.saveName, scale: SCALE, totalMs: Math.round(performance.now() - t0), sceneObjects: scene ? Object.keys(scene.objects ?? {}).length : 0, phases }, null, 2));
await window.happyDOM.abort?.();
process.exit(0);
