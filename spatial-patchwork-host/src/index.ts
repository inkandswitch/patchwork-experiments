/**
 * Spatial Patchwork Host — plugin registration.
 *
 * Registers the host folder datatype + the host tool, a dedicated calibration
 * datatype (hidden from menus), the host-owned coordinate-system provider, and
 * one provider component per recognition layer (derived from LAYERS, so adding
 * a layer needs no edit here).
 */

import { LAYERS } from "./layers/index.js";

const layerComponentPlugins = LAYERS.map((layer) => ({
  type: "patchwork:component" as const,
  id: layer.providerComponentId,
  name: layer.name,
  async load() {
    return (await import("./providers.js")).layerProviders[
      layer.providerComponentId
    ];
  },
}));

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
      return (await import("./main.js")).HostTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "spatial-host-calibration",
    name: "Spatial Calibration",
    icon: "ScanLine",
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
  ...layerComponentPlugins,
];
