/**
 * AprilTags physical layer — plugin registration.
 *
 * Registers two plugins discovered by physical-frame at runtime:
 *   - a `patchwork:physical-layer` (the reader + descriptor), and
 *   - a `patchwork:component` (the relay provider for `physical:apriltags`).
 *
 * No edit to physical-frame is needed to add this layer — just register this
 * package's URL in the module-settings doc.
 */

import {
  PHYSICAL_LAYER_PLUGIN_TYPE,
  makeRelayProvider,
  type PhysicalLayer,
} from "./contract.js";
import {
  APRILTAGS_SELECTOR,
  APRILTAGS_PROVIDER_ID,
  type PhysicalTags,
} from "./types.js";
import { createApriltagReader } from "./reader.js";

const apriltagsLayer: PhysicalLayer<PhysicalTags> = {
  selector: APRILTAGS_SELECTOR,
  providerComponentId: APRILTAGS_PROVIDER_ID,
  name: "AprilTags Physical Layer",
  initialResult: () => ({ calibrated: false, tags: [] }),
  createReader: (emitter) => createApriltagReader(emitter),
};

export const plugins = [
  {
    type: PHYSICAL_LAYER_PLUGIN_TYPE,
    id: APRILTAGS_PROVIDER_ID,
    name: "AprilTags Physical Layer",
    icon: "ScanLine",
    async load() {
      return apriltagsLayer;
    },
  },
  {
    type: "patchwork:component",
    id: APRILTAGS_PROVIDER_ID,
    name: "AprilTags Provider",
    async load() {
      return makeRelayProvider(APRILTAGS_SELECTOR);
    },
  },
];
