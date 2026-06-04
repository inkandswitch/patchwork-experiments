import type { Source } from '../types';
import type { PendingClip } from '../drag';

import { useEffect, useRef, useState } from 'react';
import { useSourcePlayer } from './use-source-player';

type SourceMonitorProps = {
  source: Source | null;
  sourceId: string | null;
  label: string;
  onStartClipDrag: (payload: PendingClip, event: React.PointerEvent) => void;
};

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function SourceMonitor({ source, sourceId, label, onStartClipDrag }: SourceMonitorProps) {
  const { mountRef, playerState, playing, currentTime, duration, play, pause, seek } =
    useSourcePlayer(source, sourceId);

  const barRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  const ready = playerState.status === 'ready';
  const resolvedOut = outPoint ?? duration;

  useEffect(() => {
    setInPoint(0);
    setOutPoint(null);
  }, [sourceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        setInPoint(Math.min(currentTime, resolvedOut));
      } else if (event.key === 'o' || event.key === 'O') {
        event.preventDefault();
        setOutPoint(Math.max(currentTime, inPoint));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ready, currentTime, inPoint, resolvedOut]);

  const togglePlay = () => {
    if (!ready) return;
    void (playing ? pause() : play());
  };

  const timeFromClientX = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(duration, ratio * duration));
  };

  const onBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    void pause();
    void seek(timeFromClientX(event.clientX));
  };

  const onBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    void seek(timeFromClientX(event.clientX));
  };

  const onBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pct = (value: number) => (duration > 0 ? `${(value / duration) * 100}%` : '0%');

  const beginClipDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || !sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    const selectionDuration = Math.max(0.05, resolvedOut - inPoint);
    onStartClipDrag(
      { sourceId, sourceInTime: inPoint, duration: selectionDuration, label },
      event,
    );
  };

  return (
    <div className="source-monitor flex flex-col gap-2 border-b border-base-300 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-base-content/60">
        Source monitor
      </div>

      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-neutral">
        <div ref={mountRef} className="origin-center" />
        {!source && (
          <span className="absolute text-xs text-neutral-content/60">No source selected</span>
        )}
        {playerState.status === 'loading' && (
          <span className="absolute text-xs text-white/80">Loading…</span>
        )}
        {playerState.status === 'error' && (
          <span className="absolute px-3 text-center text-xs text-error">
            {playerState.message}
          </span>
        )}
      </div>

      <div
        ref={barRef}
        className="source-scrubber relative h-6 w-full cursor-pointer touch-none rounded bg-base-300/60"
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
      >
        {ready && duration > 0 && (
          <>
            <div
              className="source-clip absolute top-1/2 z-10 flex h-4 -translate-y-1/2 cursor-grab items-center overflow-hidden rounded px-1 text-[10px] active:cursor-grabbing"
              style={{ left: pct(inPoint), width: pct(Math.max(0.05, resolvedOut - inPoint)) }}
              onPointerDown={beginClipDrag}
              title="Drag to timeline to create a clip"
            >
              {label}
            </div>
            <div className="absolute bottom-0 top-0 z-20 w-px bg-warning" style={{ left: pct(inPoint) }} />
            <div className="absolute bottom-0 top-0 z-20 w-px bg-warning" style={{ left: pct(resolvedOut) }} />
            <div
              className="absolute bottom-0 top-0 z-30 w-0.5 -translate-x-1/2 bg-error"
              style={{ left: pct(currentTime) }}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-xs btn-primary"
          disabled={!ready}
          onClick={togglePlay}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <span className="font-mono text-xs tabular-nums text-base-content/70">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-base-content/50">
          in {formatTime(inPoint)} · out {formatTime(resolvedOut)}
        </span>
      </div>

      <p className="text-[10px] text-base-content/45">
        Press <kbd className="kbd kbd-xs">i</kbd> / <kbd className="kbd kbd-xs">o</kbd> to set in/out,
        then drag the clip to the timeline.
      </p>
    </div>
  );
}
