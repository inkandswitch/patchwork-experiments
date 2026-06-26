/**
 * Physical Marks — a bundleless test tool for physical Patchwork.
 *
 * Subscribes to the host's `physical:marks` provider (the drawing/object
 * recognition layer) and echoes every recognized shape as a white outline on a
 * transparent background — the geometry the layer captured, mirrored back onto
 * the surface. (Analogous to how physical-colors echoes tags.)
 *
 * Each shape is a polygon of normalized {nx,ny} points in box space, so
 * placement is pure CSS percentages — no coordinate-system provider needed.
 *
 * The background + polygon fill are transparent so the host's lit "paper"
 * surface (surfaceBrightness) reaches the surface — an opaque fill would
 * re-darken exactly the area the camera needs lit for detection.
 *
 * @typedef {Object} PhysicalMarksDoc
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
export const PhysicalMarksDatatype = {
  init(doc) {
    doc.title = "Physical Marks";
  },
  getTitle(doc) {
    return doc.title || "Physical Marks";
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
    .physical-marks {
      position: absolute;
      inset: 0;
      overflow: hidden;
      /* Transparent so the host's lit "paper" surface (surfaceBrightness) shows
         through. An opaque fill here would re-darken the surface the camera
         needs lit, breaking marks detection in a dim room. */
      background: transparent;
    }
    .physical-marks svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .physical-marks polygon {
      /* Outline only — don't paint the recognized shape black (that would
         re-darken the lit surface right where you drew). Just echo the outline. */
      fill: none;
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
  root.className = "physical-marks";
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

  const unsub = subscribe(element, { type: "physical:marks" }, (value) => {
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
    id: "physical-marks-test",
    name: "Physical Marks",
    icon: "Shapes",
    async load() {
      return PhysicalMarksDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "physical-marks-test",
    name: "Physical Marks",
    icon: "Shapes",
    supportedDatatypes: ["physical-marks-test"],
    async load() {
      return Tool;
    },
  },
];
