// THE CATALOG — the single census of "placeable things". The parts bin, the
// toolbar's + add menu and the place/arm flows all consume THIS module (each
// surface renders its own slice of the same data): the tool/stamp/shape tables,
// the registry accessors (datatypes · surfaces · lenses · palettes), the part-id
// drag protocol, and partsCensus (registries in → grouped tiles out).
// Pure data + registry reads — no DOM (the mounts live in parts-bin.js and
// brush/ui/chrome.jsx, which re-export these names for their existing callers).
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { listEditors, nodeRole } from "./surfaces.js";
import { listLensDescriptors } from "./lenses.js";

// ── tool metadata: id -> [label, icon path] ──────────────────────────────────
export const TOOL_META = {
  select: ["Select  (V)", "M4 3l14 6-6 2-2 6z"],
  hand: ["Pan  (H)", "M7 11V6a1.5 1.5 0 013 0v4m0-4.5a1.5 1.5 0 013 0V11m0-3a1.5 1.5 0 013 0v5a5 5 0 01-5 5h-2a4 4 0 01-3-1.7L6 16"],
  pen: ["Draw  (P)", "M3 17l9-9 3 3-9 9H3v-3zM13 6l2-2 3 3-2 2z"],
  eraser: ["Eraser  (E)", "M4 14l7-7 7 7-5 5H8z"],
  rectangle: ["Rectangle  (R)", "M3 5h16v12H3z"],
  ellipse: ["Ellipse  (O)", "M11 5a8 6 0 100 12 8 6 0 000-12z"],
  line: ["Line  (L)", "M4 18L18 5"],
  arrow: ["Arrow  (A)", "M4 18L17 6m0 0H9m8 0v8"],
  text: ["Text  (T)", "M5 6h12M11 6v11"],
  box: ["Box  (F)", "M8 3H3V8 M14 3H19V8 M14 19H19V14 M8 19H3V14"],
  wire: ["Wire  (W)", "M4 3l9 3.7-3.7 1.2-1.2 3.7z M12 11c2 2 3.2 3.2 4.2 4.6 M18.8 15.6a2 2 0 10.02 0z"],
  highlighter: ["Highlighter", "M5 15l7-7 4 4-7 7H5v-4z M14 6l3-3 3 3-3 3z M4 21h8"],
  constraint: ["Constraint line", "M5 18a1.6 1.6 0 100-.1z M17 6a1.6 1.6 0 100-.1z M6 17L16 7 M6 17h5"],
  voice: ["Voice note", "M12 4a2.5 2.5 0 012.5 2.5v4a2.5 2.5 0 01-5 0v-4A2.5 2.5 0 0112 4z M7 10a5 5 0 0010 0 M12 15v4 M9 19h6"],
};
export const SHAPE_DRAGGABLE = new Set(["rectangle", "ellipse", "line", "arrow"]);
// the generic brush squiggle — the glyph for a registry brush without a TOOL_META
// entry (the shape overflow and the palette node both draw from this one source)
export const BRUSH_FALLBACK_PATH = "M5 16c4-1 5-9 9-10M14 6l3-2";

// little hand-drawn "stamps" — multi-stroke line drawings. Dragging the matching
// toolbar item drops them onto the canvas as freehand (pencil) strokes; the same
// paths render the toolbar glyph. Each path string is one stroke.
export const STAMPS = {
  // the cat face (replaces the old ◕ᴥ◕)
  face: { view: "0 0 64 52", paths: [
    "M17 31 L25 14 L31 29", "M33 29 L40 14 L47 31",
    "M31 30 C27.5 30 27.5 41 31 41 C34.5 41 34.5 30 31 30",
    "M28 33 L8 31", "M27 36 L10 45", "M28 39 L18 51",
    "M35 33 L57 30", "M35 37 L53 43",
  ] },
  // a pencil (for the pen tool)
  pencil: { view: "0 0 48 48", paths: [
    "M10 38 L30 18 L34 22 L14 42 Z", "M10 38 L14 42 L7 45 Z", "M28 20 L32 24",
  ] },
  // an open hand — 4 fingers + thumb (for the hand tool)
  hand: { view: "0 0 110 124", paths: [
    "M34 116 C31 104 31 96 34 82 C27 76 17 68 15 58 C13 52 21 49 27 56 C32 62 37 70 39 74 L39 36 C39 27 51 27 51 36 L51 54 L53 54 L53 26 C53 17 65 17 65 26 L65 54 L67 54 L67 32 C67 23 79 23 79 32 L79 56 L81 56 L81 44 C81 36 91 36 91 46 C93 68 93 100 88 116 C80 122 42 122 34 116 Z",
  ] },
  // a head-down mouse with a big ear and a long curling tail (for select)
  mouse: { view: "0 0 120 120", paths: [
    "M34 104 C26 98 24 84 30 70 C36 48 54 34 74 40 C88 44 92 60 86 76 C80 92 60 102 44 100 C40 99 36 106 34 104 Z",
    "M58 42 C54 24 80 22 84 40 C86 50 80 58 70 56",
    "M66 44 C64 36 76 34 78 44",
    "M33 103 C29 105 29 110 34 110 C38 110 38 105 34 103",
    "M33 107 L13 112", "M34 110 L15 120", "M35 105 L16 100",
    "M48 84 C46 82 50 80 51 84",
    "M72 42 C96 33 108 54 96 72 C90 81 83 83 79 78",
  ] },
};
export const STAMP_IDS = new Set(["face", "pencil", "hand", "mouse"]);

// ── the placeable registries, one accessor each ──────────────────────────────
export function catalogDatatypes() {
  try { return getRegistry("patchwork:datatype").filter((d) => !d.unlisted); } catch { return []; }
}
export const catalogSurfaces = () => listEditors();
export const catalogLenses = () => listLensDescriptors();

// the built-in palette parts — kept as the FALLBACK when no `sketchy:palette`
// plugin is registered (registry/palettes.js registers these two properly now).
export const PALETTE_PARTS = [
  { id: "full", name: "full palette" },
  { id: "sketch", name: "sketching palette" },
];

// registered palettes — the `sketchy:palette` PLUGIN type (documented in README.md):
//   { type: "sketchy:palette", id, name, icon?, entries: [entry…] | () => [entry…] }
// dragging one out of the bin instantiates a palette surface with those entries.
export function listPalettes() {
  try {
    const r = getRegistry("sketchy:palette");
    const list = !r ? [] : typeof r.filter === "function" ? r.filter(() => true) : Array.isArray(r) ? r : [];
    if (list.length) return list;
  } catch {}
  return PALETTE_PARTS;
}

// ── the part-id drag protocol ────────────────────────────────────────────────
// the palette's DnD type (canvas.jsx's TOOL_DRAG imports this — one protocol)
export const PART_DRAG_TYPE = "text/x-newspace-tool";
const NAMESPACED = new Set(["datatype", "surface", "lens", "palette", "flap"]);

// the flap tile's payload — one kind, one id (a flap is a flap)
export const FLAP_PART = "flap:flap";

// kind + id → the dataTransfer payload. Bare for tools/shapes/stamps (the
// existing protocol), `kind:id` for the registry kinds the bin adds.
export function encodePartId(kind, id) {
  return NAMESPACED.has(kind) ? kind + ":" + id : id;
}
// payload → { kind, id }. A bare id is a tool/shape/stamp — `{ kind: "tool" }`.
export function decodePartId(part) {
  const i = typeof part === "string" ? part.indexOf(":") : -1;
  if (i > 0) {
    const kind = part.slice(0, i);
    if (NAMESPACED.has(kind)) return { kind, id: part.slice(i + 1) };
  }
  return { kind: "tool", id: part };
}

// ── the grouping (shared by the census AND the + add menu) ───────────────────
export const byName = (a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || "");
// placeable surfaces, split by role: a SOURCE produces (no inlets),
// everything else is an editor/sink/transform you wire into
export function splitSurfacesByRole(surfaces) {
  return {
    sources: (surfaces || []).filter((w) => nodeRole(w) === "source").sort(byName),
    editors: (surfaces || []).filter((w) => nodeRole(w) !== "source").sort(byName),
  };
}

// ── the census (pure: registries in → grouped tiles out) ────────────────────
// Groups mirror the + add menu (the SAME grouping: splitSurfacesByRole, byName)
// plus the toolbar's draggables (shapes, stamps).
// Each tile: { part (the encoded drag payload), kind, id, name, mark, icon?,
// stamp? (the multi-stroke drawing, for the tile's icon), path? (a TOOL_META
// icon path) }.
export function partsCensus({ datatypes = [], surfaces = [], lenses = [], stamps = {}, shapes = [], palettes = [], flap = false } = {}) {
  const tile = (kind, d, mark) => ({ part: encodePartId(kind, d.id), kind, id: d.id, name: d.name || d.id, mark, icon: d.icon });
  const groups = [];
  if (palettes.length) groups.push({
    id: "palettes", label: "palettes",
    tiles: palettes.map((p) => tile("palette", p, "▤")),
  });
  // the FLAP tile — a named sticky container you place/draw (the frame flow);
  // not registry-driven, so it's opt-in (`flap: true` — the bin mounts pass it)
  if (flap) groups.push({
    id: "flaps", label: "containers",
    tiles: [{ part: FLAP_PART, kind: "flap", id: "flap", name: "flap", mark: "◧" }],
  });
  if (shapes.length) groups.push({
    id: "shapes", label: "shapes",
    tiles: shapes.map((id) => ({ part: id, kind: "tool", id, name: id, mark: "▱", path: (TOOL_META[id] || [])[1] })),
  });
  const stampIds = Object.keys(stamps);
  if (stampIds.length) groups.push({
    id: "stamps", label: "stamps",
    tiles: stampIds.map((id) => ({ part: id, kind: "stamp", id, name: id, mark: "✎", stamp: stamps[id] })),
  });
  if (datatypes.length) groups.push({ id: "docs", label: "new docs", tiles: [...datatypes].sort(byName).map((d) => tile("datatype", d, "＋")) });
  const { sources, editors } = splitSurfacesByRole(surfaces);
  if (sources.length) groups.push({ id: "sources", label: "sources", tiles: sources.map((d) => tile("surface", d, "●")) });
  if (editors.length) groups.push({ id: "editors", label: "editors", tiles: editors.map((d) => tile("surface", d, "⚡")) });
  if (lenses.length) groups.push({ id: "lenses", label: "lenses", tiles: [...lenses].sort(byName).map((d) => tile("lens", d, "◇")) });
  return groups;
}

// a CLICK on a tile arms the matching place flow: the same host commands the
// + menu uses. Returns true when something was armed.
export function armPart(t, host) {
  if (!t || !host) return false;
  const find = (list) => (list || []).find((x) => x.id === t.id);
  if (t.kind === "datatype") { const d = find(host.datatypes && host.datatypes()); if (d && host.selectPlacing) { host.selectPlacing(d); return true; } return false; }
  if (t.kind === "surface") { const d = find(host.editors && host.editors()); if (d && host.placeEditor) { host.placeEditor(d); return true; } return false; }
  if (t.kind === "lens") { const d = find(host.lenses && host.lenses()); if (d && host.placeLens) { host.placeLens(d); return true; } return false; }
  if (t.kind === "flap") { if (host.placeFlap) { host.placeFlap(); return true; } return false; } // draw-a-flap (the place flow)
  if (t.kind === "tool" && host.setTool) { host.setTool(t.id); return true; } // a shape: arm its draw tool
  return false; // stamps are drag-only (a stamp id isn't a tool)
}
