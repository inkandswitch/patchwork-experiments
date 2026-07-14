// The `geo-shape` context view: shapes are plain JSON, so unlike the opaque
// extension channels there is something meaningful to draw — a small chip
// naming the kind and where it sits.
//
// Loaded lazily through this package's `geo-shape-context-view` plugin.

/** @type {(element: HTMLElement, value: unknown) => () => void} */
export const geoShapeView = (element, value) => {
  injectStyles();
  const chip = document.createElement("span");
  chip.className = "embark-geo-shape-face";
  chip.textContent = describe(value);
  element.appendChild(chip);
  return () => chip.remove();
};

function describe(shape) {
  if (shape?.type === "marker") {
    return `marker ${shape.at.lat.toFixed(3)}, ${shape.at.lon.toFixed(3)}`;
  }
  if (shape?.type === "line") {
    return `line \u00b7 ${shape.points.length} pts`;
  }
  return "shape";
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-geo-shape-view-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.embark-geo-shape-face {
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: #57534e;
  background: #f5f5f4;
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
`;
