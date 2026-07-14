import type { Clip } from './types';
import { DEFAULT_IMAGE_DURATION } from './helpers';
import { PIXELS_PER_SECOND } from './canvas/constants';

export const DEFAULT_CLIP_DURATION = DEFAULT_IMAGE_DURATION;

/** Sequence time in seconds from canvas x. */
export function xToTime(x: number): number {
  return x / PIXELS_PER_SECOND;
}

export function timeToX(time: number): number {
  return time * PIXELS_PER_SECOND;
}

export function clipSequenceTime(clip: Clip): number {
  return xToTime(clip.x);
}

export function sourceSkip(clip: Clip): number {
  return clip.sourceInTime ?? 0;
}

export function resolveClipPlayDuration(clip: Clip, sourceLength: number | undefined): number {
  if (clip.duration !== null) return clip.duration;
  if (sourceLength !== undefined) {
    return Math.max(0, sourceLength - sourceSkip(clip));
  }
  return DEFAULT_CLIP_DURATION;
}

export function clipTimelineEnd(clip: Clip, playDuration: number): number {
  return clipSequenceTime(clip) + playDuration;
}

export function maxClipPlayDuration(clip: Clip, sourceLength: number | undefined): number {
  if (sourceLength === undefined) return Infinity;
  return Math.max(0, sourceLength - sourceSkip(clip));
}

export function clipSourceWindow(
  clip: Clip,
  playDuration: number,
): { start: number; end: number } {
  const start = sourceSkip(clip);
  return { start, end: start + playDuration };
}

export function clipToDiffusionTiming(
  clip: Clip,
  playDuration: number,
): { delay: number; range: [number, number] } {
  const { start, end } = clipSourceWindow(clip, playDuration);
  const time = clipSequenceTime(clip);
  return { delay: time - start, range: [start, end] };
}

export function clipWidth(clip: Clip, playDuration: number): number {
  return Math.max(12, playDuration * PIXELS_PER_SECOND);
}

export function clipRightX(clip: Clip, playDuration: number): number {
  return clip.x + clipWidth(clip, playDuration);
}
