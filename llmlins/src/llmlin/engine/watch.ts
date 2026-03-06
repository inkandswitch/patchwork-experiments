/**
 * Watch mode for LLMlin.
 *
 * Subscribes to Automerge change events on all watchedDocUrls.
 * When a watched document changes and no run is in progress, calls onTrigger()
 * after a short debounce.
 *
 * Own-write suppression:
 *   The caller sets isRunning=true via snapshotBeforeRun() at the start of a
 *   run and isRunning=false via recordOwnWrites() after it finishes. While
 *   isRunning is true, all change events are ignored, preventing the LLMlin's
 *   own writes from triggering a re-run.
 */

import type { Repo } from '@automerge/automerge-repo'
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
import type { LLMlinDoc } from '../types.js'

export type Disposer = () => void

export type Watcher = {
  /** Call this just before a run starts to suppress change events during the run. */
  snapshotBeforeRun(): void
  /** Call this after a run completes to re-enable change event triggering. */
  recordOwnWrites(): Promise<void>
  /** Stop watching and clean up all subscriptions. */
  dispose(): void
}

const DEFAULT_DEBOUNCE_MS = 2000

export function createWatcher(
  repo: Repo,
  handle: DocHandle<LLMlinDoc>,
  onTrigger: () => void,
  getDebounceMs: () => number = () => DEFAULT_DEBOUNCE_MS,
  getMaxIntervalMs: () => number = () => 0,
): Watcher {
  // While true, all change events on watched docs are ignored
  let isRunning = false

  // The urls we are currently subscribed to
  let watchedUrls: AutomergeUrl[] = []

  // Per-url cleanup callbacks
  const urlDisposers = new Map<AutomergeUrl, () => void>()

  // Debounce timer: fires after N ms of silence
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // Max-interval timer: fires after N ms even if edits keep coming
  let maxIntervalTimer: ReturnType<typeof setTimeout> | null = null

  function clearAllTimers() {
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
    if (maxIntervalTimer !== null) { clearTimeout(maxIntervalTimer); maxIntervalTimer = null }
  }

  function scheduleRun() {
    if (isRunning) return

    // Reset debounce
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (maxIntervalTimer !== null) { clearTimeout(maxIntervalTimer); maxIntervalTimer = null }
      onTrigger()
    }, getDebounceMs())

    // Start max-interval timer only once per "edit burst"
    const maxMs = getMaxIntervalMs()
    if (maxMs > 0 && maxIntervalTimer === null) {
      maxIntervalTimer = setTimeout(() => {
        maxIntervalTimer = null
        if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
        onTrigger()
      }, maxMs)
    }
  }

  function subscribeToUrl(url: AutomergeUrl) {
    if (urlDisposers.has(url)) return

    repo.find(url).then(docHandle => {
      const onChange = () => {
        if (isRunning) return
        scheduleRun()
      }

      docHandle.on('change', onChange)
      urlDisposers.set(url, () => docHandle.off('change', onChange))
    }).catch(() => {
      // Document unavailable — skip silently
    })
  }

  function unsubscribeFromUrl(url: AutomergeUrl) {
    const disposer = urlDisposers.get(url)
    if (disposer) {
      disposer()
      urlDisposers.delete(url)
    }
  }

  function syncSubscriptions(newUrls: AutomergeUrl[]) {
    const newSet = new Set(newUrls)

    // Remove subscriptions for urls no longer watched
    for (const url of watchedUrls) {
      if (!newSet.has(url)) unsubscribeFromUrl(url)
    }

    // Add subscriptions for newly watched urls
    for (const url of newUrls) {
      if (!urlDisposers.has(url)) subscribeToUrl(url)
    }

    watchedUrls = newUrls
  }

  // React to changes in the LLMlin doc itself (watchedDocUrls may change)
  const onLLMlinChange = () => {
    const doc = handle.doc()
    if (doc) syncSubscriptions(doc.watchedDocUrls ?? [])
  }

  handle.on('change', onLLMlinChange)

  // Initial subscription
  const initialDoc = handle.doc()
  if (initialDoc) syncSubscriptions(initialDoc.watchedDocUrls ?? [])

  const watcher: Watcher = {
    snapshotBeforeRun() {
      isRunning = true
      clearAllTimers()
    },

    async recordOwnWrites() {
      isRunning = false
    },

    dispose() {
      handle.off('change', onLLMlinChange)
      clearAllTimers()
      for (const url of [...urlDisposers.keys()]) unsubscribeFromUrl(url)
    },
  }

  return watcher
}
