/**
 * Spatial Patchwork Host — plugin registration.
 *
 * Registers:
 *  - the host folder datatype + the host tool
 *  - a dedicated calibration datatype (reuses the apriltag-projector schema)
 *  - the two spatial provider components (coordinate-system + apriltags)
 */

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-patchwork-host",
    name: "Spatial Host",
    icon: "Frame",
    async load() {
      return (await import("./folder-datatype.js")).SpatialHostFolderDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-patchwork-host",
    name: "Spatial Host",
    icon: "Frame",
    supportedDatatypes: ["spatial-patchwork-host"],
    async load() {
      return (await import("./host.js")).HostTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "spatial-host-calibration",
    name: "Spatial Calibration",
    icon: "ScanLine",
    // Created/managed by the host; hidden from the new-document menu.
    unlisted: true,
    async load() {
      return (await import("./folder-datatype.js")).SpatialCalibrationDatatype;
    },
  },
  {
    type: "patchwork:component",
    id: "spatial-coordinate-system-provider",
    name: "Spatial Coordinate System Provider",
    async load() {
      return (await import("./providers.js")).SpatialCoordinateSystemProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "spatial-apriltags-provider",
    name: "Spatial AprilTags Provider",
    async load() {
      return (await import("./providers.js")).SpatialApriltagsProvider;
    },
  },
];
