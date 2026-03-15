export type {
  CanvasShape,
  UserState,
  FloatingPanel,
  Bar,
  LayoutEntry,
  CanvasDoc,
  Camera,
  Rect,
  Vec2,
  PointerInfo,
  Disposer,
} from "./types.js";

export type { SpatialCanvas } from "./canvas.js";
export { getCanvas } from "./canvas.js";

export {
  createShape,
  deleteShapes,
  translateShapes,
  patchShape,
  duplicateShapes,
  newId,
  nextZIndex,
} from "./commands.js";

export { clampZoom, updateCamera, computeViewport, zoomCamera } from "./camera.js";

export { canvasPlugins } from "./plugins.js";
