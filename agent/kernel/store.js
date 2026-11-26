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
import { stopOf } from "../session/status.js"

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
      handle.change((draft) => this.appendTextIn(draft, path, delta))
    },
    /** The same append, inside a change already open. */
    appendTextIn(draft, path, delta) {
      let node = draft
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
      const key = path[path.length - 1]
      const current = node[key] ?? ""
      if (splice) splice(draft, path, current.length, 0, delta)
      else node[key] = current + delta
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
      this.change((draft) => this.appendTextIn(draft, path, delta))
    },
    appendTextIn: textInto,
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
 *
 * A path is an array, or a function giving one when the text is written (or
 * null, and the text is dropped): a reply is found by its id at each flush,
 * since a turn merged in before it moves it along the list.
 */
export function batchedAppender(store, flushMs = 120) {
  const pending = new Map() // path key -> { path, text }
  let timer = null

  const flush = () => {
    timer = null
    for (const { path, text } of pending.values()) {
      const at = typeof path === "function" ? path() : path
      if (text && at) store.appendText(at, text)
    }
    pending.clear()
  }

  return {
    append(path, delta) {
      if (!delta) return
      const key = typeof path === "function" ? path : path.join("/")
      const entry = pending.get(key) ?? { path, text: "" }
      entry.text += delta
      pending.set(key, entry)
      if (!timer) timer = setTimeout(flush, flushMs)
    },
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
    /** What is buffered, `[{ path, text }]`, taken out unwritten, for a caller to write inside a change of its own. */
    take() {
      if (timer) clearTimeout(timer)
      timer = null
      const left = [...pending.values()]
      pending.clear()
      return left
    },
  }
}

/**
 * A store a run writes through only while it may (kernel/burst.js).
 *
 *   change(fn)       runs `fn` only if `settled` has resolved, `signal` is not
 *                    aborted and no stop is in force (session/status.js
 *                    stopOf), each checked inside the change itself, so a
 *                    stop that merged in a moment ago refuses it. Returns
 *                    whether it ran.
 *   changeOwn(fn)    a write of the run's own values: allowed after an abort
 *                    or a stop, never before `settled`. `fn` checks inside
 *                    the change that what it writes is still the run's (its
 *                    reply's mark, a call it claimed, `burst` naming it).
 *   appendText       through `change`.
 *   appendTextIn     the same append inside a change already open: how a run
 *                    writes the text it buffered for its own reply inside
 *                    the change that takes the reply's mark off.
 *
 * A refused write changes nothing, so it makes no change at all.
 */
export function guardedStore(store, { signal = null, settled }) {
  let isSettled = false
  Promise.resolve(settled).then(
    () => (isSettled = true),
    () => {}
  )
  const may = (d) => isSettled && !signal?.aborted && !stopOf(d)
  const guarded = {
    url: store.url,
    doc: () => store.doc(),
    change(fn) {
      let ran = false
      store.change((d) => {
        if (!may(d)) return
        fn(d)
        ran = true
      })
      return ran
    },
    changeOwn(fn) {
      if (!isSettled) return false
      let ran = false
      store.change((d) => {
        fn(d)
        ran = true
      })
      return ran
    },
    appendText(path, delta) {
      if (!delta) return
      guarded.change((d) => guarded.appendTextIn(d, path, delta))
    },
    appendTextIn(d, path, delta) {
      if (store.appendTextIn) store.appendTextIn(d, path, delta)
      else textInto(d, path, delta)
    },
  }
  if (store.onChange) guarded.onChange = (listener) => store.onChange(listener)
  return guarded
}

/** Append to a string field inside a change, as a whole new value. */
function textInto(draft, path, delta) {
  let node = draft
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
  const key = path[path.length - 1]
  node[key] = (node[key] ?? "") + delta
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
