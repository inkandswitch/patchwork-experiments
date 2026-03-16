type BaseShape = {
  id: string;
  stroke: string;
  strokeWidth: number;
  zIndex: number;
};

export type RectangleShape = BaseShape & {
  type: 'rectangle';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  fill: string;
};

export type LineShape = BaseShape & {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type Shape = RectangleShape | LineShape;

export type PaperDoc = {
  title: string;
  shapes: Record<string, Shape>;
};

export type Camera = {
  x: number;
  y: number;
  z: number;
};
