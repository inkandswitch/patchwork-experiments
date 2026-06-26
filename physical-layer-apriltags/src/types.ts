/**
 * AprilTags layer payload types + selector. Consumer tools subscribe to
 * `physical:apriltags` and receive `PhysicalTags`.
 */

export type PhysicalTagCorner = { nx: number; ny: number };

export type PhysicalTag = {
  id: number;
  /** center, normalized 0..1 within the box (canonical) */
  nx: number;
  ny: number;
  /** radians, derived from corner0 -> corner1 */
  angle: number;
  corners: PhysicalTagCorner[];
};

export type PhysicalTags = { tags: PhysicalTag[] };

export const APRILTAGS_SELECTOR = "physical:apriltags";
export const APRILTAGS_PROVIDER_ID = "physical-apriltags-provider";
