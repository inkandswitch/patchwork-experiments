/**
 * AprilTag recognizer (tag36h11 WASM detector in a Comlink Web Worker).
 *
 * Driven by the host's shared frame loop: each `process(frame)` runs the
 * detector on the frame's grayscale buffer, maps each detection's center + all
 * four corners to box-normalized [0..1] via `frame.mapPointToBox`, derives an
 * angle, culls tags outside the board, keeps a short-lived stale map, and
 * publishes `{ tags }` into the host-provided Emitter.
 */

import { BOARD_MARGIN } from "../../apriltag-core.js";
import type { Emitter } from "../../spatial-source.js";
import type { Frame, Recognizer, RecognizerStatus } from "../types.js";
import type { SpatialTag, SpatialTags } from "./types.js";

type RawDetection = {
  id: number;
  center: { x: number; y: number };
  corners: { x: number; y: number }[];
};

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export function createApriltagRecognizer(
  emitter: Emitter<SpatialTags>,
  opts: {
    staleMs?: number;
    onStatus?: (status: RecognizerStatus, error?: string) => void;
  } = {},
): Recognizer {
  const { staleMs = 600, onStatus } = opts;

  let worker: Worker | null = null;
  let detector: {
    detect(gray: Uint8Array, w: number, h: number): Promise<RawDetection[]>;
  } | null = null;
  let status: RecognizerStatus = "idle";
  let inFlight = false;
  const liveTags = new Map<string, { tag: SpatialTag; at: number }>();

  function setStatus(next: RecognizerStatus, error?: string) {
    status = next;
    onStatus?.(next, error);
  }

  async function ensure(): Promise<void> {
    if (status === "ready" || status === "loading") return;
    setStatus("loading");
    try {
      // Worker + comlink are vendored at the package root; this module lives at
      // src/layers/apriltags/, so the siblings are three levels up.
      const { wrap, proxy } = await import(
        /* @vite-ignore */ new URL("../../../vendor/comlink.mjs", import.meta.url)
          .href
      );
      worker = new Worker(new URL("../../../vendor/apriltag.js", import.meta.url));
      worker.addEventListener("error", (event) => {
        setStatus("error", event.message || "worker error");
      });
      const AprilTagClass = wrap(worker);
      const instancePromise = new AprilTagClass(proxy(() => {}));
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("detector load timed out")), 20000),
      );
      detector = (await Promise.race([instancePromise, timeout])) as typeof detector;
      setStatus("ready");
    } catch (err) {
      setStatus("error", String((err as Error)?.message ?? err));
    }
  }

  function sweepStale(now: number): boolean {
    const cutoff = now - staleMs;
    let changed = false;
    for (const [key, entry] of liveTags) {
      if (entry.at < cutoff) {
        liveTags.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  function publish() {
    emitter.set({
      tags: [...liveTags.values()].map((e) => e.tag).sort((a, b) => a.id - b.id),
    });
  }

  function process(frame: Frame): void {
    if (inFlight || !detector || status !== "ready") return;
    inFlight = true;
    const { gray, w, h, mapPointToBox, now } = frame;
    void detector
      .detect(gray, w, h)
      .then((detections) => {
        for (const det of detections || []) {
          if (!det || det.center == null || det.id == null) continue;
          const center = mapPointToBox(det.center);
          if (!center) continue;
          if (
            center[0] < -BOARD_MARGIN ||
            center[0] > 1 + BOARD_MARGIN ||
            center[1] < -BOARD_MARGIN ||
            center[1] > 1 + BOARD_MARGIN
          ) {
            continue;
          }
          const rawCorners = Array.isArray(det.corners) ? det.corners : [];
          const corners = rawCorners.map(mapPointToBox);
          const cornersOk = corners.length === 4 && corners.every(Boolean);
          const angle = cornersOk
            ? Math.atan2(
                corners[1]![1] - corners[0]![1],
                corners[1]![0] - corners[0]![0],
              )
            : 0;
          liveTags.set(String(det.id), {
            tag: {
              id: det.id,
              nx: center[0],
              ny: center[1],
              angle,
              corners: cornersOk
                ? corners.map((c) => ({ nx: c![0], ny: c![1] }))
                : [],
            },
            at: now,
          });
        }
        sweepStale(now);
        publish();
      })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  }

  // Expire stale tags independent of detection cadence.
  const staleTimer = setInterval(() => {
    if (liveTags.size && sweepStale(nowMs())) publish();
  }, 250);

  return {
    ensure,
    process,
    get status() {
      return status;
    },
    stop() {
      clearInterval(staleTimer);
      detector = null;
      if (worker) {
        worker.terminate();
        worker = null;
      }
      liveTags.clear();
      inFlight = false;
      setStatus("idle");
    },
  };
}
