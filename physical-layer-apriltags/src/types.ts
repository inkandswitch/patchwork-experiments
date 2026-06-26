/**
 * AprilTags layer payload types + selector. Consumer tools subscribe to
 * `physical:apriltags` and receive `PhysicalTags`.
 *
 * The payload is GRADED: a tag's `id` is always present (detection works without
 * calibration), but its POSITION (`nx`/`ny`/`angle`/`corners`) requires the
 * homography and is therefore optional — present only when `calibrated` is true.
 * Presence-only consumers (e.g. frame controls) read `tags[].id`; positional
 * consumers (e.g. physical-colors) must guard on `calibrated` / `nx != null`.
 */

export type PhysicalTagCorner = { nx: number; ny: number };

export type PhysicalTag = {
  id: number;
  /** center, normalized 0..1 within the box. Present only when calibrated. */
  nx?: number;
  ny?: number;
  /** radians, derived from corner0 -> corner1. Present only when calibrated. */
  angle?: number;
  /** outline, normalized 0..1. Present only when calibrated. */
  corners?: PhysicalTagCorner[];
};

export type PhysicalTags = {
  /** true once a homography exists, so position fields are populated */
  calibrated: boolean;
  tags: PhysicalTag[];
};

export const APRILTAGS_SELECTOR = "physical:apriltags";
export const APRILTAGS_PROVIDER_ID = "physical-apriltags-provider";
