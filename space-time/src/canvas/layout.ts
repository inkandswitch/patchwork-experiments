import type { GhostPlayhead } from '../presence/types';
import type { RecordingPreview } from '../audio/use-audio-recorder';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import type { Clip, Playhead, PostIt, Scribble, Source, SpaceTimeDoc } from '../types';
import { clipDisplayName, DEFAULT_IMAGE_DURATION } from '../helpers';
import { clipWidth, sourceSkip } from '../clip-timing';
import { clipsInPlayheadExtent, extentBoxRightEdge, maxEndXForPlayhead } from './playhead-extent';
import { clipMarkers, markerPageX, visibleMarkerPageXs } from './clip-markers';
import {
  CLIP_HEIGHT,
  HANDLE_WIDTH,
  MIN_HANDLE_HIT_SCREEN_PX,
  PIXELS_PER_SECOND,
  rangesOverlap,
  type Camera,
} from './constants';

export type ClipLayout = {
  clipId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  duration: number;
  sourceId: string;
  sourceType: Source['type'];
  /** Offset (seconds) into the source where this clip begins; null = start. */
  sourceInTime: number | null;
  /** Marker times in seconds into the source. */
  markerSourceTimes: number[];
  /** Page-x positions of those markers that fall in the visible window. */
  markerXs: number[];
};

export type PlayheadLayout = {
  playheadId: string;
  x: number;
  y: number;
  height: number;
  currentX: number;
  maxEndX: number;
  active: boolean;
  looping: boolean;
};

export type GhostPlayheadLayout = GhostPlayhead & {
  maxEndX: number;
};

export type RecordingPreviewLayout = RecordingPreview & {
  width: number;
  height: number;
};

export type PostItLayout = PostIt & {
  postItId: string;
};

export type InlineImageLayout = {
  imageId: string;
  sourceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScribbleLayout = Scribble & {
  scribbleId: string;
  bounds: { x: number; y: number; width: number; height: number };
};

export type CanvasLayout = {
  width: number;
  height: number;
  camera: Camera;
  clips: ClipLayout[];
  playheads: PlayheadLayout[];
  ghostPlayheads: GhostPlayheadLayout[];
  recordingPreview: RecordingPreviewLayout | null;
  postIts: PostItLayout[];
  scribbles: ScribbleLayout[];
  inlineImages: InlineImageLayout[];
};

export type ClipDragPreview = {
  clipId: string;
  x: number;
  y: number;
  duration: number;
  sourceInTime?: number | null;
  label: string;
};

export type HitTarget =
  | { kind: 'clip-body'; clipId: string }
  | { kind: 'clip-left-handle'; clipId: string }
  | { kind: 'clip-right-handle'; clipId: string }
  | { kind: 'clip-marker'; clipId: string; sourceTime: number }
  | { kind: 'playhead'; playheadId: string }
  | { kind: 'post-it'; postItId: string }
  | { kind: 'post-it-resize'; postItId: string }
  | { kind: 'scribble'; scribbleId: string }
  | { kind: 'inline-image'; imageId: string }
  | { kind: 'inline-image-resize'; imageId: string }
  | { kind: 'none' };

export function computeClipLayout(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  clip: Clip,
): ClipLayout {
  const clipTiming = timing.get(clip.id);
  const duration = clip.duration ?? clipTiming?.playDuration ?? DEFAULT_IMAGE_DURATION;
  const sourceIn = sourceSkip(clip);
  const markerSourceTimes = clipMarkers(clip);
  return {
    clipId: clip.id,
    x: clip.x,
    y: clip.y,
    width: clipWidth(clip, duration),
    height: CLIP_HEIGHT,
    label: clipDisplayName(doc, clip),
    duration,
    sourceId: clip.sourceId,
    sourceType: doc.sources[clip.sourceId]?.type ?? 'video',
    sourceInTime: clip.sourceInTime,
    markerSourceTimes,
    markerXs: visibleMarkerPageXs(markerSourceTimes, clip.x, sourceIn, duration),
  };
}

export function maxEndXForBounds(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  bounds: { x: number; y: number; height: number },
): number {
  let max = bounds.x;
  for (const clip of doc.clips) {
    const layout = computeClipLayout(doc, timing, clip);
    if (!rangesOverlap(layout.y, layout.y + layout.height, bounds.y, bounds.y + bounds.height)) {
      continue;
    }
    max = Math.max(max, layout.x + layout.width);
  }
  return max;
}

export function computeCanvasLayout(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  playheadCurrentX: Map<string, number>,
  activePlayheadId: string | null,
  ghostPlayheads: GhostPlayhead[] = [],
  recordingPreview: RecordingPreview | null = null,
  loopingPlayheadIds: ReadonlySet<string> = new Set(),
): CanvasLayout {
  const clips = doc.clips
    .map((clip) => computeClipLayout(doc, timing, clip))
    .sort((a, b) => a.y - b.y);

  const playheads = doc.playheads.map((ph) => ({
    playheadId: ph.id,
    x: ph.x,
    y: ph.y,
    height: ph.height,
    currentX: playheadCurrentX.get(ph.id) ?? ph.x,
    maxEndX: maxEndXForPlayhead(doc, timing, ph),
    active: ph.id === activePlayheadId,
    looping: loopingPlayheadIds.has(ph.id),
  }));

  const ghostLayouts = ghostPlayheads.map((ghost) => ({
    ...ghost,
    maxEndX: maxEndXForBounds(doc, timing, ghost),
  }));

  return {
    width: viewportWidth,
    height: viewportHeight,
    camera,
    clips,
    playheads,
    ghostPlayheads: ghostLayouts,
    recordingPreview: recordingPreview
      ? {
          ...recordingPreview,
          width: Math.max(12, recordingPreview.duration * PIXELS_PER_SECOND),
          height: CLIP_HEIGHT,
        }
      : null,
    postIts: (doc.postIts ?? []).map((postIt) => ({
      ...postIt,
      postItId: postIt.id,
    })),
    scribbles: (doc.scribbles ?? []).map((scribble) => ({
      ...scribble,
      scribbleId: scribble.id,
      bounds: boundsForOutline(scribble.outline),
    })),
    inlineImages: (doc.images ?? []).map((image) => ({
      imageId: image.id,
      sourceId: image.sourceId,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    })),
  };
}

export function applyClipDragPreview(
  layout: CanvasLayout,
  preview: ClipDragPreview,
): CanvasLayout {
  const original = layout.clips.find((clip) => clip.clipId === preview.clipId);
  const clips = layout.clips.filter((clip) => clip.clipId !== preview.clipId);
  const sourceIn = preview.sourceInTime ?? original?.sourceInTime ?? 0;
  const markerSourceTimes = original?.markerSourceTimes ?? [];
  clips.push({
    clipId: preview.clipId,
    x: preview.x,
    y: preview.y,
    width: Math.max(12, preview.duration * PIXELS_PER_SECOND),
    height: CLIP_HEIGHT,
    label: preview.label,
    duration: preview.duration,
    sourceId: original?.sourceId ?? '',
    sourceType: original?.sourceType ?? 'video',
    sourceInTime: preview.sourceInTime ?? original?.sourceInTime ?? null,
    markerSourceTimes,
    markerXs: visibleMarkerPageXs(markerSourceTimes, preview.x, sourceIn ?? 0, preview.duration),
  });
  clips.sort((a, b) => a.y - b.y);
  return recomputePlayheadExtents({
    ...layout,
    clips,
    ghostPlayheads: layout.ghostPlayheads,
    recordingPreview: layout.recordingPreview,
  });
}

/** Refresh every playhead's extent box from the layout's current clip rects. */
function recomputePlayheadExtents(layout: CanvasLayout): CanvasLayout {
  return {
    ...layout,
    playheads: layout.playheads.map((ph) => ({
      ...ph,
      maxEndX: extentBoxRightEdge(
        ph,
        layout.clips,
        layout.playheads.filter((other) => other.playheadId !== ph.playheadId),
      ),
    })),
  };
}

export function applyClipDragPreviews(
  layout: CanvasLayout,
  previews: ClipDragPreview[],
): CanvasLayout {
  return previews.reduce((next, preview) => applyClipDragPreview(next, preview), layout);
}

export type PlayheadMovePreview = {
  playheadId: string;
  x: number;
  y: number;
  currentX: number;
  height: number;
};

export function applyPlayheadMovePreview(
  layout: CanvasLayout,
  clipPreviews: ClipDragPreview[],
  playheadPreview: PlayheadMovePreview,
): CanvasLayout {
  const withClips = applyClipDragPreviews(layout, clipPreviews);
  // Only the clips moving with this playhead define its box. Using every
  // vertically-overlapping clip (including a neighbour's) would let the box
  // stretch to the next playhead once the gap shrinks below 5s mid-drag.
  const maxEndX = extentBoxRightEdge(
    playheadPreview,
    clipPreviews.map((preview) => ({
      x: preview.x,
      y: preview.y,
      width: Math.max(12, preview.duration * PIXELS_PER_SECOND),
      height: CLIP_HEIGHT,
    })),
    withClips.playheads.filter((ph) => ph.playheadId !== playheadPreview.playheadId),
  );

  return {
    ...withClips,
    playheads: withClips.playheads.map((ph) =>
      ph.playheadId === playheadPreview.playheadId
        ? {
            ...ph,
            x: playheadPreview.x,
            y: playheadPreview.y,
            height: playheadPreview.height,
            currentX: playheadPreview.currentX,
            maxEndX,
          }
        : ph,
    ),
  };
}

export function applyPlayheadDuplicatePreview(
  layout: CanvasLayout,
  clipPreviews: ClipDragPreview[],
  playheadPreview: PlayheadMovePreview,
): CanvasLayout {
  const withClips = applyClipDragPreviews(layout, clipPreviews);
  let maxEndX = playheadPreview.x;
  for (const preview of clipPreviews) {
    maxEndX = Math.max(maxEndX, preview.x + Math.max(12, preview.duration * PIXELS_PER_SECOND));
  }

  return {
    ...withClips,
    playheads: [
      ...withClips.playheads.map((ph) => ({ ...ph, active: false })),
      {
        playheadId: playheadPreview.playheadId,
        x: playheadPreview.x,
        y: playheadPreview.y,
        height: playheadPreview.height,
        currentX: playheadPreview.currentX,
        maxEndX,
        active: true,
        looping: false,
      },
    ],
  };
}

export function applyPostItResizePreview(
  layout: CanvasLayout,
  preview: { postItId: string; width: number; height: number },
): CanvasLayout {
  return {
    ...layout,
    postIts: layout.postIts.map((postIt) =>
      postIt.postItId === preview.postItId
        ? { ...postIt, width: preview.width, height: preview.height }
        : postIt,
    ),
  };
}

export function applyPostItMovePreview(
  layout: CanvasLayout,
  preview: { postItId: string; x: number; y: number },
): CanvasLayout {
  return {
    ...layout,
    postIts: layout.postIts.map((postIt) =>
      postIt.postItId === preview.postItId ? { ...postIt, x: preview.x, y: preview.y } : postIt,
    ),
  };
}

export function applyInlineImageMovePreview(
  layout: CanvasLayout,
  preview: { imageId: string; x: number; y: number },
): CanvasLayout {
  return {
    ...layout,
    inlineImages: layout.inlineImages.map((img) =>
      img.imageId === preview.imageId ? { ...img, x: preview.x, y: preview.y } : img,
    ),
  };
}

export function applyInlineImageResizePreview(
  layout: CanvasLayout,
  preview: { imageId: string; width: number; height: number },
): CanvasLayout {
  return {
    ...layout,
    inlineImages: layout.inlineImages.map((img) =>
      img.imageId === preview.imageId
        ? { ...img, width: preview.width, height: preview.height }
        : img,
    ),
  };
}

export function applyMarkerMovePreview(
  layout: CanvasLayout,
  preview: { clipId: string; originalSourceTime: number; sourceTime: number },
): CanvasLayout {
  return {
    ...layout,
    clips: layout.clips.map((clip) => {
      if (clip.clipId !== preview.clipId) return clip;
      const markerSourceTimes = clip.markerSourceTimes.map((t) =>
        Math.abs(t - preview.originalSourceTime) < 1e-6 ? preview.sourceTime : t,
      );
      const sourceIn = clip.sourceInTime ?? 0;
      return {
        ...clip,
        markerSourceTimes,
        markerXs: visibleMarkerPageXs(markerSourceTimes, clip.x, sourceIn, clip.duration),
      };
    }),
  };
}

export function applyScribbleMovePreview(
  layout: CanvasLayout,
  preview: { scribbleId: string; outline: number[][] },
): CanvasLayout {
  return {
    ...layout,
    scribbles: layout.scribbles.map((scribble) =>
      scribble.scribbleId === preview.scribbleId
        ? {
            ...scribble,
            outline: preview.outline,
            bounds: boundsForOutline(preview.outline),
          }
        : scribble,
    ),
  };
}

export function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function boundsForOutline(outline: number[][]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (outline.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = outline[0]![0]!;
  let minY = outline[0]![1]!;
  let maxX = minX;
  let maxY = minY;
  for (const [px, py] of outline) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(x: number, y: number, polygon: number[][]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0]!;
    const yi = polygon[i]![1]!;
    const xj = polygon[j]![0]!;
    const yj = polygon[j]![1]!;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPlayheadPath(
  layout: CanvasLayout,
  pageX: number,
  pageY: number,
  ph: PlayheadLayout,
): boolean {
  if (pageY < ph.y || pageY > ph.y + ph.height) return false;
  const pathLeft = Math.min(ph.x, ph.currentX);
  const pathRight = ph.maxEndX;
  return pageX >= pathLeft && pageX <= pathRight;
}

export function hitTestCanvas(
  layout: CanvasLayout,
  pageX: number,
  pageY: number,
): HitTarget {
  const handleHit = Math.max(HANDLE_WIDTH, MIN_HANDLE_HIT_SCREEN_PX / layout.camera.z);

  for (const postIt of [...layout.postIts].reverse()) {
    const resizeHandle = {
      x: postIt.x + postIt.width - handleHit,
      y: postIt.y + postIt.height - handleHit,
      width: handleHit,
      height: handleHit,
    };
    if (pointInRect(pageX, pageY, resizeHandle)) {
      return { kind: 'post-it-resize', postItId: postIt.postItId };
    }
    if (
      pointInRect(pageX, pageY, {
        x: postIt.x,
        y: postIt.y,
        width: postIt.width,
        height: postIt.height,
      })
    ) {
      return { kind: 'post-it', postItId: postIt.postItId };
    }
  }

  for (const clip of [...layout.clips].reverse()) {
    // Markers sit on the top edge and must win over the clip body / handles.
    const markerHit = Math.max(7, MIN_HANDLE_HIT_SCREEN_PX / layout.camera.z);
    const sourceIn = clip.sourceInTime ?? 0;
    for (const sourceTime of clip.markerSourceTimes) {
      if (sourceTime < sourceIn - 1e-9 || sourceTime > sourceIn + clip.duration + 1e-9) continue;
      const mx = markerPageX(clip.x, sourceIn, sourceTime);
      if (
        pointInRect(pageX, pageY, {
          x: mx - markerHit / 2,
          y: clip.y - 2 / layout.camera.z,
          width: markerHit,
          height: markerHit,
        })
      ) {
        return { kind: 'clip-marker', clipId: clip.clipId, sourceTime };
      }
    }

    const rightHandle = {
      x: clip.x + clip.width - handleHit,
      y: clip.y,
      width: handleHit,
      height: clip.height,
    };
    const leftHandle = {
      x: clip.x,
      y: clip.y,
      width: handleHit,
      height: clip.height,
    };

    if (pointInRect(pageX, pageY, rightHandle)) {
      return { kind: 'clip-right-handle', clipId: clip.clipId };
    }
    if (pointInRect(pageX, pageY, leftHandle)) {
      return { kind: 'clip-left-handle', clipId: clip.clipId };
    }
    const body = {
      x: clip.x + handleHit,
      y: clip.y,
      width: Math.max(0, clip.width - handleHit * 2),
      height: clip.height,
    };
    if (body.width > 0 && pointInRect(pageX, pageY, body)) {
      return { kind: 'clip-body', clipId: clip.clipId };
    }
  }

  for (const scribble of [...layout.scribbles].reverse()) {
    if (pointInPolygon(pageX, pageY, scribble.outline)) {
      return { kind: 'scribble', scribbleId: scribble.scribbleId };
    }
  }

  // Inline images sit behind clips visually, but stay grabbable over a
  // playhead band, so they're tested after clips/notes and before playheads.
  for (const image of [...layout.inlineImages].reverse()) {
    const resizeHandle = {
      x: image.x + image.width - handleHit,
      y: image.y + image.height - handleHit,
      width: handleHit,
      height: handleHit,
    };
    if (pointInRect(pageX, pageY, resizeHandle)) {
      return { kind: 'inline-image-resize', imageId: image.imageId };
    }
    if (
      pointInRect(pageX, pageY, {
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
      })
    ) {
      return { kind: 'inline-image', imageId: image.imageId };
    }
  }

  // The playhead's clickable "path" band spans the full width of the clips in
  // its extent, so it is tested last: any clip/post-it/scribble under the
  // pointer takes precedence, and only empty band area moves the playhead.
  for (const ph of [...layout.playheads].reverse()) {
    if (pointInPlayheadPath(layout, pageX, pageY, ph)) {
      return { kind: 'playhead', playheadId: ph.playheadId };
    }
  }

  return { kind: 'none' };
}

export function clipTouchesPlayhead(
  clip: ClipLayout,
  playhead: Playhead,
): boolean {
  return rangesOverlap(clip.y, clip.y + clip.height, playhead.y, playhead.y + playhead.height);
}

export { maxEndXForPlayhead } from './playhead-extent';

const PLAYHEAD_JUMP_EPSILON_PX = 0.5;

/** Unique clip start/end x positions in playhead extent, plus the playhead origin. */
export function playheadJumpEdges(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
): number[] {
  const edges = new Set<number>([playhead.x]);
  for (const clip of clipsInPlayheadExtent(doc, playhead, timing)) {
    const layout = computeClipLayout(doc, timing, clip);
    edges.add(layout.x);
    edges.add(layout.x + layout.width);
    for (const mx of layout.markerXs) edges.add(mx);
  }
  return [...edges].sort((a, b) => a - b);
}

export function clipStartBeforePlayhead(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
  currentX: number,
): number | null {
  let best: number | null = null;
  for (const x of playheadJumpEdges(doc, timing, playhead)) {
    if (x >= currentX - PLAYHEAD_JUMP_EPSILON_PX) continue;
    if (best === null || x > best) best = x;
  }
  return best;
}

export function clipStartAfterPlayhead(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  playhead: Playhead,
  currentX: number,
): number | null {
  let best: number | null = null;
  for (const x of playheadJumpEdges(doc, timing, playhead)) {
    if (x <= currentX + PLAYHEAD_JUMP_EPSILON_PX) continue;
    if (best === null || x < best) best = x;
  }
  return best;
}

export function verticalLineIntersectsClip(
  lineX: number,
  lineY0: number,
  lineY1: number,
  clip: ClipLayout,
): boolean {
  const yMin = Math.min(lineY0, lineY1);
  const yMax = Math.max(lineY0, lineY1);
  if (!rangesOverlap(yMin, yMax, clip.y, clip.y + clip.height)) return false;
  return lineX >= clip.x && lineX <= clip.x + clip.width;
}

export function segmentCrossesClip(
  lineX: number,
  y0: number,
  y1: number,
  clip: ClipLayout,
): boolean {
  return verticalLineIntersectsClip(lineX, y0, y1, clip);
}
