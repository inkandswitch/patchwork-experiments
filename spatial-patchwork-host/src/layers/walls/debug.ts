/**
 * Temporary diagnostic channel for the walls recognizer.
 *
 * The recognizer publishes its latest CV intermediates + brightness/noise stats
 * here each frame; a debug overlay (UseStage, enabled via `?wallsDebug`) reads
 * them to paint what the recognizer actually sees. Off by default — `enabled`
 * is set from the URL flag at startup. This exists to diagnose low-light noise
 * (phantom blobs on an empty surface) and can be removed once tuned.
 */

import type { FramePoint } from "../types.js";

export interface WallsDebugSnapshot {
  w: number;
  h: number;
  /** weak foreground mask (d > DELTA_LO), 1/0 */
  weak: Uint8Array;
  /** strong foreground mask (d > DELTA_HI), 1/0 */
  strong: Uint8Array;
  /** binarized + dilated mask actually fed to connected-components */
  bin: Uint8Array;
  /** published shape outlines in frame px (post-debounce) */
  publishedPolys: FramePoint[][];
  stats: WallsDebugStats;
}

export interface WallsDebugStats {
  /** mean/min/max of the live grayscale frame */
  grayMean: number;
  grayMin: number;
  grayMax: number;
  /** mean/min/max of the sampled background reference */
  bgMean: number;
  /** mean of d = bg - gray over non-claimed pixels (signed) */
  diffMean: number;
  /** 50th/95th/99th percentile of |d| over non-claimed pixels (noise floor) */
  absDiffP50: number;
  absDiffP95: number;
  absDiffP99: number;
  /**
   * Temporal noise: mean abs frame-to-frame change in gray per pixel. High on an
   * empty static surface = sensor noise (the low-light culprit). 0 if no prior.
   */
  temporalNoiseMean: number;
  /** counts through the pipeline */
  weakPx: number;
  strongPx: number;
  binPx: number;
  components: number;
  strongGated: number;
  published: number;
}

class WallsDebug {
  enabled = false;
  snapshot: WallsDebugSnapshot | null = null;
  private listeners = new Set<() => void>();

  publish(s: WallsDebugSnapshot) {
    this.snapshot = s;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const wallsDebug = new WallsDebug();

/** Read the `?wallsDebug` URL flag once at startup. */
export function initWallsDebugFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("wallsDebug")) wallsDebug.enabled = true;
  } catch {
    /* no window (SSR/worker) */
  }
}
