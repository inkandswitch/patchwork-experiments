import type { ClipRef, SequenceDoc } from '../types';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import { DEFAULT_CLIP_DURATION } from '../helpers';

import {
  ADD_TRACK_HEIGHT,
  HANDLE_WIDTH,
  PIXELS_PER_SECOND,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  timeToX,
  totalCanvasHeight,
  trackTop,
  tracksAreaHeight,
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

export type TrackLabelLayout = {
  trackId: string;
  trackIndex: number;
  y: number;
  height: number;
  label: string;
  removeButton: { x: number; y: number; width: number; height: number };
};

export type AddTrackButtonLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TimelineLayout = {
  width: number;
  height: number;
  scrollX: number;
  duration: number;
  clips: ClipLayout[];
  trackLabels: TrackLabelLayout[];
  addTrackButton: AddTrackButtonLayout;
  playheadX: number;
};

export type HitTarget =
  | { kind: 'clip-body'; ref: ClipRef }
  | { kind: 'clip-left-handle'; ref: ClipRef }
  | { kind: 'clip-right-handle'; ref: ClipRef }
  | { kind: 'track-remove'; trackId: string }
  | { kind: 'add-track' }
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
  const trackLabels: TrackLabelLayout[] = [];

  doc.tracks.forEach((track, trackIndex) => {
    const y = trackTop(trackIndex);
    trackLabels.push({
      trackId: track.id,
      trackIndex,
      y,
      height: TRACK_HEIGHT,
      label: `Track ${trackIndex + 1}`,
      removeButton: {
        x: TRACK_LABEL_WIDTH - 28,
        y: y + 10,
        width: 18,
        height: 18,
      },
    });

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
    trackLabels,
    addTrackButton: {
      x: 8,
      y: RULER_HEIGHT + tracksAreaHeight(doc.tracks.length) - ADD_TRACK_HEIGHT + 4,
      width: TRACK_LABEL_WIDTH - 16,
      height: ADD_TRACK_HEIGHT - 8,
    },
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
  if (pointInRect(x, y, layout.addTrackButton)) {
    return { kind: 'add-track' };
  }

  for (const trackLabel of layout.trackLabels) {
    if (pointInRect(x, y, trackLabel.removeButton)) {
      return { kind: 'track-remove', trackId: trackLabel.trackId };
    }
  }

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
