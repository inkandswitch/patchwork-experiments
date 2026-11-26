/**
 * What a session is doing, read off its document. Nothing stores it.
 *
 * A stored status had to be moved by hand with everything it summarised — a
 * call approved, a lease dropped, a question answered — and every place that
 * forgot left a session that looked stuck, or finished, when it was neither.
 * Read off the document, it cannot disagree with it.
 */

import { STATUS, WHERE } from "./schema.js"
import { callsAwaitingApproval, questionsAwaitingAnswer, runnableCalls } from "./calls.js"

/** The notices that end a run and leave the session waiting to be spoken to. */
export const STOP = {
  // The run failed; `data.why` is which way.
  error: "error",
  // The session spent its budget; `data` is `{ spent, limit }`.
  budget: "budget",
  // Stopped from outside: a workflow cancelled its step, or reopened one before it.
  halted: "halted",
  // A person stopped it, from any page or device (session/recovery.js stopSession).
  stopped: "stopped",
}

const STOPS = new Set(Object.values(STOP))

/**
 * Does this user-role turn end a stop? Only when something was said to the
 * session in it: a person's words or attachments, a reopened step's
 * instructions (text, like a person's), or a lifted budget's notice.
 */
const endsStop = (turn) =>
  (turn.blocks ?? []).some((block) => block.type === "text" || block.type === "attachment" || (block.type === "notice" && block.kind === "budget"))

/**
 * The stop in force: the last stop notice (blocks.js noticeBlock) with
 * nothing said to the session after it, or null. With it goes the time of its
 * turn, as `at`.
 *
 * "After it" is a user-role turn that says something (`endsStop`): a person's
 * message, a reopened step's new instructions, a lifted budget. Not a tool's:
 * a result that lands after the stop, from a call still running when it came,
 * changes nothing. Nor news a tool delivers later (kernel/events.js), nor the
 * loop's own `nudge` or a compaction's summary written by a run that had not
 * yet heard of the stop: none of those is anyone deciding it should carry on.
 */
export function stopOf(doc) {
  const turns = doc?.turns ?? []
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === "user") {
      if (!endsStop(turn)) continue
      return null
    }
    if (turn.role !== "assistant") continue
    const notice = (turn.blocks ?? []).find((block) => block.type === "notice" && STOPS.has(block.kind))
    if (notice) return { kind: notice.kind, text: notice.text, data: notice.data ?? null, at: turn.at ?? null }
  }
  return null
}

/** Is the stop in force one written from outside the run: a person's or a workflow's? */
export function stoppedFromOutside(doc) {
  const kind = stopOf(doc)?.kind
  return kind === STOP.stopped || kind === STOP.halted
}

/**
 * A session's status.
 *
 *   awaiting-answer    it asked the person something
 *   awaiting-approval  a call waits for the person's yes
 *   error              its last run failed, and nothing was said to it since
 *   reconnecting       its runner waits for the network
 *   running            a runner holds it
 *   parked             a call that needs the page is cleared to run, and no
 *                      runner with a page has taken it
 *   idle               none of these
 *
 * `live` is the observer's own judgement of whether a lease is alive
 * (lease.js LeaseWatch); without one, a lease that is there counts.
 */
export function statusOf(doc, { live = null } = {}) {
  if (!doc) return STATUS.idle
  if (questionsAwaitingAnswer(doc).length) return STATUS.awaitingAnswer
  if (callsAwaitingApproval(doc).length) return STATUS.awaitingApproval
  const stop = stopOf(doc)
  if (stop) return stop.kind === STOP.error ? STATUS.error : STATUS.idle
  if (doc.reconnecting) return STATUS.reconnecting
  if (doc.lease && (live ? live(doc.lease) : true)) return STATUS.running
  if (runnableCalls(doc).some((call) => call.where === WHERE.host)) return STATUS.parked
  return STATUS.idle
}
