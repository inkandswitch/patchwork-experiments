import type { Clip, Playhead, SpaceTimeDoc } from '../types';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import { clipsInPlayheadExtent } from '../diffusion/sync-composition';
import { clipWidth, resolveClipPlayDuration, sourceSkip } from '../clip-timing';
import { PIXELS_PER_SECOND, type Camera, SNAP_THRESHOLD_SCREEN_PX } from './constants';
import { clipMarkers, visibleMarkerOffsetsFromLeft, visibleMarkerPageXs } from './clip-markers';

export function snapThresholdPage(camera: Camera): number {
  return SNAP_THRESHOLD_SCREEN_PX / camera.z;
}

export function snapPageXToTargets(
  x: number,
  targets: readonly number[],
  threshold: number,
): number {
  let bestX = x;
  let bestDist = threshold + 1;
  for (const target of targets) {
    const dist = Math.abs(x - target);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestX = target;
    }
  }
  return bestX;
}

/**
 * Nudge clip left edge so a start/end edge — or any extra offset from the left
 * (e.g. markers) — snaps to a target x without changing duration.
 */
export function snapClipMoveX(
  x: number,
  durationSeconds: number,
  targets: readonly number[],
  threshold: number,
  extraOffsetsFromLeft: readonly number[] = [],
): number {
  const width = durationSeconds * PIXELS_PER_SECOND;
  const offsets = [0, width, ...extraOffsetsFromLeft];
  let bestX = x;
  let bestDist = threshold + 1;

  for (const target of targets) {
    for (const offset of offsets) {
      const dist = Math.abs(x + offset - target);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        bestX = target - offset;
      }
    }
  }
  return bestX;
}

function uniquePageEdges(edges: number[]): number[] {
  const sorted = [...edges].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const edge of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(edge - last) > 0.01) {
      unique.push(edge);
    }
  }
  return unique;
}

function clipPlayDuration(clip: Clip, timing: Map<string, ClipTimingInfo>): number {
  return resolveClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
}

/** Start/end/marker x of clips in the playhead extent, for edge snapping while dragging. */
export function clipEdgeSnapTargetsX(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
  excludeClipIds?: ReadonlySet<string>,
): number[] {
  const edges: number[] = [];
  for (const clip of clipsInPlayheadExtent(doc, playhead, timing)) {
    if (excludeClipIds?.has(clip.id)) continue;
    const duration = clipPlayDuration(clip, timing);
    edges.push(clip.x);
    edges.push(clip.x + clipWidth(clip, duration));
    edges.push(
      ...visibleMarkerPageXs(clipMarkers(clip), clip.x, sourceSkip(clip), duration),
    );
  }
  return uniquePageEdges(edges);
}

export function clipMoveSnapTargetsX(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
  playheadLineX: number,
  excludeClipIds?: ReadonlySet<string>,
): number[] {
  return uniquePageEdges([
    playheadLineX,
    ...clipEdgeSnapTargetsX(doc, timing, playhead, excludeClipIds),
  ]);
}

export function playheadScrubSnapTargetsX(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
): number[] {
  return clipEdgeSnapTargetsX(doc, timing, playhead);
}

/** Marker offsets from left for the clip being moved (so markers snap too). */
export function clipMarkerSnapOffsets(
  clip: Clip,
  timing: Map<string, ClipTimingInfo>,
): number[] {
  const duration = clipPlayDuration(clip, timing);
  return visibleMarkerOffsetsFromLeft(clipMarkers(clip), sourceSkip(clip), duration);
}
