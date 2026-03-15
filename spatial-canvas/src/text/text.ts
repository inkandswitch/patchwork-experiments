import type { CanvasShape } from "../canvas/types.js";

export interface TextShape extends CanvasShape {
  type: "text";
  text: string;
  color?: string;
  fontSize?: number; // default 18
}
