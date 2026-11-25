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
 *
 * And the research steps' ledger, `plan.sources`, moves out of the plan into
 * a document of its own, which the plan names as `ledgerUrl`. Making that
 * document takes a repo, so it is migrate.mjs that makes it, from what
 * `ledgerFor` says it holds, and hands its URL in here.
 */

import { PLAN, STEP, staleInputs, tell, finishedKey, endKey, pauseKey, budgetKey, staleKey, questionKey, requestKey } from "../workflow/plan.js"
import { initLedger } from "../kernel/scope.js"

const isV1Plan = (doc) => doc?.["@patchwork"]?.type === "agent-workflow" && (doc.schemaVersion ?? 1) < 2

/**
 * The ledger document a version 1 plan needs, as a plain value: what its
 * research steps kept, for a plan that has research steps or kept anything.
 * Null for any other document, and for a plan with no research in it, whose
 * driver opens a ledger if it ever needs one.
 */
export function ledgerFor(doc) {
  if (!isV1Plan(doc)) return null
  const sources = doc.sources ?? {}
  if (!Object.keys(sources).length && !(doc.steps ?? []).some((step) => step.access === "web")) return null
  const ledger = {}
  initLedger(ledger)
  ledger.sources = JSON.parse(JSON.stringify(sources))
  return ledger
}

/** What version 1 stored in `staleNoticed` for a step stale as `plan` stands. */
function oldStaleKey(plan, step) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  return staleInputs(plan, step, byId)
    .map((id) => `${id}:${byId.get(id)?.status}:${byId.get(id)?.version ?? 0}`)
    .join(",")
}

/**
 * Returns whether the document was changed. `ledgerUrl` is the document made
 * from `ledgerFor(doc)`, which a plan that needs one must be given: its
 * sources are not dropped.
 */
export function migratePlan(doc, { ledgerUrl = null } = {}) {
  if (!isV1Plan(doc)) return false
  if (ledgerFor(doc) && !ledgerUrl) throw new Error("This plan's research steps kept things: make its ledger (ledgerFor) and pass its URL.")

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

  for (const key of ["asked", "reportedEnd", "sources"]) if (key in doc) delete doc[key]
  doc.ledgerUrl = ledgerUrl
  doc.schemaVersion = 2
  return true
}
