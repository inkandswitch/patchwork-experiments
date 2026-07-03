// The zoom % as a BARE layer tool (was hardcoded chrome). Reads the canvas camera outlet to
// show the zoom level; clicking writes the camera back (reset to 100%) via the bidirectional
// camera. RAW callbacks + plain DOM — an opstream-processing node needs no Solid.
import { snapshot } from "./ops.js";

export function mountZoom({ element, inlets = {}, context }) {
  // the camera inlet (ambient canvas feed, or an explicit wire), falling back
  // to the context Source if nothing backs it
  const cam = () => { const p = inlets.camera; if (p && p.wired) return p; return (context && context.camera) || p; };
  const btn = document.createElement("button");
  btn.className = "ns-zoom";
  btn.textContent = "100%";
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", () => { const c = cam(); if (c && typeof c.apply === "function") c.apply(snapshot({ z: 1 })); }); // merges → keeps x/y
  element.append(btn);
  const c = cam();
  const off = c && typeof c.connect === "function"
    ? c.connect(() => { const cc = cam(); const z = (cc.value && cc.value.z) || 1; btn.textContent = `${Math.round(z * 100)}%`; })
    : null;
  return () => { if (off) off(); btn.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "zoom",
  name: "Zoom",
  icon: "ZoomIn",
  bare: true,
  inlets: [{ name: "camera", type: "json" }],
  outlets: [],
  async load() { return mountZoom; },
};
