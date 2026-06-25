import type { Clip, Playhead, SpaceTimeDoc } from '../types';
import { clipWidth, resolveClipPlayDuration } from '../clip-timing';
import { CLIP_HEIGHT, PIXELS_PER_SECOND, rangesOverlap } from './constants';

/** Gaps of this size or larger break the playhead extent from reaching clips beyond them. */
export const PLAYHEAD_EXTENT_MAX_GAP_SECONDS = 5;
export const PLAYHEAD_EXTENT_MAX_GAP_PX = PLAYHEAD_EXTENT_MAX_GAP_SECONDS * PIXELS_PER_SECOND;

type ClipTimingLookup = Map<string, { sourceLength?: number }>;

type ClipExtentInterval = {
  clip: Clip;
  startX: number;
  endX: number;
};

function clipOverlapsPlayheadVertically(clip: Clip, playhead: Playhead): boolean {
  return rangesOverlap(
    clip.y,
    clip.y + CLIP_HEIGHT,
    playhead.y,
    playhead.y + playhead.height,
  );
}

function verticalClipIntervals(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: ClipTimingLookup,
): ClipExtentInterval[] {
  return doc.clips
    .filter((clip) => clipOverlapsPlayheadVertically(clip, playhead))
    .map((clip) => {
      const playDuration = resolveClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
      return {
        clip,
        startX: clip.x,
        endX: clip.x + clipWidth(clip, playDuration),
      };
    })
    .sort((a, b) => a.startX - b.startX || a.clip.id.localeCompare(b.clip.id));
}

/** Clips reachable from the playhead origin without crossing a gap ≥ 5 seconds. */
export function computeConnectedPlayheadExtent(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: ClipTimingLookup,
): { clips: Clip[]; maxEndX: number } {
  const intervals = verticalClipIntervals(doc, playhead, timing);
  let cursor = playhead.x;
  let maxEndX = playhead.x;
  const clips: Clip[] = [];

  for (const { clip, startX, endX } of intervals) {
    if (startX - cursor > PLAYHEAD_EXTENT_MAX_GAP_PX) break;
    clips.push(clip);
    maxEndX = Math.max(maxEndX, endX);
    cursor = Math.max(cursor, endX);
  }

  return { clips, maxEndX };
}

export function clipsInPlayheadExtent(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: ClipTimingLookup,
): Clip[] {
  const { clips } = computeConnectedPlayheadExtent(doc, playhead, timing);
  return clips.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
}

export function maxEndXForPlayhead(
  doc: SpaceTimeDoc,
  timing: ClipTimingLookup,
  playhead: Playhead,
): number {
  return computeConnectedPlayheadExtent(doc, playhead, timing).maxEndX;
}
