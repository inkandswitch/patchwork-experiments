import type { CanvasShape } from "../canvas/types.js";

export type EmbedShape = CanvasShape & {
  type: "embed";
  docUrl: string; // AutomergeUrl; empty string while doc is being created
  docType: string; // patchwork:datatype id
  toolId: string; // viewer tool id; empty = default
  width: number;
  height: number;
};
