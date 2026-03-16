export type BaseShape = {
  id: string;
  x: number;
  y: number;
  zIndex: number;
  [key: string]: unknown;
};

export type PaperDoc = {
  title: string;
  shapes: Record<string, BaseShape>;
};

export type Camera = {
  x: number;
  y: number;
  z: number;
};
