/**
 * What a session is doing, read off its document. Nothing stores it.
 *
 * A stored status had to be moved by hand with everything it summarised — a
 * call approved, a run ended, a question answered — and every place that
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
// The stops written from outside the run, by a person or a workflow.
const FROM_OUTSIDE = new Set([STOP.stopped, STOP.halted])

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
 *
 * A person's or a workflow's stop stays in force over a run's own `error` or
 * `budget` notice after it with nothing said between: that is a run which had
 * not yet heard the stop, failing or running out as it went, and its notice
 * merged after the stop's.
 */
export function stopOf(doc) {
  const turns = doc?.turns ?? []
  let last = null
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === "user") {
      if (!endsStop(turn)) continue
      break
    }
    if (turn.role !== "assistant") continue
    const notice = (turn.blocks ?? []).find((block) => block.type === "notice" && STOPS.has(block.kind))
    if (!notice) continue
    const stop = { kind: notice.kind, text: notice.text, data: notice.data ?? null, at: turn.at ?? null }
    if (FROM_OUTSIDE.has(stop.kind)) return stop
    last ??= stop
  }
  return last
}

/** Is the stop in force one written from outside the run: a person's or a workflow's? */
export function stoppedFromOutside(doc) {
  return FROM_OUTSIDE.has(stopOf(doc)?.kind)
}

/**
 * A session's status, the first that applies:
 *
 *   awaiting-answer    it asked the person something
 *   awaiting-approval  a call waits for the person's yes
 *   error              its last run failed, and nothing was said to it since
 *   idle               another stop is in force (a person's, a workflow's, a
 *                      budget's)
 *   reconnecting       its run waits for the network
 *   running            `burst` names a run, or a page's claim
 *   parked             a call that needs a page is cleared to run, and no
 *                      page has taken it
 *   idle               none of these
 *
 * Every reader sees the same status: whether the run `burst` names is alive
 * is heard through the queue (runners/ask.js), not read here.
 */
export function statusOf(doc) {
  if (!doc) return STATUS.idle
  if (questionsAwaitingAnswer(doc).length) return STATUS.awaitingAnswer
  if (callsAwaitingApproval(doc).length) return STATUS.awaitingApproval
  const stop = stopOf(doc)
  if (stop) return stop.kind === STOP.error ? STATUS.error : STATUS.idle
  if (doc.reconnecting) return STATUS.reconnecting
  if (doc.burst != null) return STATUS.running
  if (runnableCalls(doc).some((call) => call.where === WHERE.host)) return STATUS.parked
  return STATUS.idle
}
