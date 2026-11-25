/** Tool calls in a transcript: finding them, and which are waiting on what. */

import { eachBlock } from "./blocks.js"
import { CALL } from "./schema.js"

/** Locate a call block by id. Returns null when absent. */
export function findCall(doc, callId) {
  for (const found of eachBlock(doc)) {
    if (found.block.type === "call" && found.block.id === callId) return found
  }
  return null
}

/** Locate the result block answering a call, if it has landed. */
export function findResult(doc, callId) {
  for (const found of eachBlock(doc)) {
    if (found.block.type === "result" && found.block.callId === callId) return found
  }
  return null
}

/** Every result that has landed, in document order. */
export function results(doc) {
  const out = []
  for (const found of eachBlock(doc)) if (found.block.type === "result") out.push(found.block)
  return out
}

/** Calls that have no result yet, in document order. */
export function unansweredCalls(doc) {
  const out = []
  for (const found of eachBlock(doc)) {
    if (found.block.type !== "call") continue
    if (found.block.status === CALL.denied) continue
    if (findResult(doc, found.block.id)) continue
    out.push(found.block)
  }
  return out
}

/** Calls blocked on a human decision. */
export function callsAwaitingApproval(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.pending)
}

/** Calls cleared to run but not yet claimed by a runner. */
export function runnableCalls(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.approved)
}

/**
 * Calls that are questions waiting on a person.
 *
 * Separate from approvals on purpose. An approval is "may I", and the answer is
 * yes or no; a question is "which", and the answer is content that becomes the
 * call's result and goes to the model. Sharing one mechanism would mean the
 * model could get a question answered by someone clicking "allow".
 */
export function questionsAwaitingAnswer(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.asking)
}

/** The options a question offers, normalized to {label, detail}. */
export function questionOptions(block) {
  const raw = block?.input?.options
  if (!Array.isArray(raw)) return []
  return raw
    .map((option) =>
      typeof option === "string" ? { label: option, detail: null } : { label: option?.label ?? "", detail: option?.detail ?? null }
    )
    .filter((option) => option.label)
}

/**
 * A call's life: every move it can make, and from where.
 *
 *   approve   pending → approved    the person said yes, or a grant covers it
 *   deny      pending → denied
 *   claim     approved → running    by a runner, which the call then names
 *   succeed   running → done        by the runner that claimed it
 *   fail      running → error       by the runner that claimed it
 *   release   running → approved    put back to run again: it was cut off
 *                                   before it could have had any effect
 *   abandon   any open → error      closed without running to an end
 *   answer    asking → done         the person answered the question
 *
 * A result block is written for every end but `release` and `approve`, by
 * whoever makes the move: a call the model never hears about is a call it
 * will wait on forever.
 */
export const MOVES = Object.freeze({
  approve: { from: [CALL.pending], to: CALL.approved },
  deny: { from: [CALL.pending], to: CALL.denied },
  claim: { from: [CALL.approved], to: CALL.running },
  succeed: { from: [CALL.running], to: CALL.done },
  fail: { from: [CALL.running], to: CALL.error },
  release: { from: [CALL.running], to: CALL.approved },
  abandon: { from: [CALL.pending, CALL.asking, CALL.approved, CALL.running], to: CALL.error },
  answer: { from: [CALL.asking], to: CALL.done },
})

/**
 * Make one move on a call block, inside a change. Returns whether it was
 * made: a move that is not one of the call's from where it stands changes
 * nothing.
 *
 * `by` is `{ runner, generation }`. A claim records it on the call. Given to
 * any later move, it must be the claim the call carries, which is how a
 * runner that has lost the session leaves alone a call another has since
 * settled.
 */
export function move(block, name, by = null) {
  const step = MOVES[name]
  if (!step) throw new Error(`No such move for a call: ${name}`)
  if (!block || !step.from.includes(block.status)) return false
  if (name === "claim") {
    block.runner = by?.runner ?? null
    block.generation = by?.generation ?? null
  } else if (by && (block.runner !== by.runner || block.generation !== by.generation)) {
    return false
  }
  block.status = step.to
  // Put back to run again, it is nobody's.
  if (name === "release") {
    if (block.runner != null) block.runner = null
    if (block.generation != null) block.generation = null
  }
  return true
}
