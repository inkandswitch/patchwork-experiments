/**
 * Side threads: asking about a workflow step without changing it.
 *
 * A question to a step that is not running goes here rather than into the
 * step's own session (standing.js says why). A side thread is a copy of the
 * step's session — same conversation, same model, same tools and permissions,
 * and for a research step the same confinement — that is no longer a step:
 * the driver never reads it, it cannot ask the orchestrator for work, and its
 * answers are nobody's result.
 *
 * The copy shares the step session's history (repo.clone), so it costs a
 * pointer, not a second transcript, and carries everything the step saw.
 *
 * One side thread is kept going per step while the step stands still: a
 * second question continues the first one's thread. Once the step has moved
 * on — reopened and run again — the next question starts a fresh copy, so it
 * is asked of the step as it now is.
 */

import { CALL, STATUS, findCall, unansweredCalls, makeTurn, resultBlock, textBlock, sessionTitle } from "../session.js"
import { say } from "../loop.js"
import { handleStore } from "../store.js"

/** What a copied call that never finished is answered with in the copy. */
export const NOT_IN_ASIDE = "Not run: this is a side thread copied from a workflow step, and the call had not finished when it was copied."

/**
 * What the model is told, ahead of the first question in a fresh side thread:
 * the conversation it sees was a step's, and it is no longer that step.
 */
export const ASIDE_NOTE =
  "[This is now a side thread, copied from the workflow step above so the person can ask about it. You are not doing the step any more: nothing you say here is its result or changes it, and its workflow will not see this conversation. Answer the person's question.]"

/** The step a side thread is about, or null: { sessionUrl, planUrl, stepId }. */
export function asideOf(doc) {
  const a = doc?.aside
  return a?.sessionUrl ? { sessionUrl: String(a.sessionUrl), planUrl: a.planUrl ? String(a.planUrl) : null, stepId: a.stepId ?? null } : null
}

/**
 * Turn a copy of a step's session into a side thread, inside a change.
 *
 * What makes it a step goes (`workflow`, its budget, its record of side
 * threads); what was mid-flight is settled (lease, status, a call that had not
 * finished); what it can do and reach stays exactly as it was — `scope`,
 * `tools`, `grants` — so a research step's copy is confined as the step was.
 */
export function makeAside(doc, { sessionUrl, now = Date.now() }) {
  const step = doc.workflow ?? {}
  doc.aside = { sessionUrl, planUrl: step.planUrl ?? null, stepId: step.stepId ?? null, at: now }
  delete doc.workflow
  delete doc.asides
  doc.title = `Question · ${sessionTitle(doc) ?? step.stepId ?? "step"}`
  doc.lease = null
  doc.status = STATUS.idle
  for (const key of ["halted", "reconnecting", "stopped"]) if (doc[key] != null) doc[key] = null
  if (doc.config) {
    delete doc.config.budget
    doc.config.workflows = { enabled: false }
  }
  doc.usage = { in: 0, out: 0, turns: 0 }
  const open = unansweredCalls(doc)
  if (open.length) {
    for (const call of open) {
      const found = findCall(doc, call.id)
      if (found) found.block.status = CALL.error
    }
    doc.turns.push(makeTurn("tool", open.map((call) => resultBlock(call.id, NOT_IN_ASIDE, { isError: true, summary: "not run" }))))
  }
}

/**
 * The side thread a new question about this step continues, or null for a
 * fresh copy: the latest one, if the step's conversation has not grown since
 * it was copied.
 */
export function reusableAside(stepDoc) {
  const last = (stepDoc?.asides ?? []).at(-1)
  if (!last?.url) return null
  return last.turns === (stepDoc.turns?.length ?? 0) ? String(last.url) : null
}

/**
 * Ask `text` about the step whose session is `stepHandle`, in a side thread.
 * Returns the side thread's URL, for the view to open.
 */
export async function askAside(repo, stepHandle, text, { author = null, context = null, attachments = [], now = Date.now() } = {}) {
  const stepDoc = stepHandle.doc()
  const reuse = reusableAside(stepDoc)
  let aside = null
  let fresh = false
  if (reuse) {
    try {
      aside = await repo.find(reuse)
    } catch {
      aside = null // gone or unreachable: make a fresh one
    }
  }
  if (!aside) {
    fresh = true
    aside = repo.clone(stepHandle)
    aside.change((d) => makeAside(d, { sessionUrl: stepHandle.url, now }))
    stepHandle.change((d) => {
      if (!d.asides) d.asides = []
      d.asides.push({ url: aside.url, at: now, turns: d.turns?.length ?? 0 })
    })
  }
  say(handleStore(aside), text, author, context, attachments)
  if (fresh) aside.change((d) => d.turns[d.turns.length - 1].blocks.unshift(textBlock(ASIDE_NOTE)))
  return aside.url
}
