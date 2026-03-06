import { llmlinPlugins } from './llmlin.js'
import { documentTokenPlugins } from './doc-token.js'

export type { LLMlinDoc, DocumentTokenDoc } from './types.js'
export { LLMlinDatatype, LLMlinTool } from './llmlin.js'
export { DocumentTokenDatatype, DocumentTokenTool } from './doc-token.js'

// ============================================================================
// Plugin exports
// ============================================================================

export const plugins = [
  ...llmlinPlugins,
  ...documentTokenPlugins,
]
