import type { AutomergeUrl } from "@automerge/automerge-repo";

// A paper doc points at its layers; each ref names the layer doc plus the
// tool that draws it ("paper-line" | "paper-rect").
export type LayerRef = {
  url: AutomergeUrl;
  toolId: string;
};

export type PaperDoc = {
  "@patchwork": { type: "paper" };
  title: string;
  layers: LayerRef[];
};

// Shared base shape. Each layer tool stuffs its own fields on top of this.
export type Shape = {
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
};

// A layer document holds many shapes; the layer's tool interprets them.
export type PaperLayerDoc = {
  "@patchwork": { type: "paper-layer" };
  title: string;
  shapes: Shape[];
};
