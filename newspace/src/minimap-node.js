// The minimap as a BARE layer tool — rewritten to be DEAD SIMPLE + self-diagnosing. No Solid,
// no component reuse, no inlet→signal indirection: it subscribes its inlet opstreams with raw
// callbacks and rebuilds plain divs. A tiny readout (top-right) shows `N▢ W×H` so it's obvious
// whether the canvas data is arriving (N rects, bounds W×H). Inlets are wired to the canvas
// context (rects/bounds/peers/view/camera); camera is read/WRITE (click to jump).
import { snapshot } from "./ops.js";

// the camera that lands world (wx,wy) at the viewport centre, keeping zoom.
export function jumpCamera(view, camera, wx, wy) {
  const v = view || { w: 0, h: 0 };
  const z = (camera && camera.z) || 1;
  return { x: (v.w / 2 - wx) * z, y: (v.h / 2 - wy) * z, z };
}

const SIZE = { w: 180, h: 130 };

export function mountMinimap({ element, inlets = {}, context, canvas }) {
  const root = document.createElement("div");
  root.className = "ns-minimap";
  const dbg = document.createElement("div");
  dbg.className = "ns-mm-dbg";
  dbg.style.cssText = "position:absolute;right:2px;top:2px;z-index:5;font:9px ui-monospace,monospace;color:var(--ns-sky,#5b8def);pointer-events:none;opacity:0.75;";
  root.append(dbg);
  element.append(root);

  // rects/bounds/view come from the inlets (the ambient canvas feed, or an explicit wire to
  // a placed canvas node). camera prefers the inlet too, falling back to the context Source.
  const src = () => (inlets.rects && inlets.rects.wired ? "wire" : context ? "ctx" : "?");
  const camStream = () => { const p = inlets.camera; if (p && p.wired && typeof p.apply === "function") return p; return (context && context.camera) || p; };

  let rects = [], bounds = null, view = null;
  const bb = () => (bounds && bounds.w > 0 && bounds.h > 0 ? bounds : { x: 0, y: 0, w: SIZE.w, h: SIZE.h });
  const scaleOf = (b) => Math.min(SIZE.w / b.w, SIZE.h / b.h) || 1;

  const render = () => {
    const b = bb(), s = scaleOf(b);
    dbg.textContent = `${src()} ${rects.length}▢ ${Math.round(b.w)}×${Math.round(b.h)}`;
    for (const n of [...root.querySelectorAll(".ns-mm-rect,.ns-mm-view")]) n.remove();
    for (const r of rects) {
      if (!r) continue;
      const d = document.createElement("div");
      d.className = "ns-mm-rect" + (r.box ? " box" : "");
      d.style.cssText = `left:${(r.x - b.x) * s}px;top:${(r.y - b.y) * s}px;width:${Math.max(1, r.w * s)}px;height:${Math.max(1, r.h * s)}px;`;
      root.append(d);
    }
    if (view && view.w) {
      const v = document.createElement("div");
      v.className = "ns-mm-view";
      v.style.cssText = `left:${(view.x - b.x) * s}px;top:${(view.y - b.y) * s}px;width:${view.w * s}px;height:${view.h * s}px;`;
      root.append(v);
    }
  };

  const offs = [];
  const sub = (st, set) => { if (st && typeof st.connect === "function") offs.push(st.connect(() => { try { set(st.value); } catch {} render(); })); };
  sub(inlets.rects, (v) => { rects = Array.isArray(v) ? v : []; });
  sub(inlets.bounds, (v) => { bounds = v && typeof v === "object" ? v : null; });
  sub(inlets.view, (v) => { view = v && typeof v === "object" ? v : null; });
  render();

  // click AND DRAG to move the camera there (writes the bidirectional camera outlet)
  const jumpTo = (clientX, clientY) => {
    const cameraS = camStream();
    if (!cameraS || typeof cameraS.apply !== "function") return;
    const b = bb(), s = scaleOf(b), rect = root.getBoundingClientRect();
    const wx = b.x + (clientX - rect.left) / s, wy = b.y + (clientY - rect.top) / s;
    cameraS.apply(snapshot(jumpCamera(view, cameraS.value, wx, wy)));
  };
  root.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    jumpTo(e.clientX, e.clientY);
    const move = (ev) => jumpTo(ev.clientX, ev.clientY);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  return () => { for (const o of offs) { try { o(); } catch {} } root.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "minimap",
  name: "Minimap",
  icon: "Map",
  bare: true,
  inlets: [
    { name: "rects", type: "json" },
    { name: "bounds", type: "json" },
    { name: "peers", type: "json" },
    { name: "view", type: "json" },
    { name: "camera", type: "json" },
  ],
  outlets: [],
  async load() { return mountMinimap; },
};
