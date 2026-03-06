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

export interface LlmlinRunDoc {
  prompt: string        // snapshot of prompt at run time
  output: OutputBlock[] // streaming output blocks
  startedAt: number
  completedAt?: number
}

export interface LLMlinDoc {
  readDocUrls: AutomergeUrl[]
  writeDocUrls: AutomergeUrl[]
  prompt: string        // updated via Automerge.updateText()
  model: string
  apiUrl: string        // LLM API endpoint, e.g. "https://openrouter.ai/api/v1"
  watchedDocUrls: AutomergeUrl[]  // which tokens trigger watch-mode reruns
  watchDebounceMs?: number        // ms of idle time before auto-run triggers (default 2000)
  watchMaxIntervalMs?: number     // if > 0, run at most every N ms even if edits keep coming
  runUrls: AutomergeUrl[] // URLs of past LlmlinRunDoc documents
  running: boolean      // true while a run is in progress
}

// ============================================================================
// DocumentToken document
// ============================================================================

export interface DocumentTokenDoc {
  docUrl: AutomergeUrl
  toolId: string
}

