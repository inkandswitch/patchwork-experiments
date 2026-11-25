/**
 * Putting a session right after its runner went away: calls left running,
 * replies left half-streamed, and the network coming and going.
 */

import { livenessOf } from "./lease.js"
import { findCall, move, runnableCalls, unansweredCalls } from "./calls.js"
import { CALL } from "./schema.js"
import { makeTurn, resultBlock, noticeBlock } from "./blocks.js"
import { STOP } from "./status.js"

/**
 * Calls a runner claimed and never finished.
 *
 * A call is claimed (`running`) under the lease of the runner executing it.
 * If that runner's tab closes or reloads mid-call, nothing will ever write the
 * call's result — and before this, nothing noticed: the call was neither
 * runnable nor awaiting anyone, so the session sat there looking busy forever.
 * A running call is orphaned exactly when its claim is not the live lease:
 * the lease has gone stale, or another runner or generation holds it.
 */
export function orphanedCalls(doc, opts = {}) {
  const lease = doc?.lease
  const live = !!lease && livenessOf(opts)(lease)
  return unansweredCalls(doc).filter(
    (call) => call.status === CALL.running && !(live && lease.runner === call.runner && lease.generation === call.generation)
  )
}

/**
 * Replies a runner was streaming and never finished.
 *
 * A reply is written into the transcript as it streams, marked `streaming`
 * with the runner and generation writing it, and the mark comes off when the
 * stream ends (kernel/loop.js). A page that reloads or closes mid-reply leaves the
 * mark on: half a turn, no call committed from it, and nothing that would
 * ever make a runner look at the session again — it sat "running" for good.
 * A marked reply is interrupted exactly when its mark is not the live lease,
 * by the same rule as `orphanedCalls`.
 */
export function interruptedTurns(doc, opts = {}) {
  const lease = doc?.lease
  const live = !!lease && livenessOf(opts)(lease)
  return (doc?.turns ?? []).filter(
    (turn) => turn.role === "assistant" && turn.streaming && !(live && lease.runner === turn.streaming.runner && lease.generation === turn.streaming.generation)
  )
}

/**
 * Take interrupted replies out, inside a change, so the model is asked again
 * whole: the same as a reply the network cut off (net/network.js), and for the
 * same reason — nothing in it was acted on. Returns how many went.
 */
export function dropInterruptedTurns(doc, opts = {}) {
  const ids = new Set(interruptedTurns(doc, opts).map((turn) => turn.id))
  if (!ids.size) return 0
  for (let i = doc.turns.length - 1; i >= 0; i--) if (ids.has(doc.turns[i].id)) doc.turns.splice(i, 1)
  return ids.size
}

/** What an interrupted call's result says. */
export const INTERRUPTED =
  "This call was interrupted before it finished: the tab or process running it closed or reloaded. It may or may not have taken effect, so check before trying it again."

/**
 * Close out orphaned calls, inside a change.
 *
 * A call that only reads (`rerun(call)` true — the runner asks its toolset
 * whether the tool's risk is "read") is put back to run again: doing it twice
 * changes nothing, so it is an interruption like any other. Anything else is
 * not re-run: it may already have done what it does, and doing a write twice
 * is worse than telling the model it might not have happened, so it gets an
 * error result saying so. Returns how many were closed or put back.
 */
export function resolveOrphans(doc, opts = {}) {
  const orphans = orphanedCalls(doc, opts)
  if (!orphans.length) return 0
  const rerun = typeof opts.rerun === "function" ? opts.rerun : () => false
  const closed = []
  for (const call of orphans) {
    const found = findCall(doc, call.id)
    if (!found) continue
    if (rerun(call)) move(found.block, "release")
    else if (move(found.block, "abandon")) closed.push(call)
  }
  if (!doc.turns) doc.turns = []
  if (closed.length) doc.turns.push(makeTurn("tool", closed.map((call) => resultBlock(call.id, INTERRUPTED, { isError: true, summary: "interrupted" }))))
  return orphans.length
}

/**
 * Mark a session as waiting for the network, inside a change (net/network.js).
 * `since` is when it first went, kept across attempts; `attempts` counts them.
 */
export function markReconnecting(doc, reason, now = Date.now()) {
  const was = doc.reconnecting
  doc.reconnecting = { reason: String(reason ?? "the network went away"), since: was?.since ?? now, attempts: (was?.attempts ?? 0) + 1 }
}

/** What a call put back for the network says, when a person stops the session instead. */
export const STOPPED_OFFLINE = "Not run: the network went away before it could, and the person stopped the session rather than wait for it."

/**
 * A person stopping a session that is waiting for the network, inside a
 * change. Every call put back to wait gets its answer, the session says in
 * one line that it stopped, and nothing is left to run — otherwise the next
 * look would find work and try again. Returns whether there was anything to stop.
 */
export function stopReconnecting(doc) {
  if (!doc.reconnecting) return false
  const reason = doc.reconnecting.reason ?? "the network went away"
  const waiting = runnableCalls(doc)
  for (const call of waiting) {
    const found = findCall(doc, call.id)
    if (found) move(found.block, "abandon")
  }
  if (!doc.turns) doc.turns = []
  if (waiting.length) doc.turns.push(makeTurn("tool", waiting.map((call) => resultBlock(call.id, STOPPED_OFFLINE, { isError: true, summary: "stopped" }))))
  doc.turns.push(makeTurn("assistant", [noticeBlock(STOP.stopped, `Stopped while waiting for the network (${reason}).`)]))
  doc.reconnecting = null
  return true
}

/** Is this the result a takeover writes for a call it found cut off? */
export function isInterruptedResult(block) {
  return block?.summary === "interrupted" && String(block.output ?? "") === INTERRUPTED
}
