/**
 * AprilTag Projector - Bundleless Patchwork Tool
 *
 * Built on the spatial-calibration tool. It keeps the full camera-projector
 * calibration flow (align -> calibrate -> test) that maps:
 *
 *   camera pixels -> board coordinates -> projector fractions
 *
 * and adds a fourth "use" mode: the camera-side view runs a live AprilTag
 * detector (tag36h11) in a Web Worker, maps each detected tag's center through
 * the solved camera->board homography, and broadcasts the detections to peers.
 * Every view then projects an editable label next to each tag on the same
 * physical spot on the board.
 *
 * Detection runs only in the view whose camera is on; live tag positions travel
 * over the DocHandle's ephemeral broadcast channel (never persisted). Only the
 * editable label *names* (doc.tagLabels) are stored in the document.
 *
 * @typedef {Object} CameraViewBox
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 *
 * @typedef {Object} CameraSize
 * @property {number} w
 * @property {number} h
 *
 * @typedef {Object} CalibrationPair
 * @property {[number, number]} board
 * @property {[number, number]} camera
 * @property {CameraSize | null} cameraSize
 *
 * @typedef {Object} TestMarker
 * @property {[number, number]} board
 * @property {[number, number]} camera
 *
 * @typedef {Object} DetectedTag
 * @property {number} id
 * @property {[number, number]} board
 *
 * @typedef {Object} AprilTagProjectorDoc
 * @property {string} title
 * @property {CameraViewBox} cameraViewBox
 * @property {4 | 9} gridSize
 * @property {Record<string, CalibrationPair>} pairs
 * @property {number[] | null} homographyCamToBoard
 * @property {number[] | null} homographyBoardToCam
 * @property {"align" | "calibrate" | "test" | "use"} mode
 * @property {CameraSize | null} cameraCalibrationSize
 * @property {string} activeTargetId
 * @property {TestMarker[]} testMarkers
 * @property {Record<string, string>} tagLabels
 * @property {boolean} hideCursor
 */

const VERSION = "0.0.2";
const EPSILON = 1e-9;
const STEP = 0.005;
const COARSE = 0.02;
const MAX_TEST_MARKERS = 8;

// How often the camera-side view runs a detection pass (ms). The detector runs
// off-thread, but downscaling + grayscale conversion happen on the main thread.
export const DETECT_INTERVAL_MS = 90;
// Longest edge (px) we downscale camera frames to before detection. Sized so a
// 75 mm tag at ~1 m (≈5% of the frame width) lands at ~70 px in the detected
// image — comfortably above the ~30 px floor, even after the detector's internal
// quad_decimate. Raising this improves small/distant tags at ~quadratic CPU cost.
export const DETECT_MAX_DIM = 1280;
// Drop a broadcast tag if it hasn't been seen again within this window (ms).
const TAG_STALE_MS = 600;
// Ignore detected centers that map this far outside the [0,1] board.
export const BOARD_MARGIN = 0.05;

const TARGETS_4 = Object.freeze([
  { id: "A", label: "A", board: [0, 0] },
  { id: "B", label: "B", board: [1, 0] },
  { id: "C", label: "C", board: [1, 1] },
  { id: "D", label: "D", board: [0, 1] },
]);

const TARGETS_9 = Object.freeze([
  { id: "A", label: "A", board: [0, 0] },
  { id: "B", label: "B", board: [1, 0] },
  { id: "C", label: "C", board: [1, 1] },
  { id: "D", label: "D", board: [0, 1] },
  { id: "E", label: "E", board: [0.5, 0] },
  { id: "F", label: "F", board: [1, 0.5] },
  { id: "G", label: "G", board: [0.5, 1] },
  { id: "H", label: "H", board: [0, 0.5] },
  { id: "I", label: "I", board: [0.5, 0.5] },
]);

// ============================================================================
// Datatype
// ============================================================================

export const AprilTagProjectorDatatype = {
  init(doc) {
    doc.title = "AprilTag Projector";
    doc.cameraViewBox = { x: 0, y: 0, w: 1, h: 1 };
    doc.mode = "align";
    doc.gridSize = 4;
    doc.pairs = {};
    doc.homographyCamToBoard = null;
    doc.homographyBoardToCam = null;
    doc.cameraCalibrationSize = null;
    doc.activeTargetId = "A";
    doc.testMarkers = [];
    doc.tagLabels = {};
    doc.hideCursor = false;
  },

  getTitle(doc) {
    return doc.title || "AprilTag Projector";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Helpers
// ============================================================================

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function clonePoint(point) {
  return [point[0], point[1]];
}

export function cloneSize(size) {
  return size ? { w: size.w, h: size.h } : null;
}

export function getCalibrationTargets(gridSize) {
  const source = Number(gridSize) === 9 ? TARGETS_9 : TARGETS_4;
  return source.map((target) => ({
    id: target.id,
    label: target.label,
    board: clonePoint(target.board),
  }));
}

function normalizeGridSize(value) {
  return Number(value) === 9 ? 9 : 4;
}

function normalizeMode(value) {
  return value === "calibrate" || value === "test" || value === "use"
    ? value
    : "align";
}

function normalizeTagLabels(value) {
  const next = {};
  if (!value || typeof value !== "object") return next;
  for (const [id, label] of Object.entries(value)) {
    if (typeof label === "string" && label.length) next[String(id)] = label;
  }
  return next;
}

function defaultTagLabel(id) {
  return `Tag ${id}`;
}

function tagLabelFor(tagLabels, id) {
  const stored = tagLabels && tagLabels[String(id)];
  return stored && stored.length ? stored : defaultTagLabel(id);
}

function normalizeBox(box) {
  const b = box || {};
  const w = Math.max(0.02, Math.min(isFiniteNumber(b.w) ? b.w : 1, 1));
  const h = Math.max(0.02, Math.min(isFiniteNumber(b.h) ? b.h : 1, 1));
  const x = clamp01(isFiniteNumber(b.x) ? b.x : 0);
  const y = clamp01(isFiniteNumber(b.y) ? b.y : 0);
  return {
    x: Math.min(x, 1 - w),
    y: Math.min(y, 1 - h),
    w,
    h,
  };
}

function normalizePoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

export function normalizeCameraSize(value) {
  if (!value) return null;
  const w = Number(value.w ?? value[0]);
  const h = Number(value.h ?? value[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { w, h };
}

function normalizeCalibrationPair(value) {
  if (!value || typeof value !== "object") return null;
  const board = normalizePoint(value.board);
  const camera = normalizePoint(value.camera);
  if (!board || !camera) return null;
  return {
    board,
    camera,
    cameraSize: normalizeCameraSize(value.cameraSize),
  };
}

function normalizePairs(pairs) {
  const next = {};
  if (!pairs || typeof pairs !== "object") return next;
  for (const [id, value] of Object.entries(pairs)) {
    const pair = normalizeCalibrationPair(value);
    if (pair) next[id] = pair;
  }
  return next;
}

function normalizeHomography(H) {
  if (!Array.isArray(H) || H.length !== 9) return null;
  const next = H.map(Number);
  return next.every(Number.isFinite) ? next : null;
}

function normalizeTestMarkers(value) {
  if (!Array.isArray(value)) return [];
  const markers = [];
  for (const item of value) {
    const board = normalizePoint(item && item.board);
    const camera = normalizePoint(item && item.camera);
    if (board && camera) markers.push({ board, camera });
  }
  return markers.slice(-MAX_TEST_MARKERS);
}

export function makeDefaultDocState(doc) {
  const targets = getCalibrationTargets(doc && doc.gridSize);
  const activeTargetId = ensureActiveTargetId(
    doc && doc.activeTargetId,
    targets,
  );
  return {
    box: normalizeBox(doc && doc.cameraViewBox),
    mode: normalizeMode(doc && doc.mode),
    gridSize: normalizeGridSize(doc && doc.gridSize),
    pairs: normalizePairs(doc && doc.pairs),
    homographyCamToBoard: normalizeHomography(doc && doc.homographyCamToBoard),
    homographyBoardToCam: normalizeHomography(doc && doc.homographyBoardToCam),
    cameraCalibrationSize: normalizeCameraSize(
      doc && doc.cameraCalibrationSize,
    ),
    activeTargetId,
    testMarkers: normalizeTestMarkers(doc && doc.testMarkers),
    tagLabels: normalizeTagLabels(doc && doc.tagLabels),
    hideCursor: !!(doc && doc.hideCursor),
    title: doc && doc.title ? doc.title : "AprilTag Projector",
  };
}

function ensureActiveTargetId(id, targets) {
  const normalized = String(id || "");
  if (targets.some((target) => target.id === normalized)) return normalized;
  return targets[0] ? targets[0].id : "";
}

function getTargetIndex(targets, targetId) {
  return targets.findIndex((target) => target.id === targetId);
}

function getTargetById(targets, targetId) {
  return targets.find((target) => target.id === targetId) || null;
}

export function countCapturedTargets(targets, pairs) {
  let count = 0;
  for (const target of targets) {
    if (pairs[target.id]) count++;
  }
  return count;
}

export function nextIncompleteTargetId(targets, pairs, afterId) {
  if (!targets.length) return "";
  const startIndex = Math.max(0, getTargetIndex(targets, afterId));
  for (let offset = 1; offset <= targets.length; offset++) {
    const target = targets[(startIndex + offset) % targets.length];
    if (!pairs[target.id]) return target.id;
  }
  return afterId || targets[0].id;
}

function prevTargetId(targets, activeTargetId) {
  if (!targets.length) return "";
  const index = Math.max(0, getTargetIndex(targets, activeTargetId));
  return targets[(index - 1 + targets.length) % targets.length].id;
}

function nextTargetId(targets, activeTargetId) {
  if (!targets.length) return "";
  const index = Math.max(0, getTargetIndex(targets, activeTargetId));
  return targets[(index + 1) % targets.length].id;
}

export function projectBoardToStage(box, board) {
  return [box.x + board[0] * box.w, box.y + board[1] * box.h];
}

export function chooseCalibrationSize(targets, pairs, preferredSize) {
  const preferred = normalizeCameraSize(preferredSize);
  if (preferred) return preferred;
  for (const target of targets) {
    const size = normalizeCameraSize(
      pairs[target.id] && pairs[target.id].cameraSize,
    );
    if (size) return size;
  }
  return null;
}

export function scalePoint(point, fromSize, toSize) {
  const from = normalizeCameraSize(fromSize);
  const to = normalizeCameraSize(toSize);
  if (!from || !to) return clonePoint(point);
  return [(point[0] * to.w) / from.w, (point[1] * to.h) / from.h];
}

function liveCameraToCalibrationPoint(point, liveSize, calibrationSize) {
  return scalePoint(point, liveSize, calibrationSize);
}

function calibrationPointToLive(point, calibrationSize, liveSize) {
  return scalePoint(point, calibrationSize, liveSize);
}

function getCameraSizeLabel(size) {
  const normalized = normalizeCameraSize(size);
  return normalized ? `${normalized.w}×${normalized.h}` : "";
}

// ============================================================================
// Homography math
// ============================================================================

function multiplyMatrices3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function gaussianSolve(A, b) {
  const n = Array.isArray(A) ? A.length : 0;
  if (!n || !Array.isArray(b) || b.length !== n) return null;
  const M = A.map((row) => row.map(Number));
  const rhs = b.map(Number);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(M[row][col]);
      if (value > pivotAbs) {
        pivotAbs = value;
        pivotRow = row;
      }
    }
    if (pivotAbs < EPSILON) return null;
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]];
    }
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      if (Math.abs(factor) < EPSILON) continue;
      for (let k = col; k < n; k++) {
        M[row][k] -= factor * M[col][k];
      }
      rhs[row] -= factor * rhs[col];
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let col = row + 1; col < n; col++) {
      sum -= M[row][col] * solution[col];
    }
    if (Math.abs(M[row][row]) < EPSILON) return null;
    solution[row] = sum / M[row][row];
  }
  return solution;
}

export function solveHomography(srcPts, dstPts) {
  if (!Array.isArray(srcPts) || !Array.isArray(dstPts)) return null;
  if (srcPts.length !== dstPts.length || srcPts.length < 4) return null;

  const A = [];
  const b = [];
  for (let i = 0; i < srcPts.length; i++) {
    const src = normalizePoint(srcPts[i]);
    const dst = normalizePoint(dstPts[i]);
    if (!src || !dst) return null;
    const [x, y] = src;
    const [u, v] = dst;
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const ata = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb = new Array(8).fill(0);
  for (let row = 0; row < A.length; row++) {
    for (let col = 0; col < 8; col++) {
      atb[col] += A[row][col] * b[row];
      for (let inner = 0; inner < 8; inner++) {
        ata[col][inner] += A[row][col] * A[row][inner];
      }
    }
  }

  const h = gaussianSolve(ata, atb);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(H, point) {
  const homography = normalizeHomography(H);
  const p = normalizePoint(point);
  if (!homography || !p) return null;
  const [x, y] = p;
  const w = homography[6] * x + homography[7] * y + homography[8];
  if (Math.abs(w) < EPSILON) return null;
  return [
    (homography[0] * x + homography[1] * y + homography[2]) / w,
    (homography[3] * x + homography[4] * y + homography[5]) / w,
  ];
}

export function invertHomography(H) {
  const h = normalizeHomography(H);
  if (!h) return null;
  const a = h[0];
  const b = h[1];
  const c = h[2];
  const d = h[3];
  const e = h[4];
  const f = h[5];
  const g = h[6];
  const i = h[7];
  const j = h[8];

  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const D = -(b * j - c * i);
  const E = a * j - c * g;
  const F = -(a * i - b * g);
  const G = b * f - c * e;
  const Hc = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < EPSILON) return null;

  return [
    A / det,
    D / det,
    G / det,
    B / det,
    E / det,
    Hc / det,
    C / det,
    F / det,
    I / det,
  ];
}

export function solveCameraToBoardHomography(targets, pairs, calibrationSize) {
  const size = normalizeCameraSize(calibrationSize);
  if (!size) return null;
  const srcPts = [];
  const dstPts = [];
  for (const target of targets) {
    const pair = pairs[target.id];
    if (!pair) return null;
    const pairSize = normalizeCameraSize(pair.cameraSize) || size;
    const calibrationPoint = scalePoint(pair.camera, pairSize, size);
    srcPts.push([calibrationPoint[0] / size.w, calibrationPoint[1] / size.h]);
    dstPts.push(clonePoint(pair.board || target.board));
  }
  const normalizedHomography = solveHomography(srcPts, dstPts);
  if (!normalizedHomography) return null;
  const sourceScale = [1 / size.w, 0, 0, 0, 1 / size.h, 0, 0, 0, 1];
  return multiplyMatrices3(normalizedHomography, sourceScale);
}

export function computeMeanReprojectionErrorPx(
  targets,
  pairs,
  boardToCam,
  calibrationSize,
) {
  const H = normalizeHomography(boardToCam);
  const size = normalizeCameraSize(calibrationSize);
  if (!H || !size) return null;
  let sum = 0;
  let count = 0;
  for (const target of targets) {
    const pair = pairs[target.id];
    if (!pair) continue;
    const predicted = applyHomography(H, pair.board || target.board);
    if (!predicted) continue;
    const pairSize = normalizeCameraSize(pair.cameraSize) || size;
    const actual = scalePoint(pair.camera, pairSize, size);
    const dx = predicted[0] - actual[0];
    const dy = predicted[1] - actual[1];
    sum += Math.hypot(dx, dy);
    count++;
  }
  return count ? sum / count : null;
}

export function cameraPointToBoard(docState, cameraPoint, liveSize) {
  const H = docState.homographyCamToBoard;
  const calibrationSize =
    docState.cameraCalibrationSize || normalizeCameraSize(liveSize);
  if (!H || !calibrationSize) return null;
  const calibrationPoint = liveCameraToCalibrationPoint(
    cameraPoint,
    liveSize,
    calibrationSize,
  );
  return applyHomography(H, calibrationPoint);
}

export function boardPointToCamera(docState, boardPoint, liveSize) {
  const H = docState.homographyBoardToCam;
  const calibrationSize =
    docState.cameraCalibrationSize || normalizeCameraSize(liveSize);
  if (!H || !calibrationSize) return null;
  const calibrationPoint = applyHomography(H, boardPoint);
  if (!calibrationPoint) return null;
  return calibrationPointToLive(calibrationPoint, calibrationSize, liveSize);
}

// ============================================================================
// Styles
// ============================================================================

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @layer package {
      :root,
      :host,
      [theme] {
        --sc-bar-bg: var(--studio-fill, white);
        --sc-bar-fg: var(--studio-line, black);
        --sc-bar-border: var(--studio-fill-offset-20, #ccc);
        --sc-bar-muted: var(--studio-line-offset-50, #888);
        --sc-accent: var(--studio-primary, #35f7ca);
        --sc-danger: var(--studio-danger, #e5484d);
        --sc-family: var(--studio-family-sans, system-ui, sans-serif);
      }
    }

    .apriltag-projector {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      overflow: hidden;
      background: #000;
      font-family: var(--sc-family);
    }

    .apriltag-projector .view-layer {
      position: absolute;
      inset: 0;
    }

    .apriltag-projector .stage {
      position: absolute;
      inset: 2px;
      background: #000;
    }

    .apriltag-projector[data-clean][data-hide-cursor] .stage {
      cursor: none;
    }

    .apriltag-projector .board-frame {
      position: absolute;
      box-sizing: border-box;
      border: 1px dashed rgba(255, 255, 255, 0.25);
      pointer-events: none;
    }

    .apriltag-projector .view-box {
      position: absolute;
      box-sizing: border-box;
      border: 4px solid #fff;
      background: transparent;
    }

    .apriltag-projector[data-mode="align"]:not([data-clean]) .view-box {
      cursor: move;
      touch-action: none;
    }

    .apriltag-projector:not([data-mode="align"]) .view-box,
    .apriltag-projector[data-clean] .view-box {
      pointer-events: none;
    }

    .apriltag-projector .view-box .resize-handle {
      position: absolute;
      touch-action: none;
      z-index: 2;
    }

    .apriltag-projector .view-box .resize-handle[data-dir="n"],
    .apriltag-projector .view-box .resize-handle[data-dir="s"] {
      left: 14px;
      right: 14px;
      height: 12px;
      cursor: ns-resize;
    }

    .apriltag-projector .view-box .resize-handle[data-dir="e"],
    .apriltag-projector .view-box .resize-handle[data-dir="w"] {
      top: 14px;
      bottom: 14px;
      width: 12px;
      cursor: ew-resize;
    }

    .apriltag-projector .view-box .resize-handle[data-dir="n"] { top: -4px; }
    .apriltag-projector .view-box .resize-handle[data-dir="s"] { bottom: -4px; }
    .apriltag-projector .view-box .resize-handle[data-dir="w"] { left: -4px; }
    .apriltag-projector .view-box .resize-handle[data-dir="e"] { right: -4px; }

    .apriltag-projector .view-box .resize-handle[data-dir="nw"],
    .apriltag-projector .view-box .resize-handle[data-dir="ne"],
    .apriltag-projector .view-box .resize-handle[data-dir="sw"],
    .apriltag-projector .view-box .resize-handle[data-dir="se"] {
      width: 16px;
      height: 16px;
    }

    .apriltag-projector .view-box .resize-handle[data-dir="nw"] { top: -4px; left: -4px; cursor: nwse-resize; }
    .apriltag-projector .view-box .resize-handle[data-dir="se"] { bottom: -4px; right: -4px; cursor: nwse-resize; }
    .apriltag-projector .view-box .resize-handle[data-dir="ne"] { top: -4px; right: -4px; cursor: nesw-resize; }
    .apriltag-projector .view-box .resize-handle[data-dir="sw"] { bottom: -4px; left: -4px; cursor: nesw-resize; }

    .apriltag-projector[data-mode="align"]:not([data-clean]) .view-box .resize-handle[data-dir="nw"],
    .apriltag-projector[data-mode="align"]:not([data-clean]) .view-box .resize-handle[data-dir="ne"],
    .apriltag-projector[data-mode="align"]:not([data-clean]) .view-box .resize-handle[data-dir="sw"],
    .apriltag-projector[data-mode="align"]:not([data-clean]) .view-box .resize-handle[data-dir="se"] {
      background: var(--sc-accent);
      border-radius: 2px;
    }

    .apriltag-projector[data-clean] .view-box .resize-handle,
    .apriltag-projector:not([data-mode="align"]) .view-box .resize-handle {
      display: none;
    }

    .apriltag-projector .view-box .corner {
      position: absolute;
      width: 20px;
      height: 20px;
      border: 4px solid #fff;
    }

    .apriltag-projector .view-box .corner.tl { left: -4px; top: -4px; border-right: none; border-bottom: none; }
    .apriltag-projector .view-box .corner.tr { right: -4px; top: -4px; border-left: none; border-bottom: none; }
    .apriltag-projector .view-box .corner.bl { left: -4px; bottom: -4px; border-right: none; border-top: none; }
    .apriltag-projector .view-box .corner.br { right: -4px; bottom: -4px; border-left: none; border-top: none; }

    .apriltag-projector .calibration-target,
    .apriltag-projector .test-marker {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate(-50%, -50%);
      color: #fff;
      user-select: none;
      pointer-events: none;
    }

    .apriltag-projector .calibration-target::before {
      content: "";
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 0 18px rgba(255, 255, 255, 0.98);
    }

    .apriltag-projector .calibration-target[data-captured]::before {
      background: color-mix(in oklch, white, var(--sc-accent) 35%);
    }

    .apriltag-projector .calibration-target[data-active]::before {
      width: 30px;
      height: 30px;
      animation: sc-pulse 1.1s ease-in-out infinite;
    }

    .apriltag-projector .calibration-target .target-label {
      position: absolute;
      top: 28px;
      left: 50%;
      transform: translateX(-50%);
      padding: 0.18rem 0.5rem;
      border: 2px solid rgba(255, 255, 255, 0.7);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.78);
      font: 700 0.95rem/1 var(--sc-family);
      white-space: nowrap;
      letter-spacing: 0.02em;
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
    }

    .apriltag-projector .test-marker::before,
    .apriltag-projector .test-marker::after {
      content: "";
      position: absolute;
      background: #fff;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.75);
    }

    .apriltag-projector .test-marker::before {
      width: 22px;
      height: 2px;
    }

    .apriltag-projector .test-marker::after {
      width: 2px;
      height: 22px;
    }

    .apriltag-projector .test-marker[data-current]::before {
      width: 28px;
      background: color-mix(in oklch, white, var(--sc-accent) 35%);
    }

    .apriltag-projector .test-marker[data-current]::after {
      height: 28px;
      background: color-mix(in oklch, white, var(--sc-accent) 35%);
    }

    .apriltag-projector .tag-label {
      position: absolute;
      display: flex;
      align-items: center;
      transform: translate(-50%, -50%);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
    }

    .apriltag-projector .tag-label .tag-dot {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 0 14px rgba(255, 255, 255, 0.95);
      flex: none;
    }

    .apriltag-projector .tag-label .tag-text {
      margin-left: 10px;
      padding: 0.2rem 0.55rem;
      border: 2px solid rgba(255, 255, 255, 0.75);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.82);
      color: #fff;
      font: 700 1rem/1 var(--sc-family);
      letter-spacing: 0.01em;
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
    }

    .apriltag-projector .tag-label .tag-id {
      margin-left: 6px;
      font: 500 0.7rem/1 var(--studio-family-code, ui-monospace, monospace);
      color: rgba(255, 255, 255, 0.55);
    }

    .apriltag-projector[data-clean] .tag-label .tag-id {
      display: none;
    }

    .apriltag-projector .label-editor {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      max-height: 220px;
      overflow: auto;
      padding: 0.35rem;
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      background: color-mix(in oklch, var(--sc-bar-bg), transparent 4%);
    }

    .apriltag-projector .label-editor .label-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .apriltag-projector .label-editor .label-row .tag-key {
      font: 600 0.72rem/1 var(--studio-family-code, ui-monospace, monospace);
      color: var(--sc-bar-muted);
      min-width: 2.5rem;
    }

    .apriltag-projector .label-editor .label-row input {
      font: inherit;
      font-size: 0.82rem;
      padding: 0.25rem 0.45rem;
      min-width: 8rem;
      background: var(--sc-bar-bg);
      color: var(--sc-bar-fg);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
    }

    .apriltag-projector .label-editor .label-row[data-live] .tag-key {
      color: var(--sc-bar-fg);
    }

    .apriltag-projector .label-editor .empty {
      font-size: 0.78rem;
      color: var(--sc-bar-muted);
      padding: 0.25rem;
    }

    .apriltag-projector .version-badge {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      right: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      padding: 0.15rem 0.4rem;
      font: 500 0.7rem/1 var(--sc-family);
      color: var(--sc-bar-muted);
      background: color-mix(in oklch, var(--sc-bar-bg), transparent 15%);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      pointer-events: none;
      user-select: none;
    }

    .apriltag-projector[data-clean] .version-badge {
      display: none;
    }

    .apriltag-projector .readout {
      position: absolute;
      right: var(--studio-space-xs, 0.375rem);
      bottom: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      padding: 0.25rem 0.45rem;
      font: 500 0.7rem/1.35 var(--studio-family-code, ui-monospace, monospace);
      color: var(--sc-bar-muted);
      background: color-mix(in oklch, var(--sc-bar-bg), transparent 15%);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      pointer-events: none;
      user-select: none;
      white-space: pre;
    }

    .apriltag-projector[data-clean] .readout {
      display: none;
    }

    .apriltag-projector .control-bar {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      left: var(--studio-space-sm, 0.5rem);
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--studio-space-xs, 0.375rem);
      max-width: calc(100% - 1rem);
      padding: var(--studio-space-xs, 0.375rem);
      background: var(--sc-bar-bg);
      color: var(--sc-bar-fg);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-sm, 0 1px 3px rgba(0,0,0,0.2));
    }

    .apriltag-projector[data-clean] .control-bar {
      display: none;
    }

    .apriltag-projector .mode-group {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .apriltag-projector .toolbar-handle {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.5rem;
      border: 1px dashed var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      color: var(--sc-bar-muted);
      cursor: move;
      touch-action: none;
      user-select: none;
      white-space: nowrap;
      font-size: 0.78rem;
      line-height: 1;
    }

    .apriltag-projector .toolbar-handle::before {
      content: "⋮⋮";
      font-size: 0.72rem;
      letter-spacing: -0.08em;
    }

    .apriltag-projector button,
    .apriltag-projector select {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      background: var(--sc-bar-bg);
      color: var(--sc-bar-fg);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
    }

    .apriltag-projector button {
      cursor: pointer;
    }

    .apriltag-projector button:hover:not(:disabled),
    .apriltag-projector select:hover {
      background: color-mix(in oklch, var(--sc-bar-bg), var(--sc-bar-fg) 6%);
    }

    .apriltag-projector button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .apriltag-projector button[data-variant="primary"],
    .apriltag-projector button[data-active] {
      border-color: var(--sc-accent);
    }

    .apriltag-projector .control-bar label {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      color: var(--sc-bar-muted);
    }

    .apriltag-projector .hint,
    .apriltag-projector .status-chip {
      font-size: 0.78rem;
      color: var(--sc-bar-muted);
    }

    .apriltag-projector .status-chip {
      padding: 0.18rem 0.45rem;
      border: 1px solid var(--sc-bar-border);
      border-radius: 999px;
      white-space: nowrap;
    }

    .apriltag-projector .status-chip[data-kind="accent"] {
      border-color: var(--sc-accent);
      color: var(--sc-bar-fg);
    }

    .apriltag-projector .status-chip[data-kind="danger"] {
      border-color: var(--sc-danger);
      color: var(--sc-danger);
    }

    .apriltag-projector .sep {
      width: 1px;
      align-self: stretch;
      background: var(--sc-bar-border);
      margin: 0 0.1rem;
    }

    .apriltag-projector .exit-project {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      left: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      opacity: 0.25;
      transition: opacity var(--studio-transition-fast, 0.1s ease);
    }

    .apriltag-projector .exit-project:hover {
      opacity: 1;
    }

    .apriltag-projector .camera-panel {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      right: var(--studio-space-sm, 0.5rem);
      z-index: 20;
      /* Large by default to make calibration clicks precise; still draggable
         and capped to the viewport. */
      width: min(72vw, 960px);
      max-width: calc(100% - 1rem);
      display: flex;
      flex-direction: column;
      background: var(--sc-bar-bg);
      border: 1px solid var(--sc-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-md, 0 4px 12px rgba(0,0,0,0.3));
      overflow: hidden;
    }

    .apriltag-projector[data-clean] .camera-panel {
      display: none !important;
    }

    .apriltag-projector .camera-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.25rem 0.25rem 0.25rem 0.5rem;
      background: var(--sc-bar-bg);
      color: var(--sc-bar-fg);
      cursor: move;
      touch-action: none;
      user-select: none;
    }

    .apriltag-projector .camera-title {
      font-size: 0.8rem;
      font-weight: 600;
    }

    .apriltag-projector .camera-res {
      margin-left: auto;
      font: 500 0.72rem/1 var(--studio-family-code, ui-monospace, monospace);
      color: var(--sc-bar-muted);
    }

    .apriltag-projector button.camera-close {
      padding: 0.15rem 0.4rem;
      font-size: 0.8rem;
      line-height: 1;
    }

    .apriltag-projector .camera-stage {
      position: relative;
      line-height: 0;
      background: #000;
    }

    .apriltag-projector .camera-stage video {
      display: block;
      width: 100%;
      height: auto;
      background: #000;
    }

    .apriltag-projector .camera-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
    }

    .apriltag-projector .camera-devices {
      border: none;
      border-top: 1px solid var(--sc-bar-border);
      font-size: 0.78rem;
      padding: 0.25rem;
    }

    @keyframes sc-pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.95;
      }
      50% {
        transform: scale(1.25);
        opacity: 1;
      }
    }
  `;
  return style;
}

// ============================================================================
// Tool
// ============================================================================

export function Tool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  const prevPosition = element.style.position;
  const prevHeight = element.style.height;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  if (!element.style.height) {
    element.style.height = "100%";
  }

  const root = document.createElement("div");
  root.className = "apriltag-projector";
  root.tabIndex = 0;
  element.appendChild(root);

  const viewLayer = document.createElement("div");
  viewLayer.className = "view-layer";
  root.appendChild(viewLayer);

  let cleanView = false;
  let renderCount = 0;
  let transientStatus = "";
  let toolbarPosition = null;

  // --- Persistent camera panel ---------------------------------------------
  let cameraStream = null;
  let cameraToggleBtn = null;

  // --- Live AprilTag detection (camera-side only) --------------------------
  // The detector runs in a Web Worker (vendored apriltag wasm + Comlink). Only
  // the view with its camera on detects; results are broadcast to peers, and
  // every view renders projected labels from `liveTags`.
  let detectorWorker = null;
  let detectorProxy = null; // Comlink proxy to the worker-side Apriltag class
  let detector = null; // the constructed Apriltag instance (also a proxy)
  let detectorState = "idle"; // idle | loading | ready | error
  let detectorError = "";
  let detectLoopTimer = null;
  let detectInFlight = false;
  const detectCanvas = document.createElement("canvas");
  // `liveTags`: id -> { id, board:[x,y], at:ms }. On the camera view these come
  // from local detection; on peer views they arrive via ephemeral messages.
  const liveTags = new Map();
  let staleSweepTimer = null;

  async function ensureDetector() {
    if (detectorState === "ready" || detectorState === "loading") return;
    detectorState = "loading";
    detectorError = "";
    render();
    try {
      const { wrap, proxy } = await import(
        new URL("../vendor/comlink.mjs", import.meta.url).href
      );
      detectorWorker = new Worker(
        new URL("../vendor/apriltag.js", import.meta.url),
      );
      detectorWorker.addEventListener("error", (event) => {
        detectorState = "error";
        detectorError = event.message || "worker error";
        render();
      });
      // The worker exposes the Apriltag *class* via Comlink. Wrapping yields a
      // constructable proxy. `new Apriltag(cb)` resolves to the remote instance
      // once the wasm module is up; the callback (which must be Comlink.proxy'd)
      // also fires at that point. We rely on the construction promise.
      const AprilTagClass = wrap(detectorWorker);
      detectorProxy = AprilTagClass;
      const instancePromise = new AprilTagClass(proxy(() => {}));
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("detector load timed out")), 20000),
      );
      detector = await Promise.race([instancePromise, timeout]);
      detectorState = "ready";
      render();
      startDetectLoop();
    } catch (err) {
      detectorState = "error";
      detectorError = String((err && err.message) || err);
      render();
    }
  }

  function teardownDetector() {
    stopDetectLoop();
    detector = null;
    detectorProxy = null;
    if (detectorWorker) {
      detectorWorker.terminate();
      detectorWorker = null;
    }
    detectorState = "idle";
    detectorError = "";
  }

  function startDetectLoop() {
    if (detectLoopTimer || detectorState !== "ready") return;
    const tick = () => {
      runDetectionPass();
    };
    detectLoopTimer = setInterval(tick, DETECT_INTERVAL_MS);
  }

  function stopDetectLoop() {
    if (detectLoopTimer) {
      clearInterval(detectLoopTimer);
      detectLoopTimer = null;
    }
    detectInFlight = false;
  }

  // Grab the current camera frame, downscale to grayscale, detect, and map each
  // tag center through the camera->board homography. Camera-side view only.
  async function runDetectionPass() {
    if (detectInFlight || !detector || detectorState !== "ready") return;
    const docState = makeDefaultDocState(handle.doc());
    if (docState.mode !== "use") return;
    if (!cameraStream) return;
    const liveSize = getLiveCameraSize();
    if (!liveSize) return;
    if (!docState.homographyCamToBoard) return;

    detectInFlight = true;
    try {
      const scale = Math.min(
        1,
        DETECT_MAX_DIM / Math.max(liveSize.w, liveSize.h),
      );
      const w = Math.max(1, Math.round(liveSize.w * scale));
      const h = Math.max(1, Math.round(liveSize.h * scale));
      if (detectCanvas.width !== w) detectCanvas.width = w;
      if (detectCanvas.height !== h) detectCanvas.height = h;
      const ctx = detectCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(cameraVideo, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        // Rec. 601 luma; the detector wants single-channel grayscale.
        gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
      }
      const detections = (await detector.detect(gray, w, h)) || [];
      const now = nowMs();
      const fresh = [];
      for (const det of detections) {
        if (!det || det.center == null || det.id == null) continue;
        // Detection coords are in the downscaled image; rescale to intrinsic px.
        const cameraPoint = [det.center.x / scale, det.center.y / scale];
        const board = cameraPointToBoard(docState, cameraPoint, liveSize);
        if (!board) continue;
        if (
          board[0] < -BOARD_MARGIN ||
          board[0] > 1 + BOARD_MARGIN ||
          board[1] < -BOARD_MARGIN ||
          board[1] > 1 + BOARD_MARGIN
        ) {
          continue;
        }
        const tag = { id: det.id, board: [board[0], board[1]], at: now };
        liveTags.set(String(det.id), tag);
        fresh.push({ id: det.id, board: tag.board });
      }
      sweepStaleTags();
      try {
        handle.broadcast({ type: "apriltags", tags: fresh, at: now });
      } catch {
        /* broadcast can fail if no peers/transport; detection still renders locally */
      }
      renderTagsOnly();
    } finally {
      detectInFlight = false;
    }
  }

  function sweepStaleTags() {
    const cutoff = nowMs() - TAG_STALE_MS;
    let changed = false;
    for (const [key, tag] of liveTags) {
      if (tag.at < cutoff) {
        liveTags.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  function nowMs() {
    return performance && performance.now ? performance.now() : Date.now();
  }

  function onEphemeralMessage(payload) {
    const msg = payload && payload.message;
    if (!msg || msg.type !== "apriltags" || !Array.isArray(msg.tags)) return;
    // Peer-provided detections. Stamp with our own clock so the stale sweep
    // works regardless of cross-machine clock skew.
    const now = nowMs();
    for (const tag of msg.tags) {
      if (!tag || tag.id == null || !Array.isArray(tag.board)) continue;
      liveTags.set(String(tag.id), {
        id: tag.id,
        board: [Number(tag.board[0]), Number(tag.board[1])],
        at: now,
      });
    }
    renderTagsOnly();
  }

  // Reconcile the detector + tag state with the current mode. Safe to call on
  // local mode switches and whenever the doc changes (a peer may flip modes).
  function applyModeSideEffects(mode) {
    if (mode === "use") {
      if (cameraStream && detectorState === "idle") {
        ensureDetector();
      } else if (detectorState === "ready") {
        startDetectLoop();
      }
    } else {
      stopDetectLoop();
      if (liveTags.size) {
        liveTags.clear();
      }
    }
  }

  const cameraPanel = document.createElement("div");
  cameraPanel.className = "camera-panel";
  cameraPanel.style.display = "none";

  const cameraHeader = document.createElement("div");
  cameraHeader.className = "camera-header";
  const cameraTitle = document.createElement("span");
  cameraTitle.className = "camera-title";
  cameraTitle.textContent = "Camera";
  const cameraRes = document.createElement("span");
  cameraRes.className = "camera-res";
  const cameraClose = button("✕", () => stopCamera());
  cameraClose.className = "camera-close";
  cameraHeader.append(cameraTitle, cameraRes, cameraClose);

  const cameraStage = document.createElement("div");
  cameraStage.className = "camera-stage";
  const cameraVideo = document.createElement("video");
  cameraVideo.autoplay = true;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  const cameraOverlay = document.createElement("canvas");
  cameraOverlay.className = "camera-overlay";
  cameraOverlay.addEventListener("click", onCameraOverlayClick);
  cameraStage.append(cameraVideo, cameraOverlay);

  const cameraDevicePicker = document.createElement("select");
  cameraDevicePicker.className = "camera-devices";
  cameraDevicePicker.addEventListener("change", () => {
    if (cameraStream) startCamera(cameraDevicePicker.value);
  });

  cameraPanel.append(cameraHeader, cameraStage, cameraDevicePicker);
  root.appendChild(cameraPanel);
  makePanelDraggable(cameraPanel, cameraHeader);

  cameraVideo.addEventListener("loadedmetadata", updateCameraResolution);
  cameraVideo.addEventListener("resize", updateCameraResolution);
  cameraVideo.addEventListener("loadedmetadata", drawCameraOverlay);
  cameraVideo.addEventListener("resize", drawCameraOverlay);
  window.addEventListener("resize", drawCameraOverlay);

  async function refreshCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");
      const previous = cameraDevicePicker.value;
      cameraDevicePicker.innerHTML = "";
      for (const camera of cameras) {
        const option = document.createElement("option");
        option.value = camera.deviceId;
        option.textContent =
          camera.label || `Camera ${cameraDevicePicker.length + 1}`;
        cameraDevicePicker.appendChild(option);
      }
      cameraDevicePicker.style.display = cameras.length > 1 ? "" : "none";
      if (previous && cameras.some((camera) => camera.deviceId === previous)) {
        cameraDevicePicker.value = previous;
      }
    } catch {
      /* enumerateDevices can fail before permission; ignore */
    }
  }

  async function startCamera(deviceId) {
    try {
      stopStreamOnly();
      const videoConstraints = {
        width: { ideal: 4096 },
        height: { ideal: 2160 },
      };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId };
      const constraints = { video: videoConstraints, audio: false };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraVideo.srcObject = cameraStream;
      cameraPanel.style.display = cleanView ? "none" : "";
      await refreshCameraDevices();
      const track = cameraStream.getVideoTracks()[0];
      const settings = track && track.getSettings ? track.getSettings() : {};
      if (settings.deviceId) cameraDevicePicker.value = settings.deviceId;
      // Stop the lens hunting (continuous autofocus) and pin zoom so the image
      // stays geometrically stable — essential for a fixed homography.
      await lockCameraControls(track);
      updateCameraResolution();
      updateCameraButton();
      drawCameraOverlay();
      // In "use" mode, having a camera is the trigger to spin up detection.
      const mode = normalizeMode(handle.doc() && handle.doc().mode);
      if (mode === "use") ensureDetector();
    } catch (err) {
      cameraPanel.style.display = "none";
      window.alert(
        "Could not start the camera: " +
          (err && err.message ? err.message : err) +
          "\n\nMake sure the page has camera permission and the camera isn't in use by another app.",
      );
    }
  }

  function stopStreamOnly() {
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
  }

  // Lock the controllable camera behaviors that would otherwise change the image
  // geometry while we're calibrating: continuous autofocus (the lens "zooming"
  // in/out as it hunts) and digital zoom. Only sets controls the device actually
  // advertises; a no-op on cameras (e.g. many laptop webcams) that expose none.
  async function lockCameraControls(track) {
    if (!track || !track.getCapabilities || !track.applyConstraints) return;
    let caps = {};
    try {
      caps = track.getCapabilities() || {};
    } catch {
      return;
    }
    const settings = track.getSettings ? track.getSettings() : {};
    const advanced = [];

    if (Array.isArray(caps.focusMode)) {
      if (caps.focusMode.includes("manual")) {
        advanced.push({ focusMode: "manual" });
      } else if (caps.focusMode.includes("none")) {
        advanced.push({ focusMode: "none" });
      }
    }

    if (caps.zoom && typeof caps.zoom === "object") {
      // Pin zoom to wherever it currently sits (or the minimum) so auto-framing
      // can't drift it. Clamp into the advertised range to be safe.
      const min = isFiniteNumber(caps.zoom.min) ? caps.zoom.min : 1;
      const max = isFiniteNumber(caps.zoom.max) ? caps.zoom.max : min;
      const current = isFiniteNumber(settings.zoom) ? settings.zoom : min;
      const zoom = Math.max(min, Math.min(current, max));
      advanced.push({ zoom });
    }

    if (!advanced.length) return;
    try {
      await track.applyConstraints({ advanced });
    } catch {
      /* device rejected one of the locks; leave the camera as-is */
    }
  }

  function stopCamera() {
    stopStreamOnly();
    cameraPanel.style.display = "none";
    cameraRes.textContent = "";
    // No camera => this view can no longer be the detection source. Clear our
    // locally-produced tags so we stop projecting stale labels.
    stopDetectLoop();
    if (liveTags.size) {
      liveTags.clear();
      renderTagsOnly();
    }
    updateCameraButton();
    drawCameraOverlay();
  }

  function toggleCamera() {
    if (cameraStream) stopCamera();
    else startCamera(cameraDevicePicker.value || undefined);
  }

  function updateCameraResolution() {
    const liveSize = getLiveCameraSize();
    cameraRes.textContent = liveSize ? `${liveSize.w}×${liveSize.h}` : "";
    drawCameraOverlay();
  }

  function updateCameraButton() {
    if (cameraToggleBtn) {
      cameraToggleBtn.textContent = cameraStream
        ? "Hide camera"
        : "Show camera";
    }
  }

  function getLiveCameraSize() {
    const w = cameraVideo.videoWidth;
    const h = cameraVideo.videoHeight;
    return w && h ? { w, h } : null;
  }

  function syncCameraOverlaySize() {
    const rect = cameraStage.getBoundingClientRect();
    const width = Math.max(0, Math.round(rect.width));
    const height = Math.max(0, Math.round(rect.height));
    if (!width || !height) {
      if (cameraOverlay.width || cameraOverlay.height) {
        cameraOverlay.width = 0;
        cameraOverlay.height = 0;
      }
      return null;
    }
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.round(width * dpr);
    const canvasHeight = Math.round(height * dpr);
    if (
      cameraOverlay.width !== canvasWidth ||
      cameraOverlay.height !== canvasHeight
    ) {
      cameraOverlay.width = canvasWidth;
      cameraOverlay.height = canvasHeight;
    }
    const ctx = cameraOverlay.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function intrinsicToOverlayPoint(point, liveSize, overlaySize) {
    return [
      (point[0] / liveSize.w) * overlaySize.width,
      (point[1] / liveSize.h) * overlaySize.height,
    ];
  }

  function overlayEventToIntrinsicPoint(event) {
    const liveSize = getLiveCameraSize();
    if (!liveSize) return null;
    const rect = cameraOverlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [
      clamp01((event.clientX - rect.left) / rect.width) * liveSize.w,
      clamp01((event.clientY - rect.top) / rect.height) * liveSize.h,
    ];
  }

  function drawCrosshair(ctx, x, y, color, radius, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y + radius);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, radius * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (label) {
      ctx.font = "600 12px system-ui, sans-serif";
      const metrics = ctx.measureText(label);
      const padX = 5;
      const padY = 3;
      const boxW = metrics.width + padX * 2;
      const boxH = 18;
      const left = x + 10;
      const top = y - boxH - 8;
      ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
      ctx.lineWidth = 1;
      roundedRectPath(ctx, left, top, boxW, boxH, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, left + padX, top + boxH - padY - 2);
    }
    ctx.restore();
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawPredictedRing(ctx, x, y, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCameraOverlay() {
    const overlayState = syncCameraOverlaySize();
    if (!overlayState) return;

    const { ctx, width, height } = overlayState;
    ctx.clearRect(0, 0, width, height);

    const liveSize = getLiveCameraSize();
    if (!cameraStream || !liveSize) return;

    const docState = makeDefaultDocState(handle.doc());
    const mode = docState.mode;
    const targets = getCalibrationTargets(docState.gridSize);

    if (mode === "calibrate" && docState.homographyBoardToCam) {
      for (const target of targets) {
        const predicted = boardPointToCamera(docState, target.board, liveSize);
        if (!predicted) continue;
        const [x, y] = intrinsicToOverlayPoint(predicted, liveSize, {
          width,
          height,
        });
        drawPredictedRing(
          ctx,
          x,
          y,
          target.id === docState.activeTargetId
            ? "rgba(53, 247, 202, 0.95)"
            : "rgba(255, 255, 255, 0.45)",
        );
      }
    }

    for (const target of targets) {
      const pair = docState.pairs[target.id];
      if (!pair) continue;
      const pairSize =
        normalizeCameraSize(pair.cameraSize) ||
        docState.cameraCalibrationSize ||
        liveSize;
      const livePoint = scalePoint(pair.camera, pairSize, liveSize);
      const [x, y] = intrinsicToOverlayPoint(livePoint, liveSize, {
        width,
        height,
      });
      const isActive = target.id === docState.activeTargetId;
      drawCrosshair(
        ctx,
        x,
        y,
        isActive ? "rgba(53, 247, 202, 0.98)" : "rgba(255, 255, 255, 0.95)",
        isActive ? 11 : 8,
        target.label,
      );
    }

    if (mode === "test") {
      for (let i = 0; i < docState.testMarkers.length; i++) {
        const marker = docState.testMarkers[i];
        const [x, y] = intrinsicToOverlayPoint(marker.camera, liveSize, {
          width,
          height,
        });
        const isCurrent = i === docState.testMarkers.length - 1;
        drawCrosshair(
          ctx,
          x,
          y,
          isCurrent ? "rgba(53, 247, 202, 0.98)" : "rgba(255, 255, 255, 0.82)",
          isCurrent ? 12 : 8,
          isCurrent ? "test" : "",
        );
      }
    }

    if (mode === "use") {
      // Feedback in the camera preview: mark where each detected tag sits, by
      // mapping its board position back into camera space.
      for (const tag of liveTags.values()) {
        const camPoint = boardPointToCamera(docState, tag.board, liveSize);
        if (!camPoint) continue;
        const [x, y] = intrinsicToOverlayPoint(camPoint, liveSize, {
          width,
          height,
        });
        drawCrosshair(
          ctx,
          x,
          y,
          "rgba(53, 247, 202, 0.95)",
          10,
          tagLabelFor(docState.tagLabels, tag.id),
        );
      }
    }
  }

  function onCameraOverlayClick(event) {
    const cameraPoint = overlayEventToIntrinsicPoint(event);
    if (!cameraPoint) {
      transientStatus = "Camera feed not ready.";
      render();
      return;
    }

    const doc = handle.doc();
    if (!doc) return;
    const docState = makeDefaultDocState(doc);
    const mode = docState.mode;
    const targets = getCalibrationTargets(docState.gridSize);
    const activeTarget = getTargetById(targets, docState.activeTargetId);
    const liveSize = getLiveCameraSize();

    if (!liveSize) {
      transientStatus = "Camera feed not ready.";
      render();
      return;
    }

    if (mode === "calibrate") {
      if (!activeTarget) return;
      transientStatus = `Captured ${activeTarget.label}.`;
      handle.change((d) => {
        const currentTargets = getCalibrationTargets(d.gridSize);
        const currentActive = getTargetById(
          currentTargets,
          ensureActiveTargetId(d.activeTargetId, currentTargets),
        );
        if (!currentActive) return;
        if (!d.pairs || typeof d.pairs !== "object") d.pairs = {};
        d.pairs[currentActive.id] = {
          board: clonePoint(currentActive.board),
          camera: clonePoint(cameraPoint),
          cameraSize: cloneSize(liveSize),
        };
        d.homographyCamToBoard = null;
        d.homographyBoardToCam = null;
        d.cameraCalibrationSize = null;
        d.testMarkers = [];
        d.activeTargetId = nextIncompleteTargetId(
          currentTargets,
          normalizePairs(d.pairs),
          currentActive.id,
        );
      });
      drawCameraOverlay();
      return;
    }

    if (mode === "test") {
      if (!docState.homographyCamToBoard) {
        transientStatus = "Solve the calibration first.";
        render();
        return;
      }
      const boardPoint = cameraPointToBoard(docState, cameraPoint, liveSize);
      if (!boardPoint) {
        transientStatus =
          "Could not project that click through the homography.";
        render();
        return;
      }
      if (
        boardPoint[0] < -0.05 ||
        boardPoint[0] > 1.05 ||
        boardPoint[1] < -0.05 ||
        boardPoint[1] > 1.05
      ) {
        transientStatus = "That click falls outside the calibrated board.";
        render();
        return;
      }
      transientStatus = `Projected ${boardPoint[0].toFixed(3)}, ${boardPoint[1].toFixed(3)}.`;
      handle.change((d) => {
        const markers = normalizeTestMarkers(d.testMarkers);
        markers.push({
          board: clonePoint(boardPoint),
          camera: clonePoint(cameraPoint),
        });
        d.testMarkers = markers.slice(-MAX_TEST_MARKERS);
      });
      drawCameraOverlay();
    }
  }

  function commitBox(updater) {
    handle.change((d) => {
      const current = normalizeBox(d.cameraViewBox);
      const next = normalizeBox(updater(current));
      d.cameraViewBox = next;
    });
  }

  function startDrag(event, box, stage, boxEl) {
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = box.x;
    const originY = box.y;
    let current = { x: originX, y: originY };

    function onMove(moveEvent) {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;
      current.x = Math.min(clamp01(originX + dx), 1 - box.w);
      current.y = Math.min(clamp01(originY + dy), 1 - box.h);
      boxEl.style.left = current.x * 100 + "%";
      boxEl.style.top = current.y * 100 + "%";
    }

    function onUp(upEvent) {
      boxEl.releasePointerCapture(upEvent.pointerId);
      boxEl.removeEventListener("pointermove", onMove);
      boxEl.removeEventListener("pointerup", onUp);
      commitBox((nextBox) => ({ ...nextBox, x: current.x, y: current.y }));
    }

    boxEl.setPointerCapture(event.pointerId);
    boxEl.addEventListener("pointermove", onMove);
    boxEl.addEventListener("pointerup", onUp);
  }

  function startResize(event, dir, box, stage, boxEl) {
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const min = 0.02;
    const left = box.x;
    const top = box.y;
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const movesW = dir.includes("w");
    const movesE = dir.includes("e");
    const movesN = dir.includes("n");
    const movesS = dir.includes("s");
    let current = { x: box.x, y: box.y, w: box.w, h: box.h };

    function onMove(moveEvent) {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;
      let l = left;
      let t = top;
      let r = right;
      let b = bottom;
      if (movesW) l = clamp01(Math.min(left + dx, right - min));
      if (movesE) r = clamp01(Math.max(right + dx, left + min));
      if (movesN) t = clamp01(Math.min(top + dy, bottom - min));
      if (movesS) b = clamp01(Math.max(bottom + dy, top + min));
      current = { x: l, y: t, w: r - l, h: b - t };
      boxEl.style.left = current.x * 100 + "%";
      boxEl.style.top = current.y * 100 + "%";
      boxEl.style.width = current.w * 100 + "%";
      boxEl.style.height = current.h * 100 + "%";
    }

    function onUp(upEvent) {
      boxEl.releasePointerCapture(upEvent.pointerId);
      boxEl.removeEventListener("pointermove", onMove);
      boxEl.removeEventListener("pointerup", onUp);
      commitBox(() => current);
    }

    boxEl.setPointerCapture(event.pointerId);
    boxEl.addEventListener("pointermove", onMove);
    boxEl.addEventListener("pointerup", onUp);
  }

  function renderAlignmentBox(stage, box, mode) {
    const boxEl = document.createElement("div");
    boxEl.className = "view-box";
    boxEl.style.left = box.x * 100 + "%";
    boxEl.style.top = box.y * 100 + "%";
    boxEl.style.width = box.w * 100 + "%";
    boxEl.style.height = box.h * 100 + "%";

    for (const cornerName of ["tl", "tr", "bl", "br"]) {
      const corner = document.createElement("div");
      corner.className = "corner " + cornerName;
      boxEl.appendChild(corner);
    }

    if (!cleanView && mode === "align") {
      boxEl.addEventListener("pointerdown", (event) => {
        if (event.target.classList.contains("resize-handle")) return;
        event.stopPropagation();
        startDrag(event, box, stage, boxEl);
      });

      for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
        const handleEl = document.createElement("div");
        handleEl.className = "resize-handle";
        handleEl.dataset.dir = dir;
        handleEl.addEventListener("pointerdown", (pointerEvent) => {
          pointerEvent.stopPropagation();
          startResize(pointerEvent, dir, box, stage, boxEl);
        });
        boxEl.appendChild(handleEl);
      }
    }

    stage.appendChild(boxEl);
  }

  function renderCalibrationDots(stage, docState, box, targets) {
    for (const target of targets) {
      const [x, y] = projectBoardToStage(box, target.board);
      const dot = document.createElement("div");
      dot.className = "calibration-target";
      dot.style.left = x * 100 + "%";
      dot.style.top = y * 100 + "%";
      if (docState.pairs[target.id]) dot.setAttribute("data-captured", "");
      if (target.id === docState.activeTargetId)
        dot.setAttribute("data-active", "");
      const label = document.createElement("div");
      label.className = "target-label";
      label.textContent = target.label;
      if (target.id === docState.activeTargetId || !cleanView) {
        dot.appendChild(label);
      }
      stage.appendChild(dot);
    }
  }

  function renderTestMarkers(stage, box, markers) {
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const [x, y] = projectBoardToStage(box, marker.board);
      const markerEl = document.createElement("div");
      markerEl.className = "test-marker";
      markerEl.style.left = x * 100 + "%";
      markerEl.style.top = y * 100 + "%";
      if (i === markers.length - 1) markerEl.setAttribute("data-current", "");
      stage.appendChild(markerEl);
    }
  }

  // Renders projected labels for the current live tags into a dedicated layer
  // on the stage. Called both by full render() and the hot renderTagsOnly path.
  function renderTagLabels(stage, docState) {
    const layer = document.createElement("div");
    layer.className = "tag-layer";
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
    const tags = [...liveTags.values()].sort((a, b) => a.id - b.id);
    for (const tag of tags) {
      const [x, y] = projectBoardToStage(docState.box, tag.board);
      const el = document.createElement("div");
      el.className = "tag-label";
      el.style.left = x * 100 + "%";
      el.style.top = y * 100 + "%";

      const dot = document.createElement("div");
      dot.className = "tag-dot";
      const text = document.createElement("div");
      text.className = "tag-text";
      text.textContent = tagLabelFor(docState.tagLabels, tag.id);
      el.append(dot, text);

      if (!cleanView) {
        const idEl = document.createElement("div");
        idEl.className = "tag-id";
        idEl.textContent = `#${tag.id}`;
        el.appendChild(idEl);
      }
      layer.appendChild(el);
    }
    stage.appendChild(layer);
  }

  // Lightweight update of just the projected-label layer, used on every
  // detection pass / ephemeral message so we don't rebuild the whole toolbar.
  function renderTagsOnly() {
    const docState = makeDefaultDocState(handle.doc());
    if (docState.mode !== "use") return;
    const stage = viewLayer.querySelector(".stage");
    if (!stage) return;
    const existing = stage.querySelector(".tag-layer");
    if (existing) existing.remove();
    renderTagLabels(stage, docState);
    drawCameraOverlay();
    // Keep the live-tag count chip in the toolbar roughly current.
    updateUseStatusChip(docState);
  }

  let useStatusChip = null;
  function updateUseStatusChip(docState) {
    if (!useStatusChip) return;
    const info = useStatusText(docState);
    useStatusChip.textContent = info.text;
    if (info.kind) useStatusChip.dataset.kind = info.kind;
    else delete useStatusChip.dataset.kind;
  }

  function useStatusText(docState) {
    if (!docState.homographyCamToBoard) {
      return { text: "Solve calibration first.", kind: "danger" };
    }
    if (detectorState === "loading") {
      return { text: "Loading detector…", kind: "" };
    }
    if (detectorState === "error") {
      return { text: `Detector error: ${detectorError}`, kind: "danger" };
    }
    if (!cameraStream) {
      return { text: "Show the camera to detect tags.", kind: "" };
    }
    if (detectorState !== "ready") {
      return { text: "Starting detector…", kind: "" };
    }
    const n = liveTags.size;
    return {
      text: `${n} tag${n === 1 ? "" : "s"} detected`,
      kind: n ? "accent" : "",
    };
  }

  function getControlStatus(docState, targets) {
    const mode = docState.mode;
    const captureCount = countCapturedTargets(targets, docState.pairs);
    const meanError = computeMeanReprojectionErrorPx(
      targets,
      docState.pairs,
      docState.homographyBoardToCam,
      docState.cameraCalibrationSize,
    );
    const liveSize = getLiveCameraSize();
    const mismatch =
      liveSize &&
      docState.cameraCalibrationSize &&
      (liveSize.w !== docState.cameraCalibrationSize.w ||
        liveSize.h !== docState.cameraCalibrationSize.h);

    if (mode === "align") {
      return {
        text: "Arrows: move · +/-: width · [ ]: height · Shift: coarse",
        kind: "",
      };
    }

    if (mode === "calibrate") {
      if (meanError != null) {
        return {
          text: `${captureCount}/${targets.length} captured · mean ${meanError.toFixed(1)}px`,
          kind: "accent",
        };
      }
      return {
        text: `${captureCount}/${targets.length} captured`,
        kind: captureCount === targets.length ? "accent" : "",
      };
    }

    if (mode === "use") {
      return useStatusText(docState);
    }

    if (!docState.homographyCamToBoard) {
      return { text: "Solve calibration first.", kind: "danger" };
    }

    if (mismatch) {
      return {
        text: `Live ${getCameraSizeLabel(liveSize)} scaled to calibration ${getCameraSizeLabel(
          docState.cameraCalibrationSize,
        )}`,
        kind: "accent",
      };
    }

    return {
      text: `${docState.testMarkers.length} test marker${
        docState.testMarkers.length === 1 ? "" : "s"
      }`,
      kind: docState.testMarkers.length ? "accent" : "",
    };
  }

  function render() {
    const docState = makeDefaultDocState(handle.doc());
    const targets = getCalibrationTargets(docState.gridSize);
    const mode = docState.mode;
    renderCount++;

    root.setAttribute("data-mode", mode);
    if (cleanView) root.setAttribute("data-clean", "");
    else root.removeAttribute("data-clean");
    if (docState.hideCursor) root.setAttribute("data-hide-cursor", "");
    else root.removeAttribute("data-hide-cursor");

    // The toolbar (and its live status chip) is rebuilt below; drop the stale ref.
    useStatusChip = null;

    viewLayer.innerHTML = "";

    const stage = document.createElement("div");
    stage.className = "stage";
    viewLayer.appendChild(stage);

    renderAlignmentBox(stage, docState.box, mode);

    if (mode === "calibrate") {
      renderCalibrationDots(stage, docState, docState.box, targets);
    } else if (mode === "test") {
      renderTestMarkers(stage, docState.box, docState.testMarkers);
    } else if (mode === "use") {
      renderTagLabels(stage, docState);
    }

    const badge = document.createElement("div");
    badge.className = "version-badge";
    badge.textContent = `v${VERSION} · #${renderCount}`;
    viewLayer.appendChild(badge);

    const readout = document.createElement("div");
    readout.className = "readout";
    const lines = [
      `x ${docState.box.x.toFixed(3)}  y ${docState.box.y.toFixed(3)}`,
      `w ${docState.box.w.toFixed(3)}  h ${docState.box.h.toFixed(3)}`,
    ];
    if (docState.cameraCalibrationSize) {
      lines.push(`cal ${getCameraSizeLabel(docState.cameraCalibrationSize)}`);
    }
    readout.textContent = lines.join("\n");
    viewLayer.appendChild(readout);

    if (!cleanView) {
      const bar = document.createElement("div");
      bar.className = "control-bar";
      buildControlBar(docState, targets, bar);
      applyToolbarPosition(bar);
      viewLayer.appendChild(bar);
    } else {
      const exitBtn = button("Edit", () => {
        cleanView = false;
        render();
      });
      exitBtn.className = "exit-project";
      viewLayer.appendChild(exitBtn);
    }

    if (cameraStream) {
      cameraPanel.style.display = cleanView ? "none" : "";
    } else {
      cameraPanel.style.display = "none";
    }
    drawCameraOverlay();
  }

  function buildControlBar(docState, targets, bar) {
    bar.innerHTML = "";
    const mode = docState.mode;

    const toolbarHandle = document.createElement("div");
    toolbarHandle.className = "toolbar-handle";
    toolbarHandle.textContent = "Move";
    makePanelDraggable(bar, toolbarHandle, {
      getSavedPosition: () => toolbarPosition,
      onMove(left, top) {
        toolbarPosition = { left, top };
      },
    });
    bar.appendChild(toolbarHandle);

    bar.appendChild(sep());

    const modeGroup = document.createElement("div");
    modeGroup.className = "mode-group";
    const MODE_LABELS = {
      align: "Align",
      calibrate: "Calibrate",
      test: "Test",
    };
    // Host calibration UI: only the alignment workflow. "use" (live projection)
    // is owned by the spatial host's own Use mode, not this embedded tool. The
    // "Project" / "Hide cursor" controls are likewise dropped here.
    for (const nextMode of ["align", "calibrate", "test"]) {
      const modeBtn = button(MODE_LABELS[nextMode], () => {
        transientStatus = "";
        handle.change((d) => {
          d.mode = nextMode;
        });
        applyModeSideEffects(nextMode);
      });
      if (mode === nextMode) modeBtn.setAttribute("data-active", "");
      modeGroup.appendChild(modeBtn);
    }
    bar.appendChild(modeGroup);

    bar.appendChild(sep());

    bar.appendChild(button("Fullscreen", enterFullscreen));

    bar.appendChild(sep());

    cameraToggleBtn = button("Show camera", toggleCamera);
    cameraToggleBtn.setAttribute("data-variant", "primary");
    updateCameraButton();
    bar.appendChild(cameraToggleBtn);

    bar.appendChild(sep());

    const gridLabel = document.createElement("label");
    gridLabel.append(document.createTextNode("Grid"));
    const gridSelect = document.createElement("select");
    const fourOption = document.createElement("option");
    fourOption.value = "4";
    fourOption.textContent = "4 corners";
    const nineOption = document.createElement("option");
    nineOption.value = "9";
    nineOption.textContent = "9 points";
    gridSelect.append(fourOption, nineOption);
    gridSelect.value = String(docState.gridSize);
    gridSelect.addEventListener("change", () => {
      const nextGridSize = normalizeGridSize(Number(gridSelect.value));
      handle.change((d) => {
        d.gridSize = nextGridSize;
        const nextTargets = getCalibrationTargets(nextGridSize);
        const nextPairs = normalizePairs(d.pairs);
        d.activeTargetId = nextIncompleteTargetId(
          nextTargets,
          nextPairs,
          ensureActiveTargetId(d.activeTargetId, nextTargets),
        );
        d.homographyCamToBoard = null;
        d.homographyBoardToCam = null;
        d.cameraCalibrationSize = null;
        d.testMarkers = [];
      });
    });
    gridLabel.appendChild(gridSelect);
    bar.appendChild(gridLabel);

    if (mode === "align") {
      bar.appendChild(sep());
      bar.appendChild(
        button("Reset box", () => {
          commitBox(() => ({ x: 0, y: 0, w: 1, h: 1 }));
        }),
      );
    }

    if (mode === "calibrate") {
      const activeTargetId = ensureActiveTargetId(
        docState.activeTargetId,
        targets,
      );
      const captureCount = countCapturedTargets(targets, docState.pairs);
      bar.appendChild(sep());
      bar.appendChild(
        button("Prev target", () => {
          handle.change((d) => {
            const currentTargets = getCalibrationTargets(d.gridSize);
            d.activeTargetId = prevTargetId(
              currentTargets,
              ensureActiveTargetId(d.activeTargetId, currentTargets),
            );
          });
        }),
      );
      bar.appendChild(
        button("Next target", () => {
          handle.change((d) => {
            const currentTargets = getCalibrationTargets(d.gridSize);
            d.activeTargetId = nextTargetId(
              currentTargets,
              ensureActiveTargetId(d.activeTargetId, currentTargets),
            );
          });
        }),
      );
      bar.appendChild(
        button("Recapture", () => {
          handle.change((d) => {
            const currentTargets = getCalibrationTargets(d.gridSize);
            const currentActive = ensureActiveTargetId(
              d.activeTargetId,
              currentTargets,
            );
            if (!d.pairs || typeof d.pairs !== "object") d.pairs = {};
            delete d.pairs[currentActive];
            d.homographyCamToBoard = null;
            d.homographyBoardToCam = null;
            d.cameraCalibrationSize = null;
            d.testMarkers = [];
            d.activeTargetId = currentActive;
          });
        }),
      );
      bar.appendChild(
        button("Clear", () => {
          handle.change((d) => {
            d.pairs = {};
            d.homographyCamToBoard = null;
            d.homographyBoardToCam = null;
            d.cameraCalibrationSize = null;
            d.testMarkers = [];
            d.activeTargetId = targets[0] ? targets[0].id : "A";
          });
        }),
      );
      const solveBtn = button("Solve", () => {
        const currentDoc = makeDefaultDocState(handle.doc());
        const currentTargets = getCalibrationTargets(currentDoc.gridSize);
        if (
          countCapturedTargets(currentTargets, currentDoc.pairs) <
          currentTargets.length
        ) {
          transientStatus = "Capture every target first.";
          render();
          return;
        }
        const liveSize = getLiveCameraSize();
        const calibrationSize = chooseCalibrationSize(
          currentTargets,
          currentDoc.pairs,
          currentDoc.cameraCalibrationSize || liveSize,
        );
        if (!calibrationSize) {
          transientStatus = "Need a live or saved camera resolution to solve.";
          render();
          return;
        }
        const camToBoard = solveCameraToBoardHomography(
          currentTargets,
          currentDoc.pairs,
          calibrationSize,
        );
        const boardToCam = camToBoard ? invertHomography(camToBoard) : null;
        if (!camToBoard || !boardToCam) {
          transientStatus =
            "Could not solve a stable homography for those points.";
          render();
          return;
        }
        const errorPx = computeMeanReprojectionErrorPx(
          currentTargets,
          currentDoc.pairs,
          boardToCam,
          calibrationSize,
        );
        transientStatus =
          errorPx == null
            ? "Solved calibration."
            : `Solved calibration at ${errorPx.toFixed(1)}px mean error.`;
        handle.change((d) => {
          d.homographyCamToBoard = camToBoard;
          d.homographyBoardToCam = boardToCam;
          d.cameraCalibrationSize = cloneSize(calibrationSize);
        });
      });
      if (captureCount < targets.length) solveBtn.disabled = true;
      solveBtn.setAttribute("data-variant", "primary");
      bar.appendChild(solveBtn);

      const targetChip = statusChip(
        `Click ${activeTargetId} in feed`,
        "accent",
      );
      bar.appendChild(targetChip);
    }

    if (mode === "test") {
      bar.appendChild(sep());
      bar.appendChild(
        button("Clear", () => {
          handle.change((d) => {
            d.testMarkers = [];
          });
        }),
      );
    }

    if (mode === "use") {
      bar.appendChild(sep());
      if (detectorState === "error") {
        bar.appendChild(
          button("Retry detector", () => {
            teardownDetector();
            if (cameraStream) ensureDetector();
            else render();
          }),
        );
      }
      bar.appendChild(buildLabelEditor(docState));
      bar.appendChild(
        button("Clear labels", () => {
          handle.change((d) => {
            d.tagLabels = {};
          });
        }),
      );
    }

    bar.appendChild(sep());
    bar.appendChild(
      button("Reset all", () => {
        handle.change((d) => {
          d.cameraViewBox = { x: 0, y: 0, w: 1, h: 1 };
          d.mode = "align";
          d.pairs = {};
          d.homographyCamToBoard = null;
          d.homographyBoardToCam = null;
          d.cameraCalibrationSize = null;
          d.activeTargetId = "A";
          d.testMarkers = [];
          d.tagLabels = {};
        });
        applyModeSideEffects("align");
      }),
    );

    const status = getControlStatus(docState, targets);
    if (status.text) {
      const chip = statusChip(status.text, status.kind);
      if (mode === "use") useStatusChip = chip;
      bar.appendChild(chip);
    }
    if (transientStatus) {
      bar.appendChild(
        statusChip(
          transientStatus,
          transientStatus.includes("outside") ||
            transientStatus.includes("Could not")
            ? "danger"
            : "accent",
        ),
      );
    }
  }

  // A small editor listing every tag we know a label for, plus every currently
  // live tag, so you can rename tags (e.g. tag 7 -> "Coffee"). Names persist in
  // the doc and sync to all views.
  function buildLabelEditor(docState) {
    const editor = document.createElement("div");
    editor.className = "label-editor";

    const liveIds = new Set([...liveTags.keys()]);
    const ids = new Set([...liveIds, ...Object.keys(docState.tagLabels)]);
    const sorted = [...ids].sort((a, b) => Number(a) - Number(b));

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        "No tags seen yet. Point the camera at a tag36h11 tag.";
      editor.appendChild(empty);
      return editor;
    }

    for (const id of sorted) {
      const row = document.createElement("div");
      row.className = "label-row";
      if (liveIds.has(id)) row.setAttribute("data-live", "");

      const key = document.createElement("span");
      key.className = "tag-key";
      key.textContent = `#${id}`;

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = defaultTagLabel(id);
      input.value = docState.tagLabels[id] || "";
      input.addEventListener("change", () => {
        const value = input.value.trim();
        handle.change((d) => {
          if (!d.tagLabels || typeof d.tagLabels !== "object") d.tagLabels = {};
          if (value) d.tagLabels[id] = value;
          else delete d.tagLabels[id];
        });
      });

      row.append(key, input);
      editor.appendChild(row);
    }
    return editor;
  }

  function onKeyDown(event) {
    const target = event.target;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    if (event.key === "Escape") {
      if (cleanView && !document.fullscreenElement) {
        cleanView = false;
        render();
      }
      return;
    }

    const mode = normalizeMode(handle.doc() && handle.doc().mode);
    if (mode !== "align") return;

    const step = event.shiftKey ? COARSE : STEP;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        commitBox((box) => ({ ...box, x: box.x - step }));
        break;
      case "ArrowRight":
        commitBox((box) => ({ ...box, x: box.x + step }));
        break;
      case "ArrowUp":
        commitBox((box) => ({ ...box, y: box.y - step }));
        break;
      case "ArrowDown":
        commitBox((box) => ({ ...box, y: box.y + step }));
        break;
      case "+":
      case "=":
        commitBox((box) => ({ ...box, w: box.w + step }));
        break;
      case "-":
      case "_":
        commitBox((box) => ({ ...box, w: box.w - step }));
        break;
      case "]":
        commitBox((box) => ({ ...box, h: box.h + step }));
        break;
      case "[":
        commitBox((box) => ({ ...box, h: box.h - step }));
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  function enterFullscreen() {
    if (element.requestFullscreen) {
      element.requestFullscreen().catch(() => {});
    }
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement && cleanView) {
      cleanView = false;
      render();
    }
  }

  function button(text, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function sep() {
    const s = document.createElement("div");
    s.className = "sep";
    return s;
  }

  function statusChip(text, kind) {
    const chip = document.createElement("span");
    chip.className = "status-chip";
    chip.textContent = text;
    if (kind) chip.dataset.kind = kind;
    return chip;
  }

  function applyToolbarPosition(bar) {
    if (!toolbarPosition) return;
    bar.style.left = toolbarPosition.left + "px";
    bar.style.top = toolbarPosition.top + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
  }

  function makePanelDraggable(panel, handleEl, options = {}) {
    handleEl.addEventListener("pointerdown", (event) => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest("button")
      )
        return;
      event.preventDefault();
      const hostRect = root.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const saved = options.getSavedPosition
        ? options.getSavedPosition()
        : null;
      const panelWidth = panelRect.width;
      const panelHeight = panelRect.height;
      const panelLeft =
        saved && typeof saved.left === "number"
          ? hostRect.left + saved.left
          : panelRect.left;
      const panelTop =
        saved && typeof saved.top === "number"
          ? hostRect.top + saved.top
          : panelRect.top;
      const offsetX = event.clientX - panelLeft;
      const offsetY = event.clientY - panelTop;

      function onMove(moveEvent) {
        let left = moveEvent.clientX - hostRect.left - offsetX;
        let top = moveEvent.clientY - hostRect.top - offsetY;
        left = Math.max(0, Math.min(left, hostRect.width - panelWidth));
        top = Math.max(0, Math.min(top, hostRect.height - panelHeight));
        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        if (options.onMove) options.onMove(left, top);
      }

      function onUp(upEvent) {
        handleEl.releasePointerCapture(upEvent.pointerId);
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
      }

      handleEl.setPointerCapture(event.pointerId);
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
    });
  }

  // React to mode changes (local OR remote) for detector lifecycle, then render.
  let lastMode = normalizeMode(handle.doc() && handle.doc().mode);
  function onDocChange() {
    const mode = normalizeMode(handle.doc() && handle.doc().mode);
    if (mode !== lastMode) {
      lastMode = mode;
      applyModeSideEffects(mode);
    }
    render();
  }

  // Periodically expire tags that stopped being detected/broadcast so labels
  // don't linger after a tag leaves the frame.
  staleSweepTimer = setInterval(() => {
    if (liveTags.size && sweepStaleTags()) renderTagsOnly();
  }, 250);

  render();
  applyModeSideEffects(lastMode);
  handle.on("change", onDocChange);
  handle.on("ephemeral-message", onEphemeralMessage);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  refreshCameraDevices();

  return () => {
    handle.off("change", onDocChange);
    handle.off("ephemeral-message", onEphemeralMessage);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("resize", drawCameraOverlay);
    if (staleSweepTimer) clearInterval(staleSweepTimer);
    teardownDetector();
    stopStreamOnly();
    if (document.fullscreenElement === element) {
      document.exitFullscreen?.().catch(() => {});
    }
    element.style.position = prevPosition;
    element.style.height = prevHeight;
    root.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "apriltag-projector",
    name: "AprilTag Projector",
    icon: "ScanEye",
    async load() {
      return AprilTagProjectorDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "apriltag-projector",
    name: "AprilTag Projector",
    icon: "ScanEye",
    supportedDatatypes: ["apriltag-projector"],
    async load() {
      return Tool;
    },
  },
];
