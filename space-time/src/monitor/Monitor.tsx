import type { RefObject } from 'react';

type MonitorProps = {
  mountRef: RefObject<HTMLDivElement>;
  loading: boolean;
  error: string | null;
  empty: boolean;
};

export function Monitor({ mountRef, loading, error, empty }: MonitorProps) {
  return (
    <div className="st-monitor pointer-events-auto absolute top-12 right-4 z-20 flex h-48 w-72 flex-col overflow-hidden rounded-lg border border-base-300 bg-neutral shadow-lg">
      <div className="border-b border-base-300 px-3 py-1.5 text-xs font-medium text-base-content/70">
        Monitor
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div ref={mountRef} className="origin-center" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
            Loading…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-error/10 p-3 text-center text-xs text-error">
            {error}
          </div>
        )}
        {empty && !loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-neutral-content/60">
            No clips in playhead range
          </div>
        )}
      </div>
    </div>
  );
}
