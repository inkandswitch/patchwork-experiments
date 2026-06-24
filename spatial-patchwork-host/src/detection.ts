/**
 * Live AprilTag detection subsystem (tag36h11 WASM detector in a Comlink Web
 * Worker). Each pass maps the tag center AND all four corners through the
 * camera->board homography — board space == the aligned box, so these are
 * already normalized 0..1 within the box — derives an angle, and pushes a
 * normalized-only tag list into the host's SpatialSource.apriltags emitter.
 */

import {
  DETECT_INTERVAL_MS,
  DETECT_MAX_DIM,
  BOARD_MARGIN,
  cameraPointToBoard,
} from "./apriltag-core.js";
import type { Emitter, SpatialTags, SpatialTag } from "./spatial-source.js";

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

type Size = { w: number; h: number };
type DetectorState = "idle" | "loading" | "ready" | "error";

export interface DetectorOptions {
  video: HTMLVideoElement;
  getDocState: () => { homographyCamToBoard: number[] | null } | null;
  getLiveSize: () => Size | null;
  tagsEmitter: Emitter<SpatialTags>;
  onStateChange?: (state: DetectorState, error?: string) => void;
  staleMs?: number;
}

export interface Detector {
  ensure(): Promise<void>;
  readonly state: DetectorState;
  stop(): void;
}

export function createDetector(opts: DetectorOptions): Detector {
  const {
    video,
    getDocState,
    getLiveSize,
    tagsEmitter,
    onStateChange,
    staleMs = 600,
  } = opts;

  let worker: Worker | null = null;
  let detector: { detect(gray: Uint8Array, w: number, h: number): Promise<RawDetection[]> } | null =
    null;
  let state: DetectorState = "idle";
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const canvas = document.createElement("canvas");
  const liveTags = new Map<string, { tag: SpatialTag; at: number }>();

  function setState(next: DetectorState, error?: string) {
    state = next;
    onStateChange?.(next, error);
  }

  async function ensure(): Promise<void> {
    if (state === "ready" || state === "loading") return;
    setState("loading");
    try {
      const { wrap, proxy } = await import(
        /* @vite-ignore */ new URL("../vendor/comlink.mjs", import.meta.url).href
      );
      worker = new Worker(new URL("../vendor/apriltag.js", import.meta.url));
      worker.addEventListener("error", (event) => {
        setState("error", event.message || "worker error");
      });
      const AprilTagClass = wrap(worker);
      const instancePromise = new AprilTagClass(proxy(() => {}));
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("detector load timed out")), 20000),
      );
      detector = (await Promise.race([instancePromise, timeout])) as typeof detector;
      setState("ready");
      startLoop();
    } catch (err) {
      setState("error", String((err as Error)?.message ?? err));
    }
  }

  function startLoop() {
    if (loopTimer || state !== "ready") return;
    loopTimer = setInterval(() => void runPass(), DETECT_INTERVAL_MS);
  }

  function stopLoop() {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    inFlight = false;
  }

  function sweepStale(): boolean {
    const cutoff = nowMs() - staleMs;
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
    const tags = [...liveTags.values()]
      .map((e) => e.tag)
      .sort((a, b) => a.id - b.id);
    tagsEmitter.set({ tags });
  }

  async function runPass(): Promise<void> {
    if (inFlight || !detector || state !== "ready") return;
    const docState = getDocState();
    if (!docState || !docState.homographyCamToBoard) return;
    const liveSize = getLiveSize();
    if (!liveSize) return;

    inFlight = true;
    try {
      const scale = Math.min(1, DETECT_MAX_DIM / Math.max(liveSize.w, liveSize.h));
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
      const detections = (await detector.detect(gray, w, h)) || [];
      const now = nowMs();

      const toBox = (px: { x: number; y: number }) => {
        const cameraPoint: [number, number] = [px.x / scale, px.y / scale];
        return cameraPointToBoard(docState, cameraPoint, liveSize) as
          | [number, number]
          | null;
      };

      for (const det of detections) {
        if (!det || det.center == null || det.id == null) continue;
        const center = toBox(det.center);
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
        const corners = rawCorners.map(toBox);
        const cornersOk = corners.length === 4 && corners.every(Boolean);
        const angle = cornersOk
          ? Math.atan2(
              corners[1]![1] - corners[0]![1],
              corners[1]![0] - corners[0]![0],
            )
          : 0;
        const tag: SpatialTag = {
          id: det.id,
          nx: center[0],
          ny: center[1],
          angle,
          corners: cornersOk
            ? corners.map((c) => ({ nx: c![0], ny: c![1] }))
            : [],
        };
        liveTags.set(String(det.id), { tag, at: now });
      }
      sweepStale();
      publish();
    } finally {
      inFlight = false;
    }
  }

  const staleTimer = setInterval(() => {
    if (liveTags.size && sweepStale()) publish();
  }, 250);

  return {
    ensure,
    get state() {
      return state;
    },
    stop() {
      stopLoop();
      clearInterval(staleTimer);
      detector = null;
      if (worker) {
        worker.terminate();
        worker = null;
      }
      liveTags.clear();
      setState("idle");
    },
  };
}

type RawDetection = {
  id: number;
  center: { x: number; y: number };
  corners: { x: number; y: number }[];
};
