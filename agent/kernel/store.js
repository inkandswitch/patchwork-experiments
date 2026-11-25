/**
 * The session store.
 *
 * The loop never touches a DocHandle directly; it goes through this narrow
 * interface, which has exactly two implementations: one backed by automerge
 * and one backed by a plain object. That is what lets the entire loop —
 * streaming, tool dispatch, approvals, lease handling — be unit-tested in node
 * with no automerge, no browser, and no network.
 *
 *   doc()                     -> current snapshot
 *   change(fn)                -> mutate the document
 *   appendText(path, delta)   -> append to a string field, efficiently
 */

import { isOwn } from "./own-changes.js"

/** Store over a real automerge DocHandle. */
export function handleStore(handle, splice = null) {
  return {
    doc: () => handle.doc(),
    change: (fn) => handle.change(fn),
    /**
     * Streaming appends go through automerge's `splice` when it is available,
     * so a growing assistant message is a sequence of text insertions rather
     * than a whole-string rewrite per token. That keeps concurrent edits (two
     * people in the same session) merging correctly.
     */
    appendText(path, delta) {
      if (!delta) return
      handle.change((draft) => {
        let node = draft
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
        const key = path[path.length - 1]
        const current = node[key] ?? ""
        if (splice) splice(draft, path, current.length, 0, delta)
        else node[key] = current + delta
      })
    },
    url: handle.url,
  }
}

/** Store over a plain object. Tests, and the reference semantics. */
export function memoryStore(initial = {}) {
  let doc = initial
  const listeners = new Set()
  return {
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const listener of listeners) listener(doc)
    },
    appendText(path, delta) {
      if (!delta) return
      this.change((draft) => {
        let node = draft
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
        const key = path[path.length - 1]
        node[key] = (node[key] ?? "") + delta
      })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    url: "memory:session",
  }
}

/**
 * Buffer rapid appends into periodic flushes.
 *
 * We deliberately write streamed tokens into the document rather than pushing
 * them over an ephemeral channel — history bloat is acceptable and the
 * simplicity is worth it. But a change per token is a sync message per token,
 * so deltas are coalesced on a short timer. The text still lands in the
 * document, in order, and still streams visibly; there is just ~20x less of it
 * on the wire.
 */
export function batchedAppender(store, flushMs = 120) {
  const pending = new Map() // path key -> { path, text }
  let timer = null

  const flush = () => {
    timer = null
    for (const { path, text } of pending.values()) {
      if (text) store.appendText(path, text)
    }
    pending.clear()
  }

  return {
    append(path, delta) {
      if (!delta) return
      const key = path.join("/")
      const entry = pending.get(key) ?? { path, text: "" }
      entry.text += delta
      pending.set(key, entry)
      if (!timer) timer = setTimeout(flush, flushMs)
    },
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}

/**
 * The session's watches, writable, and nothing else in it: what the runner
 * hands doc_watch (runner.js privileges) and what a starting runner restores
 * with (tools/watch.js). `doc()` reads the whole session, which every tool may.
 */
export function watchesWriter(store) {
  return {
    url: store.url,
    doc: () => store.doc(),
    isOwn: (hash) => isOwn(store.url, hash),
    change: (fn) =>
      store.change((d) => {
        if (!d.watches) d.watches = {}
        fn(d.watches)
      }),
  }
}
