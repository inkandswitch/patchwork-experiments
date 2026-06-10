import { useEffect, useState } from "react";
import { formatDuration } from "../calculations";

export function RestTimer({
  seconds,
  onDone,
  onSkip,
}: {
  seconds: number;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const timer = window.setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, onDone]);

  const progress = seconds > 0 ? (remaining / seconds) * 100 : 0;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-amber-800">Rest timer</div>
          <div className="text-2xl font-bold tabular-nums text-amber-900">
            {formatDuration(remaining)}
          </div>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100"
        >
          Skip
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-200">
        <div
          className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
