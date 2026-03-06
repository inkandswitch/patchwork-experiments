import { plugins as spatialCanvasPlugins } from './spatial-canvas/index.js'
import { plugins as llmlinPlugins } from './llmlin/index.js'

export type { CanvasDoc, CanvasShape } from './spatial-canvas/index.js'
export { SpatialCanvasDatatype, Tool } from './spatial-canvas/index.js'

export type { LLMlinDoc, DocumentTokenDoc } from './llmlin/index.js'
export { LLMlinDatatype, LLMlinTool, DocumentTokenDatatype, DocumentTokenTool } from './llmlin/index.js'

export const plugins = [
  ...spatialCanvasPlugins,
  ...llmlinPlugins,
]
