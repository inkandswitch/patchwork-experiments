import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SurfaceTool = {
  toolId?: string;
};

export type SurfacePointer = {
  position?: Point;
  isPressed: boolean;
  surfaceUrl?: AutomergeUrl; // points to Doc<DocWithLayers>
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
  shapes: Shape[];
};

export type Shape = {
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
