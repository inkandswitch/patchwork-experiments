import type { SpatialLayer } from "../types.js";
import type { Walls } from "./types.js";
import { WALLS_SELECTOR } from "./types.js";
import { createWallsRecognizer } from "./recognizer.js";

export const wallsLayer: SpatialLayer<Walls> = {
  selector: WALLS_SELECTOR,
  providerComponentId: "spatial-walls-provider",
  name: "Spatial Walls Provider",
  initialResult: () => ({ shapes: [] }),
  createRecognizer: (emitter) => createWallsRecognizer(emitter),
};
