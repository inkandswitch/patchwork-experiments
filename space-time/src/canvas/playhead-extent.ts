import type { Clip, Playhead, SpaceTimeDoc } from '../types';
import { clipWidth, resolveClipPlayDuration } from '../clip-timing';
import { CLIP_HEIGHT, PIXELS_PER_SECOND, rangesOverlap } from './constants';

/** Gaps of this size or larger break the playhead extent from reaching clips beyond them. */
export const PLAYHEAD_EXTENT_MAX_GAP_SECONDS = 2;
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

type ClipRun = {
  intervals: ClipExtentInterval[];
  startX: number;
  endX: number;
};

/**
 * Group vertically-overlapping clips into runs, where consecutive clips join
 * the same run unless separated by a gap ≥ 5 seconds.
 */
function clipRuns(intervals: ClipExtentInterval[]): ClipRun[] {
  const runs: ClipRun[] = [];
  for (const iv of intervals) {
    const last = runs[runs.length - 1];
    if (last && iv.startX - last.endX <= PLAYHEAD_EXTENT_MAX_GAP_PX) {
      last.intervals.push(iv);
      last.endX = Math.max(last.endX, iv.endX);
    } else {
      runs.push({ intervals: [iv], startX: iv.startX, endX: iv.endX });
    }
  }
  return runs;
}

/** The single run the playhead belongs to (inside it, else nearest within gap). */
function chooseRun(runs: ClipRun[], playhead: Playhead): ClipRun | null {
  for (const run of runs) {
    if (playhead.x >= run.startX && playhead.x <= run.endX) return run;
  }
  for (const run of runs) {
    if (run.startX >= playhead.x && run.startX - playhead.x <= PLAYHEAD_EXTENT_MAX_GAP_PX) return run;
  }
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    if (run.endX <= playhead.x && playhead.x - run.endX <= PLAYHEAD_EXTENT_MAX_GAP_PX) return run;
  }
  return null;
}

type YSpan = { y: number; height: number };

function spansOverlapVertically(a: YSpan, b: YSpan): boolean {
  return rangesOverlap(a.y, a.y + a.height, b.y, b.y + b.height);
}

/**
 * The right edge of a playhead's extent box, given clip rectangles and the
 * other playheads (for the same-row bound). Shared by the doc-based extent and
 * the drag preview so the box is drawn identically while moving and at rest.
 */
export function extentBoxRightEdge(
  playhead: { x: number } & YSpan,
  rects: ReadonlyArray<{ x: number; width: number } & YSpan>,
  otherPlayheads: ReadonlyArray<{ x: number } & YSpan>,
): number {
  const intervals = rects
    .filter((r) => spansOverlapVertically(r, playhead))
    .map((r) => ({ startX: r.x, endX: r.x + r.width }))
    .sort((a, b) => a.startX - b.startX);

  let nextPlayheadX = Infinity;
  for (const other of otherPlayheads) {
    if (other.x > playhead.x && other.x < nextPlayheadX && spansOverlapVertically(other, playhead)) {
      nextPlayheadX = other.x;
    }
  }

  let cursor = playhead.x;
  let maxEndX = playhead.x;
  for (const iv of intervals) {
    if (iv.endX <= playhead.x) continue;
    if (iv.startX >= nextPlayheadX) break;
    if (iv.startX - cursor > PLAYHEAD_EXTENT_MAX_GAP_PX) break;
    maxEndX = Math.max(maxEndX, iv.endX);
    cursor = Math.max(cursor, iv.endX);
  }
  return nextPlayheadX !== Infinity ? Math.min(maxEndX, nextPlayheadX) : maxEndX;
}

/**
 * The extent of a playhead: the box [playhead.x, maxEndX] over the playhead's
 * row, and the clips that overlap that box. The box reaches rightward through
 * clips connected without a gap ≥ 5 seconds, but stops at the next playhead on
 * the same row — so two playheads side by side each get their own box, and
 * "what moves with the extent" is exactly "what overlaps the drawn box".
 */
export function computeConnectedPlayheadExtent(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: ClipTimingLookup,
): { clips: Clip[]; maxEndX: number } {
  const runs = clipRuns(verticalClipIntervals(doc, playhead, timing));
  const run = chooseRun(runs, playhead);
  if (!run) return { clips: [], maxEndX: playhead.x };

  const rects = run.intervals.map((iv) => ({
    x: iv.startX,
    width: iv.endX - iv.startX,
    y: iv.clip.y,
    height: CLIP_HEIGHT,
  }));
  const maxEndX = extentBoxRightEdge(
    playhead,
    rects,
    doc.playheads.filter((p) => p.id !== playhead.id),
  );

  // Clips that overlap the drawn box [playhead.x, maxEndX] are exactly the ones
  // that move with the extent — the single source of truth.
  const clips = run.intervals
    .filter((iv) => iv.endX > playhead.x && iv.startX < maxEndX)
    .map((iv) => iv.clip);

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

/**
 * Canvas x that maps to composition time 0 for this playhead. Diffusion cannot
 * represent negative times, so a playhead panned into negative canvas space (or
 * with clips reaching slightly left of it) needs its composition shifted to
 * start at 0. This is the leftmost of the playhead and any clip in its extent.
 */
export function playheadOriginX(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: ClipTimingLookup,
): number {
  const { clips } = computeConnectedPlayheadExtent(doc, playhead, timing);
  let originX = playhead.x;
  for (const clip of clips) originX = Math.min(originX, clip.x);
  return originX;
}
