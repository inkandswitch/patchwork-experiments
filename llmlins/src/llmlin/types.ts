// ============================================================================
// Automerge document types
// ============================================================================

export type AutomergeUrl = string

export type Disposer = () => void

// ============================================================================
// LLMlin document
// ============================================================================

export interface LLMlinDoc {
  readDocUrls: AutomergeUrl[]
  writeDocUrls: AutomergeUrl[]
  prompt: string        // updated via Automerge.updateText()
  model: string
  watchedDocUrls: AutomergeUrl[]  // which tokens are visible in eye-mode overlay
}

// ============================================================================
// DocumentToken document
// ============================================================================

export interface DocumentTokenDoc {
  docUrl: AutomergeUrl
  toolId: string
}

// ============================================================================
// DocHandle — minimal interface matching Automerge's DocHandle API
// ============================================================================

export interface DocHandle<T> {
  doc(): T | undefined
  on(event: 'change', callback: (payload: { doc: T }) => void): void
  off(event: 'change', callback: (payload: { doc: T }) => void): void
  change(fn: (doc: T) => void): void
  url: AutomergeUrl
}
