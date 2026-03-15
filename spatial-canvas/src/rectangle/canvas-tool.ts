import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { RectangleShape } from "./rectangle.js";

const lightenColor = (hex: string, t = 0.72): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
};

/**
 * canvas-rectangle — renders the visual content of a rectangle shape.
 *
 * Layout (position, size, zIndex) is applied by <patchwork-ref-view> before
 * this tool is mounted. This tool only sets visual styles.
 */
const CanvasRectangleTool = (handle: DocHandle<CanvasDoc>, element: HTMLElement): Disposer => {
  const shapeId = element.dataset.shapeId ?? "";

  element.style.borderRadius = "8px";
  element.style.boxSizing = "border-box";

  const render = ({ doc }: { doc: CanvasDoc }) => {
    const shape = doc.shapes[shapeId] as RectangleShape | undefined;
    if (!shape) return;

    const color = shape.color ?? "#4f8ef7";
    const fill = shape.fill ?? "filled";

    element.style.outline = `2.5px solid ${color}`;
    element.style.background =
      fill === "transparent" ? "transparent" : fill === "white" ? "white" : lightenColor(color);
  };

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
  };
};

export default CanvasRectangleTool;
