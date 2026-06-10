import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../calculations";

const PRESETS = [60, 90, 120, 180] as const;

function formatPreset(seconds: number): string {
  if (seconds >= 120 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function RestTimer({
  seconds,
  onReady,
  onSkip,
  onGo,
  onDurationChange,
}: {
  seconds: number;
  onReady: () => void;
  onSkip: () => void;
  onGo: () => void;
  /** Persist session default rest when user picks a preset. */
  onDurationChange?: (seconds: number) => void;
}) {
  // Wall-clock deadline so countdown stays correct even if the host
  // throttles timers or the parent re-renders frequently.
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setEndsAt(Date.now() + seconds * 1000);
    setNow(Date.now());
  }, [seconds]);

  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const ready = remaining <= 0;

  useEffect(() => {
    if (ready) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [ready]);

  // Fire onReady exactly once per countdown without putting the (unstable)
  // callback in effect deps.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (ready && !notifiedRef.current) {
      notifiedRef.current = true;
      onReadyRef.current();
    } else if (!ready) {
      notifiedRef.current = false;
    }
  }, [ready]);

  const progress =
    seconds > 0 ? Math.min(100, (remaining / seconds) * 100) : 0;

  const restartWith = (nextSeconds: number) => {
    setEndsAt(Date.now() + nextSeconds * 1000);
    setNow(Date.now());
  };

  const applyPreset = (preset: number) => {
    onDurationChange?.(preset);
    restartWith(preset);
  };

  if (ready) {
    return (
      <div className="strength-rest-ready rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Rest complete
            </div>
            <div className="text-2xl font-bold text-emerald-900">
              Time to work
            </div>
          </div>
          <button
            type="button"
            onClick={onGo}
            className="strength-rest-go rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Go
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-amber-800">Rest</div>
          <div className="text-2xl font-bold tabular-nums text-amber-900">
            {formatDuration(remaining)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-md border px-2 py-1 text-xs ${
                seconds === preset
                  ? "border-amber-500 bg-amber-100 font-medium text-amber-900"
                  : "border-amber-300 text-amber-800 hover:bg-amber-100"
              }`}
            >
              {formatPreset(preset)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => restartWith(Math.max(0, remaining - 15))}
            className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
          >
            −15s
          </button>
          <button
            type="button"
            onClick={() => restartWith(remaining + 15)}
            className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
          >
            +15s
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100"
          >
            Skip
          </button>
        </div>
      </div>
      <div className="strength-rest-track mt-3 h-2 overflow-hidden rounded-full bg-amber-200">
        <div
          className="strength-rest-fill h-full rounded-full bg-amber-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
