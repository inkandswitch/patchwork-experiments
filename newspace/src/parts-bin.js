// THE PARTS BIN — the flagship flap (see flaps.jsx): a browsable census of
// everything placeable, straight from the registries — shapes + stamps (the
// toolbar's drag-outs), datatypes (new docs), and the `sketchy:window` nodes +
// `sketchy:lens` lenses, grouped exactly like the + add menu (sources · editors ·
// lenses, via nodeRole). Raw callbacks + DOM — flap CONTENT is not canvas
// shell, and only the canvas shell gets Solid (the opstream-processing rule).
//
// DRAG-OUT PROTOCOL: tiles extend the toolbar's existing `text/x-newspace-tool`
// DnD type with a namespaced part id — `datatype:folder`, `window:codemirror`,
// `lens:uppercase` — while tool/shape/stamp ids stay BARE (the toolbar's own
// drags are unchanged). The canvas's dropToolAt decodes with decodePartId and
// lands an instance at the drop point (createDocAt / placeNode / the existing
// shape+stamp drops). A CLICK on a tile arms the place flow instead
// (selectPlacing / placeEditor / placeLens / setTool).
//
// NOT parts: BRUSHES. "Placing" a brush only ARMS it (dropToolAt falls through
// to setTool for a bare brush id) — there's no instance to land on the canvas,
// so brushes stay on the toolbar/shape-overflow, not in the bin.
import { nodeRole } from "./editors.js";
import { STAMPS, TOOL_META, SHAPE_DRAGGABLE } from "./brush/ui/chrome.jsx";

// the toolbar's DnD type (canvas.jsx's TOOL_DRAG imports this — one protocol)
export const PART_DRAG_TYPE = "text/x-newspace-tool";
const NAMESPACED = new Set(["datatype", "window", "lens"]);

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

// ── the census (pure: registries in → grouped tiles out) ────────────────────
// Groups mirror the + add menu (REUSING its grouping: nodeRole splits sources
// from editors, byName sorts) plus the toolbar's draggables (shapes, stamps).
// Each tile: { part (the encoded drag payload), kind, id, name, mark, icon?,
// stamp? (the multi-stroke drawing, for the tile's icon), path? (a TOOL_META
// icon path) }.
const byName = (a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || "");
export function partsCensus({ datatypes = [], windows = [], lenses = [], stamps = {}, shapes = [] } = {}) {
  const tile = (kind, d, mark) => ({ part: encodePartId(kind, d.id), kind, id: d.id, name: d.name || d.id, mark, icon: d.icon });
  const groups = [];
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
  const sources = windows.filter((w) => nodeRole(w) === "source").sort(byName);
  const editors = windows.filter((w) => nodeRole(w) !== "source").sort(byName);
  if (sources.length) groups.push({ id: "sources", label: "sources", tiles: sources.map((d) => tile("window", d, "●")) });
  if (editors.length) groups.push({ id: "editors", label: "editors", tiles: editors.map((d) => tile("window", d, "⚡")) });
  if (lenses.length) groups.push({ id: "lenses", label: "lenses", tiles: [...lenses].sort(byName).map((d) => tile("lens", d, "◇")) });
  return groups;
}

// a CLICK on a tile arms the matching place flow (the cheap bonus): the same
// host commands the + menu uses. Returns true when something was armed.
export function armPart(t, host) {
  if (!t || !host) return false;
  const find = (list) => (list || []).find((x) => x.id === t.id);
  if (t.kind === "datatype") { const d = find(host.datatypes && host.datatypes()); if (d && host.selectPlacing) { host.selectPlacing(d); return true; } return false; }
  if (t.kind === "window") { const d = find(host.editors && host.editors()); if (d && host.placeEditor) { host.placeEditor(d); return true; } return false; }
  if (t.kind === "lens") { const d = find(host.lenses && host.lenses()); if (d && host.placeLens) { host.placeLens(d); return true; } return false; }
  if (t.kind === "tool" && host.setTool) { host.setTool(t.id); return true; } // a shape: arm its draw tool
  return false; // stamps are drag-only (a stamp id isn't a tool)
}

// ── the flap mount (raw DOM) ─────────────────────────────────────────────────
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// a tile's icon: the stamp's real strokes / a TOOL_META path / the group mark
function tileIcon(t) {
  if (t.stamp && t.stamp.paths) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", t.stamp.view || "0 0 24 24");
    svg.setAttribute("class", "ns-part-glyph");
    for (const d of t.stamp.paths) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d); p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "3");
      p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
      svg.append(p);
    }
    return svg;
  }
  if (t.path) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("class", "ns-part-glyph");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", t.path); p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.8");
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
    return svg;
  }
  return el("span", "ns-part-glyph ns-part-mark", t.mark || "•");
}

function tileEl(t, host) {
  const b = el("button", "ns-part");
  b.draggable = true;
  b.dataset.part = t.part;
  b.title = `${t.name} — drag to canvas${t.kind === "stamp" ? "" : " · click to place"}`;
  b.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(PART_DRAG_TYPE, t.part);
    e.dataTransfer.effectAllowed = "copy";
  });
  b.addEventListener("click", () => armPart(t, host));
  b.append(tileIcon(t), el("span", "ns-part-name", t.name));
  return b;
}

// the `sketchy:flap` mount: `({ element, host }) => cleanup`. `host` is the
// canvas chrome host (registry accessors + the place commands).
export function mountPartsBin({ element, host }) {
  const root = el("div", "ns-partsbin");
  const groups = partsCensus({
    datatypes: (host && host.datatypes && host.datatypes()) || [],
    windows: (host && host.editors && host.editors()) || [],
    lenses: (host && host.lenses && host.lenses()) || [],
    stamps: STAMPS,
    shapes: [...SHAPE_DRAGGABLE],
  });
  for (const g of groups) {
    root.append(el("div", "ns-menu-sep", g.label));
    const grid = el("div", "ns-parts-grid");
    for (const t of g.tiles) grid.append(tileEl(t, host));
    root.append(grid);
  }
  element.append(root);
  return () => root.remove();
}
