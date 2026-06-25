import type { ChangeFn } from '@automerge/automerge/slim';
import type { Clip, SpaceTimeDoc } from '../types';
import { cloneClip, findClip, newClip } from '../helpers';
import { MIN_CLIP_DURATION, PIXELS_PER_SECOND } from './constants';
import { clipWidth } from '../clip-timing';
import { removePlayheadsWithoutClips } from './playheads';

export function commitClipMoves(
  doc: SpaceTimeDoc,
  moves: ReadonlyArray<{ clipId: string; x: number; y: number }>,
): void {
  for (const { clipId, x, y } of moves) {
    commitClipMove(doc, clipId, x, y);
  }
}

export function commitClipMove(
  doc: SpaceTimeDoc,
  clipId: string,
  x: number,
  y: number,
): void {
  const clip = findClip(doc, clipId);
  if (!clip) return;
  clip.x = x;
  clip.y = y;
  removePlayheadsWithoutClips(doc);
}

export function commitClipResize(
  doc: SpaceTimeDoc,
  clipId: string,
  duration: number,
): void {
  const clip = findClip(doc, clipId);
  if (!clip) return;
  clip.duration = Math.max(MIN_CLIP_DURATION, duration);
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
  clip.x = x;
  clip.sourceInTime = sourceInTime <= 0 ? null : sourceInTime;
  clip.duration = Math.max(MIN_CLIP_DURATION, duration);
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

  clip.duration = leftDuration;

  const rightClip = newClip(
    clip.sourceId,
    splitX,
    clip.y,
    rightSourceIn <= 0 ? null : rightSourceIn,
    rightDuration,
  );
  if (clip.name) rightClip.name = clip.name;

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
  doc.clips.push(clip);
}
