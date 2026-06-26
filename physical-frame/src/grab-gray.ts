/**
 * Grab the current camera frame at the detector's downscaled dimensions and
 * return its grayscale buffer. Shared by the frame loop (per-tick detection) and
 * the Sample-background phase, so a sampled reference aligns pixel-for-pixel
 * with live detection frames.
 */

import { DETECT_MAX_DIM } from "./calibration-core.js";

export type GrayFrame = {
  gray: Uint8Array;
  w: number;
  h: number;
  scale: number;
};

export function grabGray(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  liveSize: { w: number; h: number } | null,
): GrayFrame | null {
  if (!liveSize) return null;
  const scale = Math.min(1, DETECT_MAX_DIM / Math.max(liveSize.w, liveSize.h));
  const w = Math.max(1, Math.round(liveSize.w * scale));
  const h = Math.max(1, Math.round(liveSize.h * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return { gray, w, h, scale };
}
