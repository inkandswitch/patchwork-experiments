// A PALETTE as a BARE layer tool — a placeable window of brush stickers. Drop one
// (or several, with different brush sets) on the overlay and click a sticker to arm
// that tool. It WRITES the tool the same way the toolbar did — `context.tool.set`
// (falling back to `apply(snapshot)` on a wired stream) — and reads the active state
// back off the same Source, so palette / keyboard / other palettes stay in agreement.
// RAW callbacks + plain DOM — an opstream-processing node needs no Solid.
//
// STRUCTURE — the palette renders ENTRIES (model.js): tools, DIVIDERS and one-level
// overflow MENUS, with the old fixed Toolbar's visuals (.ns-sep rules, the ▾ +
// .ns-menu-grid popover). Where the entries come from, in precedence order:
//   1. the `tools` INLET (wired) — an entries array from e.g. the palette-config
//      window's `tools` outlet (the seeded pair: ns-toolbar-config → ns-toolbar-palette)
//   2. `config.entries` — a persisted entries array (rich presets)
//   3. `config.brushes` — the legacy plain id list (BACK-COMPAT FOREVER)
//   4. the DEFAULT_LAYOUT tool set
// Editing lives in the palette-config window now (the ⚙ configurator was removed);
// an UNWIRED palette still takes a drag-and-drop of a bare tool id (append, dedupe).
//
// SAVE-A-PALETTE: alt-drag the palette window (the ordinary copy gesture) and drop
// the copy into the parts FLAP — item containment does the work; there's no special
// grip/identity protocol any more.
import { snapshot } from "./ops.js";
import { rafBatch } from "./perf.js";
import { listRegistryBrushes } from "./brush-host.js";
import { normalizeEntries, entriesFromIds, entryToolIds } from "./model.js";
import { TOOL_META, STAMP_IDS, BRUSH_FALLBACK_PATH } from "./brush/ui/chrome.jsx";
import { DEFAULT_LAYOUT } from "./brush/constants.js";
import { PART_DRAG_TYPE, decodePartId } from "./parts-bin.js";
import { openPopover } from "./popover.js";

// ── pure helpers ─────────────────────────────────────────────────────────────
export const DEFAULT_PALETTE = [...DEFAULT_LAYOUT.tools];
// the parts-bin PRESETS (registered as `sketchy:palette` plugins — see
// registry/palettes.js): "sketching" is the focused hand-drawing set; "full" is
// everything armable (every TOOL_META tool + every registered sketchy:brush, at
// drop time).
export const SKETCH_PALETTE = ["select", "hand", "pen", "eraser", "rectangle", "ellipse", "arrow", "text"];
export const fullPaletteBrushes = () => paletteCensus(listRegistryBrushes()).map((r) => r.id);

// config → the brush id list (a fresh array; junk entries dropped) — the LEGACY shape
export function normalizeBrushes(config) {
  const b = config && config.brushes;
  if (!Array.isArray(b)) return [...DEFAULT_PALETTE];
  return b.filter((x) => typeof x === "string" && x);
}
export const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export const addBrush = (list, id) => (list.includes(id) ? list : [...list, id]);
export const removeBrush = (list, id) => list.filter((x) => x !== id);
export const toggleBrush = (list, id) => (list.includes(id) ? removeBrush(list, id) : addBrush(list, id));

// config → ENTRIES, the full precedence minus the wire (which the mount overlays):
// config.entries (rich) > config.brushes (legacy ids) > the default set.
export function entriesFromConfig(config) {
  if (config && Array.isArray(config.entries)) {
    const e = normalizeEntries(config.entries);
    if (e.length) return e;
  }
  return entriesFromIds(normalizeBrushes(config));
}
export const sameEntries = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a drag payload the palette takes: a BARE tool/brush id. Stamps are drawings, not
// armable tools, and namespaced parts (datatype:/window:/lens:) are instances to
// land — all of those return null so the canvas's own drop handles them.
export function acceptDrop(part) {
  if (!part || typeof part !== "string") return null;
  const { kind, id } = decodePartId(part);
  if (kind !== "tool" || STAMP_IDS.has(id)) return null;
  return id;
}

// TOOL_META labels carry the hotkey ("Draw  (P)") — pickers want just the name
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

const CHEVRON_PATH = "M6 8l5 5 5-5"; // the old Toolbar's overflow ▾

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

export function mountPalette({ element, inlets = {}, config, setConfig, setSize, context, onConfig }) {
  // the tool stream: a WIRED `tool` inlet wins (zoom's convention), else the context Source
  const toolStream = () => { const p = inlets.tool; if (p && p.wired) return p; return (context && context.tool) || p; };
  const armTool = (id) => {
    const t = toolStream();
    if (!t) return;
    if (typeof t.set === "function") t.set(id); // the context Source — the toolbar's own path
    else if (typeof t.apply === "function") t.apply(snapshot(id)); // a wired stream
  };

  // entries: the wired `tools` inlet wins; else config (entries > brushes > default)
  let cfgEntries = entriesFromConfig(config);
  let cfg = { ...(config || {}) };
  const wiredEntries = () => {
    const p = inlets.tools;
    if (!p || !p.wired) return null;
    const e = normalizeEntries(p.value);
    return e.length ? e : null;
  };
  let entries = wiredEntries() || cfgEntries;
  let openMenu = -1; // index of the open overflow menu (one at a time)

  const root = el("div", "ns-palette");
  // pointerDOWN only (the house rule): keeps select/marquee/draw off the widget body
  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  const row = el("div", "ns-palette-row");
  root.append(row);
  element.append(root);

  // FIT-CONTENT: the palette never wraps — the DOM sizes itself (width: max-content,
  // style.css) and the measured size writes back to the item's w/h so the box, the
  // selection outline and the sticky centring all track the content. Deferred a
  // frame (rafBatch, latest wins) and OUTSIDE any undo txn — the text-measure
  // commit pattern (item.jsx persistSize). Cancelled (not flushed) on unmount.
  const persistSize = rafBatch();
  const measure = () => {
    if (!setSize || !root.isConnected) return;
    const w = root.offsetWidth, h = root.offsetHeight;
    if (w > 24 && h > 12) setSize(Math.ceil(w), Math.ceil(h)); // headless/pre-layout reads (0) never write
  };
  const queueSize = () => persistSize.schedule(measure);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queueSize) : null;
  if (ro) ro.observe(root);

  // ── the button row (reconciled: rebuilt only when the ENTRIES change; a tool
  // change just toggles classes) ─────────────────────────────────────────────
  const btns = new Map(); // tool id -> its button
  const menuBtns = []; // [{ btn, ids }] — an overflow button lights when it holds the tool
  const updateActive = () => {
    const cur = toolStream()?.value;
    for (const [id, b] of btns) b.classList.toggle("active", id === cur);
    for (const m of menuBtns) m.btn.classList.toggle("active", m.open || m.ids.includes(cur));
  };
  const toolBtn = (id) => {
    const b = el("button", "ns-tool");
    b.dataset.tool = id;
    b.title = (TOOL_META[id] || [])[0] || id;
    b.append(iconSvg(toolPath(id)));
    b.addEventListener("click", () => { armTool(id); if (openMenu >= 0) setOpenMenu(-1); });
    btns.set(id, b);
    return b;
  };
  const setOpenMenu = (i) => { openMenu = i; renderRow(); };
  // the open overflow popover's close fn — PORTAL'd to the canvas root (popover.js):
  // the bare window's body clips (overflow: hidden), so an in-widget popover was
  // invisible; the portal escapes the clip AND opens away from the docked edge.
  let closeMenu = null;
  const dismissMenu = () => { if (closeMenu) { const c = closeMenu; closeMenu = null; c(); } };
  const renderRow = () => {
    dismissMenu(); // the popover re-opens below if a menu is still open
    btns.clear();
    menuBtns.length = 0;
    row.replaceChildren();
    entries.forEach((entry, i) => {
      if (entry.kind === "divider") { row.append(el("span", "ns-sep")); return; }
      if (entry.kind === "menu") {
        // the old Toolbar's overflow: a ▾ (or the menu's own icon) opening a grid popover
        const wrap = el("span", "ns-add-wrap");
        const b = el("button", "ns-tool ns-palette-menu-btn");
        b.title = entry.label || "more";
        b.append(iconSvg(entry.icon || CHEVRON_PATH));
        b.addEventListener("click", () => setOpenMenu(openMenu === i ? -1 : i));
        wrap.append(b);
        menuBtns.push({ btn: b, ids: entryToolIds([entry]), open: openMenu === i });
        if (openMenu === i) {
          const menu = el("div", "ns-menu ns-menu-grid");
          menu.addEventListener("wheel", (e) => e.stopPropagation());
          for (const it of entry.items || []) {
            if (it.kind === "divider") { menu.append(el("span", "ns-menu-gap")); continue; }
            if (it.kind !== "tool") continue;
            menu.append(toolBtn(it.id));
          }
          closeMenu = openPopover({ anchor: b, menu, onClose: () => { closeMenu = null; setOpenMenu(-1); } });
        }
        row.append(wrap);
        return;
      }
      row.append(toolBtn(entry.id)); // a tool
    });
    updateActive();
    queueSize(); // the row changed → re-measure (fit-content)
  };

  // set + re-render when the effective entries changed (identity-stable rebuilds)
  const setEntries = (next) => { if (sameEntries(next, entries)) return; entries = next; if (openMenu >= entries.length) openMenu = -1; renderRow(); };
  const refresh = () => setEntries(wiredEntries() || cfgEntries);

  // one write path for the UNWIRED palette's drag-to-add: writes are ENTRIES-only.
  // The legacy `config.brushes` id list is a read-shim (entriesFromConfig
  // normalizes it forever); a persisted brushes field is left in place, unwritten.
  const persist = (next) => {
    cfgEntries = next;
    if (setConfig) setConfig({ entries: JSON.parse(JSON.stringify(next)) });
    refresh();
  };

  // ── drag-and-drop: a bare tool/brush id ADDS it (append, dedupe) — unwired only;
  // a WIRED palette is driven by its config node, so the drop falls through ──────
  const carries = (dt) => { try { return !!dt && Array.from(dt.types || []).includes(PART_DRAG_TYPE); } catch { return false; } };
  root.addEventListener("dragover", (e) => { if (!carries(e.dataTransfer) || wiredEntries()) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; });
  root.addEventListener("drop", (e) => {
    if (!carries(e.dataTransfer) || wiredEntries()) return;
    const id = acceptDrop(e.dataTransfer.getData(PART_DRAG_TYPE));
    if (!id) return; // a stamp / namespaced part: bubble on — the canvas drop lands it
    e.preventDefault();
    e.stopPropagation();
    if (entryToolIds(cfgEntries).includes(id)) { persist(cfgEntries); return; } // dedupe (still a write, like before)
    persist([...cfgEntries, { kind: "tool", id }]);
  });

  // external/remote config edits reconcile in (same entries ⇒ no rebuild)
  if (onConfig) onConfig((c) => { cfg = { ...(c || {}) }; cfgEntries = entriesFromConfig(c); refresh(); });

  // live active state + wired-entries updates: raw connects on the stable proxies
  // (a proxy swaps backing internally, so one connect covers rewires)
  const offs = [];
  const sub = (s, cb) => { if (s && typeof s.connect === "function") offs.push(s.connect(cb)); };
  sub(context && context.tool, () => updateActive());
  if (inlets.tool && inlets.tool !== (context && context.tool)) sub(inlets.tool, () => updateActive());
  sub(inlets.tools, () => refresh());

  renderRow();
  return () => { for (const o of offs) { try { o(); } catch {} } persistSize.cancel(); if (ro) ro.disconnect(); dismissMenu(); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "palette",
  name: "Palette",
  icon: "Palette",
  bare: true, // an overlay widget: no node frame; chrome comes from the bare-chrome bar
  fit: true, // FIT-CONTENT: sizes itself (setSize) — the canvas suppresses resize handles
  inlets: [
    { name: "tool", type: "json" }, // optional — wire the context tool port; unwired ⇒ context
    { name: "tools", type: "json" }, // optional — an ENTRIES array (the palette-config outlet); unwired ⇒ config
  ],
  outlets: [],
  async load() { return mountPalette; },
};
