import type { ChangeFn } from '@automerge/automerge/slim';
import type { ClipRef, SequenceDoc } from '../types';
import type { PendingClip } from '../drag';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSourceLoader, resolveTimelineClipTiming } from '../diffusion/sync-composition';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import { maxClipPlayDuration } from '../clip-timing';
import { clipDisplayName, DEFAULT_CLIP_DURATION, findClip } from '../helpers';
import type { TimelineTheme } from './constants';
import {
  MIN_CLIP_DURATION,
  PIXELS_PER_SECOND,
  readTimelineTheme,
  snapClipMoveTime,
  snapTimeToPlayhead,
  totalCanvasHeight,
  xToTime,
} from './constants';
import { drawTimeline, maxScrollX } from './draw';
import {
  applyClipDragPreview,
  clipRefEquals,
  computeGhostLayout,
  computeTimelineLayout,
  hitTestTimeline,
  type ClipDragPreview,
  type GhostClip,
  type TimelineLayout,
} from './layout';
import {
  clipEdgeSnapTargets,
  commitClipMove,
  createClipFromDrop,
  pruneEmptyTracks,
  previewTrackIndexFromDropTarget,
  splitClipAtTime,
  trackDropTargetFromY,
  type EdgeTracksDuringDrag,
} from './tracks';

import './timeline.css';

function ClipNameEditor({
  clip,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  clip: { x: number; y: number; width: number; height: number };
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="absolute z-10 border-0 bg-base-100/90 p-0 font-sans text-[11px] text-base-content outline-none ring-1 ring-primary"
      style={{
        left: clip.x + 10,
        top: clip.y,
        width: Math.max(40, clip.width - 20),
        height: clip.height,
        lineHeight: `${clip.height}px`,
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

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
  onSeekPreview?: (time: number) => void;
  onScrubTimeChange?: (time: number | null) => void;
  onClipPreview?: (
    preview: ({ clipId: string } & Pick<ClipDragPreview, 'time' | 'duration' | 'sourceInTime'>) | null,
  ) => void;
  onScrubStart?: () => void;
  pendingClip?: PendingClip | null;
  onPendingClipResolved?: () => void;
  onPendingOverTimelineChange?: (over: boolean) => void;
};

export function Timeline({
  doc,
  changeDoc,
  currentTime,
  sequenceDuration,
  onSeek,
  onSeekPreview,
  onScrubTimeChange,
  onClipPreview,
  onScrubStart,
  pendingClip = null,
  onPendingClipResolved,
  onPendingOverTimelineChange,
}: TimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const themeRef = useRef<TimelineTheme | null>(null);
  const layoutRef = useRef<TimelineLayout | null>(null);
  const timingRef = useRef<Map<string, ClipTimingInfo>>(new Map());
  const loaderRef = useRef(createSourceLoader());
  const scrollXRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const ghostRef = useRef<GhostClip | null>(null);
  const clipDragPreviewRef = useRef<ClipDragPreview | null>(null);
  const editingClipRef = useRef<ClipRef | null>(null);
  const scrubTimeRef = useRef<number | null>(null);
  const paintRafRef = useRef<number | null>(null);
  const seekPreviewTimerRef = useRef<number | null>(null);
  const pendingSeekPreviewRef = useRef<number | null>(null);
  const clipPreviewTimerRef = useRef<number | null>(null);
  const paintDepsRef = useRef({
    doc,
    sequenceDuration,
    selected: null as ClipRef | null,
    hovered: null as ClipRef | null,
    currentTime,
  });

  const [selected, setSelected] = useState<ClipRef | null>(null);
  const [hovered, setHovered] = useState<ClipRef | null>(null);
  const [editingClip, setEditingClip] = useState<ClipRef | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [frame, setFrame] = useState(0);

  editingClipRef.current = editingClip;

  paintDepsRef.current = { doc, sequenceDuration, selected, hovered, currentTime };

  const docSyncKey = JSON.stringify({ tracks: doc.tracks, sources: doc.sources });
  const bump = () => setFrame((n) => n + 1);

  const resolveClipPlayDurationForUi = (clipId: string, explicit: number | null) => {
    const timing = timingRef.current.get(clipId);
    return explicit ?? timing?.playDuration ?? DEFAULT_CLIP_DURATION;
  };

  const clipLabelForRef = (ref: ClipRef) => {
    const clip = findClip(doc, ref);
    return clip ? clipDisplayName(doc, clip) : 'clip';
  };

  const startEditingClip = (ref: ClipRef) => {
    const clip = findClip(doc, ref);
    if (!clip) return;
    setSelected(ref);
    setEditingClip(ref);
    setEditingDraft(clipDisplayName(doc, clip));
  };

  const commitEditingClipName = () => {
    if (!editingClip) return;
    const ref = editingClip;
    const name = editingDraft;
    setEditingClip(null);
    changeDoc((d) => {
      const clip = findClip(d, ref);
      if (!clip) return;
      const trimmed = name.trim();
      if (trimmed) {
        clip.name = trimmed;
      } else {
        delete clip.name;
      }
    });
  };

  const cancelEditingClipName = () => {
    setEditingClip(null);
  };

  const displayPlayheadTime = () => scrubTimeRef.current ?? paintDepsRef.current.currentTime;

  const buildLayout = (playheadTime: number, canvasWidth: number): TimelineLayout => {
    const { doc: liveDoc, sequenceDuration: liveDuration } = paintDepsRef.current;
    let layout = computeTimelineLayout(
      liveDoc,
      timingRef.current,
      scrollXRef.current,
      canvasWidth,
      playheadTime,
      liveDuration,
    );
    if (clipDragPreviewRef.current) {
      layout = applyClipDragPreview(layout, clipDragPreviewRef.current);
    }
    return layout;
  };

  const ensureCanvasSize = (): number => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;
    if (!root || !canvas || !ctx) return 0;

    const { width, height } = root.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(totalCanvasHeight(paintDepsRef.current.doc.tracks.length), Math.floor(height));
    const dpr = window.devicePixelRatio || 1;
    const size = canvasSizeRef.current;

    if (size.w !== w || size.h !== h || size.dpr !== dpr) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvasSizeRef.current = { w, h, dpr };
    }

    scrollXRef.current = Math.min(scrollXRef.current, maxScrollX(paintDepsRef.current.sequenceDuration, w));
    return w;
  };

  const paintTimeline = () => {
    const root = rootRef.current;
    const ctx = canvasCtxRef.current;
    if (!root || !ctx) return;

    const w = ensureCanvasSize();
    if (w <= 0) return;

    if (!themeRef.current) {
      themeRef.current = readTimelineTheme(root);
    }

    const { selected: liveSelected, hovered: liveHovered, doc: liveDoc } = paintDepsRef.current;
    const layout = buildLayout(displayPlayheadTime(), w);
    layoutRef.current = layout;
    drawTimeline(
      ctx,
      themeRef.current,
      layout,
      liveDoc.tracks.length,
      liveSelected,
      liveHovered,
      ghostRef.current,
      editingClipRef.current,
    );
  };

  const schedulePaint = () => {
    if (paintRafRef.current !== null) return;
    paintRafRef.current = requestAnimationFrame(() => {
      paintRafRef.current = null;
      paintTimeline();
    });
  };

  useEffect(() => {
    return () => {
      if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current);
      if (seekPreviewTimerRef.current !== null) window.clearTimeout(seekPreviewTimerRef.current);
      if (clipPreviewTimerRef.current !== null) window.clearTimeout(clipPreviewTimerRef.current);
    };
  }, []);

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
    canvasCtxRef.current = ctx;
    themeRef.current = readTimelineTheme(root);

    const onResize = () => {
      themeRef.current = readTimelineTheme(root);
      paintTimeline();
    };

    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(root);
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useLayoutEffect(() => {
    themeRef.current = null;
    paintTimeline();
  }, [doc, docSyncKey, sequenceDuration, selected, hovered, editingClip, frame]);

  useEffect(() => {
    if (dragRef.current?.kind === 'playhead') return;
    schedulePaint();
  }, [currentTime]);

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

  const onTimelineKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'b') return;
    if (!selected) return;

    const clip = findClip(doc, selected);
    if (!clip) return;

    const playheadTime = displayPlayheadTime();
    const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
    if (playheadTime <= clip.time || playheadTime >= clip.time + playDuration) return;

    event.preventDefault();
    const ref = selected;
    let rightRef: ClipRef | null = null;
    changeDoc((d) => {
      rightRef = splitClipAtTime(d, ref, playheadTime, playDuration);
    });
    if (rightRef) setSelected(rightRef);
  };

  useEffect(() => {
    if (!editingClip) return;
    if (!findClip(doc, editingClip)) {
      setEditingClip(null);
    }
  }, [doc, docSyncKey, editingClip]);

  useEffect(() => {
    if (!pendingClip) {
      if (ghostRef.current) {
        ghostRef.current = null;
        bump();
      }
      return;
    }

    const dropFromClient = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const inside =
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) return null;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return {
        time: Math.max(0, xToTime(x, scrollXRef.current)),
        dropTarget: trackDropTargetFromY(y, doc.tracks.length),
      };
    };

    const onMove = (event: PointerEvent) => {
      const drop = dropFromClient(event.clientX, event.clientY);
      if (!drop) {
        onPendingOverTimelineChange?.(false);
        if (ghostRef.current) {
          ghostRef.current = null;
          bump();
        }
        return;
      }
      ghostRef.current = computeGhostLayout(
        pendingClip,
        drop.time,
        drop.dropTarget,
        scrollXRef.current,
        doc.tracks.length,
      );
      onPendingOverTimelineChange?.(true);
      bump();
    };

    const onUp = (event: PointerEvent) => {
      const drop = dropFromClient(event.clientX, event.clientY);
      if (drop) {
        let createdRef: ClipRef | null = null;
        changeDoc((d) => {
          createdRef = createClipFromDrop(d, pendingClip, drop.time, drop.dropTarget);
        });
        if (createdRef) setSelected(createdRef);
      }
      ghostRef.current = null;
      onPendingOverTimelineChange?.(false);
      onPendingClipResolved?.();
      bump();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pendingClip, doc.tracks.length, changeDoc, onPendingClipResolved, onPendingOverTimelineChange]);

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

  const scheduleClipPreview = (preview: ClipDragPreview) => {
    if (!onClipPreview) return;
    if (clipPreviewTimerRef.current !== null) return;
    clipPreviewTimerRef.current = window.setTimeout(() => {
      clipPreviewTimerRef.current = null;
      const livePreview = clipDragPreviewRef.current;
      if (!livePreview) return;
      onClipPreview({
        clipId: livePreview.ref.clipId,
        time: livePreview.time,
        duration: livePreview.duration,
        sourceInTime: livePreview.sourceInTime,
      });
    }, 80);
  };

  const clearClipPreview = () => {
    if (clipPreviewTimerRef.current !== null) {
      window.clearTimeout(clipPreviewTimerRef.current);
      clipPreviewTimerRef.current = null;
    }
    onClipPreview?.(null);
  };

  const scheduleSeekPreview = (time: number) => {
    pendingSeekPreviewRef.current = time;
    if (seekPreviewTimerRef.current !== null) return;
    seekPreviewTimerRef.current = window.setTimeout(() => {
      seekPreviewTimerRef.current = null;
      const previewTime = pendingSeekPreviewRef.current;
      if (previewTime === null) return;
      onSeekPreview?.(previewTime);
      onScrubTimeChange?.(previewTime);
    }, 120);
  };

  const flushSeekPreview = () => {
    if (seekPreviewTimerRef.current !== null) {
      window.clearTimeout(seekPreviewTimerRef.current);
      seekPreviewTimerRef.current = null;
    }
    pendingSeekPreviewRef.current = null;
  };

  const seekFromX = (x: number, options?: { preview?: boolean; updateLabel?: boolean }) => {
    const maxTime = paintDepsRef.current.sequenceDuration > 0 ? paintDepsRef.current.sequenceDuration : Infinity;
    const time = Math.max(0, Math.min(maxTime, xToTime(x, scrollXRef.current)));
    scrubTimeRef.current = time;
    schedulePaint();

    if (options?.updateLabel) {
      onScrubTimeChange?.(time);
    }

    if (options?.preview) {
      scheduleSeekPreview(time);
    } else {
      onSeek(time);
    }
  };

  const startPlayheadScrub = (event: React.PointerEvent<HTMLCanvasElement>, x: number) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: 'playhead', pointerId: event.pointerId };
    onScrubStart?.();
    seekFromX(x, { preview: true, updateLabel: true });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus({ preventScroll: true });

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
      seekFromX(x, { preview: true });
      return;
    }

    const deltaSeconds = (x - drag.startPointerX) / PIXELS_PER_SECOND;
    const playheadTime = scrubTimeRef.current ?? currentTime;

    if (drag.kind === 'move') {
      const dropTarget = trackDropTargetFromY(y, doc.tracks.length);
      const fromTrackIndex = doc.tracks.findIndex((track) => track.id === drag.ref.trackId);
      const fromTrack = fromTrackIndex === -1 ? null : doc.tracks[fromTrackIndex]!;
      const previewTrackIndex = fromTrack
        ? previewTrackIndexFromDropTarget(
            dropTarget,
            fromTrackIndex,
            fromTrack.clips.length,
            doc.tracks.length,
          )
        : 0;
      const snapTargets: number[] = [
        playheadTime,
        ...clipEdgeSnapTargets(
          doc,
          drag.ref.clipId,
          (clip) => resolveClipPlayDurationForUi(clip.id, clip.duration),
        ),
      ];
      const time = Math.max(
        0,
        snapClipMoveTime(drag.originalTime + deltaSeconds, drag.originalDuration, snapTargets),
      );
      clipDragPreviewRef.current = {
        ref: drag.ref,
        time,
        duration: drag.originalDuration,
        trackIndex: fromTrack
          ? previewTrackIndexFromDropTarget(
              dropTarget,
              fromTrackIndex,
              fromTrack.clips.length,
              doc.tracks.length,
            )
          : 0,
        label: clipLabelForRef(drag.ref),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current);
    } else if (drag.kind === 'resize') {
      const fromTrackIndex = doc.tracks.findIndex((track) => track.id === drag.ref.trackId);
      const rightEdge = snapTimeToPlayhead(
        drag.originalTime + drag.originalDuration + deltaSeconds,
        playheadTime,
      );
      const duration = Math.min(
        drag.maxDuration,
        Math.max(MIN_CLIP_DURATION, rightEdge - drag.originalTime),
      );
      clipDragPreviewRef.current = {
        ref: drag.ref,
        time: drag.originalTime,
        duration,
        trackIndex: fromTrackIndex === -1 ? 0 : fromTrackIndex,
        label: clipLabelForRef(drag.ref),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current);
    } else {
      const fromTrackIndex = doc.tracks.findIndex((track) => track.id === drag.ref.trackId);
      const leftEdge = snapTimeToPlayhead(drag.originalTime + deltaSeconds, playheadTime);
      const delta = clampTrimLeftDelta(drag, leftEdge - drag.originalTime);
      clipDragPreviewRef.current = {
        ref: drag.ref,
        time: drag.originalTime + delta,
        duration: drag.originalDuration - delta,
        sourceInTime: drag.originalSourceInTime + delta,
        trackIndex: fromTrackIndex === -1 ? 0 : fromTrackIndex,
        label: clipLabelForRef(drag.ref),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;

    const preview = clipDragPreviewRef.current;

    if (drag.kind === 'playhead') {
      flushSeekPreview();
      const time = scrubTimeRef.current;
      scrubTimeRef.current = null;
      onScrubTimeChange?.(null);
      if (time !== null) {
        onSeek(time);
      }
      schedulePaint();
    } else if (drag.kind === 'move') {
      clearClipPreview();
      const { x, y } = canvasPoint(event);
      const dropTarget = trackDropTargetFromY(y, doc.tracks.length);
      changeDoc((d) => {
        const nextRef = commitClipMove(
          d,
          drag.ref,
          preview?.time ?? drag.originalTime,
          preview?.duration ?? drag.originalDuration,
          dropTarget,
          drag.edgeTracks,
        );
        pruneEmptyTracks(d);
        if (nextRef) {
          drag.ref = nextRef;
        }
      });
      setSelected(drag.ref);
    } else if (drag.kind === 'resize' && preview) {
      clearClipPreview();
      commitClipUpdate(drag.ref, preview.time, preview.duration);
    } else if (drag.kind === 'trim-left' && preview) {
      clearClipPreview();
      commitClipTrimLeft(
        drag.ref,
        preview.time,
        preview.sourceInTime ?? 0,
        preview.duration,
      );
    }

    clipDragPreviewRef.current = null;
    dragRef.current = null;
    bump();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const { x, y } = canvasPoint(event);
    const target = hitTestTimeline(layout, x, y);
    if (target.kind !== 'clip-body') return;

    startEditingClip(target.ref);
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
    schedulePaint();
    if (editingClipRef.current) bump();
  };

  const editingLayout =
    editingClip && layoutRef.current
      ? layoutRef.current.clips.find((clip) => clipRefEquals(editingClip, clip))
      : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="sequence-timeline relative min-h-[180px] flex-1 overflow-hidden outline-none"
      onKeyDown={onTimelineKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      {editingLayout && (
        <ClipNameEditor
          clip={editingLayout}
          value={editingDraft}
          onChange={setEditingDraft}
          onCommit={commitEditingClipName}
          onCancel={cancelEditingClipName}
        />
      )}
    </div>
  );
}
