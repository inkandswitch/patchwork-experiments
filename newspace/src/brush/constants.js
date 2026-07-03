// Pure constants + helpers for the Sketchy canvas ("brush"). Extracted from
// tool.jsx so the canvas can be split into modules. No Solid/component state here
// — only values and pure functions (plus `ensureLayout`, which takes its repo).
import { defaultLayers } from "../layers.js"; // the base + overlay layer stack
import { byIdAsc, toolEntry, entriesFromIds } from "../model.js"; // id comparator + palette-entry helpers
import { valuesEqual } from "../ops.js"; // the deep fallback in shapePropsEqual
import { count as perfCount } from "../perf.js";

// colours are stored as semantic NAMES, mapped to a --space-color-* palette
export const PALETTE = [
  "line", "offset",
  "purple", "deep purple",
  "blue", "deep blue",
  "green", "deep green",
  "yellow", "deep yellow",
  "red", "deep red",
];
// the editor background — used for the "paper" colour (matches the canvas) and
// as the mix target for paler fills
export const FILL_BG = "var(--editor-fill, var(--studio-fill, #fff))";
// a palette name -> css var; legacy css values (with digits/punctuation) pass through
export const colorVar = (c) => {
  if (!c || c === "none") return c;
  if (c === "paper") return FILL_BG;
  if (/[^a-z\s]/i.test(c)) return c;
  return `var(--space-color-${c.trim().replace(/\s+/g, "-")})`;
};
// fills are a slightly PALER version of the palette colour — mixed toward the
// editor background so a filled shape reads as a tint, not a flat block. "paper"
// is the exact canvas colour (no mix), so it occludes what's behind.
export const fillVar = (c) =>
  !c || c === "none" ? c : c === "paper" ? FILL_BG : `color-mix(in oklab, ${colorVar(c)} 55%, ${FILL_BG})`;

export const SIZES = [2, 5, 10, 18]; // pencil + shapes: four fatnesses
export const ARROW_SIZES = [2, 5]; // arrows: just the two thin ones
export const FILL_STYLES = ["solid", "hachure", "cross-hatch", "zigzag", "dots"];
// little CSS previews so the fill-style picker shows what each style looks like
export const FILL_PREVIEW = {
  hachure: { "background-image": "repeating-linear-gradient(45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px)" },
  "cross-hatch": { "background-image": "repeating-linear-gradient(45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px), repeating-linear-gradient(-45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px)" },
  zigzag: { "background-image": "repeating-linear-gradient(135deg, var(--ns-ink) 0 1.5px, transparent 1.5px 4px)" },
  dots: { "background-image": "radial-gradient(var(--ns-ink) 1px, transparent 1.5px)", "background-size": "5px 5px" },
  solid: { background: "var(--ns-ink)" },
};
export const STROKE_STYLES = ["solid", "dashed", "dotted"];
// rectangle corner styles, shown as a top-left-corner glyph
export const CORNERS = [
  { key: "squircle", icon: "M3 15 C3 6 6 3 15 3" },
  { key: "round", icon: "M3 15 L3 9 Q3 3 9 3 L15 3" },
  { key: "square", icon: "M3 15 L3 3 L15 3" },
];
// roughness + bowing collapsed into one three-step choice (default = middle),
// each shown as a little line icon: straight → gently wavy → jagged
export const ROUGHNESS_LEVELS = [
  { key: "clean", label: "clean", roughness: 0, bowing: 0.05, icon: "M2 9 H22" },
  { key: "sketchy", label: "sketchy", roughness: 1.5, bowing: 0.1, icon: "M2 9 Q7 4 12 9 T22 9" },
  { key: "scratchy", label: "scratchy", roughness: 4.5, bowing: 0.28, icon: "M2 9 L5 4.5 L8 12 L11 5 L14 12 L17 5 L20 12 L22 7.5" },
];
// four text faces. "hand" is Caroni (an overridable --newspace-family-hand
// token, see style.css); the rest pull from the editor font vars.
export const FONTS = {
  hand: "var(--newspace-family-hand, \"Caroni\", cursive)",
  sans: "var(--editor-font-sans, ui-sans-serif, system-ui, sans-serif)",
  serif: "var(--editor-font-serif, ui-serif, Georgia, 'Times New Roman', serif)",
  code: "var(--editor-font-mono, ui-monospace, 'SF Mono', monospace)",
};
export const FONT_OPTIONS = ["hand", "sans", "serif", "code"];
export const fontFamily = (f) => FONTS[f] || FONTS.hand;
// resolve a shape's colours for rough.js
export function shapeRenderProps(it, resolve) {
  return { ...it, color: resolve(colorVar(it.color)), fill: resolve(fillVar(it.fill)) };
}

// Equality for the shape-stream sync (canvas.jsx, README.md Phase 7). `shapeProps`
// is a SHALLOW copy of the item, so a field the change didn't touch keeps its
// projection identity — compare per key by identity first, and fall back to the
// deep `valuesEqual` (a JSON walk) only for keys whose identity changed. A big
// stroke's untouched `points` array is one `===`, never a stringify; a replaced-
// but-equal value still compares equal through the fallback, exactly as before.
export function shapePropsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    if (a[k] === b[k]) continue;
    if (!(k in b)) return false;
    perfCount("shapeEqDeep"); // an ACTUAL deep-compare fallback (identity miss)
    if (!valuesEqual(a[k], b[k])) return false;
  }
  return true;
}

// Render items in a STABLE (id-sorted) order, while stacking order comes from
// the array index via z-index. So reordering a layer changes only a z-index —
// the DOM node never moves, so live embeds (a call, an iframe) are never torn
// down or relocated. (ids are stable, so this order doesn't shuffle.)
export const sortById = (items) => [...(items || [])].sort(byIdAsc);

// Reordering a layer makes Solid relocate that item's DOM node with
// insertBefore, which RESETS iframes / live embeds (a call drops its WebRTC).
// moveBefore() (the atomic-move API) relocates a node without tearing it down,
// so we route same-parent moves through it. Feature-detected; falls back to
// insertBefore where unsupported.
export function enableAtomicMove(el) {
  if (!el || el.__nsAtomicMove || typeof el.moveBefore !== "function") return;
  el.__nsAtomicMove = true;
  const insertBefore = Element.prototype.insertBefore;
  el.insertBefore = function (node, ref) {
    if (node && node !== ref && node.parentNode === this) {
      try {
        this.moveBefore(node, ref);
        return node;
      } catch {
        /* fall through */
      }
    }
    return insertBefore.call(this, node, ref);
  };
}
// a window-level pointer drag: `move` per pointermove, settled by pointerup OR
// pointercancel — a cancelled touch/pen gesture must still detach, or the stale
// listeners ride the NEXT foreign pointer's events. `done(cancelled)` runs once
// on settle; returns a manual detach. (The canvas's own gestures use its
// txn-aware gestureListeners; this is the shared helper for simple chrome drags.)
export function windowDrag(move, done) {
  const off = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
  };
  const up = (e) => { off(); if (done) done(false, e); };
  const cancel = (e) => { off(); if (done) done(true, e); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  return off;
}

export const SHAPE_TOOLS = new Set(["rectangle", "ellipse", "line", "arrow"]);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rndSeed = () => Math.floor(Math.random() * 2147483647);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function clonePlain(o) {
  const c = { ...o };
  if (o.kind === "stroke" && Array.isArray(o.points)) c.points = o.points.map((p) => [p[0], p[1], p[2] ?? 0.5]);
  delete c.parent;
  return c;
}
// The DEFAULT per-sketch LAYOUT — seeded into a new layout doc so the layout is visible +
// editable AS DATA: the standard tool set (the seeded palette window's brushes), which
// chrome parts show, and which component renders it. The layered resolver (chromePart /
// chromeHost.tools) reads this; an empty slot still falls back to the tool's opts.
// `component` names the patchwork:component. (Older docs may also carry `toolbar: true`
// from the removed fixed toolbar — ignored, never deleted.)
export const DEFAULT_LAYOUT = {
  component: "sketchy",
  tools: ["select", "hand", "pen", "eraser", "wire", "rectangle", "ellipse", "arrow", "text"],
  properties: true, presence: true, // minimap/zoom/palette/parts are seeded bare tools
};

// the DEFAULT palette ENTRIES (model.js entry structure) — reproduces the OLD fixed
// Toolbar's layout exactly: nav+draw tools · divider · shapes + the "more shapes"
// overflow menu (line/box lived behind the ▾). This is what the seeded
// palette-config window ships (and emits on its `tools` outlet).
export const DEFAULT_TOOL_ENTRIES = [
  toolEntry("select"), toolEntry("hand"), toolEntry("pen"), toolEntry("eraser"), toolEntry("wire"),
  { kind: "divider" },
  toolEntry("rectangle"), toolEntry("ellipse"), toolEntry("arrow"), toolEntry("text"),
  { kind: "menu", label: "more shapes", items: [toolEntry("line"), toolEntry("box")] },
];

// the former hardcoded chrome, now SEEDED bare tools on the overlay — normal items (move/
// delete/add like any other), stable ids so migration stays idempotent. These carry the
// legacy corner-`anchor` form (kept so old clients keep positioning them); readers
// normalize it to sticky (sticky.js stickyOf) — the one docked-positioning system.
// The minimap/zoom seed UNWIRED: a bare tool's never-wired inlets auto-feed from the
// ambient canvas context (editor-item.jsx's `auto` backing plan). The old seeded
// "canvas" chips (ns-ctx-mm / ns-ctx-zoom) + their wires were the wrong model and
// are REMOVED by the upgrade pass below; the canvas-source node stays registered
// as a hand-placeable part.
// the seeded palette is WIRED to the seeded palette-config window's `tools` outlet
// (a real, visible, persisted wire)
export const PALETTE_INLETS = { tools: { node: "ns-toolbar-config", outlet: "tools" } };

// the stable ids of the seeded overlay chrome. Deleting one records it in the layout doc's
// `dismissedSeeds` so ensureLayout does NOT re-seed it on the next open (the "delete like any
// item" contract). Fresh sketches + never-dismissed ones still get seeded.
export const SEED_IDS = ["ns-minimap", "ns-zoom", "ns-layers", "ns-toolbar-palette", "ns-toolbar-config", "ns-parts", "ns-presence"];
// the RETIRED seeded chips (the "canvas objects" chrome model) — removed on upgrade
export const RETIRED_CTX_CHIP_IDS = ["ns-ctx-mm", "ns-ctx-zoom"];
// overlay-home (`layers` home = overlay); `layer` stays mirrored for old clients.
export const minimapSeedItem = () => ({ id: "ns-minimap", kind: "editor", editorId: "minimap", layer: "overlay", layers: ["overlay"], anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136, rotation: 0, inlets: {} });
export const zoomSeedItem = () => ({ id: "ns-zoom", kind: "editor", editorId: "zoom", layer: "overlay", layers: ["overlay"], anchor: "bottom-right", x: 16, y: 18, w: 56, h: 28, rotation: 0, inlets: {} });
// the LAYER SWITCHER — a bare window like the palette: overlay HOME with a canvas
// membership (it must be visible on EVERY layer, or you couldn't switch back),
// sticky near the right end of the top edge, dismissable like any seed. It reads
// the stack / writes the active tab through the canvas context (layers-node.js).
export const layersSeedItem = () => ({ id: "ns-layers", kind: "editor", editorId: "layers", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "top", t: 0.9 }, x: 0, y: 0, w: 148, h: 30, rotation: 0, inlets: {} });
// the TOOLBAR is a seeded palette bare-window — the membership showcase: overlay HOME
// (arrange it on the overlay tab) with a CANVAS membership (usable while drawing).
// Sticky-docked bottom-centre; the brushes are the standard DEFAULT_LAYOUT tool set.
// WIRED (PALETTE_INLETS) to the seeded palette-config window; the unwired fallback
// is seeded as `config.entries` — ENTRIES are the model; the legacy `config.brushes`
// id list is a read-shim (normalized on read forever, never written).
export const paletteSeedItem = () => ({ id: "ns-toolbar-palette", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "bottom", t: 0.5 }, x: 0, y: 0, w: 356, h: 44, rotation: 0, inlets: { ...PALETTE_INLETS }, config: { entries: entriesFromIds([...DEFAULT_LAYOUT.tools]) } });
// the palette CONFIGURATOR — its own bare window, overlay-ONLY (arrange-your-space
// territory), owning the entry array in its config and emitting it on `tools`.
// `brushIds` (an existing palette's customized id list) seeds matching entries so
// upgrading an old doc never clobbers a customized palette; default = the old
// Toolbar's layout (dividers + the shape overflow menu).
export const paletteConfigSeedItem = (brushIds) => ({
  id: "ns-toolbar-config", kind: "editor", editorId: "palette-config", layer: "overlay", layers: ["overlay"],
  x: 24, y: 96, w: 236, h: 320, rotation: 0, inlets: {},
  config: { entries: brushIds ? entriesFromIds(brushIds) : DEFAULT_TOOL_ENTRIES.map((e) => JSON.parse(JSON.stringify(e))) },
});
// ── the PARTS FLAP — the bin as a named STICKY container (a `flap: true` frame) ──
// The bin no longer seeds as a bare window: `ns-parts` is a FLAP — a frame whose
// sub-space holds ONE parked item, the parts-bin window — overlay-only, stuck on
// the left edge (so it collapses to an edge TAB until clicked). The flap is a
// plain frame (old clients render it as one); the bin window inside it is a
// plain item — nothing about either is special, so anything else you alt-drag
// into the flap parks there the same way (this replaces the customParts
// save-a-palette protocol). Seeding creates DOCS (a folder + its layout), so it
// runs ASYNC from the ROOT canvas (canvas.jsx), NOT from ensureLayout — every
// box's loadSpace goes through ensureLayout and must not grow a flap + two docs.
export const partsWindowSeedItem = () => ({ id: "ns-parts-window", kind: "editor", editorId: "parts", x: 8, y: 8, w: 232, h: 324, rotation: 0, inlets: {} });
export const partsFlapItem = (url) => ({ id: "ns-parts", kind: "frame", flap: true, url, layer: "overlay", layers: ["overlay"], sticky: { edge: "left", t: 1 }, x: 24, y: 96, w: 248, h: 340, rotation: 0 });
// a flap's SUB-SPACE: a folder + canvas-layout pair like any frame's, except the
// layout dismisses EVERY seed — a flap is a shelf, not a full sketch space, so
// re-opens never grow chrome (minimap/palette/…) inside it.
export async function makeFlapSpace(repo, name = "flap", items = []) {
  const layout = await repo.create2({
    "@patchwork": { type: "sketch-layout" },
    items, layers: defaultLayers(), layout: { ...DEFAULT_LAYOUT },
    // retired ids included: an OLD client opening the flap must not seed them either
    dismissedSeeds: [...SEED_IDS, ...RETIRED_CTX_CHIP_IDS],
  });
  return repo.create2({ "@patchwork": { type: "folder" }, title: name, docs: [], sketch: layout.url, "@layouts": { canvas: layout.url } });
}
// seed the parts flap into a ROOT layout doc: idempotent (by the stable id),
// dismissal-respecting, and a no-op when an OLD ns-parts (the pre-flap bare
// window) is already there — existing docs keep what they have, migration-free.
export async function seedPartsFlap(repo, lh) {
  const d = lh.doc();
  if (!d || (d.dismissedSeeds || []).includes("ns-parts")) return null;
  if ((d.items || []).some((it) => it.id === "ns-parts")) return null;
  const folder = await makeFlapSpace(repo, "parts", [partsWindowSeedItem()]);
  lh.change((dd) => {
    if ((dd.dismissedSeeds || []).includes("ns-parts")) return;
    if (!dd.items) dd.items = [];
    if (dd.items.some((it) => it.id === "ns-parts")) return; // raced another open
    dd.items.push(partsFlapItem(folder.url));
  });
  return folder;
}
// the PRESENCE bar — a bare window like the palette: overlay HOME with a canvas
// membership (presence matters while drawing), sticky near the bottom of the
// right edge, dismissable like any seed. Its `peers` inlet auto-wires to the
// canvas's ambient `peers` outlet (the bare-tool convention).
export const presenceSeedItem = () => ({ id: "ns-presence", kind: "editor", editorId: "presence", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "right", t: 0.9 }, x: 0, y: 0, w: 148, h: 34, rotation: 0, inlets: {} });
// (ns-parts is NOT here: the parts flap needs docs created, so the root canvas
// seeds it async via seedPartsFlap above)
export const defaultOverlayItems = () => [minimapSeedItem(), zoomSeedItem(), layersSeedItem(), paletteConfigSeedItem(), paletteSeedItem(), presenceSeedItem()];

// ── MULTIPLE complement docs (README.md "still needed" #1) ─────────────────────
// A "space" doc (a folder/sketch) references ONE complement doc PER LAYOUT under the
// `@layouts` map: `{ "@layouts": { canvas: url, dock: url, … } }` — the key is the
// `sketchy:layout` descriptor id, so a registered layout finds its complement by its
// own id. Each complement is created LAZILY on first open through that lens.
//
// Migration story (all ADDITIVE — nothing is ever deleted, no map-key deletion):
// the legacy single-field reference (`.sketch`, formerly `.newspace`) IS the canvas
// entry. It's mirrored into `@layouts.canvas`, and `.sketch` KEEPS being written so
// old clients — which converge on `.sketch` (canvas.jsx reacts to it) — still work.
// For `canvas` the legacy field also WINS on read when present, because old clients
// only ever update `.sketch`; new clients follow it and re-mirror.

// resolve a layout's complement url from a folder doc (a pure read, no writes)
export function layoutDocUrl(folderDoc, key = "canvas") {
  const legacy = key === "canvas" ? folderDoc && (folderDoc.sketch || folderDoc.newspace) : undefined;
  const mapped = folderDoc && folderDoc["@layouts"] && folderDoc["@layouts"][key];
  return legacy || mapped || undefined;
}

// Per-key SEED SPECS — the seed content each layout key ships, AS DATA (README.md:
// a layout's complement carries that layout's defaults, not the canvas's). Each spec:
//   init(folderHandle) → the initial doc for repo.create2 (first open through this lens)
//   upgrade(layoutHandle) → the idempotent re-open pass (fill gaps, honour dismissedSeeds)
// A key WITHOUT a spec gets the minimal sketch-layout shape ({items:[]})
// and seeds its own arrays on first open.
export const LAYOUT_SEEDS = {
  canvas: {
    init(folderHandle) {
      const old = folderHandle.doc().items; // legacy top-level folder items migrate in
      const seed = Array.isArray(old) ? old.map(clonePlain) : [];
      return { "@patchwork": { type: "sketch-layout" }, items: [...seed, ...defaultOverlayItems()], layers: defaultLayers(), layout: { ...DEFAULT_LAYOUT } };
    },
    upgrade: upgradeCanvasLayoutDoc,
  },
};

// make/load the complement doc for `key`, seeding it from the OWNING layout's spec
// (LAYOUT_SEEDS[key]) — the canvas complement keeps its full seed exactly as before.
export async function ensureLayoutDoc(repo, folderHandle, key = "canvas") {
  folderHandle.change((d) => { if (!d.docs) d.docs = []; });
  const canvas = key === "canvas";
  const spec = LAYOUT_SEEDS[key];
  let url = layoutDocUrl(folderHandle.doc(), key);
  if (!url) {
    const layout = await repo.create2(
      spec ? spec.init(folderHandle) : { "@patchwork": { type: "sketch-layout" }, items: [] },
    );
    folderHandle.change((d) => {
      if (!d["@layouts"]) d["@layouts"] = {};
      d["@layouts"][key] = layout.url;
      if (canvas) { d.sketch = layout.url; if (Array.isArray(d.items)) d.items.splice(0); } // back-compat: old clients read .sketch
    });
    return layout;
  }
  // mirror the reference forward (guarded — no write when already in place)
  const cur = folderHandle.doc();
  if (!cur["@layouts"] || cur["@layouts"][key] !== url || (canvas && cur.sketch !== url)) {
    folderHandle.change((d) => {
      if (!d["@layouts"]) d["@layouts"] = {};
      if (d["@layouts"][key] !== url) d["@layouts"][key] = url;
      if (canvas && d.sketch !== url) d.sketch = url; // keep the legacy field written
    });
  }
  const lh = await repo.find(url);
  if (spec) spec.upgrade(lh);
  return lh;
}

// the canvas path, exactly as before — every existing caller keeps working
export function ensureLayout(repo, folderHandle) {
  return ensureLayoutDoc(repo, folderHandle, "canvas");
}

// the canvas complement's seed/upgrade pass (unchanged behavior, incl. the
// tombstone-aware inlet upgrade: `null` = an explicit unwire, never re-seeded)
function upgradeCanvasLayoutDoc(lh) {
  lh.change((d) => {
    if (!d.items) d.items = [];
    if (!d.layout) d.layout = { ...DEFAULT_LAYOUT };
    if (!d.layers) d.layers = defaultLayers();
    // (existing docs may carry a `layout.modes` field from the removed modes
    // experiment — left alone: persisted fields are never deleted)
    // seed the overlay chrome — but NEVER re-seed something the user deleted (dismissedSeeds).
    const dismissed = d.dismissedSeeds || [];
    const seed = (id, make) => { if (!dismissed.includes(id) && !d.items.some((it) => it.id === id)) d.items.push(make()); };
    seed("ns-minimap", minimapSeedItem);
    seed("ns-zoom", zoomSeedItem);
    seed("ns-layers", layersSeedItem);
    // the palette-config seed PRESERVES an existing palette's customized brush list:
    // if this doc's palette carries a non-default `config.brushes`, the config window
    // is seeded with matching entries (so the wire below can't clobber the custom set).
    const pal0 = d.items.find((it) => it.id === "ns-toolbar-palette");
    const palBrushes = pal0 && pal0.config && Array.isArray(pal0.config.brushes) ? [...pal0.config.brushes] : null;
    const customized = palBrushes && !(palBrushes.length === DEFAULT_LAYOUT.tools.length && palBrushes.every((x, i) => x === DEFAULT_LAYOUT.tools[i]));
    seed("ns-toolbar-config", () => paletteConfigSeedItem(customized ? palBrushes : null));
    seed("ns-toolbar-palette", paletteSeedItem);
    // (ns-parts — the parts FLAP — seeds async from the root canvas: seedPartsFlap)
    seed("ns-presence", presenceSeedItem);
    // upgrade earlier seeds' positioning (older versions shipped a top-left zoom)
    const mm = d.items.find((it) => it.id === "ns-minimap");
    if (mm && !mm.anchor) Object.assign(mm, { anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136 });
    const zm = d.items.find((it) => it.id === "ns-zoom");
    if (zm && !zm.anchor) Object.assign(zm, { anchor: "bottom-right", x: 16, y: 18, w: 56, h: 28 });
    // REMOVE the retired seeded "canvas" chips (the wrong model): the minimap/zoom
    // auto-feed from the ambient canvas context now. Only the EXACT seeded ids go —
    // a user-placed Canvas node (its own ed-… id) and wires to it are untouched.
    // Any inlet entry that pointed at a removed chip is DELETED, not nulled: null
    // is the explicit-cut tombstone and would keep suppressing the ambient feed —
    // deleting the key means the widget reads as never-wired and auto-feeds again.
    for (let i = d.items.length - 1; i >= 0; i--) if (RETIRED_CTX_CHIP_IDS.includes(d.items[i].id)) d.items.splice(i, 1);
    for (const it of d.items) {
      if (!it.inlets) continue;
      for (const k of Object.keys(it.inlets)) { const w = it.inlets[k]; if (w && w.node && RETIRED_CTX_CHIP_IDS.includes(w.node)) delete it.inlets[k]; }
    }
    // record the chips dismissed so an OLD client's upgrade pass doesn't re-seed them
    if (RETIRED_CTX_CHIP_IDS.some((id) => !dismissed.includes(id))) {
      if (!d.dismissedSeeds) d.dismissedSeeds = [];
      for (const id of RETIRED_CTX_CHIP_IDS) if (!d.dismissedSeeds.includes(id)) d.dismissedSeeds.push(id);
    }
    // wire an EXISTING palette seed to the (just-seeded) config window — same
    // convention: only a genuinely never-wired inlet upgrades; a null tombstone
    // (the user cut the wire) is respected, and the config-only fallback remains.
    const pal = d.items.find((it) => it.id === "ns-toolbar-palette");
    if (pal && !dismissed.includes("ns-toolbar-config")) {
      if (!pal.inlets) pal.inlets = {};
      if (pal.inlets.tools === undefined) pal.inlets.tools = { ...PALETTE_INLETS.tools };
    }
  });
}

// stable fallback colour from a contact url
export function colorFor(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `oklch(0.62 0.19 ${Math.abs(h) % 360})`;
}

// is this keystroke aimed at editable content or an embedded tool's subtree (which owns
// its own keys — incl. its own undo history), rather than the canvas itself?
//
// `within` (optional) is the asking canvas's ROOT element. In the real host the whole
// canvas renders INSIDE a <patchwork-view>, so the bare ancestor check used to match the
// canvas's own HOST view and swallow every shortcut (Backspace delete, `, undo, tool
// keys). With `within`, a patchwork-view ancestor counts as a typing target only when it
// is NOT the host: the nearest view that CONTAINS `within` is the view we're mounted in —
// ignore it and fall through to the remaining checks. (Nested sketchies resolve right:
// an embedded box's view is inside the outer canvas → the outer defers to it; the inner
// canvas passes its OWN root, so that same view is ITS host and its keys work.)
export function isTypingTarget(t, within) {
  const el = t || document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  const pv = el.closest && el.closest("patchwork-view");
  if (pv && !(within && pv.contains(within))) return true; // an embedded patchwork tool (not our own host view)
  return !!(el.closest && el.closest(".ns-doc-body:not(.ns-frame-body)"));
}
