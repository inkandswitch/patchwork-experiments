// The CANVAS as a placeable source node. Its live reactive state — the same context Sources
// the canvas itself uses — exposed as OUTLETS you can wire FROM: items, rects, bounds, camera
// (read/WRITE), pointer, selection, peers, view. Add it, wire a node's inlet to `bounds` or
// `items`, etc. Raw: it just re-publishes the context Sources as outlets; no Solid, no copies.
const OUTLETS = ["items", "rects", "bounds", "camera", "pointer", "selection", "peers", "view"];

export function mountCanvasSource({ element, context, setOutlet }) {
  // "items" is the context's `board` Source; the rest are named directly.
  const streamFor = (name) => (context ? (name === "items" ? context.board : context[name]) : null);
  for (const name of OUTLETS) {
    const s = streamFor(name);
    if (s && setOutlet) setOutlet(name, s);
  }
  const el = document.createElement("div");
  el.className = "ns-canvas-source";
  el.textContent = "canvas";
  element.append(el);
  return () => el.remove();
}

export const plugin = {
  type: "sketchy:surface",
  id: "canvas",
  name: "Canvas",
  icon: "SquareDashed",
  bare: true, // a small labelled chip on a layer; its outlet ports show while the layer is active
  inlets: [],
  outlets: OUTLETS.map((name) => ({ name, type: "json" })),
  async load() { return mountCanvasSource; },
};
