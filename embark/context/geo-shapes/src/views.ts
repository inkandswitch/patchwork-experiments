import type { ContextViewMount } from "@embark/context";
import type { GeoShape } from "./shape";
import "./views.css";

// The `geo-shape` context view: shapes are plain JSON, so unlike the opaque
// extension channels there is something meaningful to draw — a small chip
// naming the kind and where it sits.
export const geoShapeView: ContextViewMount = (element, value) => {
  const chip = document.createElement("span");
  chip.className = "embark-geo-shape-face";
  chip.textContent = describe(value as GeoShape);
  element.appendChild(chip);
  return () => chip.remove();
};

function describe(shape: GeoShape): string {
  if (shape?.type === "marker") {
    return `marker ${shape.at.lat.toFixed(3)}, ${shape.at.lon.toFixed(3)}`;
  }
  if (shape?.type === "line") {
    return `line \u00b7 ${shape.points.length} pts`;
  }
  return "shape";
}
