/** localStorage key for user-tuned latency offset (in chunks of NUM_FRAMES_PER_CHUNK) */
export const LATENCY_OFFSET_STORAGE_KEY = 'looper:latencyOffsetChunks';

export const LATENCY_OFFSET_MIN_CHUNKS = 1;
export const LATENCY_OFFSET_MAX_CHUNKS = 50;
export const LATENCY_OFFSET_DEFAULT_CHUNKS = 20;

export function readStoredLatencyOffsetChunks(): number | null {
  try {
    const raw = localStorage.getItem(LATENCY_OFFSET_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return null;
    }
    return Math.max(LATENCY_OFFSET_MIN_CHUNKS, Math.min(LATENCY_OFFSET_MAX_CHUNKS, Math.round(n)));
  } catch {
    return null;
  }
}

export function writeStoredLatencyOffsetChunks(n: number): void {
  try {
    const clamped = Math.max(
      LATENCY_OFFSET_MIN_CHUNKS,
      Math.min(LATENCY_OFFSET_MAX_CHUNKS, Math.round(n)),
    );
    localStorage.setItem(LATENCY_OFFSET_STORAGE_KEY, String(clamped));
  } catch {
    /* ignore */
  }
}
