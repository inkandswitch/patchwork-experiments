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
