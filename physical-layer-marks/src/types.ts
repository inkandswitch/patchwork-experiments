/**
 * Marks layer payload types + selector. A "mark" is any recognized black-marker
 * drawing outline, expressed as a polygon of box-normalized points — the same
 * mental model as AprilTag corners. Consumer tools subscribe to `physical:marks`
 * and receive `Marks`.
 */

export type MarkPoint = { nx: number; ny: number };

export type MarkShape = {
  id: number;
  /** Outline polygon, normalized 0..1 within the box. */
  points: MarkPoint[];
};

export type Marks = { shapes: MarkShape[] };

export const MARKS_SELECTOR = "physical:marks";
export const MARKS_PROVIDER_ID = "physical-marks-provider";
