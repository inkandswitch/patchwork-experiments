/**
 * Watch mode for LLMlin.
 *
 * Subscribes to Automerge change events on all watchedDocUrls.
 * When a watched document changes due to an external edit (not caused by the
 * LLMlin run itself), calls onTrigger() after a short debounce.
 *
 * Own-write detection:
 *   Before each run the caller should call watcher.snapshotBeforeRun() and
 *   after the run call watcher.recordOwnWrites(). Any change whose new heads
 *   match the post-run heads of a write doc is treated as an own write and
 *   will not trigger a re-run.
 */

import type { Repo } from '@automerge/automerge-repo'
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
import type { LLMlinDoc } from '../types.js'

export type Disposer = () => void

export type Watcher = {
  /** Call this just before a run starts to prime own-write detection. */
  snapshotBeforeRun(): void
  /** Call this after a run completes to record which heads came from own writes. */
  recordOwnWrites(): Promise<void>
  /** Stop watching and clean up all subscriptions. */
  dispose(): void
}

const DEBOUNCE_MS = 150

export function createWatcher(
  repo: Repo,
  handle: DocHandle<LLMlinDoc>,
  onTrigger: () => void,
): Watcher {
  // Map from url → set of heads strings we produced ourselves
  const ownHeads = new Map<AutomergeUrl, Set<string>>()

  // The urls we are currently subscribed to
  let watchedUrls: AutomergeUrl[] = []

  // Per-url cleanup callbacks
  const urlDisposers = new Map<AutomergeUrl, () => void>()

  // Debounce timer handle
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function headsKey(heads: string[]): string {
    return [...heads].sort().join(',')
  }

  function scheduleRun() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onTrigger()
    }, DEBOUNCE_MS)
  }

  function subscribeToUrl(url: AutomergeUrl) {
    if (urlDisposers.has(url)) return

    repo.find(url).then(docHandle => {
      const onChange = () => {
        const heads = docHandle.heads() as string[]
        const key = headsKey(heads)
        const known = ownHeads.get(url)
        if (known?.has(key)) {
          // This change came from our own run — ignore
          known.delete(key)
          return
        }
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
    ownHeads.delete(url)
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

  // ---- Own-write detection helpers ----

  // Heads snapshot taken just before the run, keyed by write doc url
  let preRunHeads = new Map<AutomergeUrl, string>()

  const watcher: Watcher = {
    snapshotBeforeRun() {
      const doc = handle.doc()
      if (!doc) return
      preRunHeads = new Map()
      for (const url of doc.writeDocUrls ?? []) {
        repo.find(url).then(h => {
          preRunHeads.set(url, headsKey(h.heads() as string[]))
        }).catch(() => {})
      }
    },

    async recordOwnWrites() {
      const doc = handle.doc()
      if (!doc) return
      for (const url of doc.writeDocUrls ?? []) {
        try {
          const h = await repo.find(url)
          const newKey = headsKey(h.heads() as string[])
          const oldKey = preRunHeads.get(url)
          if (oldKey !== undefined && newKey !== oldKey) {
            if (!ownHeads.has(url)) ownHeads.set(url, new Set())
            ownHeads.get(url)!.add(newKey)
          }
        } catch {
          // skip
        }
      }
      preRunHeads.clear()
    },

    dispose() {
      handle.off('change', onLLMlinChange)
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      for (const url of [...urlDisposers.keys()]) unsubscribeFromUrl(url)
    },
  }

  return watcher
}
