import type { SpaceTimeDoc, Playhead } from '../types';
import { findClip, findPlayhead, newClip, newPlayhead } from '../helpers';
import { MIN_PLAYHEAD_HEIGHT } from './constants';
import { clipsInPlayheadExtent } from './playhead-extent';

/** True when the playhead's connected extent contains at least one clip. */
export function playheadHasClipsInExtent(doc: SpaceTimeDoc, playhead: Playhead): boolean {
  return clipsInPlayheadExtent(doc, playhead, new Map()).length > 0;
}

export function removePlayheadsWithoutClips(doc: SpaceTimeDoc): void {
  for (let i = doc.playheads.length - 1; i >= 0; i--) {
    if (!playheadHasClipsInExtent(doc, doc.playheads[i]!)) {
      doc.playheads.splice(i, 1);
    }
  }
}

export function createPlayhead(
  doc: SpaceTimeDoc,
  x: number,
  y0: number,
  y1: number,
): string | null {
  const y = Math.min(y0, y1);
  const height = Math.abs(y1 - y0);
  if (height < MIN_PLAYHEAD_HEIGHT) return null;

  const playhead = newPlayhead(x, y, height);
  // Reject playheads whose extent would be empty (no connected clips).
  if (!playheadHasClipsInExtent(doc, playhead)) return null;

  doc.playheads.push(playhead);
  return playhead.id;
}

export function commitPlayheadPosition(
  doc: SpaceTimeDoc,
  playheadId: string,
  x: number,
  y: number,
): void {
  const playhead = findPlayhead(doc, playheadId);
  if (!playhead) return;
  playhead.x = x;
  playhead.y = y;
}

/** Update origin x/y and vertical band height together (origin drag / resize). */
export function commitPlayheadGeometry(
  doc: SpaceTimeDoc,
  playheadId: string,
  x: number,
  y: number,
  height: number,
): void {
  const playhead = findPlayhead(doc, playheadId);
  if (!playhead) return;
  playhead.x = x;
  playhead.y = y;
  playhead.height = Math.max(MIN_PLAYHEAD_HEIGHT, height);
}

export function commitPlayheadOriginX(
  doc: SpaceTimeDoc,
  playheadId: string,
  x: number,
): void {
  const playhead = findPlayhead(doc, playheadId);
  if (!playhead) return;
  playhead.x = x;
}

export function deletePlayhead(doc: SpaceTimeDoc, playheadId: string): void {
  const index = doc.playheads.findIndex((ph) => ph.id === playheadId);
  if (index >= 0) doc.playheads.splice(index, 1);
}

export function getPlayhead(doc: SpaceTimeDoc, playheadId: string) {
  return findPlayhead(doc, playheadId);
}

export function commitPlayheadDuplicate(
  doc: SpaceTimeDoc,
  playheadId: string,
  x: number,
  y: number,
  height: number,
  clipDuplicates: ReadonlyArray<{ clipId: string; sourceClipId: string; x: number; y: number }>,
): void {
  doc.playheads.push({ id: playheadId, x, y, height });
  for (const { clipId, sourceClipId, x: clipX, y: clipY } of clipDuplicates) {
    const source = findClip(doc, sourceClipId);
    if (!source) continue;
    const clip = newClip(source.sourceId, clipX, clipY, source.sourceInTime, source.duration);
    clip.id = clipId;
    if (source.name) clip.name = source.name;
    if (source.markers && source.markers.length > 0) clip.markers = [...source.markers];
    doc.clips.push(clip);
  }
}
