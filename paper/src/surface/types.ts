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
