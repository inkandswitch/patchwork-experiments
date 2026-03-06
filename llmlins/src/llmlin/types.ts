// ============================================================================
// Automerge document types
// ============================================================================

import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
export type { AutomergeUrl, DocHandle }

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

