/**
 * physical-frame configuration doc (a per-account subdoc, referenced by
 * `accountDoc.physicalFrameConfigUrl`). It holds the set of physical SYSTEMS
 * (rigs) — each with its own calibration doc + reserved-tag control mapping — so
 * one account can calibrate and run several rigs. The *current* system is chosen
 * per-frame-instance (localStorage), not stored here, so two windows can run two
 * rigs at once. Frame-level display state (surface brightness, panel position,
 * the open-doc list) lives at the top level.
 */

import type { AutomergeUrl } from "@automerge/automerge-repo";

export type BarPosition = { left: number; top: number };

// ---- Physical controls (reserved AprilTags → frame UI) --------------------
export type ControlAction = "setup" | "hide-controls" | "left-sidebar";
export type ControlTrigger = "momentary" | "toggle";
export type ControlEntry = { action: ControlAction; trigger: ControlTrigger };
/** tag id (as string) → control entry */
export type ControlMap = Record<string, ControlEntry>;

/** One physical rig: its calibration doc + reserved-tag controls. */
export type PhysicalSystem = {
  name: string;
  /** dedicated calibration doc for this rig (created when the system is added) */
  calibrationUrl: AutomergeUrl | null;
  /** reserved-tag controls for this rig */
  controls: ControlMap;
};

export type PhysicalFrameConfig = {
  title: string;
  /** the physical rigs this account can run, keyed by system id */
  systems: Record<string, PhysicalSystem>;
  /** unified control panel position */
  barPosition: BarPosition | null;
};

/** Back-compat alias — the config doc replaces the old host doc shape. */
export type SpatialHostDoc = PhysicalFrameConfig;

// tag36h11 has 587 codes (ids 0..586). Reserve the TOP of the space for controls
// so they don't collide with low-numbered content tags.
export const MAX_TAG_ID = 586;

// TEMP (Phase 2/3 testing): low ids 3/4/5 (physical tags on hand). Restore the
// top-of-space defaults (586/585/584) once those are printed.
export function defaultControls(): ControlMap {
  return {
    "5": { action: "hide-controls", trigger: "toggle" },
    "4": { action: "setup", trigger: "toggle" },
    "3": { action: "left-sidebar", trigger: "momentary" },
  };
}

export const SpatialHostFolderDatatype = {
  init(doc: PhysicalFrameConfig) {
    doc.title = "Physical Frame";
    doc.systems = {};
    doc.barPosition = null;
  },
  getTitle(doc: PhysicalFrameConfig) {
    return doc.title || "Physical Frame";
  },
  setTitle(doc: PhysicalFrameConfig, title: string) {
    doc.title = title;
  },
  markCopy(doc: PhysicalFrameConfig) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

/** Calibration sub-mode (within the Setup phase). */
export type CalibrationMode = "align" | "calibrate" | "test";

export type CameraViewBox = { x: number; y: number; w: number; h: number };
export type CameraSize = { w: number; h: number };
export type CalibrationPair = {
  board: [number, number];
  camera: [number, number];
  cameraSize: CameraSize | null;
};

export type CalibrationDoc = {
  title: string;
  cameraViewBox: CameraViewBox;
  mode: CalibrationMode;
  gridSize: 4 | 9;
  pairs: Record<string, CalibrationPair>;
  homographyCamToBoard: number[] | null;
  homographyBoardToCam: number[] | null;
  cameraCalibrationSize: CameraSize | null;
  activeTargetId: string;
  testMarkers: { board: [number, number]; camera: [number, number] }[];
  /**
   * Brightness (0–100) of the projected "paper" the camera sees, per rig. Lives
   * here (not the frame config) so it's part of calibration and matches the
   * sampled background. Optional for back-compat with older calibration docs.
   */
  surfaceBrightness?: number;
};

/**
 * The calibration doc reuses the apriltag-projector document schema. Registered
 * under a host-owned datatype id so the host is self-contained.
 */
export const SpatialCalibrationDatatype = {
  init(doc: CalibrationDoc) {
    doc.title = "Spatial Calibration";
    doc.cameraViewBox = { x: 0, y: 0, w: 1, h: 1 };
    doc.mode = "align";
    doc.gridSize = 4;
    doc.pairs = {};
    doc.homographyCamToBoard = null;
    doc.homographyBoardToCam = null;
    doc.cameraCalibrationSize = null;
    doc.activeTargetId = "A";
    doc.testMarkers = [];
    doc.surfaceBrightness = 0;
  },
  getTitle(doc: CalibrationDoc) {
    return doc.title || "Spatial Calibration";
  },
  setTitle(doc: CalibrationDoc, title: string) {
    doc.title = title;
  },
};

export const CALIBRATION_DATATYPE_ID = "physical-frame-calibration";
