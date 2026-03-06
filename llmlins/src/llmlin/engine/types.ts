// ============================================================================
// LLM engine types
// ============================================================================

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string }

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean }

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}
