/**
 * The repo a full-access session's tools are handed.
 *
 * It works as the repo does, except that its handles refuse to change a
 * session, a plan or a research ledger, or to make a document into one, and
 * it makes none itself. So no agent tool — doc_edit, fs_write, a plugin — can
 * rewrite a step's scope or its grants, forge a plan for the driver to run,
 * or add a document to a ledger, which would make it readable by a step that
 * fetches freely from the web (kernel/scope.js). The
 * two modules that legitimately write those are handed explicit capabilities
 * instead (`ctx.workflows`, `ctx.session`; see kernel/runner.js `privileges`),
 * for their own calls only: no other tool, and no plugin, ever holds the real
 * repo or a writer of a session.
 *
 * Every write through it is also reported to `record`, as the heads it added
 * (own-changes.js), so a session's own edits can be told from everyone else's.
 *
 * Nor does it let a tool read a session's task (runners/ask.js asks for one
 * under `agent:<session>`, with its asker's keys in its input): a handle on
 * one answers nothing but whether it is ready, and the repo exports, clones
 * and merges none into another document.
 * Other packages' tasks read as any document does, so their tools can follow
 * them.
 */

import { addedHeads } from "./own-changes.js"
import { Automerge as A, AutomergeRepo } from "../host/modules.js"
import { repairDocUrl, documentIdOf } from "../documents/doc-urls.js"

const { decodeHeads, encodeHeads } = AutomergeRepo

/** What research steps have kept, and so what they may read (kernel/scope.js). */
export const LEDGER_TYPE = "agent-ledger"

/** The documents only the runtime writes: sessions, workflow plans and research ledgers. */
export const KERNEL_TYPES = ["agent-session", "agent-workflow", LEDGER_TYPE]

export const KERNEL_REFUSAL = "Sessions, workflow plans and research ledgers are written only by the agent runtime; no tool may change one."

export const isKernel = (doc) => KERNEL_TYPES.includes(doc?.["@patchwork"]?.type)

/** Handle methods that hand back another handle on the same document. */
const DERIVES = new Set(["view", "sub"])

/** Handle methods that take a listener, which must be handed the guarded handle, not the one beneath. */
const LISTENS = new Set(["on", "once", "addListener", "off", "removeListener"])

/** The whole document behind a handle, whatever path it is scoped to. */
const whole = (handle) => (typeof handle.fullDoc === "function" ? handle.fullDoc() : handle.doc())

export const refuse = () => {
  throw new Error(KERNEL_REFUSAL)
}

/**
 * A task asked for a session's work: its input holds its asker's keys. Told
 * here, as the task rules tell a task (an `importUrl` and a list of runs),
 * since every tool's repo refuses one whether or not the Tasks package is
 * installed where it runs.
 */
export const isSessionTask = (doc) => typeof doc?.importUrl === "string" && Array.isArray(doc.runs) && typeof doc.key === "string" && doc.key.startsWith("agent:")

export const TASK_REFUSAL = "That document is an agent session's task: its input holds its asker's keys, so no tool reads it."

const refuseTask = () => {
  throw new Error(TASK_REFUSAL)
}

/** What a handle on a session's task still answers: whether it is there, and letting go of a listener. */
const TASK_ANSWERS = new Set(["whenReady", "isReady", "isDeleted", "isUnavailable", "inState", "off", "removeListener"])

/**
 * Each guarded handle, by the handle beneath it, and back: one guard per handle
 * for each session's record of its writes (or none), so a listener comes off
 * the way it went on and a write is credited to the session that made it.
 */
const guardsByRecord = new WeakMap() // record -> WeakMap(handle -> guard)

const unrecorded = new WeakMap()

const guardsFor = (record) => {
  if (!record) return unrecorded
  if (!guardsByRecord.has(record)) guardsByRecord.set(record, new WeakMap())
  return guardsByRecord.get(record)
}

const beneath = new WeakMap()

const unguarded = (value) => beneath.get(value) ?? value

/**
 * A write through a sub-handle changes only what is at its path, so it can
 * make a document a session, a plan or a ledger only from inside `@patchwork`. One
 * whose path starts anywhere else is left to the document as it is; one that
 * starts there, or at a path that does not resolve, is refused.
 */
function judgePath(handle) {
  const first = handle.path?.[0]
  if (!first || first.prop === undefined || first.prop === "@patchwork") refuse()
}

const isSub = (handle) => (handle.path?.length ?? 0) > 0 || !!handle.range

/**
 * A whole-document write, done to a copy and kept only if the copy is still
 * not a session, a plan or a ledger. Through `update`, which adopts what its callback
 * returns and keeps the document as it was if the callback throws: the
 * document the handle holds is never touched by a write that is refused.
 * Copied under the same actor, so a write that is kept reads as this peer's.
 */
function judgedWrite(handle, write) {
  let result
  handle.update((doc) => {
    const after = write(A.clone(doc, { actor: A.getActorId(doc) }))
    if (isKernel(after.doc)) refuse()
    result = after.result
    return after.doc
  })
  return result
}

/**
 * How each write is done through a guarded handle, after the document as it
 * is has been judged. Every one judges what the document will be, too: a plan
 * a tool could make would pass for a real one, and the driver would run its
 * research steps against a ledger the tool wrote.
 */
const WRITES = {
  change(handle, write, [fn, options]) {
    if (isSub(handle)) {
      judgePath(handle)
      return write.call(handle, fn, options)
    }
    // A root change's draft is the document as the change leaves it, and a
    // throw inside the change abandons it — cheaply, so the common write is
    // not copied.
    const checked = (d) => {
      fn(d)
      if (isKernel(d)) refuse()
    }
    return write.call(handle, typeof fn === "function" ? checked : fn, options)
  },
  changeAt(handle, write, [heads, fn, options = {}]) {
    if (isSub(handle)) {
      judgePath(handle)
      return write.call(handle, heads, fn, options)
    }
    // The draft is the document at `heads`; what it becomes is that merged
    // with everything since, which only the result shows.
    return judgedWrite(handle, (doc) => {
      const { newDoc, newHeads } = A.changeAt(doc, decodeHeads(heads), options, fn)
      return { doc: newDoc, result: newHeads ? encodeHeads(newHeads) : undefined }
    })
  },
  merge(handle, _write, [other]) {
    // A session's task is not read by merging it into another document either.
    const theirs = whole(unguarded(other))
    if (isSessionTask(theirs)) refuseTask()
    return judgedWrite(handle, (doc) => ({ doc: A.merge(doc, theirs) }))
  },
  update(handle, _write, [fn]) {
    return judgedWrite(handle, (doc) => ({ doc: fn(doc) }))
  },
  remove(handle, write) {
    judgePath(handle)
    return write.call(handle)
  },
  delete(handle, write) {
    return write.call(handle)
  },
}

/** The whole document behind a handle, or null when it has none to give (not loaded, deleted). */
const wholeOrNull = (handle) => {
  try {
    return whole(handle)
  } catch {
    return null
  }
}

/** The heads of the whole document behind a handle, or null if it has none now (deleted). */
const headsOf = (handle) => {
  try {
    return A.getHeads(whole(handle))
  } catch {
    return null
  }
}

function kernelHandle(handle, record = null) {
  if (!handle || typeof handle !== "object") return handle
  if (beneath.has(handle)) return handle
  const guards = guardsFor(record)
  if (guards.has(handle)) return guards.get(handle)

  // A listener is called with the handle it was added to; it gets this one.
  const listeners = new WeakMap()
  const listenerFor = (fn) => {
    if (typeof fn !== "function") return fn
    if (!listeners.has(fn)) listeners.set(fn, (payload) => fn(payload?.handle ? { ...payload, handle: kernelHandle(payload.handle, record) } : payload))
    return listeners.get(fn)
  }
  // The chainable methods return the handle itself; they return this one.
  const ours = (result) => (result === handle ? guard : result)

  const guard = new Proxy(handle, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== "function") return value
      if (!TASK_ANSWERS.has(key) && isSessionTask(wholeOrNull(target))) refuseTask()
      if (Object.hasOwn(WRITES, key)) {
        return (...args) => {
          // Judged at the moment of writing and on the whole document, so
          // neither a path in the URL nor a document that became a session
          // after it was opened gets past it.
          if (isKernel(whole(target))) refuse()
          // The changes this write made, for the session that made it
          // (kernel/own-changes.js): the heads it added. Writes are synchronous, so
          // nothing else lands in between.
          const before = record ? headsOf(target) : null
          const result = WRITES[key](target, value, args)
          if (record) record(addedHeads(before, headsOf(target)))
          return result
        }
      }
      if (DERIVES.has(key)) return (...args) => kernelHandle(value.apply(target, args), record)
      if (LISTENS.has(key)) return (event, fn) => ours(value.call(target, event, listenerFor(fn)))
      // Bound to the handle itself: its fields are private, and a method
      // called on the proxy could not reach them. A guarded handle passed
      // back in is unwrapped for the same reason.
      return (...args) => ours(value.apply(target, args.map(unguarded)))
    },
  })
  guards.set(handle, guard)
  beneath.set(guard, handle)
  return guard
}

/**
 * What `repo.findWithProgress` hands back — the observable a view waits on
 * (`useDocHandle`, the `file` tool's own loading) — as the guarded repo gives
 * it out: read-only, and every handle in it a kernel handle. Only the
 * observing methods and the deprecated getters are passed on; the query's
 * source methods (`fail`, `sourceReady`, …) are not a view's to call.
 */
const OBSERVES = new Set(["documentId", "peek", "subscribe", "whenReady", "state", "progress", "error", "handle"])

function kernelProgress(progress, record) {
  if (!progress || typeof progress !== "object") return progress
  const state = (s) => (s?.handle ? { ...s, handle: kernelHandle(s.handle, record) } : s)
  return new Proxy(progress, {
    get(target, key) {
      if (!OBSERVES.has(key)) return undefined
      if (key === "peek") return () => state(target.peek())
      if (key === "subscribe") return (callback) => target.subscribe((s) => callback(state(s)))
      if (key === "whenReady") return (options) => target.whenReady(options).then((h) => kernelHandle(h, record))
      if (key === "handle") return kernelHandle(target.handle, record)
      const value = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

const wrapped = (result, record) =>

  result && typeof result.then === "function" ? result.then((h) => kernelHandle(h, record)) : kernelHandle(result, record)

/**
 * The repo every other session's tools get: everything works, except that no
 * handle it gives out can change a session, a plan or a ledger, however its id was
 * spelled, or make a document into one; and it makes none itself — not from
 * an initial value, a copy of one, or bytes. The repo's own ways around a
 * handle — deleting by id, importing over an
 * existing id — are closed too. Its table of live handles and
 * `findWithProgress`, which a view loads its document with, stay, but hand
 * out only guarded handles.
 */
export function kernelRepo(repo, { known = null, record = null } = {}) {
  if (!repo || typeof repo !== "object") return repo
  // A mistyped document URL is mended where that is safe, or refused with
  // the nearest the conversation has seen (documents/doc-urls.js).
  const mend = (args) => (args.length ? [repairDocUrl(args[0], known ?? []).url, ...args.slice(1)] : args)
  return new Proxy(repo, {
    get(target, key) {
      // The table of live handles, as a snapshot of guarded ones: a view reads
      // `repo.handles[id]` for a document it already has (the solid hooks do).
      if (key === "handles") return Object.fromEntries(Object.entries(Reflect.get(target, key) ?? {}).map(([id, h]) => [id, kernelHandle(h, record)]))
      const value = Reflect.get(target, key)
      if (typeof value !== "function") return value
      // The observable a view waits on: the same document `find` gives, behind
      // the same guard. (Hidden outright, it broke every view that loads its
      // document this way — the `file` tool threw "findWithProgress is not a
      // function" in a view the agent mounted or a person opened.)
      if (key === "findWithProgress") return (...args) => kernelProgress(value.apply(target, mend(args)), record)
      if (key === "find" || key === "findClassic") return (...args) => wrapped(value.apply(target, mend(args)), record)
      if (key === "create" || key === "create2") {
        return (initial) => {
          if (isKernel(initial)) refuse()
          return wrapped(value.call(target, initial), record)
        }
      }
      if (key === "clone") {
        return (source) => {
          const original = unguarded(source)
          if (isKernel(whole(original))) refuse()
          if (isSessionTask(whole(original))) refuseTask()
          return kernelHandle(value.call(target, original), record)
        }
      }
      if (key === "delete") {
        return (name) => {
          const live = target.handles?.[documentIdOf(name)]
          // A document this repo has not loaded cannot be judged, so it is not deleted.
          if (!live || isKernel(whole(live))) refuse()
          return value.call(target, name)
        }
      }
      if (key === "export") {
        return async (...args) => {
          const bytes = await value.apply(target, mend(args))
          if (bytes && isSessionTask(A.load(bytes))) refuseTask()
          return bytes
        }
      }
      if (key === "import") {
        return (binary, args) => {
          if (args?.docId) refuse()
          if (isKernel(A.load(binary))) refuse()
          return kernelHandle(value.call(target, binary, args), record)
        }
      }
      return value.bind(target)
    },
  })
}
