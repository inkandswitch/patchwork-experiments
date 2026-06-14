import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SurfaceState = {
  selectedToolId?: string;
  pointer?: {
    // The pointer location in `surfaceUrl`'s own local space. Exactly one
    // surface — the innermost one under the cursor — owns each pointer event
    // (its root stops propagation), so there is a single sample, never a
    // coordinate conversion.
    position: Point;
    // The surface that stamped the sample (points to Doc<DocWithLayers>).
    surfaceUrl: AutomergeUrl;
    isPressed: boolean;
    // The stamping surface's current scale: screen pixels per local unit at
    // this view. Paper is always 1; the map varies with zoom. Tools that
    // create shapes read it so a shape can record the scale it was drawn at
    // (see `Shape.scale`) without ever measuring the DOM.
    scale: number;
    // The topmost shape under the pointer in the stamping surface, if any
    // (sub-document url into its layer doc). The surface hit-tests as it
    // stamps, so tools read what's under the cursor instead of computing it.
    // Absent until the surface's layer handles have loaded (a sample or two).
    shapeUrl?: AutomergeUrl;
  };
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
