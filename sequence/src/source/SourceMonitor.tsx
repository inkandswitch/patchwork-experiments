import type { Source } from '../types';
import type { PendingClip } from '../drag';

import { useEffect, useRef, useState } from 'react';
import { MIN_CLIP_DURATION } from '../timeline/constants';
import { useSourcePlayer } from './use-source-player';

const HANDLE_WIDTH = 8;

type SourceMonitorProps = {
  source: Source | null;
  sourceId: string | null;
  label: string;
  onStartClipDrag: (payload: PendingClip, event: React.PointerEvent) => void;
  bindTogglePlay?: React.MutableRefObject<(() => void) | null>;
};

type ScrubberTarget = 'left-handle' | 'right-handle' | 'clip-body' | 'bar';

type SourceDrag =
  | {
      kind: 'trim-left';
      pointerId: number;
      startPointerX: number;
      originalIn: number;
      originalOut: number;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startPointerX: number;
      originalIn: number;
      originalOut: number;
    }
  | { kind: 'scrub'; pointerId: number };

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function hitTestScrubber(
  clientX: number,
  barRect: DOMRect,
  inPoint: number,
  outPoint: number,
  duration: number,
): ScrubberTarget {
  if (duration <= 0) return 'bar';

  const x = clientX - barRect.left;
  const clipLeft = (inPoint / duration) * barRect.width;
  const clipRight = (outPoint / duration) * barRect.width;

  if (x >= clipLeft && x <= clipLeft + HANDLE_WIDTH) return 'left-handle';
  if (x >= clipRight - HANDLE_WIDTH && x <= clipRight) return 'right-handle';
  if (x > clipLeft + HANDLE_WIDTH && x < clipRight - HANDLE_WIDTH) return 'clip-body';
  return 'bar';
}

export function SourceMonitor({
  source,
  sourceId,
  label,
  onStartClipDrag,
  bindTogglePlay,
}: SourceMonitorProps) {
  const { mountRef, playerState, playing, currentTime, duration, play, pause, seek } =
    useSourcePlayer(source, sourceId);

  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<SourceDrag | null>(null);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [scrubberCursor, setScrubberCursor] = useState('pointer');

  const ready = playerState.status === 'ready';
  const resolvedOut = outPoint ?? duration;

  useEffect(() => {
    setInPoint(0);
    setOutPoint(null);
  }, [sourceId]);

  const togglePlay = () => {
    if (!ready) return;
    void (playing ? pause() : play());
  };

  useEffect(() => {
    if (!bindTogglePlay) return;
    bindTogglePlay.current = ready ? togglePlay : null;
    return () => {
      bindTogglePlay.current = null;
    };
  }, [bindTogglePlay, ready, playing, play, pause]);

  const timeFromClientX = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(duration, ratio * duration));
  };

  const selectionDuration = () => Math.max(MIN_CLIP_DURATION, resolvedOut - inPoint);

  const beginClipDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || !sourceId) return;
    event.preventDefault();
    onStartClipDrag(
      { sourceId, sourceInTime: inPoint, duration: selectionDuration(), label },
      event,
    );
  };

  const onBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || duration <= 0) return;

    const bar = barRef.current;
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    const target = hitTestScrubber(event.clientX, rect, inPoint, resolvedOut, duration);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (target === 'left-handle') {
      dragRef.current = {
        kind: 'trim-left',
        pointerId: event.pointerId,
        startPointerX: event.clientX,
        originalIn: inPoint,
        originalOut: resolvedOut,
      };
      return;
    }

    if (target === 'right-handle') {
      dragRef.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        startPointerX: event.clientX,
        originalIn: inPoint,
        originalOut: resolvedOut,
      };
      return;
    }

    dragRef.current = { kind: 'scrub', pointerId: event.pointerId };
    void pause();
    void seek(timeFromClientX(event.clientX));
  };

  const onBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return;

    const rect = bar.getBoundingClientRect();
    const drag = dragRef.current;

    if (!drag) {
      if (!ready) return;
      const target = hitTestScrubber(event.clientX, rect, inPoint, resolvedOut, duration);
      setScrubberCursor(
        target === 'left-handle' || target === 'right-handle' ? 'ew-resize' : 'pointer',
      );
      return;
    }

    if (event.pointerId !== drag.pointerId) return;
    const deltaSeconds = ((event.clientX - drag.startPointerX) / rect.width) * duration;

    if (drag.kind === 'scrub') {
      void seek(timeFromClientX(event.clientX));
      return;
    }

    if (drag.kind === 'trim-left') {
      const maxIn = drag.originalOut - MIN_CLIP_DURATION;
      const nextIn = Math.max(0, Math.min(maxIn, drag.originalIn + deltaSeconds));
      setInPoint(nextIn);
      return;
    }

    const minOut = drag.originalIn + MIN_CLIP_DURATION;
    const nextOut = Math.max(minOut, Math.min(duration, drag.originalOut + deltaSeconds));
    setOutPoint(nextOut);
  };

  const onBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pct = (value: number) => (duration > 0 ? `${(value / duration) * 100}%` : '0%');

  return (
    <div className="source-monitor">
      <div className="source-monitor__label">
        Source monitor
      </div>

      <div
        className="source-monitor__screen"
        data-draggable={(ready && sourceId) || undefined}
        onPointerDown={beginClipDrag}
        title={ready && sourceId ? 'Drag to timeline to create a clip' : undefined}
      >
        <div ref={mountRef} className="source-monitor__mount" />
        {!source && (
          <span className="source-monitor__hint">No source selected</span>
        )}
        {playerState.status === 'loading' && (
          <span className="source-monitor__hint source-monitor__hint--light">Loading…</span>
        )}
        {playerState.status === 'error' && (
          <span className="source-monitor__hint source-monitor__hint--error">
            {playerState.message}
          </span>
        )}
      </div>

      <div className="source-monitor__row">
        <span className="source-monitor__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span className="source-monitor__time source-monitor__time--total">
          in {formatTime(inPoint)} · out {formatTime(resolvedOut)}
        </span>
      </div>

      <div
        ref={barRef}
        className="source-scrubber"
        style={{ cursor: scrubberCursor }}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerLeave={() => setScrubberCursor('pointer')}
      >
        {ready && duration > 0 && (
          <>
            <div
              className="source-clip"
              style={{ left: pct(inPoint), width: pct(selectionDuration()) }}
            >
              <div className="source-clip-handle source-clip-handle-left" />
              <span className="source-clip-label">{label}</span>
              <div className="source-clip-handle source-clip-handle-right" />
            </div>
            <div
              className="source-playhead"
              style={{ left: pct(currentTime) }}
            />
          </>
        )}
      </div>

      <p className="source-monitor__tip">
        Trim with the clip handles, then drag the preview to the timeline.
      </p>
    </div>
  );
}
