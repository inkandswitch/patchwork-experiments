import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SurfaceState = {
  selectedToolId?: string;
  pointer?: {
    // The pointer location expressed once per surface under the cursor, each
    // in that surface's own local space. Every SurfaceProvider in the DOM
    // ancestor chain stamps its own entry as the event bubbles through it, so
    // a consumer never converts coordinates — it just reads the entry for the
    // surface it draws into or moves a shape on. Keyed by the surface's doc
    // url (points to Doc<DocWithLayers>).
    positions: { [surfaceUrl: AutomergeUrl]: Point };
    // The innermost surface under the cursor. The keyed map carries no order,
    // so the deepest surface (the one that owns a fresh draw, and the starting
    // point for ascending to a parent embed) must be named explicitly.
    surfaceUrl: AutomergeUrl;
    isPressed: boolean;
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
