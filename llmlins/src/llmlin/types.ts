// ============================================================================
// Automerge document types
// ============================================================================

import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
export type { AutomergeUrl, DocHandle }

export type Disposer = () => void

// ============================================================================
// LLMlin document
// ============================================================================

import type { OutputBlock } from './engine/types.js'
export type { OutputBlock }

export interface LLMlinDoc {
  readDocUrls: AutomergeUrl[]
  writeDocUrls: AutomergeUrl[]
  prompt: string        // updated via Automerge.updateText()
  model: string
  apiUrl: string        // LLM API endpoint, e.g. "https://openrouter.ai/api/v1"
  watchedDocUrls: AutomergeUrl[]  // which tokens trigger watch-mode reruns
  output: OutputBlock[] // live-streaming output from the current run
  running: boolean      // true while a run is in progress
}

// ============================================================================
// DocumentToken document
// ============================================================================

export interface DocumentTokenDoc {
  docUrl: AutomergeUrl
  toolId: string
}

