import { plugin as mathOpPlugin } from "../math-op-node.js";
import { plugin as rangeMapPlugin } from "../range-map-node.js";
import { plugin as splitJoinPlugin } from "../split-join-node.js";
import { plugin as mapListPlugin } from "../map-list-node.js";
import { plugin as batteryPlugin } from "../battery-source.js";
import { plugin as clipboardPlugin } from "../clipboard-source.js";
import { plugin as orientationPlugin } from "../orientation-source.js";
import { plugin as motionPlugin } from "../motion-source.js";
import { plugin as gatePlugin } from "../gate-node.js";
import { plugin as combinePlugin } from "../combine-node.js";
import { plugin as switchPlugin } from "../switch-node.js";
import { plugin as bufferPlugin } from "../buffer-node.js";
import { plugin as delayPlugin } from "../delay-node.js";
import { plugin as clampPlugin } from "../clamp-node.js";
import { plugin as roundPlugin } from "../round-node.js";
import { plugin as jsonPrettyLens } from "../json-pretty-lens.js";
import { mapPrettyLens, mapNumberToStringLens } from "../lenses.js";
import { plugin as throttlePlugin } from "../throttle-node.js";
import { plugin as pointerLockPlugin } from "../pointerlock-source.js";
import { plugin as magnifierPlugin } from "../llm-magnifier.js";
import { plugin as minimapPlugin } from "../minimap-node.js";
import { geoMarksSchema, pixelMarksSchema } from "../map-schemas.js";
import { plugin as palettePlugin } from "../palette-node.js";
import { plugin as paletteConfigPlugin } from "../palette-config-node.js";
import { plugin as presencePlugin } from "../presence-node.js";
import { plugin as layersPlugin } from "../layers-node.js";
import { plugin as partsPlugin } from "../parts-bin.js";
import { plugin as zoomPlugin } from "../zoom-node.js";
import { plugin as canvasSourcePlugin } from "../canvas-source-node.js";

const mapPlugin = {
  type: "sketchy:window",
  id: "map",
  name: "Map",
  icon: "Map",
  inlets: [],
  outlets: [
    { name: "shapes", type: "json", schema: geoMarksSchema() },
    { name: "pixels", type: "json", schema: pixelMarksSchema() },
  ],
  async load() {
    return (await import("../map-node.js")).mountMap;
  },
};

export const contributedNodePlugins = [
  mathOpPlugin,
  rangeMapPlugin,
  splitJoinPlugin,
  mapListPlugin,
  batteryPlugin,
  clipboardPlugin,
  orientationPlugin,
  motionPlugin,
  gatePlugin,
  combinePlugin,
  switchPlugin,
  bufferPlugin,
  delayPlugin,
  clampPlugin,
  roundPlugin,
  jsonPrettyLens,
  mapPrettyLens,
  mapNumberToStringLens,
  throttlePlugin,
  pointerLockPlugin,
  magnifierPlugin,
  palettePlugin,
  paletteConfigPlugin,
  presencePlugin,
  layersPlugin,
  partsPlugin,
  minimapPlugin,
  zoomPlugin,
  mapPlugin,
  canvasSourcePlugin,
];
