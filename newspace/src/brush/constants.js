// Pure constants + helpers for the Sketchy canvas ("brush"). Extracted from
// tool.jsx so the canvas can be split into modules. No Solid/component state here
// — only values and pure functions (plus `ensureLayout`, which takes its repo).
import { defaultLayers } from "../layers.js"; // the base + overlay layer stack (a literal)

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

// Render items in a STABLE (id-sorted) order, while stacking order comes from
// the array index via z-index. So reordering a layer changes only a z-index —
// the DOM node never moves, so live embeds (a call, an iframe) are never torn
// down or relocated. (ids are stable, so this order doesn't shuffle.)
export const sortById = (items) =>
  [...(items || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
// editable AS DATA: the tools in the toolbar, which chrome parts show, and which component
// renders it. The layered resolver (chromePart / chromeHost.tools) reads this; an empty slot
// still falls back to the tool's opts. `component` names the patchwork:component.
export const DEFAULT_LAYOUT = {
  component: "sketchy",
  tools: ["select", "hand", "pen", "eraser", "wire", "rectangle", "ellipse", "arrow", "text"],
  toolbar: true, properties: true, presence: true, // minimap + zoom are now seeded bare tools
};

// the former hardcoded chrome, now SEEDED bare tools on the overlay — normal items (move/
// delete/add like any other), corner-anchored, stable ids so migration stays idempotent.
// Each is WIRED to its own `canvas` context node (a placeable source that re-publishes the
// canvas's live state as outlets): minimap ← ns-ctx-mm, zoom ← ns-ctx-zoom. Real, visible
// wires — nodeStream(nodeId, outlet) resolves to the context Source. `camera` is read/WRITE.
export const MINIMAP_INLETS = { rects: { node: "ns-ctx-mm", outlet: "rects" }, bounds: { node: "ns-ctx-mm", outlet: "bounds" }, peers: { node: "ns-ctx-mm", outlet: "peers" }, view: { node: "ns-ctx-mm", outlet: "view" }, camera: { node: "ns-ctx-mm", outlet: "camera" } };
export const ZOOM_INLETS = { camera: { node: "ns-ctx-zoom", outlet: "camera" } };
// which viewport edges a corner anchor pins to — the SINGLE source of truth (resolveItemPos,
// toAnchorOffset, the move delta-flip, item.jsx baseStyle all read this).
export const anchorAxes = (anchor) => ({ right: anchor === "bottom-right" || anchor === "top-right", bottom: anchor === "bottom-left" || anchor === "bottom-right" });

// the stable ids of the seeded overlay chrome. Deleting one records it in the layout doc's
// `dismissedSeeds` so ensureLayout does NOT re-seed it on the next open (the "delete like any
// item" contract). Fresh sketches + never-dismissed ones still get seeded.
export const SEED_IDS = ["ns-ctx-mm", "ns-minimap", "ns-ctx-zoom", "ns-zoom"];
const canvasCtxItem = (id, anchor, x, y) => ({ id, kind: "editor", editorId: "canvas", layer: "overlay", anchor, x, y, w: 74, h: 22, rotation: 0, inlets: {} });
export const minimapSeedItem = () => ({ id: "ns-minimap", kind: "editor", editorId: "minimap", layer: "overlay", anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136, rotation: 0, inlets: { ...MINIMAP_INLETS } });
export const zoomSeedItem = () => ({ id: "ns-zoom", kind: "editor", editorId: "zoom", layer: "overlay", anchor: "bottom-right", x: 16, y: 18, w: 56, h: 28, rotation: 0, inlets: { ...ZOOM_INLETS } });
export const ctxMmSeedItem = () => canvasCtxItem("ns-ctx-mm", "bottom-left", 16, 162);   // above the minimap
export const ctxZoomSeedItem = () => canvasCtxItem("ns-ctx-zoom", "bottom-right", 16, 54); // above the zoom
export const defaultOverlayItems = () => [ctxMmSeedItem(), minimapSeedItem(), ctxZoomSeedItem(), zoomSeedItem()];

// a "space" doc (a folder/sketch) references its canvas layout doc via `.sketch` (was
// `.newspace` — still read for back-compat + migrated forward). ensureLayout makes/loads
// that layout doc, seeding DEFAULT_LAYOUT and migrating any older top-level `items`.
export async function ensureLayout(repo, folderHandle) {
  folderHandle.change((d) => { if (!d.docs) d.docs = []; });
  let url = folderHandle.doc().sketch || folderHandle.doc().newspace;
  if (!url) {
    const old = folderHandle.doc().items;
    const seed = Array.isArray(old) ? old.map(clonePlain) : [];
    const layout = await repo.create2({ "@patchwork": { type: "sketch-layout" }, items: [...seed, ...defaultOverlayItems()], layers: defaultLayers(), layout: { ...DEFAULT_LAYOUT } });
    folderHandle.change((d) => { d.sketch = layout.url; if (Array.isArray(d.items)) d.items.splice(0); });
    return layout;
  }
  if (!folderHandle.doc().sketch) folderHandle.change((d) => { d.sketch = url; }); // migrate .newspace → .sketch
  const lh = await repo.find(url);
  lh.change((d) => {
    if (!d.items) d.items = [];
    if (!d.layout) d.layout = { ...DEFAULT_LAYOUT };
    if (!d.layers) d.layers = defaultLayers();
    // seed the overlay chrome — but NEVER re-seed something the user deleted (dismissedSeeds).
    const dismissed = d.dismissedSeeds || [];
    const seed = (id, make) => { if (!dismissed.includes(id) && !d.items.some((it) => it.id === id)) d.items.push(make()); };
    seed("ns-ctx-mm", ctxMmSeedItem);
    seed("ns-ctx-zoom", ctxZoomSeedItem);
    seed("ns-minimap", minimapSeedItem);
    seed("ns-zoom", zoomSeedItem);
    // rewire/upgrade earlier seeds (older versions used {context} inlets or a top-left zoom).
    const mm = d.items.find((it) => it.id === "ns-minimap");
    if (mm) {
      if (!mm.anchor) Object.assign(mm, { anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136 });
      if (!mm.inlets || !mm.inlets.rects || !mm.inlets.rects.node) mm.inlets = { ...MINIMAP_INLETS };
    }
    const zm = d.items.find((it) => it.id === "ns-zoom");
    if (zm) {
      if (!zm.anchor) Object.assign(zm, { anchor: "bottom-right", x: 16, y: 18, w: 56, h: 28 });
      if (!zm.inlets || !zm.inlets.camera || !zm.inlets.camera.node) zm.inlets = { ...ZOOM_INLETS };
    }
  });
  return lh;
}

// stable fallback colour from a contact url
export function colorFor(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `oklch(0.62 0.19 ${Math.abs(h) % 360})`;
}

export function isTypingTarget(t) {
  const el = t || document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return !!(el.closest && el.closest(".ns-doc-body:not(.ns-frame-body)"));
}
