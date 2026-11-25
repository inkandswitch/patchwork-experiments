/**
 * Budgets, in dollars, at two levels.
 *
 * A workflow's budget is the person's: when its steps have spent it nothing
 * more starts, the plan pauses and says so, and only the person resumes it. A
 * step's budget is the orchestrator's: a step that spends it stops part-way
 * and waits for the orchestrator to give it more, stop it, or re-plan. The
 * rules themselves are checked over every small plan in workflow-plan.test.js;
 * these follow them through the loop, the driver, the tool and the view.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { run, OUTCOME, spentBudget } from "../kernel/loop.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, noticeBlock } from "../session/blocks.js"
import { claimLease } from "../session/lease.js"
import { initPlan, STEP, DEFAULT_STEP_BUDGETS, stepBudget, resumePlan, told, pauseKey } from "../workflow/plan.js"
import { WorkflowDriver, sessionOutcome, _resetDrivers } from "../workflow/driver.js"
import { workflowBudget } from "../workflow/tools.js"
import { renderBudgetItem } from "./waiting.js"
import { budgetWaiting } from "../workflow/waiting.js"
import { settled } from "../fixtures/session.js"
import { STOP, stopOf } from "../session/status.js"

await initSubduction()

beforeEach(_resetIds)

const toolset = { tools: [], schemas: [], get: () => null }

function sessionStore({ budget = null, cost = 0 } = {}) {
  const doc = {}
  initSession(doc, { config: budget == null ? {} : { budget } })
  doc.turns = [makeTurn("user", [textBlock("go")])]
  doc.usage = { in: 0, out: 0, turns: 0, cost }
  claimLease(doc, "r", Date.now())
  return memoryStore(doc)
}

describe("a session with a budget", () => {
  it("stops before calling the model once it has spent it, says so, and records why", async () => {
    const store = sessionStore({ budget: 1, cost: 1.2 })
    const provider = makeMock([[{ type: "text", delta: "should not happen" }]])
    const result = await run({ store, provider, toolset, runnerUrl: "r", generation: 1, flushMs: 0 })
    expect(result.outcome).toBe(OUTCOME.budgetExhausted)
    expect(provider.requests).toHaveLength(0)
    const doc = store.doc()
    expect(stopOf(doc)).toMatchObject({ kind: STOP.budget, data: { spent: 1.2, limit: 1 } })
    expect(doc.turns.at(-1).blocks[0].text).toMatch(/spent its \$1\.00 budget \(\$1\.20\)/)
    expect(settled(doc)).toBe(STATUS.idle)
  })

  it("runs as usual under its budget, or with none", async () => {
    for (const store of [sessionStore({ budget: 1, cost: 0.4 }), sessionStore({ cost: 99 })]) {
      const provider = makeMock([[{ type: "text", delta: "ok" }]])
      const result = await run({ store, provider, toolset, runnerUrl: "r", generation: 1, flushMs: 0 })
      expect(result.outcome).toBe(OUTCOME.idle)
      expect(provider.requests).toHaveLength(1)
    }
  })

  it("says exactly when it is spent", () => {
    const doc = (budget, cost) => ({ config: { budget }, usage: { cost } })
    expect(spentBudget(doc(1, 0.99))).toBe(null)
    expect(spentBudget(doc(1, 1))).toEqual({ spent: 1, limit: 1 })
    expect(spentBudget(doc(undefined, 50))).toBe(null)
    expect(spentBudget({ config: { budget: 1 } })).toBe(null)
  })
})

// ---------------------------------------------------------------- the driver

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/** Steps that answer at once, spending `cost` each; or stop out of budget. */
function runner(behaviour = {}) {
  const started = []
  const startSession = async (handle) => {
    const id = handle.doc().workflow?.stepId
    if (!started.includes(id)) {
      started.push(id)
      const act = behaviour[id] ?? { cost: 0.1 }
      handle.change((d) => {
        if (act.outOfBudget) {
          d.usage = { in: 10, out: 1, turns: 1, cost: d.config.budget }
          d.turns.push(makeTurn("assistant", [noticeBlock(STOP.budget, "Stopped: spent", { spent: d.config.budget, limit: d.config.budget })], { at: 1234 }))
        } else {
          d.usage = { in: 10, out: 1, turns: 1, cost: act.cost }
          d.turns.push(makeTurn("assistant", [textBlock(`result of ${id}`)]))
        }
      })
    }
    return { runner: { interrupt() {} }, listen: () => {} }
  }
  return { startSession, started }
}

const drivers = []
afterEach(() => {
  for (const d of drivers.splice(0)) d.stop()
  _resetDrivers()
})

async function workflow(steps, { limits = {}, behaviour = {} } = {}) {
  const repo = new Repo({ network: [] })
  const orchestrator = repo.create({})
  orchestrator.change((d) => initSession(d, {}))
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "W", goal: "G", sessionUrl: orchestrator.url, limits, steps }))
  const fake = runner(behaviour)
  const news = []
  const driver = new WorkflowDriver({
    repo,
    handle: plan,
    startSession: fake.startSession,
    notify: () => ({ notify: (render) => news.push(render()), close() {} }),
    heartbeatMs: 1e9,
    confirmMs: 0,
  })
  drivers.push(driver)
  driver.start()
  const settle = async () => {
    for (let i = 0; i < 20; i++) await driver.kick()
  }
  return { repo, plan, driver, fake, news, settle }
}

describe("the workflow's budget", () => {
  it("spent with work ready, the plan pauses, says so once, and resuming starts what was waiting", async () => {
    const w = await workflow([step("a"), step("b")], { limits: { cost: 0.5, parallel: 1 }, behaviour: { a: { cost: 1 } } })
    await w.settle()
    expect(w.fake.started).toEqual(["a"])
    expect(w.plan.doc().paused).toMatchObject({ reason: "budget", spent: 1, limit: 0.5 })
    expect(told(w.plan.doc(), pauseKey(w.plan.doc()))).toBe(true)
    expect(w.plan.doc().status).toBe("running")
    const news = w.news.join("\n")
    expect(news.match(/## Paused: the budget is spent/g)).toHaveLength(1)
    expect(news).toMatch(/\$1\.00 of its \$0\.50 cap \(steps and your own turns together\), so 1 step will not start: Step b \(b\)/)

    w.plan.change((d) => resumePlan(d, 5))
    await w.settle()
    expect(w.fake.started).toEqual(["a", "b"])
    expect(w.plan.doc().paused).toBe(null)
    expect(w.plan.doc().status).toBe("done")
  })

  it("does not pause a plan that is simply finishing", async () => {
    const w = await workflow([step("a")], { limits: { cost: 0.05 }, behaviour: { a: { cost: 1 } } })
    await w.settle()
    expect([w.plan.doc().status, w.plan.doc().paused ?? null]).toEqual(["done", null])
  })
})

describe("a step's budget", () => {
  it("is the step's own, or its tier's, and is handed to its session", async () => {
    expect(stepBudget(step("a", { tier: "deep" }))).toBe(DEFAULT_STEP_BUDGETS.deep)
    expect(stepBudget(step("a", { budget: 3 }))).toBe(3)
    const w = await workflow([step("a", { tier: "standard" }), step("b", { budget: 0.75 })])
    await w.settle()
    const budgets = await Promise.all(w.plan.doc().steps.map(async (s) => (await w.repo.find(s.sessionUrl)).doc().config.budget))
    expect(budgets).toEqual([DEFAULT_STEP_BUDGETS.standard, 0.75])
  })

  it("spent, the step waits — not done, not failed — and the orchestrator is told once to decide", async () => {
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { behaviour: { a: { outOfBudget: true } } })
    await w.settle()
    const doc = (await w.repo.find(w.plan.doc().steps[0].sessionUrl)).doc()
    expect(sessionOutcome(doc)).toEqual({ state: "running", outOfBudget: { spent: 0.5, limit: 0.5, at: 1234 } })
    expect(w.plan.doc().steps.map((s) => s.status)).toEqual([STEP.running, STEP.pending])
    const told = w.news.join("\n")
    expect(told.match(/## Out of budget: Step a \(a\)/g)).toHaveLength(1)
    expect(told).toMatch(/workflow_budget[^]*workflow_stop[^]*workflow_add_steps/)
  })

  it("given more, it carries on from where it stopped", async () => {
    const w = await workflow([step("a")], { behaviour: { a: { outOfBudget: true } } })
    await w.settle()
    const out = await workflowBudget.execute({ plan: w.plan.url, step: "a", add: 2, why: "half done" }, { workflows: { repo: w.repo } })
    expect(out).toMatch(/may now spend \$2\.50; it carries on from where it stopped/)
    const doc = (await w.repo.find(w.plan.doc().steps[0].sessionUrl)).doc()
    expect([doc.config.budget, stopOf(doc), doc.turns.at(-1).role]).toEqual([2.5, null, "user"])
    expect(doc.turns.at(-1).blocks[0].text).toMatch(/budget is now \$2\.50\. Carry on/)
    expect(w.plan.doc().steps[0].budget).toBe(2.5)
  })

  it("can be raised before a step starts, and not after it has finished", async () => {
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { limits: { parallel: 1 } })
    await workflowBudget.execute({ plan: w.plan.url, step: "b", add: 1, why: "big" }, { workflows: { repo: w.repo } })
    expect(w.plan.doc().steps[1].budget).toBe(DEFAULT_STEP_BUDGETS.fast + 1)
    await w.settle()
    await expect(workflowBudget.execute({ plan: w.plan.url, step: "a", add: 1, why: "more" }, { workflows: { repo: w.repo } })).rejects.toThrow(/is done/)
    await expect(workflowBudget.execute({ plan: w.plan.url, step: "a", add: 0, why: "more" }, { workflows: { repo: w.repo } })).rejects.toThrow(/positive/)
  })
})

describe("Resume, where the person sees it", () => {
  it("offers each amount, and adds it to what was spent", () => {
    const doc = { title: "W", steps: [step("b", { status: STEP.pending })], usage: { cost: 1 }, limits: { cost: 0.5 }, paused: { reason: "budget", at: 9, spent: 1, limit: 0.5 } }
    const handle = { change: (fn) => fn(doc) }
    const item = budgetWaiting(doc, "automerge:plan", handle)
    expect(item).toMatchObject({ kind: "budget", callId: "budget:automerge:plan:9", notStarted: 1 })
    const node = renderBudgetItem(item)
    expect(node.textContent).toMatch(/spent its whole budget \(\$1\.00 of \$0\.50, orchestrator included\), so 1 step waiting to start/)
    const buttons = [...node.querySelectorAll("button")].map((b) => b.textContent)
    expect(buttons).toEqual(["Resume with $5 more", "Resume with $20 more"])
    node.querySelector("button").click()
    expect([doc.paused, doc.limits.cost]).toEqual([null, 6])
  })
})
