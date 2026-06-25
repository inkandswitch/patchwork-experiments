/**
 * Host-owned shared frame loop + ordered recognition pipeline.
 *
 * Each tick: grab the camera frame, downscale to grayscale, and run every
 * recognizer IN ORDER, sharing a per-tick claim mask so later layers ignore
 * regions earlier layers claimed. Each layer publishes its own results (box
 * coords) via its Emitter for embedded tools to subscribe to.
 */

import { DETECT_INTERVAL_MS, cameraPointToBoard } from "./apriltag-core.js";
import { grabGray } from "./grab-gray.js";
import type { Frame, Recognizer, FramePoint } from "./layers/types.js";

type Size = { w: number; h: number };

export interface FrameLoopOptions {
  video: HTMLVideoElement;
  /** Read FRESH each tick so live re-calibration during Use takes effect. */
  getDocState: () => { homographyCamToBoard: number[] | null } | null;
  getLiveSize: () => Size | null;
  recognizers: Recognizer[];
  /**
   * The sampled empty-surface grayscale reference (or null), read fresh each
   * tick and handed to recognizers as `frame.backgroundGray`. In-memory only.
   */
  getBackground: () => Uint8Array | null;
}

export interface FrameLoop {
  /** ensure() every recognizer (lazy worker spin-up) and start the loop. */
  ensureAll(): Promise<void>;
  /**
   * Grab the current camera frame at the SAME downscaled dims the detector uses
   * and return it as a grayscale reference (for background sampling), or null if
   * no frame is available. (Dormant while no layer uses a background.)
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
  const { video, getDocState, getLiveSize, recognizers, getBackground } = opts;
  const canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let mask: Uint8Array | null = null;

  function startLoop() {
    if (timer) return;
    timer = setInterval(() => tick(), DETECT_INTERVAL_MS);
  }

  const grab = () => grabGray(video, canvas, getLiveSize());

  function tick(): void {
    if (inFlight) return;
    const docState = getDocState();
    if (!docState || !docState.homographyCamToBoard) return;
    const liveSize = getLiveSize();
    if (!liveSize) return;
    if (!recognizers.some((r) => r.status === "ready")) return;

    inFlight = true;
    try {
      const grabbed = grab();
      if (!grabbed) return;
      const { gray, w, h, scale } = grabbed;

      // Detection runs every tick (no frame-change skip): recognized things must
      // re-evaluate live so transient occlusions (e.g. a person walking through)
      // clear immediately instead of leaving a stuck recognition.

      // Shared per-tick claim mask.
      if (!mask || mask.length !== w * h) mask = new Uint8Array(w * h);
      else mask.fill(0);

      const mapPointToBox = (px: FramePoint): [number, number] | null => {
        const cameraPoint: [number, number] = [px.x / scale, px.y / scale];
        return cameraPointToBoard(docState, cameraPoint, liveSize) as
          | [number, number]
          | null;
      };

      // Hand the background reference to recognizers only if it aligns with the
      // current frame dims (camera renegotiation would invalidate it).
      const bg = getBackground();
      const backgroundGray = bg && bg.length === w * h ? bg : null;

      const frame: Frame = {
        gray,
        w,
        h,
        scale,
        mask,
        backgroundGray,
        mapPointToBox,
        now: nowMs(),
      };

      // Ordered pipeline. Each layer processes the frame (reading the mask =
      // regions EARLIER layers already claimed), then stamps its OWN claims into
      // the mask so LATER layers ignore them. A layer never masks itself out.
      for (const r of recognizers) {
        if (r.status !== "ready") continue;
        try {
          r.process(frame);
          r.claimSync(frame);
        } catch (err) {
          console.error("[frame-loop] recognizer threw:", err);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    sampleBackground() {
      return grab()?.gray ?? null;
    },
    async ensureAll() {
      await Promise.all(recognizers.map((r) => r.ensure().catch(() => {})));
      startLoop();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      inFlight = false;
      mask = null;
      for (const r of recognizers) r.stop();
    },
  };
}
