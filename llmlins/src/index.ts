import { plugins as spatialCanvasPlugins } from './spatial-canvas/index.js'

export type { CanvasDoc, CanvasShape } from './spatial-canvas/index.js'
export { SpatialCanvasDatatype, Tool, RectangleDatatype, RectangleTool } from './spatial-canvas/index.js'

export const plugins = [
  ...spatialCanvasPlugins,
]
