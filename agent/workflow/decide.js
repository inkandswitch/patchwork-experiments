/**
 * What a workflow's driver does on a tick, decided from what it has read.
 *
 * decide(plan, observations, now) is pure: given the plan and what the
 * driver read of each step's session, it returns the actions to take, in
 * order, as plain data. The driver performs them (driver.js perform). Each
 * decision is made on the plan as the actions before it leave it, worked out
 * on a copy with plan.js's own transitions: a step that finishes on this tick
 * makes what waits on it ready on this tick, and a step started on it keeps
 * the plan from settling.
 *
 *   observations = {
 *     sessions: { [sessionUrl]: {        each step session the plan names
 *       status,                          session/status.js statusOf
 *       usage,                           its usage, as the session keeps it
 *       requests: [{ id, input }],       its workflow_request calls that went through
 *       outcome,                         driver.js sessionOutcome, for a running step
 *       waiting: [item],                 workflow/waiting.js waitingIn, when it waits on a person
 *       scopeOk,                         for a running research step: confined as its plan says
 *     } },
 *     orchestratorCost,                  what the orchestrating session has spent, when known
 *     reasons: { [sessionUrl]: text },   why a step's runner stopped, from its events
 *   }
 *
 * The actions, in the order they come:
 *
 *   { type: "cancel", stepIds, reason }   research steps whose scope is not theirs
 *   { type: "finish", stepId, result, at }
 *   { type: "fail", stepId, error, at }
 *   { type: "requests", requests }        what steps asked for, new to the plan
 *   { type: "waiting", waiting, outOfBudget }  what running steps wait on, for the news
 *   { type: "orchestratorFrom", cost }    what the orchestrator had spent when the plan began
 *   { type: "usage", usage }              the plan's spend, when it has changed
 *   { type: "shareGrants" }               one job, one set of permissions
 *   { type: "fileSources" }               what research steps kept, filed for people
 *   { type: "run", sessionUrl }           a running step's session has a runner
 *   { type: "ledger" }                    open the plan's ledger: a research step is about to start, and there is none
 *   { type: "start", stepId }             a ready step begins, in a new session
 *   { type: "continue", stepId }          a reopened step carries on in its own
 *   { type: "pause", stopped, at }        out of budget with work waiting
 *   { type: "settle", at }                nothing more to do
 *   { type: "report" }                    tell the orchestrator what it has not heard
 *
 * A plan that is not running gets only the report.
 */

import { PLAN, STEP, toStart, isSettled, shouldPause, orchestratorSpend, newRequest, finishStep, failStep, cancelStep, beginStep, pausePlan, settlePlan } from "./plan.js"

/** Why a research step whose scope was changed is cancelled. */
export const SCOPE_REMOVED = "its research scope was removed"

/** Why a step failed, when its runner did not say. */
export const UNKNOWN_FAILURE = "Its session stopped with an error. Open it to see what happened."

/** What a plan's step sessions cost, summed. */
export function sumUsage(usages) {
  const sum = { in: 0, out: 0 }
  for (const u of usages) {
    sum.in += u?.in ?? 0
    sum.out += u?.out ?? 0
    // Cost only once some step has one, so an unknown is not shown as free.
    if (typeof u?.cost === "number") sum.cost = (sum.cost ?? 0) + u.cost
    if (u?.costEstimated) sum.costEstimated = true
  }
  return sum
}

const sameUsage = (a = {}, b = {}) => a.in === b.in && a.out === b.out && a.cost === b.cost && a.orchestrator === b.orchestrator && !!a.costEstimated === !!b.costEstimated

export function decide(plan, observations = {}, now = Date.now()) {
  if (plan.status !== PLAN.running) return [{ type: "report" }]
  const sessions = observations.sessions ?? {}
  const seen = (step) => (step.sessionUrl ? sessions[step.sessionUrl] ?? null : null)
  const next = JSON.parse(JSON.stringify(plan))
  const actions = []

  // A research step runs confined or not at all. Its runner refuses an
  // unconfined session too (kernel/scope.js); this ends the step in the plan.
  const broken = next.steps.filter((s) => s.access === "web" && s.status === STEP.running && seen(s)?.scopeOk === false).map((s) => s.id)
  if (broken.length) {
    actions.push({ type: "cancel", stepIds: broken, reason: SCOPE_REMOVED })
    for (const id of broken) cancelStep(next, id, { reason: SCOPE_REMOVED, now })
  }

  // What the steps have done. Each workflow_request call that went through
  // is one request, by its call's id, so reading it again adds nothing.
  const known = new Set((next.requests ?? []).map((r) => r.id))
  const requests = []
  const waiting = []
  const outOfBudget = []
  for (const step of next.steps) {
    if (!step.sessionUrl) continue
    for (const call of seen(step)?.requests ?? []) {
      if (known.has(call.id)) continue
      known.add(call.id)
      requests.push(newRequest(step.id, call, now))
    }
    if (step.status !== STEP.running) continue
    const outcome = seen(step)?.outcome ?? { state: "running" }
    if (outcome.state === "running") {
      for (const item of seen(step)?.waiting ?? []) waiting.push({ stepId: step.id, ...item })
      if (outcome.outOfBudget) outOfBudget.push({ stepId: step.id, ...outcome.outOfBudget })
    } else if (outcome.state === "done") {
      actions.push({ type: "finish", stepId: step.id, result: outcome.result, at: now })
      finishStep(next, step.id, { result: outcome.result, now })
    } else {
      const error = observations.reasons?.[step.sessionUrl] ?? UNKNOWN_FAILURE
      actions.push({ type: "fail", stepId: step.id, error, at: now })
      failStep(next, step.id, { error, now })
    }
  }
  if (requests.length) {
    actions.push({ type: "requests", requests })
    next.requests = [...(next.requests ?? []), ...requests]
  }
  actions.push({ type: "waiting", waiting, outOfBudget })

  // The orchestrator's own spend since the workflow began counts toward the
  // cap: it is the workflow's money too.
  const usage = sumUsage(next.steps.filter((s) => s.sessionUrl).map((s) => seen(s)?.usage))
  const cost = observations.orchestratorCost
  if (typeof cost === "number") {
    if (next.orchestratorFrom == null) {
      actions.push({ type: "orchestratorFrom", cost })
      next.orchestratorFrom = cost
    }
    usage.orchestrator = orchestratorSpend(next, cost)
  }
  if (!sameUsage(usage, next.usage ?? {})) {
    actions.push({ type: "usage", usage })
    next.usage = usage
  }

  actions.push({ type: "shareGrants" }, { type: "fileSources" })

  // Running steps keep a runner: after a reload theirs are gone.
  for (const step of next.steps) if (step.status === STEP.running && step.sessionUrl) actions.push({ type: "run", sessionUrl: step.sessionUrl })

  // Start what is ready. A research step keeps into the plan's ledger and
  // reads only from it, so the ledger is opened first, once per plan.
  const statuses = Object.fromEntries(Object.entries(sessions).map(([url, s]) => [url, s?.status ?? null]))
  const starting = toStart(next, statuses)
  if (!next.ledgerUrl && starting.some((id) => next.steps.find((s) => s.id === id).access === "web")) actions.push({ type: "ledger" })
  for (const id of starting) {
    const step = next.steps.find((s) => s.id === id)
    actions.push({ type: step.sessionUrl ? "continue" : "start", stepId: id })
    beginStep(next, id, { now })
  }

  // Out of budget, with work ready to start: pause and say so, rather than
  // sit "running" with nothing happening.
  const stopped = outOfBudget.map((b) => b.stepId)
  if (shouldPause(next, statuses, stopped)) {
    actions.push({ type: "pause", stopped, at: now })
    pausePlan(next, { stopped, now })
  }

  if (isSettled(next, statuses)) {
    actions.push({ type: "settle", at: now })
    settlePlan(next, now)
  }
  actions.push({ type: "report" })
  return actions
}
