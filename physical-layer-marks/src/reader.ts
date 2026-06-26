/**
 * Marks reader: contour-detects dark-on-light black-marker drawings in the
 * grayscale frame (background-difference), simplifies each outline to a polygon,
 * tracks stable ids frame-to-frame, and publishes box-normalized shapes on
 * `physical:marks`.
 *
 * Pure JS, runs on the main thread within the per-tick budget at the downscaled
 * frame size. No shared mask / cross-layer claiming — every reader is
 * independent in physical-frame. Tunables are the constants below.
 */

import type {
  CameraFrame,
  EmitterLike,
  Reader,
  ReaderStatus,
  FramePoint,
} from "./contract.js";
import {
  buildForegroundMasks,
  dilateMask,
  connectedComponents,
  traceContour,
  simplify,
} from "./cv.js";
import type { Marks, MarkShape } from "./types.js";

// Tunables.
// Thin marker strokes are only a few px wide and noise breaks them into
// sub-MIN_AREA segments that drop out (flashing). Keep MIN_AREA low so strokes
// survive; the dilation + strong-pixel requirement reject real noise.
const MIN_AREA = 24; // drop blobs smaller than this many frame px (noise specks)
// Drop blobs larger than this fraction of the frame — that's the surface /
// background, not a drawing.
const MAX_AREA_FRAC = 0.4;
const RDP_EPSILON = 2.0; // contour simplification tolerance (frame px)
// Hysteresis on "darker than background": a stroke pixel turns the mask on at
// DELTA_LO but a component is kept only if it contains a pixel ≥ DELTA_HI.
const DELTA_LO = 35;
const DELTA_HI = 55;
// Dilation radius (px) to bridge noise-broken thin lines into one component.
const DILATE_RADIUS = 3;
const MATCH_DIST = 0.06; // box-space centroid distance to keep a shape's id (tracking)
const STALE_MS = 600;
// Appear-debounce: a shape must be detected this many consecutive frames before
// it's published — a transient noise speck (1 frame) never survives.
const APPEAR_FRAMES = 3;
// Hold geometry: once published, keep a matched shape's outline steady until the
// new detection's centroid moves more than this (box coords). Kills wobble.
const HOLD_TOL = 0.015;
// Temporary diagnostics — flip off once marks detection is confirmed working.
const DEBUG = true;

type Tracked = {
  id: number;
  cx: number; // box-space centroid
  cy: number;
  box: { nx: number; ny: number }[]; // outline in box coords (published)
  at: number;
  seen: number; // consecutive frames matched (appear-debounce)
  published: boolean; // has cleared APPEAR_FRAMES and is being emitted
};

function centroid(points: { nx: number; ny: number }[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.nx;
    y += p.ny;
  }
  return [x / points.length, y / points.length];
}

export function createMarksReader(emitter: EmitterLike<Marks>): Reader {
  // Always "ready" — no async init (pure JS).
  let status: ReaderStatus = "ready";
  let nextId = 1;
  let tracked: Tracked[] = [];
  // No cross-layer mask in physical-frame: a zero "claimed" buffer (nothing is
  // ever claimed by another layer). Reused across ticks, resized as needed.
  let noClaim = new Uint8Array(0);

  function publish() {
    // Only emit shapes that have cleared the appear-debounce.
    emitter.set({
      shapes: tracked
        .filter((t) => t.published)
        .map<MarkShape>((t) => ({ id: t.id, points: t.box }))
        .sort((a, b) => a.id - b.id),
    });
  }

  function process(cameraFrame: CameraFrame): void {
    const { gray, w, h, backgroundGray, mapPointToBox, now } = cameraFrame;

    // No background sampled (or it doesn't align with the current frame) → we
    // can't tell drawings from the surface. Publish nothing.
    if (!backgroundGray || backgroundGray.length !== gray.length) {
      if (DEBUG)
        console.log(
          "[marks] no background",
          backgroundGray ? `len ${backgroundGray.length} vs ${gray.length}` : "null",
        );
      if (tracked.length) {
        tracked = [];
        publish();
      }
      return;
    }

    if (noClaim.length !== gray.length) noClaim = new Uint8Array(gray.length);

    // Hysteresis foreground: weak (DELTA_LO) defines the mask; strong (DELTA_HI)
    // gates which components are real. Dilate the weak mask to bridge noise gaps
    // in thin strokes into one component.
    const { weak, strong } = buildForegroundMasks(
      gray,
      backgroundGray,
      noClaim,
      DELTA_LO,
      DELTA_HI,
    );
    const bin = dilateMask(weak, w, h, DILATE_RADIUS);
    const { labels, components } = connectedComponents(bin, w, h, MIN_AREA);
    const maxArea = w * h * MAX_AREA_FRAC;

    // Which labels contain at least one strong pixel (hysteresis gate).
    const labelHasStrong = new Set<number>();
    for (let i = 0; i < strong.length; i++) {
      if (strong[i] && labels[i]) labelHasStrong.add(labels[i]);
    }

    if (DEBUG) {
      // Brightness diagnostic: how dark is the frame, how bright is the sampled
      // background, and what is the strongest darkening (max d = bg-gray) seen?
      let binPx = 0;
      for (let i = 0; i < bin.length; i++) binPx += bin[i];
      let graySum = 0;
      let bgSum = 0;
      let maxD = -255;
      let minD = 255;
      for (let i = 0; i < gray.length; i++) {
        graySum += gray[i];
        bgSum += backgroundGray[i];
        const d = backgroundGray[i] - gray[i];
        if (d > maxD) maxD = d;
        if (d < minD) minD = d;
      }
      const n = gray.length;
      console.log(
        `[marks] fg px ${binPx}/${n}, components ${components.length}` +
          `, strong-gated ${labelHasStrong.size}` +
          ` | gray μ${(graySum / n).toFixed(0)} bg μ${(bgSum / n).toFixed(0)}` +
          ` d[${minD}..${maxD}] (DELTA_LO ${DELTA_LO})`,
      );
    }

    const detections: { box: { nx: number; ny: number }[] }[] = [];
    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci];
      if (comp.pixels > maxArea) continue; // background/surface, not a drawing
      const label = comp.label;
      if (!labelHasStrong.has(label)) continue; // no strong pixel → noise, drop
      const inside = (x: number, y: number) => labels[y * w + x] === label;
      const raw = traceContour(comp.startX, comp.startY, w, h, inside);
      const framePoly: FramePoint[] = simplify(raw, RDP_EPSILON);
      if (framePoly.length < 3) continue;
      const box: { nx: number; ny: number }[] = [];
      for (const p of framePoly) {
        const b = mapPointToBox(p);
        if (b) box.push({ nx: b[0], ny: b[1] });
      }
      if (box.length < 3) continue;
      detections.push({ box });
    }

    // Track: match each detection to the nearest existing tracked shape by
    // box-space centroid; otherwise assign a new id.
    const used = new Set<number>();
    const nextTracked: Tracked[] = [];
    for (const det of detections) {
      const [cx, cy] = centroid(det.box);
      let best: Tracked | null = null;
      let bestD = MATCH_DIST;
      for (const t of tracked) {
        if (used.has(t.id)) continue;
        const d = Math.hypot(t.cx - cx, t.cy - cy);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        used.add(best.id);
        const seen = best.seen + 1;
        const published = best.published || seen >= APPEAR_FRAMES;
        // Hold the existing outline while the shape is essentially still; adopt
        // the new outline only when it has moved enough. Kills per-frame wobble.
        const held = bestD < HOLD_TOL;
        nextTracked.push({
          id: best.id,
          cx: held ? best.cx : cx,
          cy: held ? best.cy : cy,
          box: held ? best.box : det.box,
          at: now,
          seen,
          published,
        });
      } else {
        // New candidate — not published until it survives APPEAR_FRAMES.
        nextTracked.push({
          id: nextId++,
          cx,
          cy,
          box: det.box,
          at: now,
          seen: 1,
          published: 1 >= APPEAR_FRAMES,
        });
      }
    }

    // Keep recently-seen tracked shapes that weren't matched this frame, until
    // they go stale (smooths brief detection dropouts).
    for (const t of tracked) {
      if (!nextTracked.some((n) => n.id === t.id) && now - t.at < STALE_MS) {
        nextTracked.push(t);
      }
    }

    tracked = nextTracked;
    publish();
  }

  return {
    async ensure() {
      // No async init (pure JS); just (re)mark ready so a demand-driven restart
      // after stop() resumes processing.
      status = "ready";
    },
    process,
    get status() {
      return status;
    },
    stop() {
      status = "idle";
      tracked = [];
    },
  };
}
