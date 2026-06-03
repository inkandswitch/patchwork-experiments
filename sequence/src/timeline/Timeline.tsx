import type { ChangeFn } from '@automerge/automerge/slim';
import type { ClipRef, SequenceDoc } from '../types';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSourceLoader, resolveTimelineClipTiming } from '../diffusion/sync-composition';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import { maxClipPlayDuration } from '../clip-timing';
import { DEFAULT_CLIP_DURATION } from '../helpers';
import {
  MIN_CLIP_DURATION,
  PIXELS_PER_SECOND,
  readTimelineTheme,
  totalCanvasHeight,
  xToTime,
} from './constants';
import { drawTimeline, maxScrollX } from './draw';
import { clipRefEquals, computeTimelineLayout, hitTestTimeline, type TimelineLayout } from './layout';
import { findClip } from '../helpers';
import {
  commitClipMove,
  pruneEmptyTracks,
  trackDropTargetFromY,
  type EdgeTracksDuringDrag,
} from './tracks';

import './timeline.css';

type DragState =
  | {
      kind: 'move';
      ref: ClipRef;
      pointerId: number;
      startPointerX: number;
      originalTime: number;
      originalDuration: number;
      edgeTracks: EdgeTracksDuringDrag;
    }
  | {
      kind: 'resize';
      ref: ClipRef;
      pointerId: number;
      startPointerX: number;
      originalTime: number;
      originalDuration: number;
      maxDuration: number;
    }
  | {
      kind: 'trim-left';
      ref: ClipRef;
      pointerId: number;
      startPointerX: number;
      originalTime: number;
      originalDuration: number;
      originalSourceInTime: number;
    }
  | {
      kind: 'playhead';
      pointerId: number;
    };

type TimelineProps = {
  doc: SequenceDoc;
  changeDoc: (changeFn: ChangeFn<SequenceDoc>) => void;
  currentTime: number;
  sequenceDuration: number;
  onSeek: (time: number) => void;
  onScrubStart?: () => void;
};

export function Timeline({
  doc,
  changeDoc,
  currentTime,
  sequenceDuration,
  onSeek,
  onScrubStart,
}: TimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<TimelineLayout | null>(null);
  const timingRef = useRef<Map<string, ClipTimingInfo>>(new Map());
  const loaderRef = useRef(createSourceLoader());
  const scrollXRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);

  const [selected, setSelected] = useState<ClipRef | null>(null);
  const [hovered, setHovered] = useState<ClipRef | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);

  const docSyncKey = JSON.stringify({ tracks: doc.tracks, sources: doc.sources });
  const bump = () => setFrame((n) => n + 1);

  const resolveClipPlayDurationForUi = (clipId: string, explicit: number | null) => {
    const timing = timingRef.current.get(clipId);
    return explicit ?? timing?.playDuration ?? DEFAULT_CLIP_DURATION;
  };

  useEffect(() => {
    void resolveTimelineClipTiming(doc, loaderRef.current).then((timing) => {
      timingRef.current = timing;
      bump();
    });
  }, [doc, docSyncKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const syncCanvasSize = () => {
      const { width, height } = root.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(totalCanvasHeight(doc.tracks.length), Math.floor(height));
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      scrollXRef.current = Math.min(scrollXRef.current, maxScrollX(sequenceDuration, w));

      const layout = computeTimelineLayout(
        doc,
        timingRef.current,
        scrollXRef.current,
        w,
        scrubTime ?? currentTime,
        sequenceDuration,
      );
      layoutRef.current = layout;

      const theme = readTimelineTheme(root);
      drawTimeline(ctx, theme, layout, doc.tracks.length, selected, hovered);
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(root);
    window.addEventListener('resize', syncCanvasSize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
    };
  }, [doc, docSyncKey, currentTime, scrubTime, sequenceDuration, selected, hovered, frame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selected) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      event.preventDefault();
      const ref = selected;
      changeDoc((d) => {
        const track = d.tracks.find((t) => t.id === ref.trackId);
        const clip = findClip(d, ref);
        if (!track || !clip) return;
        const clipIndex = track.clips.indexOf(clip);
        if (clipIndex === -1) return;
        track.clips.splice(clipIndex, 1);
        pruneEmptyTracks(d);
      });
      setSelected(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, changeDoc]);

  const canvasPoint = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const commitClipUpdate = (ref: ClipRef, time: number, duration: number) => {
    changeDoc((d) => {
      const clip = findClip(d, ref);
      if (!clip) return;
      clip.time = Math.max(0, time);
      clip.duration = Math.max(MIN_CLIP_DURATION, duration);
    });
  };

  const commitClipTrimLeft = (
    ref: ClipRef,
    time: number,
    sourceInTime: number,
    duration: number,
  ) => {
    changeDoc((d) => {
      const clip = findClip(d, ref);
      if (!clip) return;
      clip.time = Math.max(0, time);
      clip.sourceInTime = sourceInTime <= 0 ? null : Math.max(0, sourceInTime);
      clip.duration = Math.max(MIN_CLIP_DURATION, duration);
    });
  };

  const clampTrimLeftDelta = (drag: Extract<DragState, { kind: 'trim-left' }>, delta: number) => {
    const minDelta = Math.max(-drag.originalTime, -drag.originalSourceInTime);
    const maxDelta = drag.originalDuration - MIN_CLIP_DURATION;
    return Math.max(minDelta, Math.min(maxDelta, delta));
  };

  const seekFromX = (x: number) => {
    const maxTime = sequenceDuration > 0 ? sequenceDuration : Infinity;
    const time = Math.max(0, Math.min(maxTime, xToTime(x, scrollXRef.current)));
    setScrubTime(time);
    onSeek(time);
  };

  const startPlayheadScrub = (event: React.PointerEvent<HTMLCanvasElement>, x: number) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: 'playhead', pointerId: event.pointerId };
    onScrubStart?.();
    seekFromX(x);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const { x, y } = canvasPoint(event);
    const target = hitTestTimeline(layout, x, y);

    if (target.kind === 'ruler' || target.kind === 'playhead') {
      startPlayheadScrub(event, x);
      return;
    }

    if (
      target.kind === 'clip-body' ||
      target.kind === 'clip-right-handle' ||
      target.kind === 'clip-left-handle'
    ) {
      const clip = findClip(doc, target.ref);
      if (!clip) return;

      const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
      const maxDuration = maxClipPlayDuration(
        clip,
        timingRef.current.get(clip.id)?.sourceLength,
      );

      event.currentTarget.setPointerCapture(event.pointerId);

      if (target.kind === 'clip-body') {
        dragRef.current = {
          kind: 'move',
          ref: target.ref,
          pointerId: event.pointerId,
          startPointerX: x,
          originalTime: clip.time,
          originalDuration: playDuration,
          edgeTracks: {},
        };
      } else if (target.kind === 'clip-right-handle') {
        dragRef.current = {
          kind: 'resize',
          ref: target.ref,
          pointerId: event.pointerId,
          startPointerX: x,
          originalTime: clip.time,
          originalDuration: playDuration,
          maxDuration,
        };
      } else {
        dragRef.current = {
          kind: 'trim-left',
          ref: target.ref,
          pointerId: event.pointerId,
          startPointerX: x,
          originalTime: clip.time,
          originalDuration: playDuration,
          originalSourceInTime: clip.sourceInTime ?? 0,
        };
      }
      setSelected(target.ref);
      return;
    }

    setSelected(null);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const { x, y } = canvasPoint(event);
    const target = hitTestTimeline(layout, x, y);

    if (!dragRef.current) {
      if (
        target.kind === 'clip-body' ||
        target.kind === 'clip-right-handle' ||
        target.kind === 'clip-left-handle'
      ) {
        setHovered(target.ref);
      } else {
        setHovered(null);
      }
      return;
    }

    const drag = dragRef.current;
    if (event.pointerId !== drag.pointerId) return;

    if (drag.kind === 'playhead') {
      seekFromX(x);
      return;
    }

    const deltaSeconds = (x - drag.startPointerX) / PIXELS_PER_SECOND;

    if (drag.kind === 'move') {
      const dropTarget = trackDropTargetFromY(y, doc.tracks.length);
      changeDoc((d) => {
        const nextRef = commitClipMove(
          d,
          drag.ref,
          drag.originalTime + deltaSeconds,
          drag.originalDuration,
          dropTarget,
          drag.edgeTracks,
        );
        if (nextRef) {
          drag.ref = nextRef;
        }
      });
      if (!clipRefEquals(selected, drag.ref)) {
        setSelected(drag.ref);
      }
    } else if (drag.kind === 'resize') {
      const duration = Math.min(
        drag.maxDuration,
        Math.max(MIN_CLIP_DURATION, drag.originalDuration + deltaSeconds),
      );
      commitClipUpdate(drag.ref, drag.originalTime, duration);
    } else {
      const delta = clampTrimLeftDelta(drag, deltaSeconds);
      commitClipTrimLeft(
        drag.ref,
        drag.originalTime + delta,
        drag.originalSourceInTime + delta,
        drag.originalDuration - delta,
      );
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;

    if (drag.kind === 'playhead') {
      setScrubTime(null);
    } else if (drag.kind === 'move') {
      changeDoc((d) => {
        pruneEmptyTracks(d);
      });
      setSelected(drag.ref);
    }

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
    event.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    scrollXRef.current = Math.max(
      0,
      Math.min(maxScrollX(sequenceDuration, canvas.clientWidth), scrollXRef.current + event.deltaX),
    );
    bump();
  };

  return (
    <div ref={rootRef} className="sequence-timeline min-h-[180px] flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onWheel={onWheel}
      />
    </div>
  );
}
