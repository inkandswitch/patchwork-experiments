import type { ChangeFn } from '@automerge/automerge/slim';
import type { Clip, SpaceTimeDoc } from '../types';
import { cloneClip, findClip, newClip } from '../helpers';
import { MIN_CLIP_DURATION, PIXELS_PER_SECOND } from './constants';
import { clipWidth } from '../clip-timing';
import { removePlayheadsWithoutClips } from './playheads';
import {
  clipMarkers,
  maxSourceInKeepingMarkers,
  minDurationKeepingMarkers,
  partitionMarkersAtSourceTime,
} from './clip-markers';

function setClipPosition(
  doc: SpaceTimeDoc,
  clipId: string,
  x: number,
  y: number,
): void {
  const clip = findClip(doc, clipId);
  if (!clip) return;
  clip.x = x;
  clip.y = y;
}

/**
 * Move several clips. By default prunes empty playheads once at the end — never
 * between clips, so a batch move can't look "empty" mid-update. Pass
 * `pruneEmptyPlayheads: false` when the caller still needs to update playhead
 * geometry in the same change (then prune once after everything lands).
 */
export function commitClipMoves(
  doc: SpaceTimeDoc,
  moves: ReadonlyArray<{ clipId: string; x: number; y: number }>,
  options?: { pruneEmptyPlayheads?: boolean },
): void {
  for (const { clipId, x, y } of moves) {
    setClipPosition(doc, clipId, x, y);
  }
  if (options?.pruneEmptyPlayheads !== false) {
    removePlayheadsWithoutClips(doc);
  }
}

export function commitClipMove(
  doc: SpaceTimeDoc,
  clipId: string,
  x: number,
  y: number,
): void {
  setClipPosition(doc, clipId, x, y);
  removePlayheadsWithoutClips(doc);
}

export function commitClipResize(
  doc: SpaceTimeDoc,
  clipId: string,
  duration: number,
): void {
  const clip = findClip(doc, clipId);
  if (!clip) return;
  const minDur = Math.max(MIN_CLIP_DURATION, minDurationKeepingMarkers(clip));
  clip.duration = Math.max(minDur, duration);
}

export function commitClipTrimLeft(
  doc: SpaceTimeDoc,
  clipId: string,
  x: number,
  sourceInTime: number,
  duration: number,
): void {
  const clip = findClip(doc, clipId);
  if (!clip) return;
  const maxIn = maxSourceInKeepingMarkers(clip);
  const clampedIn = Math.min(sourceInTime, maxIn);
  // If we had to pull sourceIn back, keep the right edge fixed by adjusting duration.
  const inDelta = sourceInTime - clampedIn;
  const adjustedDuration = duration + inDelta;
  const adjustedX = x - inDelta * PIXELS_PER_SECOND;
  const minDur = Math.max(MIN_CLIP_DURATION, minDurationKeepingMarkers({
    ...clip,
    sourceInTime: clampedIn <= 0 ? null : clampedIn,
  }));
  clip.x = adjustedX;
  clip.sourceInTime = clampedIn <= 0 ? null : clampedIn;
  clip.duration = Math.max(minDur, adjustedDuration);
}

export function splitClipAtX(
  doc: SpaceTimeDoc,
  clipId: string,
  splitX: number,
  playDuration: number,
): string | null {
  const clip = findClip(doc, clipId);
  if (!clip) return null;

  const leftDuration = (splitX - clip.x) / PIXELS_PER_SECOND;
  const rightDuration = playDuration - leftDuration;
  if (
    leftDuration < MIN_CLIP_DURATION ||
    rightDuration < MIN_CLIP_DURATION ||
    splitX <= clip.x ||
    splitX >= clip.x + clipWidth(clip, playDuration)
  ) {
    return null;
  }

  const sourceIn = clip.sourceInTime ?? 0;
  const rightSourceIn = sourceIn + leftDuration;

  // Don't split through a marker — markers must stay visible on a clip.
  for (const t of clipMarkers(clip)) {
    if (Math.abs(t - rightSourceIn) < 1e-6) return null;
  }

  const { left, right } = partitionMarkersAtSourceTime(clipMarkers(clip), rightSourceIn);

  clip.duration = leftDuration;
  if (left.length > 0) clip.markers = left;
  else delete clip.markers;

  const rightClip = newClip(
    clip.sourceId,
    splitX,
    clip.y,
    rightSourceIn <= 0 ? null : rightSourceIn,
    rightDuration,
  );
  if (clip.name) rightClip.name = clip.name;
  if (right.length > 0) rightClip.markers = right;

  const clipIndex = doc.clips.findIndex((c) => c.id === clipId);
  doc.clips.splice(clipIndex + 1, 0, rightClip);

  return rightClip.id;
}

export function deleteClip(doc: SpaceTimeDoc, clipId: string): void {
  const index = doc.clips.findIndex((c) => c.id === clipId);
  if (index >= 0) doc.clips.splice(index, 1);
  removePlayheadsWithoutClips(doc);
}

export function addClipToDoc(
  changeDoc: (fn: ChangeFn<SpaceTimeDoc>) => void,
  sourceId: string,
  x: number,
  y: number,
  duration: number | null,
): string | null {
  let newId: string | null = null;
  changeDoc((doc) => {
    const clip = newClip(sourceId, x, y, null, duration);
    doc.clips.push(clip);
    newId = clip.id;
  });
  return newId;
}

export function duplicateClipAt(clip: Clip): Clip {
  return cloneClip(clip);
}

export function commitClipDuplicate(
  doc: SpaceTimeDoc,
  clipId: string,
  sourceClipId: string,
  x: number,
  y: number,
): void {
  const source = findClip(doc, sourceClipId);
  if (!source) return;
  const clip = newClip(source.sourceId, x, y, source.sourceInTime, source.duration);
  clip.id = clipId;
  if (source.name) clip.name = source.name;
  if (source.markers && source.markers.length > 0) clip.markers = [...source.markers];
  doc.clips.push(clip);
}
