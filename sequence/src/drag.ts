/** A clip being dragged out of the source monitor onto the timeline. */
export type PendingClip = {
  sourceId: string;
  /** Seconds of source media to skip (the "in" point). */
  sourceInTime: number;
  /** Play duration in seconds (out - in). */
  duration: number;
  label: string;
};
