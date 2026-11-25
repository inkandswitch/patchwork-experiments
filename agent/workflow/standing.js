/**
 * Where a session stands in its workflow, for the session's own view.
 *
 * A step's session is a conversation like any other, and before this nothing
 * in it said whether its step was running, done, cancelled or out of date.
 * Worse, a message typed into it ran the session again whatever the step's
 * state, and the workflow did not notice: a done step got a new answer the
 * plan never took, and a cancelled one quietly undid its cancelling.
 *
 * So what may be sent to a step's session follows from its step:
 *
 *   running        a message steers it, as in any session
 *   anything else  a message is one of two things, chosen when it is sent:
 *                    a question  — asked in a side thread (aside.js), which
 *                                  begins as a copy of the step's
 *                                  conversation; the step never sees it
 *                    a reopening — the step runs again in its own session,
 *                                  told the message (plan.js reopenSteps),
 *                                  and its new result replaces the old one
 *
 * Asking and reopening are kept apart on purpose: a question about a step's
 * work must not change that work, nor sit in the conversation the step
 * carries on from when it is reopened later.
 */

import { states, STATE, STEP, PLAN, reopenErrors, reopenSteps, staleInputs, dependantsOf } from "./plan.js"

/** A step's state in a word, wherever one is shown. */
export const STATE_LABEL = {
  [STATE.waiting]: "waiting",
  // It can start; it may still be waiting its turn for a runner.
  [STATE.ready]: "ready",
  [STATE.blocked]: "blocked",
  [STATE.running]: "running",
  [STATE.needsInput]: "needs you",
  [STATE.done]: "done",
  [STATE.stale]: "out of date",
  [STATE.failed]: "failed",
  [STATE.cancelled]: "cancelled",
}

const titleOf = (byId, id) => byId.get(id)?.title ?? id
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)
const steps = (n) => `${n} step${n === 1 ? "" : "s"}`

/**
 * What reopening `stepId` with its later steps would reopen besides it:
 * worked out by doing it to a copy, so it is exactly what the button does.
 */
export function laterReopened(plan, stepId) {
  if (reopenErrors(plan, [stepId]).length) return []
  const copy = JSON.parse(JSON.stringify(plan))
  const { reopened } = reopenSteps(copy, [stepId], { note: "", cascade: true, now: 0 })
  return reopened.filter((id) => id !== stepId)
}

/**
 * A step's session, as its workflow sees it.
 *
 *   { state, label, detail, plan, run, steer, reopen, later }
 *
 * `state` is the step's derived state (plan.js STATE); `label` says it in a
 * word or two and `detail` in a phrase, or null. `plan` says what the whole
 * workflow is doing when that is not simply running, or null. `run` counts
 * the step's runs. `steer` is whether a message goes straight to the session;
 * when it does not, `reopen` is whether the step can be reopened with it, and
 * `later` the steps reopening it with those after it would reopen too.
 *
 * A step no longer in its plan can only be asked about.
 */
export function stepStanding(plan, stepId, sessions = {}) {
  const byId = new Map((plan?.steps ?? []).map((s) => [s.id, s]))
  const step = byId.get(stepId)
  const whole = planNote(plan)
  if (!step) return { state: null, label: "removed", detail: "no longer a step of its workflow", plan: whole, run: 0, steer: false, reopen: false, later: [] }

  const state = states(plan, sessions).get(stepId)
  const run = (step.previous?.length ?? 0) + 1
  const steer = step.status === STEP.running
  const reopen = !steer && !reopenErrors(plan, [stepId]).length
  return { state, label: STATE_LABEL[state] ?? state, detail: detailOf(plan, step, state, byId), plan: whole, run, steer, reopen, later: reopen ? laterReopened(plan, stepId) : [] }
}

function detailOf(plan, step, state, byId) {
  const notDone = (step.after ?? []).filter((id) => byId.get(id)?.status !== STEP.done)
  const again = step.reopen ? "reopened; " : ""
  switch (state) {
    case STATE.waiting:
      return `${again}waits for ${list(notDone.map((id) => titleOf(byId, id)))}`
    case STATE.ready:
      return step.reopen ? "reopened; carries on next" : null
    case STATE.blocked: {
      const stuck = (step.after ?? []).filter((id) => {
        const s = states(plan).get(id)
        return s === STATE.failed || s === STATE.cancelled || s === STATE.blocked || s === STATE.stale || !byId.has(id)
      })
      return `${again}cannot start until ${list(stuck.map((id) => titleOf(byId, id)))} ${stuck.length === 1 ? "is" : "are"} settled`
    }
    case STATE.needsInput:
      return "waiting on you"
    case STATE.done: {
      const users = dependantsOf(plan, step.id).length
      return users ? `its result is used by ${steps(users)}` : null
    }
    case STATE.stale:
      return `${list(staleInputs(plan, step, byId).map((id) => titleOf(byId, id)))} changed since it finished`
    case STATE.failed:
      return step.error ? String(step.error) : null
    default:
      return null
  }
}

/** What the whole workflow is doing, when that is not simply running. */
function planNote(plan) {
  if (!plan) return null
  if (plan.status === PLAN.stopped) return "the workflow was stopped"
  if (plan.status === PLAN.done) return "the workflow has finished"
  if (plan.paused) return plan.paused.reason === "budget" ? "the workflow is paused: its budget is spent" : "the workflow is paused"
  return null
}

/**
 * A workflow at a glance, for the session that started it:
 *   { status, done, total, needsYou, running, failed, stale, requests }
 */
export function planGlance(plan, sessions = {}) {
  const all = [...states(plan, sessions).values()]
  const count = (s) => all.filter((x) => x === s).length
  return {
    status: plan.paused && plan.status === PLAN.running ? "paused" : plan.status,
    total: all.length,
    done: count(STATE.done),
    running: count(STATE.running),
    needsYou: count(STATE.needsInput),
    failed: count(STATE.failed),
    stale: count(STATE.stale),
    requests: (plan.requests ?? []).filter((r) => r.status === "open").length,
  }
}

/** The glance as a line: "running · 3 of 7 done · 1 needs you". */
export function glanceText(g) {
  const parts = [g.status, `${g.done} of ${g.total} done`]
  if (g.running) parts.push(`${g.running} running`)
  if (g.needsYou) parts.push(`${g.needsYou} need${g.needsYou === 1 ? "s" : ""} you`)
  if (g.stale) parts.push(`${g.stale} out of date`)
  if (g.failed) parts.push(`${g.failed} failed`)
  if (g.requests) parts.push(`${g.requests} request${g.requests === 1 ? "" : "s"} to decide`)
  return parts.join(" · ")
}
