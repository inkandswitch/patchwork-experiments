/**
 * Calibration core — camera/projector homography + coordinate math.
 *
 * The pure calibration pipeline (originally from the apriltag-projector /
 * spatial-calibration tool), with the standalone AprilTag-detector tool removed:
 * physical-frame does NOT detect AprilTags — that lives in the
 * physical-layer-apriltags package. This file provides only the math the frame
 * needs to map:
 *
 *   camera pixels <-> board coordinates <-> projector fractions
 *
 * (align -> calibrate -> test), plus the small doc-normalization helpers those
 * functions rely on. No DOM, no worker, no detection.
 *
 * @typedef {Object} CameraViewBox
 * @property {number} x
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
