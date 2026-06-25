/**
 * Recognition-layer framework contract.
 *
 * A "layer" turns the live camera into some recognized result (AprilTags first;
 * line drawings, words, etc. later) and publishes it on its own provider
 * selector. The host owns the camera + calibration and runs ONE shared frame
 * loop; each tick it hands every layer's recognizer a `Frame` and the recognizer
 * publishes into an `Emitter` the host stamped on its provider wrapper.
 *
 * Layers never call getUserMedia and never own a camera loop.
 */

import type { Emitter } from "../spatial-source.js";

/** One downscaled camera frame, fanned to every layer's recognizer per tick. */
export interface Frame {
  /** Grayscale buffer, length w*h. */
  gray: Uint8Array;
  /** Downscaled width/height (px). */
  w: number;
  h: number;
  /** Downscaled px = camera px * scale. */
  scale: number;
  /**
   * Map a downscaled-image pixel to box-normalized [0..1] coordinates (board
   * space == the aligned box), or null if it can't be mapped. Built by the host
   * from the current calibration homography.
   */
  mapPointToBox(px: { x: number; y: number }): [number, number] | null;
  /** performance.now() for this tick. */
  now: number;
}

export type RecognizerStatus = "idle" | "loading" | "ready" | "error";

/** A layer's per-host-instance recognizer, driven by the host's frame loop. */
export interface Recognizer {
  /** Lazy/async init (e.g. spin up a wasm worker). Idempotent. */
  ensure(): Promise<void>;
  /** Called once per tick with the shared frame. Cheap no-op until ready. */
  process(frame: Frame): void;
  /** Tear down workers/timers and clear published state. */
  stop(): void;
  /** Current readiness. */
  readonly status: RecognizerStatus;
}

/**
 * Static descriptor for a layer. The host enumerates these (see ./index.ts),
 * registers one provider component per layer, and per host instance creates one
 * Emitter + one recognizer.
 *
 * `Result` is the JSON payload published on `selector` (e.g. SpatialTags).
 */
export interface SpatialLayer<Result = unknown> {
  /** Selector the embedded tool subscribes to, e.g. "spatial:apriltags". */
  readonly selector: string;
  /** patchwork:component id for this layer's provider. */
  readonly providerComponentId: string;
  /** Human-readable name (plugin registration). */
  readonly name: string;
  /** Empty/initial value handed to a brand-new subscriber. */
  initialResult(): Result;
  /**
   * Per-host-instance recognizer factory. The host owns the Emitter (so it can
   * stamp it on the wrapper) and passes it in; the recognizer publishes via it.
   */
  createRecognizer(emitter: Emitter<Result>): Recognizer;
}
