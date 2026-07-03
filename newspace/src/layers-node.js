// The LAYER SWITCHER as a BARE layer tool — the fixed .ns-layers strip
// (canvas.jsx) made a placeable window, following the presence-node conversion.
// Seeded as `ns-layers`: overlay HOME with a canvas membership (you need it
// visible on EVERY layer to switch), sticky near the top-right, dismissable
// like any seed. RAW callbacks + plain DOM — an opstream-processing node needs
// no Solid.
//
// State travels over plain Sources on the canvas context: `layers` (read-only
// { id, name, kind } rows, bottom → top) and `activeLayer` (the active id,
// writable — apply(snapshot(id)) switches the canvas tab).
import { snapshot } from "./ops.js";
import { rafBatch } from "./perf.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountLayers({ element, context, setSize }) {
  const layersStream = () => (context && context.layers) || null;
  const activeStream = () => (context && context.activeLayer) || null;
  const layers = () => { const v = layersStream()?.value; return Array.isArray(v) ? v.filter(Boolean) : []; };
  const activeId = () => activeStream()?.value ?? null;
  const switchTo = (id) => { const s = activeStream(); if (s && typeof s.apply === "function") s.apply(snapshot(id)); };

  const root = el("div", "ns-layers");
  root.addEventListener("pointerdown", (e) => e.stopPropagation()); // pointerDOWN only (the house rule)
  element.append(root);

  // FIT-CONTENT: the pill sizes itself and writes its measured size back to the
  // item's w/h (the palette's persistSize pattern — deferred a frame, latest
  // wins, cancelled on unmount; zero-size headless reads never write).
  const persistSize = rafBatch();
  const measure = () => {
    if (!setSize || !root.isConnected) return;
    const w = root.offsetWidth, h = root.offsetHeight;
    if (w > 24 && h > 12) setSize(Math.ceil(w), Math.ceil(h));
  };
  const queueSize = () => persistSize.schedule(measure);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queueSize) : null;
  if (ro) ro.observe(root);

  // RECONCILED tabs, keyed by layer id (like the presence chips): re-created
  // only when the STACK changes; an active-layer switch just toggles classes.
  const tabs = new Map(); // id -> button
  let tabOrder = "";
  const render = () => {
    const list = layers();
    // a single-layer sketch has nothing to switch — the pill hides (the fixed
    // strip's `length > 1` gate, kept)
    root.style.display = list.length > 1 ? "" : "none";
    // tabs listed TOPMOST space first (reverse of doc order — array order stays z-order)
    const rows = [...list].reverse();
    const order = rows.map((l) => l.id).join("|");
    if (order !== tabOrder) {
      tabOrder = order;
      const seen = new Set();
      for (const l of rows) {
        seen.add(l.id);
        let b = tabs.get(l.id);
        if (!b) { b = el("button", "ns-layer-tab"); b.addEventListener("click", () => switchTo(l.id)); tabs.set(l.id, b); }
        root.append(b);
      }
      for (const [id, b] of tabs) if (!seen.has(id)) { b.remove(); tabs.delete(id); }
    }
    for (const l of rows) {
      const b = tabs.get(l.id);
      b.textContent = l.name || l.id;
      b.title = l.kind || l.id;
      b.classList.toggle("active", activeId() === l.id);
    }
    queueSize();
  };

  const offs = [];
  const sub = (s) => { if (s && typeof s.connect === "function") offs.push(s.connect(() => render())); };
  sub(layersStream());
  sub(activeStream());
  render();
  return () => { for (const o of offs) { try { o(); } catch {} } persistSize.cancel(); if (ro) ro.disconnect(); root.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "layers",
  name: "Layers",
  icon: "Layers",
  bare: true, // a frameless pill: no node frame; chrome comes from the bare-chrome bar
  fit: true, // FIT-CONTENT: sizes itself (setSize) — the canvas suppresses resize handles
  inlets: [],
  outlets: [],
  async load() { return mountLayers; },
};
