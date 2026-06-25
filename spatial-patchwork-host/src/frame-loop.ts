/**
 * Host-owned shared frame loop. Each tick it grabs the camera frame, downscales
 * it to grayscale, builds a camera→box mapper from the current calibration
 * homography, and fans the resulting `Frame` to every registered recognizer.
 * Recognition itself lives in the layers (src/layers/<name>/recognizer.ts).
 */

import {
  DETECT_INTERVAL_MS,
  DETECT_MAX_DIM,
  cameraPointToBoard,
} from "./apriltag-core.js";
import type { Frame, Recognizer } from "./layers/types.js";

type Size = { w: number; h: number };

export interface FrameLoopOptions {
  video: HTMLVideoElement;
  /** Read FRESH each tick so live re-calibration during Use takes effect. */
  getDocState: () => { homographyCamToBoard: number[] | null } | null;
  getLiveSize: () => Size | null;
  recognizers: Recognizer[];
}

export interface FrameLoop {
  /** ensure() every recognizer (lazy worker spin-up) and start the loop. */
  ensureAll(): Promise<void>;
  stop(): void;
}

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export function createFrameLoop(opts: FrameLoopOptions): FrameLoop {
  const { video, getDocState, getLiveSize, recognizers } = opts;
  const canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function startLoop() {
    if (timer) return;
    timer = setInterval(() => tick(), DETECT_INTERVAL_MS);
  }

  // Only the synchronous grab/downscale/grayscale is guarded by `inFlight`;
  // each recognizer guards its own async work internally.
  function tick(): void {
    if (inFlight) return;
    const docState = getDocState();
    if (!docState || !docState.homographyCamToBoard) return;
    const liveSize = getLiveSize();
    if (!liveSize) return;
    if (!recognizers.some((r) => r.status === "ready")) return;

    inFlight = true;
    try {
      const scale = Math.min(
        1,
        DETECT_MAX_DIM / Math.max(liveSize.w, liveSize.h),
      );
      const w = Math.max(1, Math.round(liveSize.w * scale));
      const h = Math.max(1, Math.round(liveSize.h * scale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
      }

      const mapPointToBox = (px: { x: number; y: number }) => {
        const cameraPoint: [number, number] = [px.x / scale, px.y / scale];
        return cameraPointToBoard(docState, cameraPoint, liveSize) as
          | [number, number]
          | null;
      };

      const frame: Frame = { gray, w, h, scale, mapPointToBox, now: nowMs() };
      for (const r of recognizers) {
        if (r.status !== "ready") continue;
        try {
          r.process(frame);
        } catch (err) {
          console.error("[frame-loop] recognizer threw:", err);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
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
      for (const r of recognizers) r.stop();
    },
  };
}
