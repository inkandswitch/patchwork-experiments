import type { CanvasShape } from "../canvas/types.js";

export type TextShape = CanvasShape & {
  type: "text";
  text: string;
  color?: string;
  fontSize?: number; // default 18
};
