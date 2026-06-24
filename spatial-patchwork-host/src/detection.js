/**
 * Live AprilTag detection subsystem for the spatial host.
 *
 * Ported from apriltag-projector's detector + runDetectionPass, but instead of
 * keeping only the tag center and broadcasting board coords over the ephemeral
 * channel, it maps the center AND all four corners through the same
 * camera->board homography (board space == the aligned box, so these are
 * already normalized 0..1 within the box), derives an angle, and pushes a
 * normalized-only tag list into the host's SpatialSource.apriltags emitter.
 *
 * The detector runs in a classic Web Worker (vendor/apriltag.js, tag36h11) via
 * Comlink so per-frame CV never blocks the projector UI.
 */

import {
  DETECT_INTERVAL_MS,
  DETECT_MAX_DIM,
  BOARD_MARGIN,
  cameraPointToBoard,
} from "./apriltag-core.js";

function nowMs() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * Create a detector bound to a <video> element, a docState getter (returns the
 * calibration docState: { mode, homographyCamToBoard, cameraCalibrationSize, ... }),
 * and a SpatialSource to push tags into.
 *
 * @param {Object} opts
 * @param {HTMLVideoElement} opts.video       the live camera video element
 * @param {() => Object|null} opts.getDocState calibration docState (or null)
 * @param {() => {w:number,h:number}|null} opts.getLiveSize  intrinsic camera size
 * @param {import("./spatial-source.js").Emitter} opts.tagsEmitter  source.apriltags
 * @param {(state: string, error?: string) => void} [opts.onStateChange]
 * @param {number} [opts.staleMs] drop a tag not seen for this long (ms)
 */
export function createDetector(opts) {
  const {
    video,
    getDocState,
    getLiveSize,
    tagsEmitter,
    onStateChange,
    staleMs = 600,
  } = opts;

  let worker = null;
  let detector = null;
  let state = "idle"; // idle | loading | ready | error
  let loopTimer = null;
  let inFlight = false;
  const canvas = document.createElement("canvas");
  // id -> { tag, at }
  const liveTags = new Map();

  function setState(next, error) {
    state = next;
    onStateChange?.(next, error);
  }

  async function ensure() {
    if (state === "ready" || state === "loading") return;
    setState("loading");
    try {
      const { wrap, proxy } = await import(
        new URL("../vendor/comlink.mjs", import.meta.url).href
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
      detector = await Promise.race([instancePromise, timeout]);
      setState("ready");
      startLoop();
    } catch (err) {
      setState("error", String((err && err.message) || err));
    }
  }

  function startLoop() {
    if (loopTimer || state !== "ready") return;
    loopTimer = setInterval(() => runPass(), DETECT_INTERVAL_MS);
  }

  function stopLoop() {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    inFlight = false;
  }

  function sweepStale() {
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

  async function runPass() {
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
        // Rec. 601 luma.
        gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
      }
      const detections = (await detector.detect(gray, w, h)) || [];
      const now = nowMs();

      // Map a downscaled-image pixel through the camera->board homography to
      // normalized box coords [0..1]. Returns null if outside the box (+margin).
      const toBox = (px) => {
        const cameraPoint = [px.x / scale, px.y / scale];
        return cameraPointToBoard(docState, cameraPoint, liveSize);
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
        // Require all corners to map; otherwise we can't draw an oriented tag.
        const cornersOk = corners.length === 4 && corners.every(Boolean);
        const angle = cornersOk
          ? Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0])
          : 0;
        const tag = {
          id: det.id,
          nx: center[0],
          ny: center[1],
          angle,
          corners: cornersOk
            ? corners.map(([nx, ny]) => ({ nx, ny }))
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

  // Periodically expire stale tags even when no new detections arrive.
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
