/**
 * Physical Frame — plugin registration.
 *
 * Registers the frame TOOL (a frame-tool over the `account` datatype), the
 * physical-frame CONFIG datatype (its per-account subdoc; unlisted — not a
 * user-created doc type), a dedicated calibration datatype (hidden), and the
 * frame-owned coordinate-system provider.
 *
 * Sensor layers are NOT registered here — each ships in its own package as a
 * `physical:sensor` plugin (+ its relay provider) and is discovered at runtime.
 * Calibration plugins register into the `physical:calibration` bucket; the frame
 * ships one built-in default below (others can be registered by other packages).
 */

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "physical-frame",
    name: "Physical Frame Config",
    icon: "Frame",
    unlisted: true,
    async load() {
      return (await import("./folder-datatype.js")).SpatialHostFolderDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "physical-frame",
    name: "Physical Frame",
    icon: "Frame",
    tags: ["frame-tool"],
    supportedDatatypes: ["account"],
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
  {
    type: "patchwork:component",
    id: "physical-calibration-doc-provider",
    name: "Physical Calibration Doc Provider",
    async load() {
      return (await import("./providers.js")).CalibrationDocProvider;
    },
  },
  {
    // Built-in default calibration plugin (others may register into this bucket).
    type: "physical:calibration",
    id: "physical-frame:builtin-calibration",
    name: "Built-in calibration",
    async load() {
      return (await import("./calibration/builtin.jsx")).BuiltinCalibration;
    },
  },
];
