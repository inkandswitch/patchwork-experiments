// A PALETTE as a BARE layer tool — a placeable window of brush stickers. Drop one
// (or several, with different brush sets) on the overlay and click a sticker to arm
// that tool. It WRITES the tool the same way the toolbar does — `context.tool.set`
// (falling back to `apply(snapshot)` on a wired stream) — and reads the active state
// back off the same Source, so palette / toolbar / keyboard stay in agreement.
// RAW callbacks + plain DOM — an opstream-processing node needs no Solid.
//
// Config: `{ brushes: string[] }` — bare tool/brush ids; ARRAY ORDER = button order.
// Add: drag any toolbar/parts-bin tool tile onto it (bare ids only — stamps and
// namespaced parts fall through to the canvas drop), or tick it in the ⚙ popover.
// Remove: untick it in the ⚙ popover, or click the × badge each button grows while
// the popover is open (the ns-bare-x convention).
import { snapshot } from "./ops.js";
import { listRegistryBrushes } from "./brush-host.js";
import { TOOL_META, STAMP_IDS, BRUSH_FALLBACK_PATH } from "./brush/ui/chrome.jsx";
import { DEFAULT_LAYOUT } from "./brush/constants.js";
import { PART_DRAG_TYPE, decodePartId } from "./parts-bin.js";

// ── pure helpers ─────────────────────────────────────────────────────────────
export const DEFAULT_PALETTE = [...DEFAULT_LAYOUT.tools];

// config → the brush id list (a fresh array; junk entries dropped)
export function normalizeBrushes(config) {
  const b = config && config.brushes;
  if (!Array.isArray(b)) return [...DEFAULT_PALETTE];
  return b.filter((x) => typeof x === "string" && x);
}
export const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export const addBrush = (list, id) => (list.includes(id) ? list : [...list, id]);
export const removeBrush = (list, id) => list.filter((x) => x !== id);
export const toggleBrush = (list, id) => (list.includes(id) ? removeBrush(list, id) : addBrush(list, id));

// a drag payload the palette takes: a BARE tool/brush id. Stamps are drawings, not
// armable tools, and namespaced parts (datatype:/window:/lens:) are instances to
// land — all of those return null so the canvas's own drop handles them.
export function acceptDrop(part) {
  if (!part || typeof part !== "string") return null;
  const { kind, id } = decodePartId(part);
  if (kind !== "tool" || STAMP_IDS.has(id)) return null;
  return id;
}

// TOOL_META labels carry the hotkey ("Draw  (P)") — the checklist wants just the name
export const toolLabel = (id) => ((TOOL_META[id] || [])[0] || id).replace(/\s*\([^)]*\)\s*$/, "").trim();
export const toolPath = (id) => (TOOL_META[id] || [, BRUSH_FALLBACK_PATH])[1];

// registry brushes come from brush-host.js's listRegistryBrushes (the same
// list the canvas loads), re-exported for the palette's tests/consumers
export { listRegistryBrushes };

// everything armable: the built-in tools (TOOL_META) + the registry brushes.
// Each row: { id, name, path } — path is the toolbar's own glyph source.
export function paletteCensus(registry = []) {
  const rows = [], seen = new Set();
  for (const id of Object.keys(TOOL_META)) { seen.add(id); rows.push({ id, name: toolLabel(id), path: TOOL_META[id][1] }); }
  for (const b of registry) if (b.id && !seen.has(b.id)) { seen.add(b.id); rows.push({ id: b.id, name: b.name || b.id, path: toolPath(b.id) }); }
  return rows;
}

// ── the mount ────────────────────────────────────────────────────────────────
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function iconSvg(path) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 22 22");
  svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

export function mountPalette({ element, inlets = {}, config, setConfig, context, onConfig }) {
  // the tool stream: a WIRED `tool` inlet wins (zoom's convention), else the context Source
  const toolStream = () => { const p = inlets.tool; if (p && p.wired) return p; return (context && context.tool) || p; };
  const armTool = (id) => {
    const t = toolStream();
    if (!t) return;
    if (typeof t.set === "function") t.set(id); // the context Source — the toolbar's own path
    else if (typeof t.apply === "function") t.apply(snapshot(id)); // a wired stream
  };

  let brushes = normalizeBrushes(config);
  let menuOpen = false;

  const root = el("div", "ns-palette");
  // pointerDOWN only (the house rule): keeps select/marquee/draw off the widget body
  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  const row = el("div", "ns-palette-row");
  const gear = el("button", "ns-tool ns-palette-gear", "⚙");
  gear.title = "choose brushes";
  gear.addEventListener("click", () => setMenu(!menuOpen));
  root.append(row, gear);
  element.append(root);

  // ── the button row (reconciled: rebuilt only when the id LIST changes; a tool
  // change just toggles classes) ─────────────────────────────────────────────
  const btns = new Map(); // id -> the tool button
  const updateActive = () => { const cur = toolStream()?.value; for (const [id, b] of btns) b.classList.toggle("active", id === cur); };
  const renderRow = () => {
    btns.clear();
    row.replaceChildren();
    for (const id of brushes) {
      const slot = el("span", "ns-palette-slot");
      const b = el("button", "ns-tool");
      b.dataset.tool = id;
      b.title = (TOOL_META[id] || [])[0] || id;
      b.append(iconSvg(toolPath(id)));
      b.addEventListener("click", () => armTool(id));
      slot.append(b);
      if (menuOpen) { // the remove badge, shown while configuring (a sibling — no click-propagation games)
        const x = el("button", "ns-palette-x", "×");
        x.title = "remove from this palette";
        x.addEventListener("click", () => setBrushes(removeBrush(brushes, id)));
        slot.append(x);
      }
      btns.set(id, b);
      row.append(slot);
    }
    updateActive();
  };

  // ── the ⚙ popover: every available brush/tool, ticks = membership ──────────
  let menu = null, backdrop = null;
  const closeMenu = () => { if (menu) menu.remove(); if (backdrop) backdrop.remove(); menu = backdrop = null; };
  const renderMenu = () => {
    closeMenu();
    if (!menuOpen) return;
    backdrop = el("div", "ns-menu-backdrop");
    backdrop.addEventListener("pointerdown", () => setMenu(false));
    menu = el("div", "ns-menu ns-palette-menu");
    menu.addEventListener("wheel", (e) => e.stopPropagation());
    menu.append(el("div", "ns-menu-sep", "brushes"));
    for (const t of paletteCensus(listRegistryBrushes())) {
      const lab = el("label", "ns-palette-check");
      const check = el("input");
      check.type = "checkbox";
      check.checked = brushes.includes(t.id);
      check.addEventListener("change", () => setBrushes(toggleBrush(brushes, t.id)));
      lab.append(check, iconSvg(t.path), el("span", "ns-palette-check-name", t.name));
      menu.append(lab);
    }
    root.append(backdrop, menu);
  };
  const setMenu = (open) => { menuOpen = open; gear.classList.toggle("active", open); renderMenu(); renderRow(); };

  // one write path: always a real array (never undefined into automerge), applied
  // locally at once — the onConfig echo reconciles to the same list (a no-op).
  const setBrushes = (next) => {
    brushes = next;
    if (setConfig) setConfig({ brushes: [...next] });
    renderRow();
    if (menuOpen) renderMenu();
  };

  // ── drag-and-drop: a bare tool/brush id ADDS it (append, dedupe) ────────────
  const carries = (dt) => { try { return !!dt && Array.from(dt.types || []).includes(PART_DRAG_TYPE); } catch { return false; } };
  root.addEventListener("dragover", (e) => { if (!carries(e.dataTransfer)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; });
  root.addEventListener("drop", (e) => {
    if (!carries(e.dataTransfer)) return;
    const id = acceptDrop(e.dataTransfer.getData(PART_DRAG_TYPE));
    if (!id) return; // a stamp / namespaced part: bubble on — the canvas drop lands it
    e.preventDefault();
    e.stopPropagation();
    setBrushes(addBrush(brushes, id));
  });

  // external/remote config edits reconcile in (same list ⇒ no rebuild)
  if (onConfig) onConfig((c) => { const next = normalizeBrushes(c); if (!sameList(next, brushes)) { brushes = next; renderRow(); if (menuOpen) renderMenu(); } });

  // live active state: the context Source always, plus the inlet proxy when present
  // (the proxy swaps backing internally, so one connect covers rewires)
  const offs = [];
  const sub = (s) => { if (s && typeof s.connect === "function") offs.push(s.connect(() => updateActive())); };
  sub(context && context.tool);
  if (inlets.tool && inlets.tool !== (context && context.tool)) sub(inlets.tool);

  renderRow();
  return () => { for (const o of offs) { try { o(); } catch {} } closeMenu(); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "palette",
  name: "Palette",
  icon: "Palette",
  bare: true, // an overlay widget: no node frame; chrome comes from the bare-chrome bar
  inlets: [{ name: "tool", type: "json" }], // optional — wire the context tool port; unwired ⇒ context
  outlets: [],
  async load() { return mountPalette; },
};
