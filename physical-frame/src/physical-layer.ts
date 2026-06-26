/**
 * Physical-layer framework contract — the public API a layer package implements.
 *
 * A `patchwork:physical-layer` turns the live camera into some recognized result
 * (apriltags, marks, …) and publishes it on its own provider selector. The
 * FRAME (this tool) owns the camera + calibration and runs ONE shared camera
 * loop; each tick it hands every ACTIVE layer's **reader** a `CameraFrame` and
 * the reader publishes into an `Emitter` the frame stamped on its provider
 * wrapper.
 *
 * A layer consists of two halves:
 *   - a READER: the per-tick pixel processor (this contract), and
 *   - a PROVIDER: a normal `patchwork:component` relay (use the frame's
 *     `makeRelayProvider(selector)`), referenced here by `providerComponentId`.
 *
 * Layers never call getUserMedia and never own a camera loop. There is NO shared
 * mask / cross-layer claiming in this frame — every reader sees the same
 * read-only CameraFrame independently.
 */

import type { Emitter } from "./spatial-source.js";

/** The plugin type a layer package registers (in addition to its provider). */
export const PHYSICAL_LAYER_PLUGIN_TYPE = "patchwork:physical-layer";

/** A pixel point in downscaled camera-frame coordinates. */
export type FramePoint = { x: number; y: number };

/**
 * One downscaled camera frame, fanned to every active reader per tick. Named
 * `CameraFrame` (not `Frame`) to avoid colliding with the "frame" tool concept.
 */
export interface CameraFrame {
  /** Grayscale buffer, length w*h. */
  gray: Uint8Array;
  /** Downscaled width/height (px). */
  w: number;
  h: number;
  /** Downscaled px = camera px * scale. */
  scale: number;
  /**
   * The sampled empty-surface grayscale reference (same w*h as `gray`), or null
   * if none sampled. In-memory detection data only — never displayed. Layers
   * that do background-difference detection compare `gray` against this.
   */
  backgroundGray: Uint8Array | null;
  /**
   * Whether a calibration homography exists this frame. When false,
   * `mapPointToBox` returns null for everything — a reader can still report
   * detection PRESENCE (ids), just not position.
   */
  calibrated: boolean;
  /**
   * Map a downscaled-image pixel to box-normalized [0..1] coordinates (board
   * space == the aligned box), or null if it can't be mapped. Built by the frame
   * from the current calibration homography.
   */
  mapPointToBox(px: FramePoint): [number, number] | null;
  /** performance.now() for this tick. */
  now: number;
}

export type ReaderStatus = "idle" | "loading" | "ready" | "error";

/** A layer's per-frame-instance reader, driven by the frame's camera loop. */
export interface Reader {
  /** Lazy/async init (e.g. spin up a wasm worker). Idempotent. */
  ensure(): Promise<void>;
  /** Called once per tick with the camera frame. Cheap no-op until ready. */
  process(cameraFrame: CameraFrame): void;
  /** Tear down workers/timers and clear published state. */
  stop(): void;
  /** Current readiness. */
  readonly status: ReaderStatus;
}

/**
 * Static descriptor for a physical layer, returned by the layer package's
 * `patchwork:physical-layer` plugin `load()`. The frame enumerates these from
 * the registry and, per frame instance, creates one Emitter + one reader.
 *
 * `Result` is the JSON payload published on `selector` (e.g. PhysicalTags).
 */
export interface PhysicalLayer<Result = unknown> {
  /** Selector the embedded tool subscribes to, e.g. "physical:apriltags". */
  readonly selector: string;
  /** patchwork:component id for this layer's relay provider. */
  readonly providerComponentId: string;
  /** Human-readable name. */
  readonly name: string;
  /** Empty/initial value handed to a brand-new subscriber. */
  initialResult(): Result;
  /**
   * Per-frame-instance reader factory. The frame owns the Emitter (so it can
   * stamp it on the wrapper) and passes it in; the reader publishes via it.
   */
  createReader(emitter: Emitter<Result>): Reader;
}
