/**
 * The spatial host's own datatype: a folder-like doc that holds the list of
 * openable spatial docs plus a URL to a dedicated calibration doc (mirroring the
 * way `space` keeps a folder doc + a separate tldraw doc).
 *
 * @typedef {Object} DocLink
 * @property {string} name
 * @property {string} type
 * @property {string} url
 * @property {string} [icon]
 *
 * @typedef {Object} SpatialHostDoc
 * @property {string} title
 * @property {DocLink[]} docs           openable docs shown one-at-a-time in the box
 * @property {string|null} calibrationUrl  dedicated calibration doc (created lazily)
 * @property {number} activeIndex       which docs[] entry is mounted in use mode
 */

export const SpatialHostFolderDatatype = {
  init(doc) {
    doc.title = "Spatial Host";
    doc.docs = [];
    doc.calibrationUrl = null;
    doc.activeIndex = 0;
  },

  getTitle(doc) {
    return doc.title || "Spatial Host";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

/**
 * The calibration doc reuses the apriltag-projector document schema (same
 * cameraViewBox / homography / pairs fields). We register it under a host-owned
 * datatype id so the host is self-contained (no dependency on the
 * apriltag-projector tool being installed). The init is copied from
 * AprilTagProjectorDatatype.
 */
export const SpatialCalibrationDatatype = {
  init(doc) {
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
    doc.tagLabels = {};
    doc.hideCursor = false;
  },

  getTitle(doc) {
    return doc.title || "Spatial Calibration";
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};

export const CALIBRATION_DATATYPE_ID = "spatial-host-calibration";
