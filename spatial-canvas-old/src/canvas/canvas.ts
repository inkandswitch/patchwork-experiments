import type { Vec2, Rect } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

/**
 * A PatchworkViewElement augmented with the spatial canvas public API.
 * Cast the root canvas patchwork-view to this type to access canvas methods.
 */
export type SpatialCanvas = PatchworkViewElement & {
  screenToPage(screenX: number, screenY: number): Vec2;
  pageToScreen(x: number, y: number): Vec2;
  shapesAtPoint(screenX: number, screenY: number): { id: string }[];
  shapesOverlapping(screenRect: Rect): { id: string }[];
};

/** Walk up the DOM to find the nearest SpatialCanvas view by locating the layout host and querying within it. */
export function getCanvas(el: Element | null): SpatialCanvas | null {
  let node = el?.parentElement ?? null;
  while (node) {
    if ((node as any).toolId === "spatial-canvas") {
      return node.querySelector(
        'patchwork-view[tool-id="spatial-canvas-view"]',
      ) as unknown as SpatialCanvas;
    }
    node = node.parentElement;
  }
  return null;
}
