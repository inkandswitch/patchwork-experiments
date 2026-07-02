import { layerTransformPlugins, layerKindPlugins } from "../layers.js";

// Layer coordinate-spaces + kinds are plugins, not a core switch: camera/viewport
// ship here; a map adds `geo` the same way by registering a transform.
export const layerPlugins = [
  ...layerTransformPlugins,
  ...layerKindPlugins,
];
