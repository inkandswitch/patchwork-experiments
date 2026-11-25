/**
 * Every writer of a plan leaves a plan of another version alone.
 *
 * One gate (plan.js `writable`, `changePlan`) stands in front of every write
 * to a plan: the driver's, the workflow tools', the views'. Here each writer
 * is run on a plan of version 1, of this version and of a version newer than
 * this code: on this version it changes the plan, which is how the rows
 * below can fail; on another it changes nothing — not the plan, not a step's
 * session — and says why, in words a person can act on.
 */

import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initPlan, newStep, STEP, PLAN_VERSION, PlanVersionError, versionNote, isCurrent } from "./plan.js"
import { WorkflowDriver, _resetDrivers } from "./driver.js"
import { workflowAddSteps, workflowEditSteps, workflowKeep, workflowDecide, workflowBudget, workflowReopen, workflowStop } from "./tools.js"
import { initSession } from "../session/schema.js"

await initSubduction()

afterEach(() => _resetDrivers())

const step = (id, over = {}) => ({ id, title: id, prompt: `do ${id}`, why: "w", where: "worker", tier: "fast", after: [], ...over })

/**
 * A plan of `version` with something for every writer to do: a done step to
 * reopen, an out-of-date one to keep, a pending one to edit and stop, a
 * running one to give more budget, and an open request to decide.
 */
function world(version) {
  const repo = new Repo({ network: [] })
  const session = (over = {}) => {
    const handle = repo.create({})
    handle.change((d) => {
      initSession(d, { config: { budget: 0.5 } })
      Object.assign(d, over)
    })
    return handle
  }
  const sessions = { a: session(), r: session() }
  const plan = repo.create({})
  plan.change((d) => {
    initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] }), step("c"), step("r")] })
    Object.assign(d.steps[0], { status: STEP.done, version: 1, result: "A", sessionUrl: sessions.a.url })
    Object.assign(d.steps[1], { status: STEP.done, version: 1, result: "B", inputs: { a: 0 } })
    Object.assign(d.steps[3], { status: STEP.running, sessionUrl: sessions.r.url })
    d.requests = [{ id: "q1", stepId: "a", why: "found more", add: [newStep(step("e"))], reopen: null, status: "open", at: 1, decidedAt: null, note: null }]
    if (version === 1) delete d.schemaVersion
    else d.schemaVersion = version
  })
  const startSession = async () => ({ runner: { interrupt() {} }, listen() {} })
  const ctx = { workflows: { repo, startSession } }
  const driver = () => new WorkflowDriver({ repo, handle: plan, startSession, heartbeatMs: 1e9, confirmMs: 0 })
  return { repo, plan, sessions, ctx, driver }
}

/** Each writer, and whether on another version it refuses out loud or quietly does nothing. */
const WRITERS = {
  workflow_add_steps: [(w) => workflowAddSteps.execute({ plan: w.plan.url, steps: [step("f")] }, w.ctx), "refuses"],
  workflow_edit_steps: [(w) => workflowEditSteps.execute({ plan: w.plan.url, steps: [{ id: "c", title: "C" }] }, w.ctx), "refuses"],
  workflow_keep: [(w) => workflowKeep.execute({ plan: w.plan.url, steps: ["b"] }, w.ctx), "refuses"],
  "workflow_decide, accepting": [(w) => workflowDecide.execute({ plan: w.plan.url, request: "q1", accept: true }, w.ctx), "refuses"],
  "workflow_decide, declining": [(w) => workflowDecide.execute({ plan: w.plan.url, request: "q1", accept: false }, w.ctx), "refuses"],
  workflow_budget: [(w) => workflowBudget.execute({ plan: w.plan.url, step: "r", add: 1, why: "more" }, w.ctx), "refuses"],
  workflow_reopen: [(w) => workflowReopen.execute({ plan: w.plan.url, steps: ["a"], note: "again", cascade: false }, w.ctx), "refuses"],
  workflow_stop: [(w) => workflowStop.execute({ plan: w.plan.url, steps: ["c"] }, w.ctx), "refuses"],
  "a driver's tick": [(w) => w.driver().kick(), "quietly"],
  "a driver's reopen": [(w) => w.driver().reopen(["a"], { note: "again" }), "refuses"],
  "a driver's cancel": [(w) => w.driver().cancel(["c"]), "refuses"],
}

const CASES = []
for (const version of [1, PLAN_VERSION, PLAN_VERSION + 1]) for (const writer of Object.keys(WRITERS)) CASES.push([writer, version])

describe("a writer of a plan", () => {
  it.each(CASES)("%s, on a plan of version %i", async (writer, version) => {
    const [write, refusal] = WRITERS[writer]
    const w = world(version)
    const heads = () => [w.plan.heads(), ...Object.values(w.sessions).map((s) => s.heads())]
    const before = heads()
    const attempt = write(w)
    if (version === PLAN_VERSION) {
      await attempt
      expect(w.plan.heads()).not.toEqual(before[0])
      return
    }
    if (refusal === "refuses") {
      await expect(attempt).rejects.toThrow(PlanVersionError)
      await expect(attempt).rejects.toThrow(versionNote(w.plan.doc()))
    } else {
      await attempt
    }
    expect(heads()).toEqual(before)
  })
})

describe("what a person is told", () => {
  it.each([
    [1, /earlier version of the agent[^]*migration/],
    [PLAN_VERSION + 1, /newer version of the agent[^]*Update the agent package/],
  ])("of a plan of version %i", (version, said) => {
    const plan = version === 1 ? {} : { schemaVersion: version }
    expect(isCurrent(plan)).toBe(false)
    expect(versionNote(plan)).toMatch(said)
  })

  it("nothing of a plan of this version", () => {
    expect(isCurrent({ schemaVersion: PLAN_VERSION })).toBe(true)
  })
})
