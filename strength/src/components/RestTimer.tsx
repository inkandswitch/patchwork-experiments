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
      <div className="strength-rest-ready st-rest st-rest--ready">
        <div className="st-rest__row">
          <div>
            <div className="st-rest__eyebrow">
              Rest complete
            </div>
            <div className="st-rest__clock">
              Time to work
            </div>
          </div>
          <button
            type="button"
            onClick={onGo}
            className="strength-rest-go st-rest__go"
          >
            Go
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="st-rest">
      <div className="st-rest__row">
        <div>
          <div className="st-rest__eyebrow">Rest</div>
          <div className="st-rest__clock st-rest__clock--num">
            {formatDuration(remaining)}
          </div>
        </div>
        <div className="st-rest__buttons">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className="st-rest__button"
              data-active={seconds === preset || undefined}
            >
              {formatPreset(preset)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => restartWith(Math.max(0, remaining - 15))}
            className="st-rest__button"
          >
            −15s
          </button>
          <button
            type="button"
            onClick={() => restartWith(remaining + 15)}
            className="st-rest__button"
          >
            +15s
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="st-rest__button"
          >
            Skip
          </button>
        </div>
      </div>
      <div className="strength-rest-track st-rest__track">
        <div
          className="strength-rest-fill st-rest__fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
