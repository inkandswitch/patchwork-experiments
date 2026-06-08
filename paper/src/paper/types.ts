import { DocWithLayers } from "../surface/types";

// A paper doc maps each surface tool id ("rect" | "line") to the layer
// document that tool draws into. The map shape lets the surface provider
// look a layer up (and create it on demand) by tool id.
export type PaperDoc = DocWithLayers & {
  "@patchwork": { type: "paper" };
  title: string;
};
