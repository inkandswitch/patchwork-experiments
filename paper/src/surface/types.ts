import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SurfaceState = {
  selectedToolId?: string;
  pointer?: {
    position: Point; // local to the surface that received the event
    // Client (viewport) coordinates. Drag deltas must be computed here: a
    // drag can move the surface that stamps the samples (dragging an embed
    // moves the inner surface's frame), which makes local deltas feed back
    // into themselves. The screen frame can't be moved by a drag.
    screenPosition: Point;
    isPressed: boolean;
    surfaceUrl: AutomergeUrl; // points to Doc<DocWithLayers>
    // The surface this one is embedded in, absent for top-level surfaces.
    // Lets consumers ascend one level (e.g. select resolves a miss to this
    // surface's embed shape in the parent).
    parentSurfaceUrl?: AutomergeUrl;
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
  outline?: Outline;
  width?: number;
  height?: number;
};

export type Outline =
  | { type: "rectangle"; width: number; height: number }
  | { type: "line"; points: Point[] }
  | { type: "polygon"; points: Point[] };

export type Point = { x: number; y: number };
