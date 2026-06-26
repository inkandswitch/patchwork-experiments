/**
 * Physical Frame — plugin registration.
 *
 * Registers the frame folder datatype + the frame tool, a dedicated calibration
 * datatype (hidden from menus), and the frame-owned coordinate-system provider.
 *
 * Recognition layers are NOT registered here — each ships in its own package as
 * a `patchwork:physical-layer` plugin (+ its relay provider) and is discovered
 * at runtime via the registry. New layers need no edit to this file.
 */

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "physical-frame",
    name: "Physical Frame",
    icon: "Frame",
    async load() {
      return (await import("./folder-datatype.js")).SpatialHostFolderDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "physical-frame",
    name: "Physical Frame",
    icon: "Frame",
    supportedDatatypes: ["physical-frame"],
    async load() {
      return (await import("./main.js")).HostTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "physical-frame-calibration",
    name: "Physical Frame Calibration",
    icon: "ScanLine",
    unlisted: true,
    async load() {
      return (await import("./folder-datatype.js")).SpatialCalibrationDatatype;
    },
  },
  {
    type: "patchwork:component",
    id: "physical-coordinate-system-provider",
    name: "Physical Coordinate System Provider",
    async load() {
      return (await import("./providers.js")).SpatialCoordinateSystemProvider;
    },
  },
];
