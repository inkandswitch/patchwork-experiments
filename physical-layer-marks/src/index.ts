/**
 * Marks physical layer — plugin registration.
 *
 * Registers two plugins discovered by physical-frame at runtime:
 *   - a `patchwork:physical-layer` (the reader + descriptor), and
 *   - a `patchwork:component` (the relay provider for `physical:marks`).
 *
 * No edit to physical-frame is needed to add this layer — just register this
 * package's URL in the module-settings doc.
 */

import {
  PHYSICAL_LAYER_PLUGIN_TYPE,
  makeRelayProvider,
  type PhysicalLayer,
} from "./contract.js";
import { MARKS_SELECTOR, MARKS_PROVIDER_ID, type Marks } from "./types.js";
import { createMarksReader } from "./reader.js";

const marksLayer: PhysicalLayer<Marks> = {
  selector: MARKS_SELECTOR,
  providerComponentId: MARKS_PROVIDER_ID,
  name: "Marks Physical Layer",
  initialResult: () => ({ shapes: [] }),
  createReader: (emitter) => createMarksReader(emitter),
};

export const plugins = [
  {
    type: PHYSICAL_LAYER_PLUGIN_TYPE,
    id: MARKS_PROVIDER_ID,
    name: "Marks Physical Layer",
    icon: "PenLine",
    async load() {
      return marksLayer;
    },
  },
  {
    type: "patchwork:component",
    id: MARKS_PROVIDER_ID,
    name: "Marks Provider",
    async load() {
      return makeRelayProvider(MARKS_SELECTOR);
    },
  },
];
