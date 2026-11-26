/**
 * Putting a session right after its runner went away: calls left running,
 * replies left half-streamed, and the network coming and going. And stopping
 * one, and speaking to one that was stopped.
 */

import { livenessOf } from "./lease.js"
import { findCall, move, runnableCalls, unansweredCalls } from "./calls.js"
import { CALL } from "./schema.js"
import { makeTurn, resultBlock, noticeBlock, lastTurn } from "./blocks.js"
import { STOP, stopOf, stoppedFromOutside } from "./status.js"

/**
 * Calls a runner claimed and never finished.
 *
 * A call is claimed (`running`) under the lease of the runner executing it.
 * If that runner's tab closes or reloads mid-call, nothing will ever write the
 * call's result. Such a call is neither runnable nor awaiting anyone, so
 * unless it is found here the session sits there looking busy forever.
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
  if (closed.length) doc.turns.push(makeTurn("tool", closed.map((call) => resultBlock(call.id, INTERRUPTED, { isError: true, summary: "interrupted", placeholder: true }))))
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

/**
 * Is anything under way in this session, or due to be? A runner's lease, a
 * wait for the network, a reply still marked as streaming, a call running or
 * cleared to run, or a last word that wants an answer (a person's or a
 * tool's). What a person's Stop has to stop; with none of it there is nothing.
 */
function underWay(doc) {
  if (doc.lease || doc.reconnecting) return true
  if ((doc.turns ?? []).some((turn) => turn.streaming)) return true
  if (unansweredCalls(doc).some((call) => call.status === CALL.running || call.status === CALL.approved)) return true
  const last = lastTurn(doc)
  return last?.role === "user" || last?.role === "tool"
}

/**
 * Stop a session, inside a change: one change, written from any page or
 * device, and the stop holds wherever the session is run.
 *
 *   kind     STOP.stopped (a person) or STOP.halted (a workflow)
 *   text     what the notice says; null for the kind's own words
 *   author   who stopped it (a contact url), recorded on the notice's turn
 *
 * It writes an assistant turn with the notice, takes every streaming mark off
 * (what was streamed stays, as what was said), and clears `reconnecting` and
 * `lease`. The lease goes so that the runner holding it, in this tab or any
 * other, stops writing at its next look (kernel/loop.js), and none takes the
 * session up again: a stop in force is no work (kernel/runner.js needsWork).
 * Calls cleared to run and not yet run are left as they are, shown "Not run:
 * stopped", and closed by the message that ends the stop (`speak`); closing
 * them here would cross a runner's claim on the same call.
 *
 * Said once: no second notice while a stop of this kind is in force, and a
 * person's stop writes no notice over any stop in force or on a session with
 * nothing under way. Returns whether it changed anything.
 */
export function stopSession(doc, kind, text = null, author = null) {
  if (!doc.turns) doc.turns = []
  const inForce = stopOf(doc)
  const person = kind === STOP.stopped
  if (person && !inForce && !underWay(doc)) return false
  let changed = false
  for (const turn of doc.turns) {
    if (turn.streaming) {
      delete turn.streaming
      changed = true
    }
  }
  const says = text ?? (person ? (doc.reconnecting ? `Stopped while waiting for the network (${doc.reconnecting.reason ?? "the network went away"}).` : "Stopped by a person.") : "Stopped by its workflow.")
  if (person ? !inForce : inForce?.kind !== STOP.halted) {
    doc.turns.push(makeTurn("assistant", [noticeBlock(kind, String(says))], { author }))
    changed = true
  }
  if (doc.reconnecting != null) {
    doc.reconnecting = null
    changed = true
  }
  if (doc.lease != null) {
    doc.lease = null
    changed = true
  }
  return changed
}

/** The result a call cleared to run, and never run, gets when a message ends the stop it was left under. */
export const NOT_RUN = "Not run: the session was stopped before this call ran. Ask again if it is still wanted."

/**
 * Say something to a session, inside a change: push `turn`, which ends any
 * stop in force (session/status.js stopOf). Under a person's or a workflow's
 * stop, the calls left cleared to run from before it are closed first, each
 * answered NOT_RUN: speaking is deciding to carry on, not to do what was
 * stopped. A budget's stop leaves them, to run once the budget is lifted.
 */
export function speak(doc, turn) {
  if (!doc.turns) doc.turns = []
  if (stoppedFromOutside(doc)) {
    const left = runnableCalls(doc)
    for (const call of left) move(findCall(doc, call.id)?.block, "abandon")
    if (left.length) doc.turns.push(makeTurn("tool", left.map((call) => resultBlock(call.id, NOT_RUN, { isError: true, summary: "not run: stopped" }))))
  }
  doc.turns.push(turn)
}

/** Is this the result a takeover writes for a call it found cut off? */
export function isInterruptedResult(block) {
  return block?.placeholder === true
}
