/**
 * Spatial Walls — a bundleless demo tool for the spatial host.
 *
 * Subscribes to the host's `spatial:walls` provider (the drawing/object
 * recognition layer) and echoes every recognized shape as a black polygon with
 * a white border on a black background — the geometry the layer captured,
 * mirrored back onto the surface. (Analogous to how spatial-colors echoes tags.)
 *
 * Each shape is a polygon of normalized {nx,ny} points in box space, so
 * placement is pure CSS percentages — no coordinate-system provider needed.
 *
 * Note: the host blacks out each recognized shape ABOVE everything, so this
 * tool's black fill is largely redundant with the host's; the white border's
 * outer half is what reads as the outline around the black shape.
 *
 * @typedef {Object} SpatialWallsDoc
 * @property {string} title
 */

// ---------------------------------------------------------------------------
// Inlined patchwork-providers `subscribe` (v0.2.x) — dependency-free.
// ---------------------------------------------------------------------------
function subscribe(element, selector, listener) {
  const view = element.closest("patchwork-view");
  const dispatchEl = view ?? element;
  const channel = new MessageChannel();
  const port = channel.port2;
  const controller = new AbortController();
  port.addEventListener(
    "message",
    (event) => {
      if (event.data?.type === "change") listener(event.data.value);
    },
    { signal: controller.signal },
  );
  port.start();
  dispatchEl.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    }),
  );
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    port.postMessage({ type: "unsubscribe" });
    port.close();
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Datatype
// ---------------------------------------------------------------------------
export const SpatialWallsDatatype = {
  init(doc) {
    doc.title = "Spatial Walls";
  },
  getTitle(doc) {
    return doc.title || "Spatial Walls";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .spatial-walls {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: #000;
    }
    .spatial-walls svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .spatial-walls polygon {
      fill: #000;
      stroke: #fff;
      stroke-width: 12px;
      stroke-linejoin: round;
    }
  `;
  element.appendChild(style);

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "spatial-walls";
  element.appendChild(root);

  // viewBox 0..100 + preserveAspectRatio "none" lets us plot normalized points
  // directly as percentages; the non-scaling stroke keeps a constant border.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  root.appendChild(svg);

  let shapes = [];

  function render() {
    svg.replaceChildren();
    for (const shape of shapes) {
      const points = Array.isArray(shape.points) ? shape.points : [];
      if (points.length < 3) continue;
      const polygon = document.createElementNS(SVG_NS, "polygon");
      polygon.setAttribute(
        "points",
        points.map((p) => `${p.nx * 100},${p.ny * 100}`).join(" "),
      );
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(polygon);
    }
  }

  const unsub = subscribe(element, { type: "spatial:walls" }, (value) => {
    shapes = (value && value.shapes) || [];
    render();
  });

  render();

  return () => {
    unsub();
    root.remove();
    style.remove();
    element.style.position = prevPosition;
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-walls",
    name: "Spatial Walls",
    icon: "Shapes",
    async load() {
      return SpatialWallsDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-walls",
    name: "Spatial Walls",
    icon: "Shapes",
    supportedDatatypes: ["spatial-walls"],
    async load() {
      return Tool;
    },
  },
];
