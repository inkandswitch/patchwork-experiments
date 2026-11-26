/**
 * Putting a session right after a run went away: calls left running, replies
 * left half-streamed, and the network coming and going. And stopping one,
 * and speaking to one that was stopped.
 */

import { findCall, move, runnableCalls, unansweredCalls } from "./calls.js"
import { CALL } from "./schema.js"
import { makeTurn, resultBlock, noticeBlock, lastTurn } from "./blocks.js"
import { STOP, stopOf, stoppedFromOutside } from "./status.js"

/** Take these replies out, inside a change, so the model is asked again whole: nothing in them was acted on. */
function dropTurns(doc, turns) {
  const ids = new Set(turns.map((turn) => turn.id))
  if (!ids.size) return 0
  for (let i = doc.turns.length - 1; i >= 0; i--) if (ids.has(doc.turns[i].id)) doc.turns.splice(i, 1)
  return ids.size
}

// ---- Judged by the run a session's `burst` names (kernel/burst.js).
//
// A mark is a reply's `streaming` or a running call's claim, each naming a
// run in `runner`. Debris is a mark that does not name `holder`, the run
// `burst` names, or any mark while `burst` is null: equality, with no clock
// and no judgement of whether anything is alive.

/** Running calls whose claim does not name `holder`. */
export function debrisCalls(doc, holder) {
  return unansweredCalls(doc).filter((call) => call.status === CALL.running && (holder == null || call.runner !== holder))
}

/** Replies marked as streaming whose mark does not name `holder`. */
export function debrisTurns(doc, holder) {
  return (doc?.turns ?? []).filter((turn) => turn.role === "assistant" && turn.streaming && (holder == null || turn.streaming.runner !== holder))
}

/** Is there debris for `holder`? */
export function hasDebris(doc, holder) {
  return debrisCalls(doc, holder).length > 0 || debrisTurns(doc, holder).length > 0
}

/**
 * Settle what other runs left, for run `run`, inside a change: one change at
 * a run's turn boundary (kernel/burst.js). When `burst` is null or names
 * another run of the same task (`ownRun`), it is rewritten to name `run`.
 * Then every mark not naming `run` is settled as a takeover settles one:
 * marked replies are dropped, to be asked for again whole; a running call
 * that only reads (`rerun`) is put back to run; any other running call is
 * answered INTERRUPTED. `reconnecting` is cleared: the run is going on.
 *
 * When `burst` names a run of another task, it is that run's session, and
 * nothing is written: returns null. Otherwise returns how many marks were
 * settled.
 */
export function settleDebris(doc, run, { ownRun = () => false, rerun = () => false } = {}) {
  const named = doc.burst?.run ?? null
  if (named != null && named !== run && !ownRun(named)) return null
  if (named !== run) doc.burst = { run }
  const calls = debrisCalls(doc, run)
  const turns = debrisTurns(doc, run)
  if (!doc.turns) doc.turns = []
  dropTurns(doc, turns)
  closeCalls(doc, calls, rerun)
  if (doc.reconnecting != null) doc.reconnecting = null
  return calls.length + turns.length
}

/** What an interrupted call's result says. */
export const INTERRUPTED =
  "This call was interrupted before it finished: the tab or process running it closed or reloaded. It may or may not have taken effect, so check before trying it again."

/** Put back the calls `rerun` says may run again; answer the rest INTERRUPTED. */
function closeCalls(doc, calls, rerun) {
  const closed = []
  for (const call of calls) {
    const found = findCall(doc, call.id)
    if (!found) continue
    if (rerun(call)) move(found.block, "release")
    else if (move(found.block, "abandon")) closed.push(call)
  }
  if (!doc.turns) doc.turns = []
  if (closed.length) doc.turns.push(makeTurn("tool", closed.map((call) => resultBlock(call.id, INTERRUPTED, { isError: true, summary: "interrupted", placeholder: true }))))
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
 * Is anything under way in this session, or due to be? A burst's mark, a
 * wait for the network, a reply still marked as streaming, a call running or
 * cleared to run, or a last word that wants an answer (a person's or a
 * tool's). What a person's Stop has to stop; with none of it there is nothing.
 */
function underWay(doc) {
  if (doc.burst != null || doc.reconnecting) return true
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
 * `burst`. A run anywhere hears the notice and stops (kernel/burst.js), its
 * writes refused from then on (kernel/store.js guardedStore), and nothing
 * takes the session up again: a stop in force is no work (kernel/runner.js
 * needsWork). Calls cleared to run and not yet run are left as they are,
 * shown "Not run: stopped", and closed by the message that ends the stop
 * (`speak`); closing them here would cross a run's claim on the same call.
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
  if (doc.burst != null) {
    doc.burst = null
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
 *
 * Nothing on a call says when it was approved, so a call a person approved
 * under the stop is closed the same way, and shows "Not run: stopped" from
 * the moment it is approved (ui/transcript.js).
 *
 * NOT_RUN is a placeholder, like INTERRUPTED: a run that had not yet heard
 * the stop may have claimed the call and run it, and what it found wins in
 * the request and the transcript.
 */
export function speak(doc, turn) {
  if (!doc.turns) doc.turns = []
  if (stoppedFromOutside(doc)) {
    const left = runnableCalls(doc)
    for (const call of left) move(findCall(doc, call.id)?.block, "abandon")
    if (left.length) doc.turns.push(makeTurn("tool", left.map((call) => resultBlock(call.id, NOT_RUN, { isError: true, summary: "not run: stopped", placeholder: true }))))
  }
  doc.turns.push(turn)
}

/** Is this a result written for a call whose own may still arrive: a takeover's INTERRUPTED, or `speak`'s NOT_RUN? */
export function isInterruptedResult(block) {
  return block?.placeholder === true
}
