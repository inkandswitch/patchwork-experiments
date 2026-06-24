/**
 * Spatial Tag Labeler — a tiny bundleless demo tool for the spatial host.
 *
 * It knows NOTHING about cameras, projectors, or homographies. It subscribes to
 * the spatial host's providers and drops an editable label on each detected
 * AprilTag, positioned in normalized box coordinates. This is the worked example
 * proving the host replaces apriltag-projector's bespoke "use" mode: the host
 * does all the spatial work; this tool just consumes `spatial:apriltags`.
 *
 * Tag positions arrive as normalized 0..1 within the embedded view (`nx,ny`),
 * so placement is pure CSS percentages — no need for the coordinate-system
 * provider at all in this simple case (we subscribe to it only to show the box
 * size in a readout).
 *
 * @typedef {Object} SpatialTagLabelerDoc
 * @property {string} title
 * @property {Record<string,string>} labels   tag id -> custom label
 */

// ---------------------------------------------------------------------------
// Inlined patchwork-providers `subscribe` (v0.2.x). Dependency-free DOM +
// MessageChannel code, copied so this stays a bundleless single-file tool.
// Dispatches a bubbling+composed `patchwork:subscribe` from the nearest
// enclosing <patchwork-view>; the host's provider answers over the port.
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

// ---------------------------------------------------------------------------
// Datatype
// ---------------------------------------------------------------------------
export const SpatialTagLabelerDatatype = {
  init(doc) {
    doc.title = "Spatial Tag Labeler";
    doc.labels = {};
  },
  getTitle(doc) {
    return doc.title || "Spatial Tag Labeler";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

function labelFor(labels, id) {
  const stored = labels && labels[String(id)];
  return stored && stored.length ? stored : `Tag ${id}`;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .stl-root {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: transparent;
      font-family: var(--studio-family-sans, system-ui, sans-serif);
      color: #fff;
    }
    .stl-tag {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      white-space: nowrap;
    }
    .stl-dot {
      width: 14px; height: 14px; border-radius: 999px;
      background: #fff; box-shadow: 0 0 14px rgba(255,255,255,0.95);
      flex: none;
    }
    .stl-text {
      padding: 0.2rem 0.55rem;
      border: 2px solid rgba(255,255,255,0.75);
      border-radius: 999px;
      background: rgba(0,0,0,0.82);
      font: 700 1rem/1 var(--studio-family-sans, system-ui, sans-serif);
      text-shadow: 0 0 10px rgba(255,255,255,0.4);
    }
    .stl-readout {
      position: absolute;
      right: 0.4rem; bottom: 0.4rem;
      font: 500 0.7rem/1.3 var(--studio-family-code, ui-monospace, monospace);
      color: rgba(255,255,255,0.55);
      background: rgba(0,0,0,0.5);
      padding: 0.25rem 0.45rem;
      border-radius: 4px;
      pointer-events: none;
      white-space: pre;
    }
  `;
  element.appendChild(style);

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "stl-root";
  element.appendChild(root);

  const layer = document.createElement("div");
  layer.style.position = "absolute";
  layer.style.inset = "0";
  root.appendChild(layer);

  const readout = document.createElement("div");
  readout.className = "stl-readout";
  root.appendChild(readout);

  let lastTags = [];
  let boxSize = { width: 0, height: 0 };

  function renderTags() {
    const labels = (handle.doc() && handle.doc().labels) || {};
    layer.innerHTML = "";
    for (const tag of lastTags) {
      const el = document.createElement("div");
      el.className = "stl-tag";
      el.style.left = tag.nx * 100 + "%";
      el.style.top = tag.ny * 100 + "%";

      const dot = document.createElement("div");
      dot.className = "stl-dot";

      const text = document.createElement("div");
      text.className = "stl-text";
      text.textContent = labelFor(labels, tag.id);
      if (typeof tag.angle === "number" && tag.angle) {
        text.style.transform = `rotate(${tag.angle}rad)`;
      }

      el.append(dot, text);
      layer.appendChild(el);
    }
    readout.textContent =
      `${lastTags.length} tag${lastTags.length === 1 ? "" : "s"}` +
      `\nbox ${Math.round(boxSize.width)}×${Math.round(boxSize.height)}`;
  }

  // Subscribe to the host's providers. The host answers these; if this tool is
  // opened outside a spatial host (no provider), the listeners simply never fire.
  const unsubTags = subscribe(element, { type: "spatial:apriltags" }, (value) => {
    lastTags = (value && value.tags) || [];
    renderTags();
  });
  const unsubCoords = subscribe(
    element,
    { type: "spatial:coordinate-system" },
    (value) => {
      boxSize = value || { width: 0, height: 0 };
      renderTags();
    },
  );

  const onChange = renderTags; // re-render when labels change
  handle.on("change", onChange);
  renderTags();

  return () => {
    unsubTags();
    unsubCoords();
    handle.off("change", onChange);
    root.remove();
    style.remove();
    element.style.position = prevPosition;
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-tag-labeler",
    name: "Spatial Tag Labeler",
    icon: "Tags",
    async load() {
      return SpatialTagLabelerDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-tag-labeler",
    name: "Spatial Tag Labeler",
    icon: "Tags",
    supportedDatatypes: ["spatial-tag-labeler"],
    async load() {
      return Tool;
    },
  },
];
