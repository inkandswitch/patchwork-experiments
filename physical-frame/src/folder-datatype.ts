/**
 * The spatial host's own datatype: a folder-like doc holding the list of
 * openable spatial docs plus a URL to a dedicated calibration doc (mirroring
 * the way `space` keeps a folder doc + a separate tldraw doc).
 */

import type { AutomergeUrl } from "@automerge/automerge-repo";

export type DocLink = {
  name: string;
  type: string;
  url: AutomergeUrl;
  icon?: string;
};

export type BarPosition = { left: number; top: number };

export type HostMode = "setup" | "sample" | "use";

export type SpatialHostDoc = {
  title: string;
  /** openable docs shown one-at-a-time in the box */
  docs: DocLink[];
  /** dedicated calibration doc (created lazily on first render) */
  calibrationUrl: AutomergeUrl | null;
  /** which docs[] entry is mounted in use mode */
  activeIndex: number;
  /** top-level phase */
  hostMode: HostMode;
  /** unified control panel position (synced to all screens) */
  barPosition: BarPosition | null;
  /**
   * Brightness (0–100) of the light the projector paints behind the embedded
   * tool, i.e. the "paper" the camera sees. 0 = black (legacy). Raising it
   * floods the surface with projector light so a dark marker has high contrast
   * against it — essential for the walls layer in a dim room. Applied during
   * BOTH the background sample and Use so the reference matches the live scene.
   */
  surfaceBrightness?: number;
};

export const SpatialHostFolderDatatype = {
  init(doc: SpatialHostDoc) {
    doc.title = "Physical Frame";
    doc.docs = [];
    doc.calibrationUrl = null;
    doc.activeIndex = 0;
    doc.hostMode = "setup";
    doc.barPosition = null;
    doc.surfaceBrightness = 0;
  },
  getTitle(doc: SpatialHostDoc) {
    return doc.title || "Physical Frame";
  },
  setTitle(doc: SpatialHostDoc, title: string) {
    doc.title = title;
  },
  markCopy(doc: SpatialHostDoc) {
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
  },
  getTitle(doc: CalibrationDoc) {
    return doc.title || "Spatial Calibration";
  },
  setTitle(doc: CalibrationDoc, title: string) {
    doc.title = title;
  },
};

export const CALIBRATION_DATATYPE_ID = "physical-frame-calibration";
