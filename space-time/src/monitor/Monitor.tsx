import type { RefObject } from 'react';

type MonitorProps = {
  mountRef: RefObject<HTMLDivElement>;
  loading: boolean;
  error: string | null;
};

export function Monitor({ mountRef, loading, error }: MonitorProps) {
  return (
    <div className="st-monitor pointer-events-auto absolute top-12 right-4 z-20 flex h-48 w-72 items-center justify-center overflow-hidden rounded-lg border border-base-300 bg-black shadow-lg leading-[0]">
      <div ref={mountRef} className="block origin-center [&_canvas]:block" />
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
    </div>
  );
}
