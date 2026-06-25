/**
 * Walls layer payload types + selector. A "wall" is any recognized
 * drawing/object outline, expressed as a polygon of box-normalized points —
 * the same mental model as AprilTag corners.
 */

export type WallPoint = { nx: number; ny: number };

export type WallShape = {
  id: number;
  /** Outline polygon, normalized 0..1 within the box. */
  points: WallPoint[];
};

export type Walls = { shapes: WallShape[] };

export const WALLS_SELECTOR = "spatial:walls";
