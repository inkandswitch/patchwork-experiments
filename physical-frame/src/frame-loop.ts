/**
 * Frame-owned camera loop (no ordered pipeline, no shared mask).
 *
 * Each tick: grab the camera frame, downscale to grayscale, build the
 * `CameraFrame`, and call `process(cameraFrame)` on every ACTIVE reader. Readers
 * are demand-driven — the frame only activates a layer's reader while a tool is
 * subscribed to its selector (see UseStage). Every reader sees the SAME read-only
 * CameraFrame independently; there is no cross-layer masking here.
 */

import { DETECT_INTERVAL_MS, cameraPointToBoard } from "./calibration-core.js";
import { grabGray } from "./grab-gray.js";
import type { CameraFrame, Reader, FramePoint } from "./physical-layer.js";

type Size = { w: number; h: number };

export interface FrameLoopOptions {
  video: HTMLVideoElement;
  /** Read FRESH each tick so live re-calibration during Use takes effect. */
  getDocState: () => { homographyCamToBoard: number[] | null } | null;
  getLiveSize: () => Size | null;
  /** The readers to process THIS tick — the demand-driven active set. */
  getActiveReaders: () => Reader[];
  /**
   * The sampled empty-surface grayscale reference (or null), read fresh each
   * tick and handed to readers as `cameraFrame.backgroundGray`. In-memory only.
   */
  getBackground: () => Uint8Array | null;
}

export interface FrameLoop {
  /** Start the per-tick camera loop (idempotent). */
  start(): void;
  /**
   * Grab the current camera frame at the SAME downscaled dims the readers use
   * and return it as a grayscale reference (for background sampling), or null if
   * no frame is available.
   */
  sampleBackground(): Uint8Array | null;
  stop(): void;
}

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export function createFrameLoop(opts: FrameLoopOptions): FrameLoop {
  const { video, getDocState, getLiveSize, getActiveReaders, getBackground } =
    opts;
  const canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function startLoop() {
    if (timer) return;
    timer = setInterval(() => tick(), DETECT_INTERVAL_MS);
  }

  const grab = () => grabGray(video, canvas, getLiveSize());

  function tick(): void {
    if (inFlight) return;
    const docState = getDocState();
    const liveSize = getLiveSize();
    if (!liveSize) return;
    const readers = getActiveReaders().filter((r) => r.status === "ready");
    if (readers.length === 0) return; // nothing subscribed → skip the grab

    // Run readers even BEFORE calibration: without a homography, mapPointToBox
    // returns null (no position), but a reader can still report detection
    // PRESENCE (e.g. apriltags ids for frame controls). `calibrated` tells each
    // reader which mode it's in.
    const calibrated = !!docState?.homographyCamToBoard;

    inFlight = true;
    try {
      const grabbed = grab();
      if (!grabbed) return;
      const { gray, w, h, scale } = grabbed;

      // Detection runs every tick (no frame-change skip): recognized things must
      // re-evaluate live so transient occlusions (e.g. a person walking through)
      // clear immediately instead of leaving a stuck recognition.

      const mapPointToBox = (px: FramePoint): [number, number] | null => {
        if (!docState || !docState.homographyCamToBoard) return null;
        const cameraPoint: [number, number] = [px.x / scale, px.y / scale];
        return cameraPointToBoard(docState, cameraPoint, liveSize) as
          | [number, number]
          | null;
      };

      // Hand the background reference to readers only if it aligns with the
      // current frame dims (camera renegotiation would invalidate it).
      const bg = getBackground();
      const backgroundGray = bg && bg.length === w * h ? bg : null;

      const cameraFrame: CameraFrame = {
        gray,
        w,
        h,
        scale,
        backgroundGray,
        calibrated,
        mapPointToBox,
        now: nowMs(),
      };

      // Every active reader sees the same read-only CameraFrame, independently.
      for (const r of readers) {
        try {
          r.process(cameraFrame);
        } catch (err) {
          console.error("[frame-loop] reader threw:", err);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      startLoop();
    },
    sampleBackground() {
      return grab()?.gray ?? null;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      inFlight = false;
    },
  };
}
