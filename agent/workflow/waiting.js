/**
 * What a step's session is waiting on a person for.
 *
 * A step runs unwatched, so a question it asks or a permission it needs would
 * sit in a session nobody has open. These are read off its document so they
 * can be shown where someone is looking — the orchestrator's view and the
 * workflow view — and so the orchestrator can answer questions itself.
 */

import { callsAwaitingApproval, questionsAwaitingAnswer, questionOptions } from "../session.js"
import { notStarted } from "./plan.js"

/**
 *   { kind: "approval", callId, tool, input }
 *   { kind: "question", callId, question, options: [{label, detail}] }
 */
/**
 * A plan paused for its budget, as something waiting on a person: who can
 * resume it with more, or leave it. `planHandle` is what Resume writes to.
 */
export function budgetWaiting(plan, planUrl, planHandle) {
  if (plan?.paused?.reason !== "budget") return null
  return {
    kind: "budget",
    callId: `budget:${planUrl}:${plan.paused.at}`,
    planUrl,
    planHandle,
    planTitle: plan.title,
    spent: plan.paused.spent,
    limit: plan.paused.limit,
    notStarted: notStarted(plan).length,
  }
}

export function waitingIn(doc) {
  if (!doc) return []
  // Stopped for its budget: waiting for someone to give it more (liftBudget),
  // shown wherever a permission would be.
  if (doc.stopped?.reason === "budget") {
    return [{ kind: "budget", scope: "session", callId: `budget:${doc.stopped.at}`, spent: doc.stopped.spent, limit: doc.stopped.limit }]
  }
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
