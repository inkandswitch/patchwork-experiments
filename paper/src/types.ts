import type { AutomergeUrl } from "@automerge/automerge-repo";

// A paper doc maps each surface tool id ("rect" | "line") to the layer
// document that tool draws into. The map shape lets the surface provider
// look a layer up (and create it on demand) by tool id.
export type PaperDoc = {
  "@patchwork": { type: "paper" };
  title: string;
  layers: { [toolId: string]: AutomergeUrl };
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
