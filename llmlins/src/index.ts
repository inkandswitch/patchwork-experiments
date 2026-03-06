import { plugins as spatialCanvasPlugins } from './spatial-canvas/index.js'
import { plugins as llmlinPlugins } from './llmlin/index.js'
import { documentTokenPlugins as docTokenPlugins } from './doc-token/index.js'

export type { CanvasDoc, CanvasShape } from './spatial-canvas/index.js'
export { SpatialCanvasDatatype, Tool } from './spatial-canvas/index.js'

export type { LLMlinDoc } from './llmlin/index.js'
export { LLMlinDatatype, LLMlinTool } from './llmlin/index.js'

export type { DocumentTokenDoc } from './llmlin/types.js'
export { DocumentTokenDatatype, DocumentTokenTool } from './doc-token/index.js'

export const plugins = [
  ...spatialCanvasPlugins,
  ...llmlinPlugins,
  ...docTokenPlugins,
]
