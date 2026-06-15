import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SurfaceState = {
  selectedToolId?: string;
  pointer?: SurfacePointer;
};

export type SurfacePointer = {
  position: Point;
  surfaceUrl: AutomergeUrl;
  isPressed: boolean;
  scale: number;
  shapeUrl?: AutomergeUrl;
};

// A pointer-driven drag-and-drop payload. A source writes `data` (and
// optionally `effectAllowed`) to the pointer; the surface dispatches native
// drag events built from it and writes back `dropEffect` once the drag ends.
export type PointerDrag = {
  // Mirrors DataTransfer: keys are native media types, values are strings. The
  // surface puts these straight onto a real DataTransfer. Values are withheld
  // mid-drag (blanked on dragenter/over/leave) and only populated on the drop.
  data: { [type: string]: string };
  // What the source permits; targets pick from it. Defaults to "copy".
  effectAllowed: EffectAllowed;
  // Finalized on release: the effect a target accepted, or "none" if rejected
  // or cancelled. Absent while the drag is in progress.
  dropEffect?: DropEffect;
};

// The native DnD drop effects (subset of DataTransfer.dropEffect).
export type DropEffect = "none" | "copy" | "link" | "move";

// The native DnD allowed effects (subset of DataTransfer.effectAllowed; the
// "uninitialized" sentinel is intentionally excluded).
export type EffectAllowed =
  | "none"
  | "copy"
  | "copyLink"
  | "copyMove"
  | "link"
  | "linkMove"
  | "move"
  | "all";

export type DocWithLayers = {
  layers: {
    [toolId: string]: AutomergeUrl; // points to Doc<LayerDoc>
  };
};

export type ShapeLayerDoc = {
  title: string;
  "@patchwork": {
    type: "shape-layer";
  };
  shapes: { [shapeId: string]: Shape };
};

export type Shape = {
  id: string;
  x: number;
  y: number;
  z: number;
  // World units per logical pixel: the scale the shape was drawn at (1 / the
  // drawing surface's scale). `x`/`y` are the surface-local (world) anchor;
  // the outline, stroke width and everything else are in logical pixels, and
  // the renderer applies a single `scale(scale)` around the anchor. So a shape
  // keeps its on-screen size at draw time and scales with the surface (e.g.
  // map zoom) afterwards. On paper the scale is 1, so pixels equal world units.
  scale: number;
  outline: Outline;
};

export type Outline =
  | { type: "rectangle"; width: number; height: number }
  | { type: "line"; points: Point[] }
  | { type: "polygon"; points: Point[] };

export type Point = { x: number; y: number };
