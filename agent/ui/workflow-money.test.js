/**
 * The workflow's money, and when a step counts as finished.
 *
 * Finite cases, each checked by construction rather than sampled:
 *   - the cap counts steps and orchestrator together;
 *   - a step out of budget is the orchestrator's decision, and becomes a
 *     person's only when the cap is reached;
 *   - "done" is read off the whole session document, so a call still running,
 *     a reply still streaming or a live runner is never done;
 *   - an empty last message takes the last words the session said.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, STATUS, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock } from "../session/blocks.js"
import { initPlan, PLAN, STEP, budgetOf, canExtend, orchestratorSpend, shouldPause, resumePlan, askForBudget, stepPrompt, reopenPrompt, requestErrors, DEFAULT_LIMITS } from "../workflow/plan.js"
import { sessionOutcome, describeProgress, WorkflowDriver, _resetDrivers, EMPTY_RESULT } from "../workflow/driver.js"
import { waitingIn, budgetWaiting } from "../workflow/waiting.js"
import { describeBudget } from "./waiting.js"
import { workflowBudget } from "../workflow/tools.js"

await initSubduction()
beforeEach(_resetIds)

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

describe("what the workflow has spent", () => {
  it("sums the steps and the orchestrator, against the cap", () => {
    const plan = { usage: { cost: 47.55, orchestrator: 13.81 }, limits: { cost: 50.07 } }
    const b = budgetOf(plan)
    expect(b.spent).toBeCloseTo(61.36, 2)
    expect(b).toMatchObject({ steps: 47.55, orchestrator: 13.81, limit: 50.07, remaining: 0 })
  })

  it("counts only what the orchestrator spent since the plan began", () => {
    expect(orchestratorSpend({ orchestratorFrom: 2 }, 15.81)).toBeCloseTo(13.81, 2)
    expect(orchestratorSpend({}, 3)).toBe(3)
    expect(orchestratorSpend({ orchestratorFrom: 9 }, 3)).toBe(0)
  })

  it("is over budget on the orchestrator's spend alone", () => {
    const plan = { status: PLAN.running, limits: { cost: 5 }, usage: { cost: 1, orchestrator: 4 }, steps: [step("a")] }
    expect(budgetOf(plan).remaining).toBe(0)
    expect(shouldPause(plan)).toBe(true)
  })

  it("the driver writes the orchestrator's spend into the plan", async () => {
    const repo = new Repo({ network: [] })
    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, {})
      d.usage = { in: 0, out: 0, turns: 0, cost: 2 }
    })
    const plan = repo.create({})
    plan.change((d) => initPlan(d, { title: "W", goal: "G", sessionUrl: orchestrator.url, limits: { cost: 10 }, steps: [step("a")] }))
    const driver = new WorkflowDriver({ repo, handle: plan, startSession: async () => ({ runner: { interrupt() {} }, listen() {} }), heartbeatMs: 1e9, confirmMs: 0, toolIds: { worker: [] } })
    driver.start()
    for (let i = 0; i < 10; i++) await driver.kick()
    // The first look fixes what it had already spent; nothing before the plan counts.
    expect(plan.doc().orchestratorFrom).toBe(2)
    expect(budgetOf(plan.doc()).orchestrator).toBe(0)
    orchestrator.change((d) => { d.usage.cost = 5.5 })
    for (let i = 0; i < 10; i++) await driver.kick()
    expect(budgetOf(plan.doc()).orchestrator).toBeCloseTo(3.5, 2)
    driver.stop()
    _resetDrivers()
  })
})

describe("extending a step's budget", () => {
  it("is the orchestrator's within the remainder, and a person's past it, over every case", () => {
    for (const remaining of [0, 0.5, 3]) {
      for (const add of [0.5, 1, 3, 3.01]) {
        const plan = { limits: { cost: 10 }, usage: { cost: 10 - remaining } }
        expect(canExtend(plan, add), `add ${add} with ${remaining} left`).toBe(add <= remaining)
      }
    }
  })

  const toolPlan = async (usage) => {
    const repo = new Repo({ network: [] })
    const plan = repo.create({})
    plan.change((d) => {
      initPlan(d, { title: "W", goal: "G", limits: { cost: 10 }, steps: [step("a")] })
      d.usage = usage
      d.steps[0].status = STEP.pending
    })
    return { repo, plan }
  }

  it("within the remainder, extends the step without asking anyone, and records why", async () => {
    const { repo, plan } = await toolPlan({ in: 0, out: 0, cost: 4, orchestrator: 2 })
    const out = await workflowBudget.execute({ plan: plan.url, step: "a", add: 3, why: "half done" }, { workflows: { repo } })
    expect(out).toMatch(/may now spend \$3\.50/)
    expect(plan.doc().paused ?? null).toBe(null)
    expect(plan.doc().steps[0].budget).toBe(3.5)
    expect(plan.doc().steps[0].budgetLog).toMatchObject([{ add: 3, limit: 3.5, why: "half done" }])
  })

  it("past the cap, extends nothing and puts the request to the person, with what one click does", async () => {
    const { repo, plan } = await toolPlan({ in: 0, out: 0, cost: 4, orchestrator: 4 })
    const out = await workflowBudget.execute({ plan: plan.url, step: "a", add: 5, why: "needs the rest" }, { workflows: { repo } })
    expect(out).toMatch(/Not given: \$5\.00 is more than the \$2\.00 left/)
    expect(plan.doc().steps[0].budget).toBeUndefined()
    expect(plan.doc().paused).toMatchObject({ reason: "budget", stopped: ["a"], ask: { stepId: "a", stepTitle: "Step a", need: 5, why: "needs the rest" } })
    const item = budgetWaiting(plan.doc(), plan.url, plan)
    const text = describeBudget(item)
    expect(text).toMatch(/spent its whole budget \(\$8\.00 of \$10\.00, orchestrator included\)/)
    expect(text).toMatch(/1 stopped part-way/)
    expect(text).toMatch(/wants to give Step a \$5\.00 more: needs the rest/)
    expect(text).toMatch(/Resume raises the budget/)
  })

  it("requires a reason", async () => {
    const { repo, plan } = await toolPlan({ in: 0, out: 0, cost: 0 })
    await expect(workflowBudget.execute({ plan: plan.url, step: "a", add: 1 }, { workflows: { repo } })).rejects.toThrow(/Pass `why`/)
  })
})

describe("a step out of budget, and the person", () => {
  const stopped = { reason: "budget", spent: 2, limit: 2, at: 5 }

  it("is not shown to the person while its orchestrator can decide, but is when it has none", () => {
    const base = { turns: [], stopped }
    expect(waitingIn({ ...base, workflow: { planUrl: "p", stepId: "a", orchestratorUrl: "automerge:o" } })).toEqual([])
    expect(waitingIn(base)).toMatchObject([{ kind: "budget", scope: "session" }])
  })

  it("pauses the plan, asking the person, only when the cap is reached with a step stopped", () => {
    const run = (cost, stoppedIds) => shouldPause({ status: PLAN.running, limits: { cost: 10 }, usage: { cost }, steps: [step("a", { status: STEP.running })] }, {}, stoppedIds)
    expect(run(10, ["a"])).toBe(true)
    expect(run(10, [])).toBe(false) // running, not stopped: let it finish
    expect(run(9.99, ["a"])).toBe(false) // room left: the orchestrator decides
  })

  it("resuming makes the orchestrator hear of stopped steps again, and clears the pause", () => {
    const doc = { limits: { cost: 10 }, usage: { cost: 8, orchestrator: 2 }, steps: [step("a", { budgetNoticed: 5 })] }
    askForBudget(doc, doc.steps[0], 3, "x")
    resumePlan(doc, 5)
    expect(doc.paused).toBe(null)
    expect(doc.limits.cost).toBe(15)
    expect(doc.steps[0].budgetNoticed).toBeUndefined()
  })

  it("tells the orchestrator to decide while there is room, and that the person was asked when there is none", () => {
    const base = { title: "W", status: PLAN.running, steps: [step("a", { status: STEP.running })] }
    const out = [{ stepId: "a", spent: 2, limit: 2, at: 5 }]
    const roomy = describeProgress({ ...base, limits: { cost: 10 }, usage: { cost: 4, orchestrator: 1 } }, [], [], out)
    expect(roomy).toMatch(/The person has not been asked: you set this budget/)
    expect(roomy).toMatch(/\$5\.00 left under its \$10\.00 cap/)
    expect(roomy).toMatch(/workflow_budget \{ step, add, why \}/)
    const full = describeProgress({ ...base, limits: { cost: 10 }, usage: { cost: 9, orchestrator: 1 } }, [], [], out)
    expect(full).toMatch(/cap is reached/)
    expect(full).toMatch(/the person is being asked/)
  })
})

describe("when a step is done", () => {
  const session = (turns, over = {}) => {
    const doc = {}
    initSession(doc, {})
    doc.status = STATUS.idle
    doc.turns = turns
    return Object.assign(doc, over)
  }
  const user = () => makeTurn("user", [textBlock("go")])
  const said = (text) => makeTurn("assistant", [textBlock(text)])

  it("a quiet session that said something is done, with that as its result", () => {
    expect(sessionOutcome(session([user(), said("all done")]))).toEqual({ state: "done", result: "all done" })
  })

  it("a call still unanswered anywhere keeps it running, whatever the status says", () => {
    for (const status of [CALL.running, CALL.approved, CALL.done]) {
      const call = callBlock("fs_edit", {})
      call.status = status
      const turns = [user(), makeTurn("assistant", [textBlock("editing now"), call])]
      const doc = session(turns)
      const out = sessionOutcome(doc)
      // A call that finished has its result in the next turn; one that did not, has none.
      expect(out.state, `call ${status}`).toBe("running")
    }
  })

  it("a call that was answered does not hold it back", () => {
    const call = callBlock("fs_edit", {})
    call.status = CALL.done
    const turns = [user(), makeTurn("assistant", [call]), makeTurn("tool", [resultBlock(call.id, "ok")]), said("edited")]
    expect(sessionOutcome(session(turns))).toEqual({ state: "done", result: "edited" })
  })

  it("a reply still streaming keeps it running", () => {
    const turn = said("half a sent")
    turn.streaming = { runner: "r", generation: 1 }
    expect(sessionOutcome(session([user(), turn])).state).toBe("running")
  })

  it("a live runner holding the session keeps it running; a stale one does not", () => {
    const doc = session([user(), said("done?")], { lease: { runner: "r", generation: 1, at: 1 } })
    expect(sessionOutcome(doc, { live: () => true }).state).toBe("running")
    expect(sessionOutcome(doc, { live: () => false }).state).toBe("done")
  })

  it("a status other than idle keeps it running", () => {
    for (const status of [STATUS.running, STATUS.parked, STATUS.reconnecting]) {
      expect(sessionOutcome(session([user(), said("x")], { status })).state).toBe("running")
    }
  })
})

describe("an empty last message", () => {
  const session = (turns) => {
    const doc = {}
    initSession(doc, {})
    doc.status = STATUS.idle
    doc.turns = turns
    return doc
  }
  const user = () => makeTurn("user", [textBlock("go")])
  const said = (text) => makeTurn("assistant", [textBlock(text)])
  const call = () => {
    const c = callBlock("doc_read", {})
    c.status = CALL.done
    return c
  }

  it("takes the last words the session said, saying so", () => {
    const c = call()
    const turns = [user(), said("Parts list written: 14 items."), makeTurn("assistant", [c]), makeTurn("tool", [resultBlock(c.id, "ok")]), makeTurn("assistant", [])]
    const out = sessionOutcome(session(turns))
    expect(out.state).toBe("done")
    expect(out.result).toMatch(/last message was empty/)
    expect(out.result).toMatch(/Parts list written: 14 items\./)
  })

  it("prefers the last message when it says something, and keeps the old line when nothing was ever said", () => {
    expect(sessionOutcome(session([user(), said("early"), said("final")])).result).toBe("final")
    expect(sessionOutcome(session([user(), makeTurn("assistant", [])])).result).toBe(EMPTY_RESULT)
  })
})

describe("waiting, and asking", () => {
  it("steps that run in a host or worker are told to doc_watch rather than hold a click open", () => {
    const plan = { title: "W", goal: "G", steps: [] }
    for (const prompt of [stepPrompt(plan, step("a")), reopenPrompt(plan, step("a", { reopen: { note: "again" } }))]) {
      expect(prompt).toMatch(/doc_watch/)
      expect(prompt).toMatch(/settleMs/)
    }
    // A research step has no documents to watch.
    expect(stepPrompt(plan, step("w", { access: "web" }))).not.toMatch(/doc_watch/)
  })

  it("a request with only a reason says what to pass", () => {
    const [error] = requestErrors({ why: "found something" })
    expect(error).toMatch(/pass `add_steps`/)
    expect(error).toMatch(/`reopen`/)
    expect(error).toMatch(/`why` alone asks for nothing/)
  })
})

afterEach(() => _resetDrivers())
void DEFAULT_LIMITS
