import type { ClipRef, SequenceDoc } from '../types';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import type { PendingClip } from '../drag';
import type { TrackDropTarget } from './tracks';
import { DEFAULT_CLIP_DURATION } from '../helpers';

import {
  HANDLE_WIDTH,
  PIXELS_PER_SECOND,
  RULER_HEIGHT,
  TRACK_EDGE_PADDING,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  timeToX,
  totalCanvasHeight,
  trackTop,
} from './constants';

export type ClipLayout = ClipRef & {
  trackIndex: number;
  start: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export type TimelineLayout = {
  width: number;
  height: number;
  scrollX: number;
  duration: number;
  clips: ClipLayout[];
  playheadX: number;
};

export type GhostClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** Highlighted band showing which track (or new-track gap) the clip will land on. */
  highlight: { y: number; height: number };
};

/** Layout for the translucent preview of a clip being dragged in from the source monitor. */
export function computeGhostLayout(
  payload: PendingClip,
  time: number,
  dropTarget: TrackDropTarget,
  scrollX: number,
  trackCount: number,
): GhostClip {
  const width = Math.max(12, payload.duration * PIXELS_PER_SECOND);
  const x = timeToX(Math.max(0, time), scrollX);

  let rowTop: number;
  let highlight: { y: number; height: number };
  if (dropTarget.kind === 'track') {
    rowTop = trackTop(dropTarget.index);
    highlight = { y: rowTop, height: TRACK_HEIGHT };
  } else if (dropTarget.kind === 'insert-above') {
    rowTop = RULER_HEIGHT + TRACK_EDGE_PADDING - TRACK_HEIGHT;
    highlight = { y: RULER_HEIGHT, height: TRACK_EDGE_PADDING };
  } else {
    rowTop = trackTop(trackCount);
    highlight = { y: rowTop, height: TRACK_EDGE_PADDING };
  }

  return {
    x,
    y: rowTop + 6,
    width,
    height: TRACK_HEIGHT - 12,
    label: payload.label,
    highlight,
  };
}

export type HitTarget =
  | { kind: 'clip-body'; ref: ClipRef }
  | { kind: 'clip-left-handle'; ref: ClipRef }
  | { kind: 'clip-right-handle'; ref: ClipRef }
  | { kind: 'ruler' }
  | { kind: 'playhead' }
  | { kind: 'none' };

export function computeTimelineLayout(
  doc: SequenceDoc,
  timing: Map<string, ClipTimingInfo>,
  scrollX: number,
  canvasWidth: number,
  currentTime: number,
  sequenceDuration: number,
): TimelineLayout {
  const clips: ClipLayout[] = [];

  doc.tracks.forEach((track, trackIndex) => {
    const y = trackTop(trackIndex);

    for (const clip of track.clips) {
      const clipTiming = timing.get(clip.id);
      const playDuration = clip.duration ?? clipTiming?.playDuration ?? DEFAULT_CLIP_DURATION;
      const source = doc.sources[clip.sourceId];
      const sourceLabel = source?.type ?? 'clip';
      clips.push({
        trackId: track.id,
        clipId: clip.id,
        trackIndex,
        start: clip.time,
        duration: playDuration,
        x: timeToX(clip.time, scrollX),
        y: y + 6,
        width: Math.max(12, playDuration * PIXELS_PER_SECOND),
        height: TRACK_HEIGHT - 12,
        label: sourceLabel,
      });
    }
  });

  const contentDuration = Math.max(
    sequenceDuration,
    ...clips.map((clip) => clip.start + clip.duration),
    1,
  );

  return {
    width: canvasWidth,
    height: totalCanvasHeight(doc.tracks.length),
    scrollX,
    duration: contentDuration,
    clips,
    playheadX: timeToX(currentTime, scrollX),
  };
}

export function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function hitTestTimeline(layout: TimelineLayout, x: number, y: number): HitTarget {
  if (x >= TRACK_LABEL_WIDTH && Math.abs(x - layout.playheadX) <= 6) {
    return { kind: 'playhead' };
  }

  for (const clip of layout.clips) {
    const rightHandle = {
      x: clip.x + clip.width - HANDLE_WIDTH,
      y: clip.y,
      width: HANDLE_WIDTH,
      height: clip.height,
    };
    const leftHandle = {
      x: clip.x,
      y: clip.y,
      width: HANDLE_WIDTH,
      height: clip.height,
    };

    if (pointInRect(x, y, rightHandle)) {
      return { kind: 'clip-right-handle', ref: { trackId: clip.trackId, clipId: clip.clipId } };
    }
    if (pointInRect(x, y, leftHandle)) {
      return { kind: 'clip-left-handle', ref: { trackId: clip.trackId, clipId: clip.clipId } };
    }
    if (pointInRect(x, y, clip)) {
      return { kind: 'clip-body', ref: { trackId: clip.trackId, clipId: clip.clipId } };
    }
  }

  if (y < RULER_HEIGHT && x >= TRACK_LABEL_WIDTH) {
    return { kind: 'ruler' };
  }

  return { kind: 'none' };
}

export function clipRefEquals(a: ClipRef | null | undefined, b: ClipRef | null | undefined): boolean {
  return !!a && !!b && a.trackId === b.trackId && a.clipId === b.clipId;
}
