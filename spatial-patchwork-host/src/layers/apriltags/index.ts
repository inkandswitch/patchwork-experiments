import type { SpatialLayer } from "../types.js";
import type { SpatialTags } from "./types.js";
import { APRILTAGS_SELECTOR } from "./types.js";
import { createApriltagRecognizer } from "./recognizer.js";

export const apriltagsLayer: SpatialLayer<SpatialTags> = {
  selector: APRILTAGS_SELECTOR,
  providerComponentId: "spatial-apriltags-provider",
  name: "Spatial AprilTags Provider",
  initialResult: () => ({ tags: [] }),
  createRecognizer: (emitter) => createApriltagRecognizer(emitter),
};
