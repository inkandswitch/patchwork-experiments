import type { Clip, ClipRef, SequenceDoc } from '../types';
import type { PendingClip } from '../drag';
import { findClip, newClip, newTrack } from '../helpers';
import { MIN_CLIP_DURATION, RULER_HEIGHT, TRACK_EDGE_PADDING, TRACK_HEIGHT } from './constants';

export type TrackDropTarget =
  | { kind: 'track'; index: number }
  | { kind: 'insert-above' }
  | { kind: 'insert-below' };

export type EdgeTracksDuringDrag = {
  above?: string;
  below?: string;
};

/** Visual track row for a clip preview while dragging (does not mutate the doc). */
export function previewTrackIndexFromDropTarget(
  dropTarget: TrackDropTarget,
  fromTrackIndex: number,
  fromTrackClipCount: number,
  trackCount: number,
): number {
  if (dropTarget.kind === 'track') {
    return dropTarget.index;
  }
  if (dropTarget.kind === 'insert-above') {
    if (fromTrackIndex === 0 && fromTrackClipCount === 1) {
      return 0;
    }
    return -1;
  }
  if (fromTrackIndex === trackCount - 1 && fromTrackClipCount === 1) {
    return fromTrackIndex;
  }
  return trackCount;
}

/** Sorted unique start/end times for clips across all tracks. */
export function allClipEdges(
  doc: SequenceDoc,
  playDurationForClip: (clip: Clip) => number,
  excludeClipId: string | null = null,
): number[] {
  const edges: number[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      const duration = playDurationForClip(clip);
      edges.push(clip.time, clip.time + duration);
    }
  }
  edges.sort((a, b) => a - b);

  const unique: number[] = [];
  for (const edge of edges) {
    const last = unique[unique.length - 1];
    if (last === undefined || edge - last > 1e-9) {
      unique.push(edge);
    }
  }
  return unique;
}

/** Start/end times of other clips in the sequence, for edge snapping while dragging. */
export function clipEdgeSnapTargets(
  doc: SequenceDoc,
  excludeClipId: string | null,
  playDurationForClip: (clip: Clip) => number,
): number[] {
  return allClipEdges(doc, playDurationForClip, excludeClipId);
}

/** Next or previous clip boundary relative to the current playhead time. */
export function adjacentClipEdgeTime(
  edges: readonly number[],
  currentTime: number,
  direction: 'previous' | 'next',
): number | null {
  if (direction === 'next') {
    for (const edge of edges) {
      if (edge > currentTime) return edge;
    }
    return null;
  }

  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i]!;
    if (edge < currentTime) return edge;
  }
  return null;
}

export function trackDropTargetFromY(y: number, trackCount: number): TrackDropTarget {
  const tracksTop = RULER_HEIGHT + TRACK_EDGE_PADDING;
  if (y < tracksTop) {
    return { kind: 'insert-above' };
  }
  const relY = y - tracksTop;
  if (relY >= trackCount * TRACK_HEIGHT) {
    return { kind: 'insert-below' };
  }
  return { kind: 'track', index: Math.floor(relY / TRACK_HEIGHT) };
}

/** Plain-object copy so a clip can be inserted on another track (Automerge rejects re-inserting proxies). */
function copyClip(clip: Clip): Clip {
  return {
    id: clip.id,
    name: clip.name,
    sourceId: clip.sourceId,
    time: clip.time,
    sourceInTime: clip.sourceInTime,
    duration: clip.duration,
  };
}

export function pruneEmptyTracks(doc: SequenceDoc): void {
  for (let i = doc.tracks.length - 1; i >= 0; i--) {
    if (doc.tracks[i]!.clips.length === 0) {
      doc.tracks.splice(i, 1);
    }
  }
}

function resolveDestinationTrackId(
  doc: SequenceDoc,
  fromTrackIndex: number,
  dropTarget: TrackDropTarget,
  edgeTracks: EdgeTracksDuringDrag,
): string {
  const trackCount = doc.tracks.length;

  if (dropTarget.kind === 'track') {
    return doc.tracks[dropTarget.index]!.id;
  }

  if (dropTarget.kind === 'insert-above') {
    if (fromTrackIndex === 0) {
      // The dragged clip is alone in the uppermost track; adding a track above
      // would just recreate the same situation, so keep it where it is.
      if (doc.tracks[0]!.clips.length === 1) {
        return doc.tracks[0]!.id;
      }
      if (edgeTracks.above && doc.tracks.some((track) => track.id === edgeTracks.above)) {
        return edgeTracks.above;
      }
      const track = newTrack();
      doc.tracks.unshift(track);
      edgeTracks.above = track.id;
      return track.id;
    }
    return doc.tracks[0]!.id;
  }

  const lastIndex = trackCount - 1;
  if (fromTrackIndex === lastIndex) {
    // The dragged clip is alone in the lowest track; adding a track below
    // would just recreate the same situation, so keep it where it is.
    if (doc.tracks[lastIndex]!.clips.length === 1) {
      return doc.tracks[lastIndex]!.id;
    }
    if (edgeTracks.below && doc.tracks.some((track) => track.id === edgeTracks.below)) {
      return edgeTracks.below;
    }
    const track = newTrack();
    doc.tracks.push(track);
    edgeTracks.below = track.id;
    return track.id;
  }
  return doc.tracks[lastIndex]!.id;
}

export function moveClipToDropTarget(
  doc: SequenceDoc,
  ref: ClipRef,
  dropTarget: TrackDropTarget,
  edgeTracks: EdgeTracksDuringDrag,
): ClipRef | null {
  const fromTrackIndex = doc.tracks.findIndex((track) => track.id === ref.trackId);
  if (fromTrackIndex === -1) return null;

  const fromTrack = doc.tracks[fromTrackIndex]!;
  const clipIndex = fromTrack.clips.findIndex((clip) => clip.id === ref.clipId);
  if (clipIndex === -1) return null;

  const destTrackId = resolveDestinationTrackId(doc, fromTrackIndex, dropTarget, edgeTracks);
  if (destTrackId === ref.trackId) {
    return ref;
  }

  const clip = fromTrack.clips.splice(clipIndex, 1)[0]!;
  const destTrack = doc.tracks.find((track) => track.id === destTrackId);
  if (!destTrack) {
    fromTrack.clips.splice(clipIndex, 0, copyClip(clip));
    return null;
  }
  destTrack.clips.push(copyClip(clip));
  return { trackId: destTrackId, clipId: clip.id };
}

/** Insert a brand-new clip (dragged from the source monitor) at a drop target. */
export function createClipFromDrop(
  doc: SequenceDoc,
  payload: PendingClip,
  time: number,
  dropTarget: TrackDropTarget,
): ClipRef {
  const clip = newClip(
    payload.sourceId,
    Math.max(0, time),
    payload.sourceInTime <= 0 ? null : payload.sourceInTime,
    Math.max(MIN_CLIP_DURATION, payload.duration),
  );

  if (dropTarget.kind === 'track' && doc.tracks[dropTarget.index]) {
    const track = doc.tracks[dropTarget.index]!;
    track.clips.push(clip);
    return { trackId: track.id, clipId: clip.id };
  }

  // For a new track, attach the clip before inserting so the whole object graph is
  // serialized into the document at once. (Pushing into `track.clips` after insertion
  // would mutate the detached plain object, not the live Automerge proxy.)
  const track = newTrack();
  track.clips.push(clip);
  if (dropTarget.kind === 'insert-above') {
    doc.tracks.unshift(track);
  } else {
    doc.tracks.push(track);
  }
  return { trackId: track.id, clipId: clip.id };
}

export function commitClipMove(
  doc: SequenceDoc,
  ref: ClipRef,
  time: number,
  duration: number,
  dropTarget: TrackDropTarget,
  edgeTracks: EdgeTracksDuringDrag,
): ClipRef | null {
  const clip = findClip(doc, ref);
  if (!clip) return null;

  clip.time = Math.max(0, time);
  clip.duration = Math.max(MIN_CLIP_DURATION, duration);

  return moveClipToDropTarget(doc, ref, dropTarget, edgeTracks);
}

/** Split a clip at a sequence time; returns the new right-hand clip ref, or null if invalid. */
export function splitClipAtTime(
  doc: SequenceDoc,
  ref: ClipRef,
  splitTime: number,
  playDuration: number,
): ClipRef | null {
  const track = doc.tracks.find((t) => t.id === ref.trackId);
  const clip = findClip(doc, ref);
  if (!track || !clip) return null;

  const leftDuration = splitTime - clip.time;
  const rightDuration = playDuration - leftDuration;
  if (
    leftDuration < MIN_CLIP_DURATION ||
    rightDuration < MIN_CLIP_DURATION ||
    splitTime <= clip.time ||
    splitTime >= clip.time + playDuration
  ) {
    return null;
  }

  const sourceIn = clip.sourceInTime ?? 0;
  const rightSourceIn = sourceIn + leftDuration;

  clip.duration = leftDuration;

  const rightClip = newClip(
    clip.sourceId,
    splitTime,
    rightSourceIn <= 0 ? null : rightSourceIn,
    rightDuration,
  );

  const clipIndex = track.clips.findIndex((c) => c.id === ref.clipId);
  track.clips.splice(clipIndex + 1, 0, rightClip);

  return { trackId: track.id, clipId: rightClip.id };
}
