/**
 * Walls recognizer: contour-detects dark-on-light drawings/objects in the
 * grayscale frame (ignoring pixels earlier layers already claimed), simplifies
 * each outline to a polygon, tracks stable ids frame-to-frame, and publishes
 * box-normalized shapes on `spatial:walls`. It also stamps its outlines into the
 * shared mask (claimSync) and reports them (frame px) for the host blackout.
 *
 * Pure JS, runs on the main thread within the per-tick budget at the downscaled
 * frame size. Tunables are the constants below.
 */

import type { Emitter } from "../../spatial-source.js";
import type { Frame, Recognizer, RecognizerStatus, FramePoint } from "../types.js";
import { fillPolygon } from "../raster.js";
import {
  buildForegroundMask,
  connectedComponents,
  traceContour,
  simplify,
} from "./cv.js";
import type { Walls, WallShape } from "./types.js";

// Tunables.
const MIN_AREA = 80; // drop blobs smaller than this many frame px (noise specks)
// Drop blobs larger than this fraction of the frame — that's the surface /
// background, not a drawing. Prevents a full-frame "blob" from blacking out the
// whole box (rare with background-diff, but a cheap safety net).
const MAX_AREA_FRAC = 0.4;
const RDP_EPSILON = 2.0; // contour simplification tolerance (frame px)
// A pixel counts as a black marker mark if it's at least this many gray levels
// DARKER than the sampled empty-surface background. Tuned high so only genuinely
// dark marks register (black ink), not faint shadows / mid-tones / color. Tunable.
const DARKNESS_DELTA = 60;
const MATCH_DIST = 0.06; // box-space centroid distance to keep a tag's id (tracking)
const STALE_MS = 600;
// Temporary diagnostics — flip off once walls detection is confirmed working.
const DEBUG = true;

type Tracked = {
  id: number;
  cx: number; // box-space centroid
  cy: number;
  frame: FramePoint[]; // outline in frame px (for mask/blackout)
  box: { nx: number; ny: number }[]; // outline in box coords (published)
  at: number;
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

export function createWallsRecognizer(emitter: Emitter<Walls>): Recognizer {
  // Always "ready" — no async init (pure JS).
  let status: RecognizerStatus = "ready";
  let nextId = 1;
  let tracked: Tracked[] = [];
  let lastFramePolys: FramePoint[][] = [];

  function publish() {
    emitter.set({
      shapes: tracked
        .map<WallShape>((t) => ({ id: t.id, points: t.box }))
        .sort((a, b) => a.id - b.id),
    });
  }

  function process(frame: Frame): void {
    const { gray, w, h, mask, backgroundGray, mapPointToBox, now } = frame;

    // No background sampled (or it doesn't align with the current frame) → we
    // can't tell drawings from the surface. Publish nothing, claim nothing.
    if (!backgroundGray || backgroundGray.length !== gray.length) {
      if (DEBUG)
        console.log(
          "[walls] no background",
          backgroundGray ? `len ${backgroundGray.length} vs ${gray.length}` : "null",
        );
      if (tracked.length) {
        tracked = [];
        lastFramePolys = [];
        publish();
      }
      return;
    }

    const bin = buildForegroundMask(gray, backgroundGray, mask, DARKNESS_DELTA);
    const { labels, components } = connectedComponents(bin, w, h, MIN_AREA);
    const maxArea = w * h * MAX_AREA_FRAC;

    if (DEBUG) {
      let fgCount = 0;
      for (let i = 0; i < bin.length; i++) fgCount += bin[i];
      console.log(
        `[walls] fg px ${fgCount}/${bin.length}, components ${components.length}` +
          ` (kept area ${MIN_AREA}..${Math.round(maxArea)})`,
      );
    }

    const detections: { frame: FramePoint[]; box: { nx: number; ny: number }[] }[] =
      [];
    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci];
      if (comp.pixels > maxArea) continue; // background/surface, not a drawing
      const label = comp.label; // actual value stored in `labels` for this blob
      const inside = (x: number, y: number) => labels[y * w + x] === label;
      const raw = traceContour(comp.startX, comp.startY, w, h, inside);
      const framePoly = simplify(raw, RDP_EPSILON);
      if (framePoly.length < 3) continue;
      const box: { nx: number; ny: number }[] = [];
      for (const p of framePoly) {
        const b = mapPointToBox(p);
        if (b) box.push({ nx: b[0], ny: b[1] });
      }
      if (box.length < 3) continue;
      detections.push({ frame: framePoly, box });
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
      const id = best ? best.id : nextId++;
      if (best) used.add(best.id);
      nextTracked.push({ id, cx, cy, frame: det.frame, box: det.box, at: now });
    }

    // Keep recently-seen tracked shapes that weren't matched this frame, until
    // they go stale (smooths brief detection dropouts).
    for (const t of tracked) {
      if (!nextTracked.some((n) => n.id === t.id) && now - t.at < STALE_MS) {
        nextTracked.push(t);
      }
    }

    tracked = nextTracked;
    lastFramePolys = tracked.map((t) => t.frame);
    publish();
  }

  return {
    async ensure() {
      /* no async init */
    },
    claimSync(frame: Frame) {
      // Stamp this layer's current outlines into the shared mask so it doesn't
      // re-detect them and the host blacks them out. (No-op the first tick.)
      for (const poly of lastFramePolys) {
        fillPolygon(frame.mask, frame.w, frame.h, poly);
      }
    },
    process,
    get status() {
      return status;
    },
    stop() {
      status = "idle";
      tracked = [];
      lastFramePolys = [];
    },
  };
}
