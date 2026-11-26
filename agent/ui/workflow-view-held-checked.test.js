/**
 * A checker's case of the workflow view and the driver a page keeps for a
 * plan (ui/workflow-view.js, workflow/driver.js holders): the view says it
 * drives the plan from this page while it is open.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { follow, _reset } from "../runners/page.js"
import { ensureDriver, getDriver, sessionHolder, _resetDrivers } from "../workflow/driver.js"
import { initPlan, beginStep, changePlan, finishStep, settlePlan, reopenSteps, runAgain, PLAN } from "../workflow/plan.js"
import { WorkflowView } from "./workflow-view.js"

await initSubduction()

beforeEach(() => {
  document.body.replaceChildren()
  _resetIds()
  _reset()
})
afterEach(() => {
  _resetDrivers()
  _reset()
})

function sessionIn(repo, turns) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(...turns)
    d.burst = null
  })
  return handle
}

/** A plan with two steps, `a` and `b`, begun in their own sessions, and an orchestrator. */
function planIn(repo) {
  const orchestrator = sessionIn(repo, [makeTurn("assistant", [textBlock("started")])])
  const a = sessionIn(repo, [makeTurn("user", [textBlock("do a")])])
  const b = sessionIn(repo, [makeTurn("user", [textBlock("do b")])])
  const plan = repo.create()
  plan.change((d) => {
    initPlan(d, {
      title: "t",
      goal: "g",
      sessionUrl: orchestrator.url,
      steps: [
        { id: "a", title: "A", prompt: "do a", why: "w", where: "worker", tier: "fast", after: [] },
        { id: "b", title: "B", prompt: "do b", why: "w", where: "worker", tier: "fast", after: [] },
      ],
    })
    beginStep(d, "a", { session: { url: a.url, model: null } })
    beginStep(d, "b", { session: { url: b.url, model: null } })
  })
  return { orchestrator, a, b, plan }
}

const quiet = async () => ({ asked: false, why: "a test asks nothing" })

describe("a workflow view open on the plan", () => {
  // The case: the workflow view is opened on a finished plan, so it starts no
  // driver. The orchestrator's workflow tool, in this page, reopens a step:
  // the plan runs again, driven here for that session. The person closes the
  // orchestrator's view; this page's follow of it ends, and so does the
  // driver, while the workflow view, which says it drives the plan "while
  // this view is open", still shows it running. Its Resume and Stop use the
  // driver they find without joining it (getDriver(url) ?? drivePlanHere).
  it.fails("keeps a running plan driven here while it is open", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, b, plan } = planIn(repo)
    changePlan(plan, (d) => {
      finishStep(d, "a", { result: "a" })
      finishStep(d, "b", { result: "b" })
      settlePlan(d)
    })
    expect(plan.doc().status).toBe(PLAN.done)
    const element = document.createElement("div")
    document.body.append(element)
    const close = WorkflowView(plan, element, { repo })
    expect(getDriver(plan.url)).toBe(null)

    const shown = follow(orchestrator, { repo })
    // As workflow_reopen does: the step reopened, the plan run again, its driver held for the calling session.
    changePlan(plan, (d) => {
      reopenSteps(d, ["a"], { note: "again", cascade: false, by: "orchestrator" })
      runAgain(d)
    })
    expect(plan.doc().status).toBe(PLAN.running)
    await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url), startSession: quiet })
    await new Promise((r) => setTimeout(r, 20))
    shown.release()
    try {
      expect(plan.doc().status).toBe(PLAN.running)
      expect(getDriver(plan.url)).not.toBe(null)
    } finally {
      close()
    }
  })
})
