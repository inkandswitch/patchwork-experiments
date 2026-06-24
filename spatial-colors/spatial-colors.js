/**
 * Spatial Colors — a bundleless demo tool for the spatial host.
 *
 * Subscribes to the host's `spatial:apriltags` provider and draws a thick
 * colored outline around each detected tag's quad — nothing is drawn on top of
 * the tag itself, only around it. Colors are hardcoded by tag id (v1):
 *
 *   tag 0 → hue 0   (pure red)
 *   tag 1 → hue 120 (pure green)
 *   tag 2 → hue 240 (pure blue)
 *
 * Outlines follow the four corners the provider gives us (normalized 0..1 in
 * box space), so they track the tag's real orientation. An SVG polygon with a
 * non-scaling stroke keeps the border a constant thickness regardless of the
 * box's aspect ratio.
 *
 * @typedef {Object} SpatialColorsDoc
 * @property {string} title
 */

// ---------------------------------------------------------------------------
// Inlined patchwork-providers `subscribe` (v0.2.x) — dependency-free DOM +
// MessageChannel code, copied so this stays a bundleless single-file tool.
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

// Hardcoded tag id -> hue (v1). Pure, fully saturated colors.
const TAG_HUES = { 0: 0, 1: 120, 2: 240 };

function colorForTag(id) {
  const hue = TAG_HUES[id];
  if (hue == null) return null; // unknown tag → no outline
  return `hsl(${hue}, 100%, 50%)`;
}

// ---------------------------------------------------------------------------
// Datatype
// ---------------------------------------------------------------------------
export const SpatialColorsDatatype = {
  init(doc) {
    doc.title = "Spatial Colors";
  },
  getTitle(doc) {
    return doc.title || "Spatial Colors";
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
    .spatial-colors {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: transparent;
    }
    .spatial-colors svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .spatial-colors polygon {
      fill: none;
      stroke-width: 20px;
      stroke-linejoin: round;
    }
  `;
  element.appendChild(style);

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "spatial-colors";
  element.appendChild(root);

  // A single SVG spanning the whole box. viewBox 0..100 + preserveAspectRatio
  // "none" lets us plot normalized corners directly as percentages; the
  // non-scaling stroke keeps the outline a constant pixel thickness.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  root.appendChild(svg);

  let tags = [];

  function render() {
    svg.replaceChildren();
    for (const tag of tags) {
      const color = colorForTag(tag.id);
      if (!color) continue;
      const corners = Array.isArray(tag.corners) ? tag.corners : [];
      if (corners.length < 3) continue; // need a quad (fallback: skip points)
      const points = corners
        .map((c) => `${c.nx * 100},${c.ny * 100}`)
        .join(" ");
      const polygon = document.createElementNS(SVG_NS, "polygon");
      polygon.setAttribute("points", points);
      polygon.setAttribute("stroke", color);
      // Constant-thickness border regardless of box aspect ratio.
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(polygon);
    }
  }

  const unsubTags = subscribe(
    element,
    { type: "spatial:apriltags" },
    (value) => {
      tags = (value && value.tags) || [];
      render();
    },
  );

  render();

  return () => {
    unsubTags();
    root.remove();
    style.remove();
    element.style.position = prevPosition;
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-colors",
    name: "Spatial Colors",
    icon: "Palette",
    async load() {
      return SpatialColorsDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-colors",
    name: "Spatial Colors",
    icon: "Palette",
    supportedDatatypes: ["spatial-colors"],
    async load() {
      return Tool;
    },
  },
];
