/**
 * What a step's session is waiting on a person for.
 *
 * A step runs unwatched, so a question it asks or a permission it needs would
 * sit in a session nobody has open. These are read off its document so they
 * can be shown where someone is looking — the orchestrator's view and the
 * workflow view — and so the orchestrator can answer questions itself.
 */

import { callsAwaitingApproval, questionsAwaitingAnswer, questionOptions } from "../session.js"

/**
 *   { kind: "approval", callId, tool, input }
 *   { kind: "question", callId, question, options: [{label, detail}] }
 */
export function waitingIn(doc) {
  if (!doc) return []
  const approvals = callsAwaitingApproval(doc).map((call) => ({
    kind: "approval",
    callId: call.id,
    tool: call.tool,
    input: call.input ?? {},
  }))
  const questions = questionsAwaitingAnswer(doc).map((call) => ({
    kind: "question",
    callId: call.id,
    question: String(call.input?.question ?? ""),
    options: questionOptions(call),
  }))
  return [...questions, ...approvals]
}
