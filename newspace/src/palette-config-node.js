// The palette CONFIGURATOR as its own bare window — it OWNS a palette's entry
// structure (model.js: tools · dividers · one-level menus) in its config, edits it
// with a sticker-style list editor, and emits the live array on a `tools` OUTLET.
// Wire that outlet into a palette window's `tools` inlet and the palette follows
// every edit (the seeded pair: ns-toolbar-config → ns-toolbar-palette).
// RAW callbacks + plain DOM — an opstream-processing node needs no Solid.
//
// Its default config reproduces the OLD fixed Toolbar exactly
// (constants.js DEFAULT_TOOL_ENTRIES: nav+draw · divider · shapes + the
// "more shapes" overflow menu).
import { Source } from "./opstreams.js";
import { normalizeEntries } from "./model.js";
import { DEFAULT_TOOL_ENTRIES } from "./brush/constants.js";
import { paletteCensus, listRegistryBrushes, toolLabel, toolPath } from "./palette-node.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function glyph(path) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 22 22");
  svg.setAttribute("width", "15"); svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

// pure list surgery (exported for tests)
export const moveAt = (list, i, d) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
export const removeAt = (list, i) => list.filter((_, k) => k !== i);
// move the item at `from` so it lands at insertion index `ins` (0..len, computed on
// the ORIGINAL list — before removal); the drag-reorder counterpart of moveAt's ±1.
export const moveTo = (list, from, ins) => {
  if (from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  const dest = ins > from ? ins - 1 : ins; // removal shifts everything after `from` left one
  next.splice(Math.max(0, Math.min(dest, next.length)), 0, item);
  return next;
};

export const configEntries = (config) => {
  const e = normalizeEntries(config && config.entries);
  return e.length ? e : JSON.parse(JSON.stringify(DEFAULT_TOOL_ENTRIES));
};

export function mountPaletteConfig({ element, config, setConfig, onConfig, setOutlet }) {
  let entries = configEntries(config);
  // the OUTLET — a plain Source of the entries array; every edit (local or remote,
  // via the onConfig echo) pushes the fresh value, so wired palettes follow live.
  const out = new Source(JSON.parse(JSON.stringify(entries)));
  if (setOutlet) setOutlet("tools", out);

  let picker = null; // { at: entries | a menu's items, done() } — the census popover target
  let iconPicker = null; // index of the menu whose icon-picker is open (one at a time)
  let drag = null; // { list, from } — the in-flight row reorder (same-list only)

  const root = el("div", "ns-palcfg");
  root.addEventListener("pointerdown", (e) => e.stopPropagation()); // pointerDOWN only (the house rule)
  root.addEventListener("wheel", (e) => e.stopPropagation()); // the list scrolls, not the canvas
  element.append(root);

  const commit = (next) => {
    entries = normalizeEntries(next);
    if (setConfig) setConfig({ entries: JSON.parse(JSON.stringify(entries)) });
    out.push(JSON.parse(JSON.stringify(entries)));
    render();
  };

  // one ↑ ↓ × control cluster; `list` is the (sub)array the row lives in and
  // `write(nextList)` folds the edited sublist back into a full commit
  const controls = (list, i, write) => {
    const c = el("span", "ns-palcfg-ctl");
    const mk = (txt, title, fn) => { const b = el("button", "ns-palcfg-btn", txt); b.title = title; b.addEventListener("click", fn); return b; };
    c.append(
      mk("↑", "move up", () => write(moveAt(list, i, -1))),
      mk("↓", "move down", () => write(moveAt(list, i, +1))),
      mk("×", "remove", () => write(removeAt(list, i))),
    );
    return c;
  };

  // ── drag-to-reorder ─────────────────────────────────────────────────────────
  // a GRIP handle is the drag source (so the menu's label input stays selectable);
  // the row is the drop target. Reorders stay WITHIN one list (`list` identity is
  // stable between dragstart and drop — no commit runs in that window). `write`
  // folds the reordered sublist back exactly like the ↑ ↓ buttons.
  const clearOver = () => root.querySelectorAll(".ns-palcfg-over-top,.ns-palcfg-over-bot").forEach((n) => n.classList.remove("ns-palcfg-over-top", "ns-palcfg-over-bot"));
  const dropsAfter = (row, e) => { const r = row.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const makeDraggable = (handle, row, list, i, write) => {
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => { drag = { list, from: i }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch {} } row.classList.add("ns-palcfg-drag"); });
    handle.addEventListener("dragend", () => { drag = null; row.classList.remove("ns-palcfg-drag"); clearOver(); });
    row.addEventListener("dragover", (e) => { if (!drag || drag.list !== list) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; clearOver(); row.classList.add(dropsAfter(row, e) ? "ns-palcfg-over-bot" : "ns-palcfg-over-top"); });
    row.addEventListener("drop", (e) => { if (!drag || drag.list !== list) return; e.preventDefault(); const ins = i + (dropsAfter(row, e) ? 1 : 0); write(moveTo(list, drag.from, ins)); drag = null; clearOver(); });
  };
  const grip = () => { const g = el("span", "ns-palcfg-grip", "⠿"); g.title = "drag to reorder"; return g; };

  // ── a menu's ICON — pick any census glyph (or the default chevron) ───────────
  const setMenuIcon = (i, path) => commit(entries.map((e, k) => { if (k !== i) return e; const m = { ...e }; if (path) m.icon = path; else delete m.icon; return m; }));
  const renderIconPicker = (i) => {
    const wrap = el("div", "ns-menu ns-palcfg-iconpick");
    const none = el("button", "ns-palcfg-pick");
    none.append(el("span", "ns-palcfg-mark", "▾"), el("span", null, "default (chevron)"));
    none.title = "no icon — show the overflow chevron";
    none.addEventListener("click", () => { iconPicker = null; setMenuIcon(i, null); });
    wrap.append(none);
    const seen = new Set();
    for (const t of paletteCensus(listRegistryBrushes())) {
      if (!t.path || seen.has(t.path)) continue;
      seen.add(t.path);
      const b = el("button", "ns-palcfg-pick");
      b.append(glyph(t.path), el("span", null, t.name));
      b.title = `use ${t.name}'s icon`;
      b.addEventListener("click", () => { iconPicker = null; setMenuIcon(i, t.path); });
      wrap.append(b);
    }
    return wrap;
  };

  // the census picker — every armable tool/brush, click to append to `target`
  const renderPicker = (wrap, target, write) => {
    const menu = el("div", "ns-menu ns-palcfg-picker");
    for (const t of paletteCensus(listRegistryBrushes())) {
      const b = el("button", "ns-palcfg-pick");
      b.append(glyph(t.path), el("span", null, t.name));
      b.title = `add ${t.name}`;
      b.addEventListener("click", () => { picker = null; write([...target, { kind: "tool", id: t.id }]); });
      menu.append(b);
    }
    wrap.append(menu);
  };

  const addBar = (target, write, allowStructure) => {
    const bar = el("div", "ns-palcfg-add");
    const addTool = el("button", "ns-palcfg-btn ns-palcfg-addbtn", "+ tool");
    addTool.title = "add a tool from the registry census";
    addTool.addEventListener("click", () => { picker = picker && picker.target === target ? null : { target, write }; render(); });
    bar.append(addTool);
    const addDiv = el("button", "ns-palcfg-btn ns-palcfg-addbtn", "+ divider");
    addDiv.title = "insert a divider";
    addDiv.addEventListener("click", () => write([...target, { kind: "divider" }]));
    bar.append(addDiv);
    if (allowStructure) {
      const addMenu = el("button", "ns-palcfg-btn ns-palcfg-addbtn", "+ menu");
      addMenu.title = "create an overflow menu (one level)";
      addMenu.addEventListener("click", () => write([...target, { kind: "menu", label: "menu", items: [] }]));
      bar.append(addMenu);
    }
    if (picker && picker.target === target) renderPicker(bar, target, write);
    return bar;
  };

  const toolRow = (entry, list, i, write) => {
    const row = el("div", "ns-palcfg-row");
    const g = grip();
    row.append(g, glyph(toolPath(entry.id)), el("span", "ns-palcfg-name", toolLabel(entry.id)), controls(list, i, write));
    makeDraggable(g, row, list, i, write);
    return row;
  };
  const dividerRow = (list, i, write) => {
    const row = el("div", "ns-palcfg-row ns-palcfg-divider");
    const g = grip();
    row.append(g, el("span", "ns-palcfg-name", "— divider —"), controls(list, i, write));
    makeDraggable(g, row, list, i, write);
    return row;
  };

  const render = () => {
    root.replaceChildren();
    root.append(el("div", "ns-menu-sep", "palette layout"));
    const writeTop = (next) => commit(next);
    entries.forEach((entry, i) => {
      if (entry.kind === "tool") { root.append(toolRow(entry, entries, i, writeTop)); return; }
      if (entry.kind === "divider") { root.append(dividerRow(entries, i, writeTop)); return; }
      // a MENU: a grip, an ICON button (opens the census icon-picker), a label input
      // and its nested items (one level, tools/dividers only)
      const head = el("div", "ns-palcfg-row ns-palcfg-menuhead");
      const g = grip();
      const iconBtn = el("button", "ns-palcfg-btn ns-palcfg-iconbtn");
      iconBtn.title = "menu icon";
      iconBtn.append(entry.icon ? glyph(entry.icon) : el("span", "ns-palcfg-mark", "▾"));
      iconBtn.addEventListener("click", () => { iconPicker = iconPicker === i ? null : i; render(); });
      const lab = el("input", "ns-text ns-palcfg-label");
      lab.value = entry.label || "menu";
      lab.title = "the menu's name (its button tooltip)";
      lab.addEventListener("change", () => commit(entries.map((e, k) => (k === i ? { ...e, label: lab.value.trim() || "menu" } : e))));
      head.append(g, iconBtn, lab, controls(entries, i, writeTop));
      makeDraggable(g, head, entries, i, writeTop);
      root.append(head);
      if (iconPicker === i) root.append(renderIconPicker(i));
      const nest = el("div", "ns-palcfg-nest");
      const writeItems = (items) => commit(entries.map((e, k) => (k === i ? { ...e, items } : e)));
      (entry.items || []).forEach((item, j) => {
        if (item.kind === "divider") nest.append(dividerRow(entry.items, j, writeItems));
        else if (item.kind === "tool") nest.append(toolRow(item, entry.items, j, writeItems));
      });
      nest.append(addBar(entry.items || [], writeItems, false));
      root.append(nest);
    });
    root.append(addBar(entries, writeTop, true));
  };

  // external/remote edits reconcile in (same entries ⇒ no rebuild, no re-emit)
  if (onConfig) onConfig((c) => {
    const next = configEntries(c);
    if (JSON.stringify(next) === JSON.stringify(entries)) return;
    entries = next;
    out.push(JSON.parse(JSON.stringify(entries)));
    render();
  });

  render();
  return () => root.remove();
}

export const plugin = {
  type: "sketchy:window",
  id: "palette-config",
  name: "Palette setup",
  icon: "SlidersHorizontal",
  bare: true, // an overlay widget: no node frame; chrome comes from the bare-chrome bar
  inlets: [],
  outlets: [{ name: "tools", type: "json" }], // the entries array — wire into a palette's `tools`
  async load() { return mountPaletteConfig; },
};
