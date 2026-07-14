import type { Clip } from './types';
import { DEFAULT_CLIP_DURATION } from './helpers';

/** Seconds of source media to skip before playback starts. */
export function sourceSkip(clip: Clip): number {
  return clip.sourceInTime ?? 0;
}

/**
 * How long the clip plays on the sequence timeline.
 * When `duration` is null, use the remainder of the source after skipping.
 */
export function resolveClipPlayDuration(clip: Clip, sourceLength: number | undefined): number {
  if (clip.duration !== null) return clip.duration;
  if (sourceLength !== undefined) {
    return Math.max(0, sourceLength - sourceSkip(clip));
  }
  return DEFAULT_CLIP_DURATION;
}

/** Last sequence time at which the clip is visible/active. */
export function clipTimelineEnd(clip: Clip, playDuration: number): number {
  return clip.time + playDuration;
}

/** Maximum play duration without exceeding the source window. */
export function maxClipPlayDuration(clip: Clip, sourceLength: number | undefined): number {
  if (sourceLength === undefined) return Infinity;
  return Math.max(0, sourceLength - sourceSkip(clip));
}

/** Source media window [start, end] in seconds. */
export function clipSourceWindow(
  clip: Clip,
  playDuration: number,
): { start: number; end: number } {
  const start = sourceSkip(clip);
  return { start, end: start + playDuration };
}

/**
 * Map sequence clip timing to Diffusion Studio's delay/range model.
 *
 * DSC defines timeline start as `delay + range[0]` and end as `delay + range[1]`,
 * so delay must subtract the source skip to avoid double-counting sourceInTime.
 */
export function clipToDiffusionTiming(
  clip: Clip,
  playDuration: number,
): { delay: number; range: [number, number] } {
  const { start, end } = clipSourceWindow(clip, playDuration);
  return { delay: clip.time - start, range: [start, end] };
}
