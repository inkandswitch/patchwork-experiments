#!/usr/bin/env node
// How long a big TTS mod takes to import and then to set up a table from, and
// to show a card's face once it's set up, and where the time, the documents
// and the memory go. Node only, offline: a real Automerge Repo with
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
//   node probes/setup-bench.mjs [--mod <Workshop/<id>.json>] [--scale 0.25] [--fetch-now]
//
// Defaults: Terraforming Mars + Expansions (2104525488) from this machine's
// TTS cache, at full size, its assets fetched when first drawn (--fetch-now:
// every one at import, the importer's offline option). --scale shrinks every
// stand-in asset's bytes (not its pixel size). Set up a table is timed from
// the click to the scene opening; `made` counts the docs made (by type),
// `changes`/`listenerMs` are the game doc's change events and the time the
// game page spent handling them (happy-dom's DOM is slower than a browser's).
// Then a card's face is shown as a keeper shows it (table/faces.js): the
// first of its group (`shown`: until it can be drawn; `kept`: until its group
// is in the game), another of that group, and the first again for a viewer
// who comes later.
//
// Measured 2026-11-18 (TM, full size): 177 s and 1369 changes before drawn
// was written in batches, 15 s and 29 after, every piece drawn up front
// (1454 docs at setup, 1368 of them GLBs, after an import that fetched and
// stored all 339 assets). Drawn on demand: import 0.6 s, 1 doc, nothing
// fetched; setup 8–11 s, 8 changes, 742 docs (331 GLBs, 325 assets fetched
// and cached, 85 containers and bags, the scene); 6.5 s with --fetch-now. A
// card's face is drawn with its group (31 groups, 1051 faces; median 23,
// largest 171 over 4 sheets): its first showing 115 ms to its bytes, 233 ms
// to its group of 23 kept (24 docs, 1 change, 1 fetch); the largest's 8 ms
// and 595 ms (175 docs, 4 fetches); every later one, its doc (≤ 6 ms).
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
const FETCH_NOW = process.argv.includes("--fetch-now");
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
// what the game page and the keepers fetch with (pieces.js): the stand-in, never the network
globalThis.fetch = fetchStub;
mark("read the mod", { objects: save.objects.length });

// ─── a repo that never leaves this process ─────────────────────────────────
await initSubduction();
// no network, no storage, no sync endpoints: nothing leaves this process
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [] });
// every doc made, counted (and what kind of doc it is)
const made = { docs: 0, byType: {} };
const create2 = repo.create2.bind(repo);
repo.create2 = (init, ...rest) => {
  made.docs++;
  const t = init?.["@patchwork"]?.type ?? "?";
  made.byType[t] = (made.byType[t] ?? 0) + 1;
  return create2(init, ...rest);
};
const madeSince = (() => {
  let was = { docs: 0, byType: {} };
  return () => {
    const out = { docs: made.docs - was.docs, byType: Object.fromEntries(Object.entries(made.byType).map(([k, n]) => [k, n - (was.byType[k] ?? 0)]).filter(([, n]) => n)) };
    was = { docs: made.docs, byType: { ...made.byType } };
    return out;
  };
})();
const { runImport, source } = await import("../src/tts/importer.js");
const { default: TabletopGameTool } = await import("../src/tool.js");

// ─── 1. the import ─────────────────────────────────────────────────────────
let lastPhase = null;
const { gameUrl, report } = await runImport({
  sources: [source(`Mods/Workshop/${MOD.split("/").pop()}`, statSync(MOD).size, async () => new TextEncoder().encode(text))],
  repo,
  fetch: fetchStub,
  settings: { fetchNow: FETCH_NOW },
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
mark(`import: ${lastPhase}`, { made: madeSince(), missing: why, assets: report.counts.assets, fetches: counts.fetches, fetchedMB: Math.round(counts.fetchedBytes / MB) });

// ─── 2. the game page, then Set up a table ─────────────────────────────────
const game = await repo.find(gameUrl);
let listenerMs = 0;
let changes = 0;
const on = game.on.bind(game);
let docChanges = 0; // the game doc's changes, whoever is listening
on("change", () => docChanges++);
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
  made: madeSince(),
  opened: opened.length,
  status: status().slice(0, 200),
  changes,
  docChanges,
  listenerMs: Math.round(listenerMs),
  decodes: counts.decodes,
  crops: counts.crops,
  fetches: counts.fetches,
  fetchedMB: Math.round(counts.fetchedBytes / MB),
  drawn: Object.keys(game.doc().drawn ?? {}).length,
});
unmount();
const scene = opened[0] ? (await repo.find(opened[0].url)).doc() : null;

// ─── 3. a card shown, as a keeper shows it ─────────────────────────────────
const { faces: facesOf } = await import("../src/table/faces.js");
const { groupsOf } = await import("../src/pieces.js");
const g = () => game.doc();
const sheetOf = (k) => g().pieces[k]?.parts?.find((p) => p.top?.file)?.top?.file ?? "";
// a card's face is drawn with its group (pieces.js groupsOf: its container's cards and their sheets)
const groups = [...new Set(groupsOf(g()).values())].filter((m) => !m.some((k) => g().drawn?.[k]));
const sizes = groups.map((m) => m.length).sort((a, b) => a - b);
// a group of the middling size: a typical first card
const middling = [...groups].sort((a, b) => a.length - b.length)[Math.floor(groups.length / 2)];
const largest = [...groups].sort((a, b) => b.length - a.length)[0];
const ofGroup = middling;
const groupStats = { groups: groups.length, faces: sizes.reduce((a, b) => a + b, 0), median: sizes[Math.floor(sizes.length / 2)], largest: sizes.at(-1), sheets: new Set(ofGroup.map(sheetOf)).size };
const changesNow = () => docChanges;
const reveal = async (label, look, api, ofGroup = middling) => {
  const was = { changes: changesNow(), fetches: counts.fetches, decodes: counts.decodes, crops: counts.crops };
  madeSince();
  const s = performance.now();
  const shown = await facesOf(api)(look);
  const shownMs = performance.now() - s;
  // kept: its group is in the game (the whole group drawn, its docs made, recorded)
  for (let i = 0; i < 6000 && !ofGroup.every((k) => g().drawn?.[k]); i++) await new Promise((r) => setTimeout(r, 5));
  mark(label, {
    shownMs: Math.round(shownMs),
    shownAs: shown?.url ? "its doc" : shown?.glb ? "bytes drawn here" : "nothing",
    keptMs: Math.round(performance.now() - s),
    made: madeSince(),
    changes: changesNow() - was.changes,
    fetches: counts.fetches - was.fetches,
    decodes: counts.decodes - was.decodes,
    crops: counts.crops - was.crops,
  });
};
const here = { repo, registry: async () => null };
mark("before showing a card", { groupFaces: ofGroup.length, ...groupStats });
await reveal("show a card: the first of its group", { game: gameUrl, kind: ofGroup[0] }, here);
await reveal("show a card: another of that group", { game: gameUrl, kind: ofGroup.at(-1) }, here);
// a viewer who comes later: a drawer of their own (one per repo), finding it in the game
const later = { repo: { find: (u) => repo.find(u), create2: (d) => repo.create2(d) }, registry: async () => null };
await reveal("show a card: the first again, to a viewer who comes later", { game: gameUrl, kind: ofGroup[0] }, later);
await reveal(`show a card: the first of the largest group (${largest.length} faces)`, { game: gameUrl, kind: largest[0] }, here, largest);
console.log(JSON.stringify({ mod: save.saveName, scale: SCALE, fetchNow: FETCH_NOW, totalMs: Math.round(performance.now() - t0), sceneObjects: scene ? Object.keys(scene.objects ?? {}).length : 0, phases }, null, 2));
await window.happyDOM.abort?.();
process.exit(0);
