/**
 * A workflow plan from version 1 to version 2, inside a change.
 *
 * Run once over the plans that exist (migrate.mjs), then deleted: the driver
 * reads version 2 only (workflow/driver.js leaves anything else alone).
 *
 * What changed between the two is how the plan records what its orchestrator
 * has been told. Version 1 kept a flag for each kind of news, reset by hand
 * where that news could happen again; version 2 keeps one map, `told`, keyed
 * by the occurrence (workflow/plan.js tell). Each flag becomes the key of the
 * occurrence it was set for, so nothing already told is told again:
 *
 *   step.reported        a done or failed step's finish, in its current run
 *   plan.reportedEnd     a plan that is not running: its end
 *   plan.asked           each question, by its call's id
 *   plan.paused.reported the pause in force
 *   step.budgetNoticed   the stop it recorded (a resume deleted it, so it
 *                        names a stop since the last resume)
 *   step.staleNoticed    the inputs a stale step was out of date over, when
 *                        they are still the ones it is out of date over
 *   request.reported     each request, by its id
 *
 * The flags go, and the plan gains `runs` (this is its first) and its version.
 */

import { PLAN, STEP, staleInputs, tell, finishedKey, endKey, pauseKey, budgetKey, staleKey, questionKey, requestKey } from "../workflow/plan.js"

/** What version 1 stored in `staleNoticed` for a step stale as `plan` stands. */
function oldStaleKey(plan, step) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  return staleInputs(plan, step, byId)
    .map((id) => `${id}:${byId.get(id)?.status}:${byId.get(id)?.version ?? 0}`)
    .join(",")
}

/** Returns whether the document was changed. */
export function migratePlan(doc) {
  if (doc?.["@patchwork"]?.type !== "agent-workflow") return false
  if ((doc.schemaVersion ?? 1) >= 2) return false

  if (doc.runs == null) doc.runs = 1
  if (!doc.told) doc.told = {}

  for (const step of doc.steps ?? []) {
    if (step.reported && (step.status === STEP.done || step.status === STEP.failed)) tell(doc, finishedKey(step))
    if (step.budgetNoticed != null) tell(doc, budgetKey(doc, step.id, step.budgetNoticed))
    if (step.staleNoticed && step.status === STEP.done && staleInputs(doc, step).length && step.staleNoticed === oldStaleKey(doc, step)) tell(doc, staleKey(doc, step))
    for (const key of ["reported", "budgetNoticed", "staleNoticed"]) if (key in step) delete step[key]
  }
  for (const callId of doc.asked ?? []) tell(doc, questionKey(callId))
  if (doc.reportedEnd && doc.status !== PLAN.running) tell(doc, endKey(doc))
  if (doc.paused) {
    if (doc.paused.reported) tell(doc, pauseKey(doc))
    if ("reported" in doc.paused) delete doc.paused.reported
  }
  for (const request of doc.requests ?? []) {
    if (request.reported) tell(doc, requestKey(request))
    if ("reported" in request) delete request.reported
  }

  for (const key of ["asked", "reportedEnd"]) if (key in doc) delete doc[key]
  doc.schemaVersion = 2
  return true
}
