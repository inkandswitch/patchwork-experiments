import * as Automerge from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { RectangleShape } from "./rectangle.js";
import { deleteShapes } from "../canvas/commands.js";

/** Mix color with white by `t` (0 = original, 1 = white). */
function lightenColor(hex: string, t = 0.72): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * t);
  const lg = Math.round(g + (255 - g) * t);
  const lb = Math.round(b + (255 - b) * t);
  return `rgb(${lr},${lg},${lb})`;
}

/**
 * canvas-rectangle — renders the visual content of a rectangle shape.
 *
 * Layout (position, size, zIndex) is applied by <patchwork-ref-view> before
 * this tool is mounted. This tool only sets visual styles.
 *
 * The element itself is a <patchwork-ref-view> with `data-shape-id` already
 * set by the generic shape layer so selection/resize layers can find it.
 */
export default function CanvasRectangleTool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): Disposer {
  const shapeId = element.dataset.shapeId ?? "";
  console.log("[canvas-rectangle] mounted for shapeId:", shapeId, "element:", element);

  element.style.borderRadius = "8px";
  element.style.boxSizing = "border-box";

  function render({ doc }: { doc: CanvasDoc }) {
    const shape = doc.shapes[shapeId] as RectangleShape | undefined;
    if (!shape) {
      console.warn("[canvas-rectangle] render: shape not found for id:", shapeId, "shapes:", Object.keys(doc.shapes));
      return;
    }

    console.log("[canvas-rectangle] render: shape", { shapeId, color: shape.color, fill: shape.fill, x: shape.x, y: shape.y, w: (shape as any).width, h: (shape as any).height, elSize: `${element.offsetWidth}x${element.offsetHeight}` });
    const color = shape.color ?? "#4f8ef7";
    const fill = shape.fill ?? "filled";

    element.style.outline = `2.5px solid ${color}`;

    if (fill === "transparent") {
      element.style.background = "transparent";
    } else if (fill === "white") {
      element.style.background = "white";
    } else {
      element.style.background = lightenColor(color);
    }
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
  };
}
