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
  outline: Outline;
};

export type Outline =
  | { type: "rectangle"; width: number; height: number }
  | { type: "line"; points: Point[] }
  | { type: "polygon"; points: Point[] };

export type Point = { x: number; y: number };
