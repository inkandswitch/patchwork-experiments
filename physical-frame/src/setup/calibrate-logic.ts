/**
 * Calibration helpers shared by the control panel and the Calibrate UI. Thin
 * wrappers over the math in calibration-core.
 */

import type { DocHandle } from "@automerge/automerge-repo";
import type { CalibrationDoc, CameraSize } from "../folder-datatype";
import {
  getCalibrationTargets,
  countCapturedTargets,
  chooseCalibrationSize,
  solveCameraToBoardHomography,
  computeMeanReprojectionErrorPx,
  invertHomography,
  normalizeCameraSize,
  cloneSize,
} from "../calibration-core.js";

/** Clear the currently-active target's captured pair (re-capture it). */
export function recaptureActive(calHandle: DocHandle<CalibrationDoc>): void {
  calHandle.change((d) => {
    const active = d.activeTargetId;
    if (d.pairs && active && d.pairs[active]) delete d.pairs[active];
    d.homographyCamToBoard = null;
    d.homographyBoardToCam = null;
    d.cameraCalibrationSize = null;
  });
}

/** Clear all captured pairs + the solved homography (keeps the alignment box). */
export function clearCapture(calHandle: DocHandle<CalibrationDoc>): void {
  calHandle.change((d) => {
    const targets = getCalibrationTargets(d.gridSize);
    d.pairs = {};
    d.homographyCamToBoard = null;
    d.homographyBoardToCam = null;
    d.cameraCalibrationSize = null;
    d.testMarkers = [];
    d.activeTargetId = targets[0] ? targets[0].id : "A";
  });
}

/** Full reset: alignment box back to full frame and all calibration cleared. */
export function resetCalibration(calHandle: DocHandle<CalibrationDoc>): void {
  calHandle.change((d) => {
    d.cameraViewBox = { x: 0, y: 0, w: 1, h: 1 };
    d.pairs = {};
    d.homographyCamToBoard = null;
    d.homographyBoardToCam = null;
    d.cameraCalibrationSize = null;
    d.testMarkers = [];
    d.activeTargetId = "A";
  });
}

export function captureCount(doc: CalibrationDoc): number {
  const targets = getCalibrationTargets(doc.gridSize);
  return countCapturedTargets(targets, doc.pairs);
}

export function calibrationStatus(doc: CalibrationDoc): {
  text: string;
  kind?: "accent" | "danger";
} {
  const targets = getCalibrationTargets(doc.gridSize);
  const captured = countCapturedTargets(targets, doc.pairs);

  if (doc.mode === "align") {
    return { text: "Arrows: move · +/−: width · [ ]: height · Shift: coarse" };
  }
  if (doc.mode === "calibrate") {
    const err = computeMeanReprojectionErrorPx(
      targets,
      doc.pairs,
      doc.homographyBoardToCam,
      doc.cameraCalibrationSize,
    );
    if (err != null) {
      return {
        text: `${captured}/${targets.length} captured · mean ${err.toFixed(1)}px`,
        kind: "accent",
      };
    }
    return {
      text: `${captured}/${targets.length} captured`,
      kind: captured === targets.length ? "accent" : undefined,
    };
  }
  // test
  if (!doc.homographyCamToBoard) {
    return { text: "Solve calibration first.", kind: "danger" };
  }
  return {
    text: `${doc.testMarkers.length} test marker${doc.testMarkers.length === 1 ? "" : "s"}`,
    kind: doc.testMarkers.length ? "accent" : undefined,
  };
}

/** Solve the homography from captured pairs and persist it into the doc. */
export function solveSetup(
  calHandle: DocHandle<CalibrationDoc>,
  liveSize: CameraSize | null,
): { ok: boolean; message: string } {
  const doc = calHandle.doc();
  if (!doc) return { ok: false, message: "No calibration doc." };
  const targets = getCalibrationTargets(doc.gridSize);
  if (countCapturedTargets(targets, doc.pairs) < targets.length) {
    return { ok: false, message: "Capture every target first." };
  }
  const calibrationSize = chooseCalibrationSize(
    targets,
    doc.pairs,
    doc.cameraCalibrationSize || normalizeCameraSize(liveSize),
  );
  if (!calibrationSize) {
    return { ok: false, message: "Need a camera resolution to solve." };
  }
  const camToBoard = solveCameraToBoardHomography(
    targets,
    doc.pairs,
    calibrationSize,
  );
  const boardToCam = camToBoard ? invertHomography(camToBoard) : null;
  if (!camToBoard || !boardToCam) {
    return { ok: false, message: "Could not solve a stable homography." };
  }
  const err = computeMeanReprojectionErrorPx(
    targets,
    doc.pairs,
    boardToCam,
    calibrationSize,
  );
  calHandle.change((d) => {
    d.homographyCamToBoard = camToBoard;
    d.homographyBoardToCam = boardToCam;
    d.cameraCalibrationSize = cloneSize(calibrationSize);
  });
  return {
    ok: true,
    message:
      err == null
        ? "Solved calibration."
        : `Solved at ${err.toFixed(1)}px mean error.`,
  };
}
