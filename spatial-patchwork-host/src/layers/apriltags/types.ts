/**
 * AprilTags layer payload types + selector. Moved out of spatial-source.ts so
 * the host framework stays generic; consumer tools subscribe to
 * `spatial:apriltags` and receive `SpatialTags`.
 */

export type SpatialTagCorner = { nx: number; ny: number };

export type SpatialTag = {
  id: number;
  /** center, normalized 0..1 within the box (canonical) */
  nx: number;
  ny: number;
  /** radians, derived from corner0 -> corner1 */
  angle: number;
  corners: SpatialTagCorner[];
};

export type SpatialTags = { tags: SpatialTag[] };

export const APRILTAGS_SELECTOR = "spatial:apriltags";
