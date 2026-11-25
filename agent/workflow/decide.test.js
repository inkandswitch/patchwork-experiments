/**
 * decide(), over written-out cases: every kind of action, and the orderings
 * that matter — a step finished on a tick makes what waits on it start on
 * the same tick, a step started keeps the plan from settling, a cancelled
 * research step is not filed as finished, and a plan with nothing to do
 * writes nothing.
 */

import { describe, it, expect } from "vitest"
import { decide, SCOPE_REMOVED, UNKNOWN_FAILURE, sumUsage } from "./decide.js"
import { initPlan, STEP, PLAN } from "./plan.js"

const step = (id, over = {}) => ({ id, title: id, prompt: "p", why: "w", where: "worker", tier: "fast", after: [], ...over })

/** A plan whose steps are as given, status and all. */
function planOf(steps, { limits = {}, ...over } = {}) {
  const doc = {}
  initPlan(doc, { title: "W", goal: "G", steps: steps.map(({ status, ...s }) => s), limits })
  steps.forEach((s, i) => Object.assign(doc.steps[i], s))
  return Object.assign(doc, over)
}

const running = (id, over = {}) => step(id, { status: STEP.running, sessionUrl: `automerge:${id}`, ...over })
const session = (over = {}) => ({ status: "idle", usage: null, requests: [], outcome: { state: "running" }, ...over })
const types = (actions) => actions.map((a) => a.type)
/** The actions that write to the plan. */
const WRITES = new Set(["cancel", "finish", "fail", "requests", "orchestratorFrom", "usage", "ledger", "start", "continue", "pause", "settle"])

describe("decide", () => {
  it.each([PLAN.done, PLAN.stopped])("a %s plan only reports", (status) => {
    const plan = planOf([step("a")], { status })
    expect(decide(plan, {}, 1)).toEqual([{ type: "report" }])
  })

  it("a new plan starts what is ready, in plan order, within the parallel limit, and does not settle", () => {
    const plan = planOf([step("a"), step("b"), step("c"), step("d", { after: ["a"] })], { limits: { parallel: 2 } })
    expect(decide(plan, {}, 1)).toEqual([
      { type: "waiting", waiting: [], outOfBudget: [] },
      { type: "shareGrants" },
      { type: "fileSources" },
      { type: "start", stepId: "a" },
      { type: "start", stepId: "b" },
      { type: "report" },
    ])
  })

  // [does the plan name a ledger] × [what is about to start] → is the ledger
  // opened, and before that start? Only a research step needs one, and a plan
  // that has one never gets another.
  const LEDGER_CASES = []
  for (const has of [false, true]) {
    for (const [what, steps] of [
      ["nothing", [step("a", { after: ["b"] }), running("b")]],
      ["a full step", [step("a")]],
      ["a research step", [step("a", { access: "web" })]],
      ["a full and a research step", [step("a"), step("b", { access: "web" })]],
      ["a reopened research step", [step("a", { access: "web", sessionUrl: "automerge:a", reopen: { note: "again" }, previous: [{ status: STEP.done }] })]],
    ]) LEDGER_CASES.push([has, what, steps, !has && what.includes("research")])
  }
  it.each(LEDGER_CASES)("ledger named %s, starting %s → opened %s", (has, _what, steps, opened) => {
    const plan = planOf(steps, has ? { ledgerUrl: "automerge:ledger" } : {})
    const sessions = Object.fromEntries(steps.filter((s) => s.sessionUrl).map((s) => [s.sessionUrl, session({ outcome: undefined })]))
    const kinds = types(decide(plan, { sessions }, 1))
    expect(kinds.filter((t) => t === "ledger")).toHaveLength(opened ? 1 : 0)
    if (opened) expect(kinds.indexOf("ledger")).toBeLessThan(Math.min(...["start", "continue"].map((t) => kinds.indexOf(t)).filter((i) => i >= 0)))
  })

  it("a reopened step continues in its own session", () => {
    const plan = planOf([step("a", { sessionUrl: "automerge:a", reopen: { note: "again" }, previous: [{ status: STEP.done }] })])
    expect(types(decide(plan, { sessions: { "automerge:a": session({ outcome: undefined }) } }, 1))).toContain("continue")
  })

  it("a step that finished is filed, what waits on it starts on the same tick, and the plan does not settle while it runs", () => {
    const plan = planOf([running("a"), step("b", { after: ["a"] })])
    const actions = decide(plan, { sessions: { "automerge:a": session({ outcome: { state: "done", result: "A" }, usage: { in: 3, out: 1 } }) } }, 7)
    expect(actions).toEqual([
      { type: "finish", stepId: "a", result: "A", at: 7 },
      { type: "waiting", waiting: [], outOfBudget: [] },
      { type: "usage", usage: { in: 3, out: 1 } },
      { type: "shareGrants" },
      { type: "fileSources" },
      { type: "start", stepId: "b" },
      { type: "report" },
    ])
  })

  it("the last step finishing settles the plan on the same tick, after it is filed", () => {
    const plan = planOf([step("a", { status: STEP.done, version: 1, sessionUrl: "automerge:x" }), running("b", { after: ["a"], inputs: { a: 1 } })])
    const actions = decide(plan, { sessions: { "automerge:x": session(), "automerge:b": session({ outcome: { state: "done", result: "B" } }) } }, 7)
    expect(types(actions)).toEqual(["finish", "waiting", "shareGrants", "fileSources", "settle", "report"])
    expect(actions.at(-2)).toEqual({ type: "settle", at: 7 })
  })

  it("a step that broke fails with its runner's reason, or a general one", () => {
    const plan = planOf([running("a"), running("b")])
    const sessions = { "automerge:a": session({ outcome: { state: "failed" } }), "automerge:b": session({ outcome: { state: "failed" } }) }
    const actions = decide(plan, { sessions, reasons: { "automerge:a": "OpenRouter 401" } }, 3)
    expect(actions.filter((a) => a.type === "fail")).toEqual([
      { type: "fail", stepId: "a", error: "OpenRouter 401", at: 3 },
      { type: "fail", stepId: "b", error: UNKNOWN_FAILURE, at: 3 },
    ])
    expect(types(actions)).toContain("settle")
  })

  it("a research step whose scope is not its own is cancelled first, and what its session says is not filed", () => {
    const plan = planOf([running("r", { access: "web" }), running("s", { access: "web" })])
    const sessions = {
      "automerge:r": session({ scopeOk: false, outcome: { state: "done", result: "leaked" } }),
      "automerge:s": session({ scopeOk: true }),
    }
    const actions = decide(plan, { sessions }, 1)
    expect(actions[0]).toEqual({ type: "cancel", stepIds: ["r"], reason: SCOPE_REMOVED })
    expect(types(actions)).not.toContain("finish")
    expect(actions.filter((a) => a.type === "run")).toEqual([{ type: "run", sessionUrl: "automerge:s" }])
  })

  it("a request is added once, by its call's id, and holds the plan open", () => {
    const plan = planOf([step("a", { status: STEP.done, sessionUrl: "automerge:a" })], {
      requests: [{ id: "c1", stepId: "a", why: "old", add: null, reopen: ["a"], status: "declined", at: 1, decidedAt: 2, note: null }],
    })
    const calls = [{ id: "c1", input: { why: "old", reopen: ["a"] } }, { id: "c2", input: { why: "new", reopen: ["a"] } }]
    const actions = decide(plan, { sessions: { "automerge:a": session({ requests: calls, outcome: undefined }) } }, 5)
    expect(actions[0]).toEqual({ type: "requests", requests: [{ id: "c2", stepId: "a", why: "new", add: null, reopen: ["a"], status: "open", at: 5, decidedAt: null, note: null }] })
    expect(types(actions)).not.toContain("settle")
  })

  it("collects what running steps wait on a person for, and which are out of their budgets", () => {
    const plan = planOf([running("a"), running("b")])
    const question = { kind: "question", callId: "q1", question: "?", options: [] }
    const sessions = {
      "automerge:a": session({ status: "awaiting-answer", outcome: { state: "running", waiting: true }, waiting: [question] }),
      "automerge:b": session({ outcome: { state: "running", outOfBudget: { spent: 2, limit: 2, at: 9 } } }),
    }
    expect(decide(plan, { sessions }, 1).find((a) => a.type === "waiting")).toEqual({
      type: "waiting",
      waiting: [{ stepId: "a", ...question }],
      outOfBudget: [{ stepId: "b", spent: 2, limit: 2, at: 9 }],
    })
  })

  it("fixes what the orchestrator had spent when the plan began, once, and counts only what it spent since", () => {
    const plan = planOf([step("a")])
    const first = decide(plan, { orchestratorCost: 2 }, 1)
    expect(first.slice(1, 3)).toEqual([{ type: "orchestratorFrom", cost: 2 }, { type: "usage", usage: { in: 0, out: 0, orchestrator: 0 } }])
    const later = decide({ ...plan, orchestratorFrom: 2, usage: { in: 0, out: 0, orchestrator: 0 } }, { orchestratorCost: 5.5 }, 1)
    expect(later.filter((a) => a.type === "orchestratorFrom" || a.type === "usage")).toEqual([{ type: "usage", usage: { in: 0, out: 0, orchestrator: 3.5 } }])
  })

  it("spent, with work ready and nothing running, pauses instead of starting", () => {
    const plan = planOf([step("a", { status: STEP.done, sessionUrl: "automerge:a" }), step("b")], { limits: { cost: 1 }, usage: { in: 0, out: 0, cost: 1 } })
    const actions = decide(plan, { sessions: { "automerge:a": session({ usage: { in: 0, out: 0, cost: 1 }, outcome: undefined }) } }, 4)
    expect(types(actions)).toEqual(["waiting", "shareGrants", "fileSources", "pause", "report"])
    expect(actions[3]).toEqual({ type: "pause", stopped: [], at: 4 })
  })

  it("spent, with a step stopped for its own budget, pauses naming it", () => {
    const plan = planOf([running("a")], { limits: { cost: 1 }, usage: { in: 0, out: 0, cost: 1 } })
    const sessions = { "automerge:a": session({ usage: { in: 0, out: 0, cost: 1 }, outcome: { state: "running", outOfBudget: { spent: 1, limit: 1, at: 2 } } }) }
    expect(decide(plan, { sessions }, 4).find((a) => a.type === "pause")).toEqual({ type: "pause", stopped: ["a"], at: 4 })
  })

  it("a plan with nothing new writes nothing: it keeps its runners and reports", () => {
    const plan = planOf([running("a"), step("b", { after: ["a"] })], { usage: { in: 3, out: 1 } })
    const actions = decide(plan, { sessions: { "automerge:a": session({ usage: { in: 3, out: 1 } }) } }, 1)
    expect(actions.filter((a) => WRITES.has(a.type))).toEqual([])
    expect(types(actions)).toEqual(["waiting", "shareGrants", "fileSources", "run", "report"])
  })

  it("leaves the plan it was given as it was", () => {
    const plan = planOf([running("a"), step("b", { after: ["a"] })])
    const before = JSON.stringify(plan)
    decide(plan, { sessions: { "automerge:a": session({ outcome: { state: "done", result: "A" } }) }, orchestratorCost: 1 }, 1)
    expect(JSON.stringify(plan)).toBe(before)
  })

  it("sums what the step sessions cost, with a cost only once one is known", () => {
    expect(sumUsage([{ in: 1, out: 2 }, null, { in: 3, out: 4, cost: 0.5, costEstimated: true }])).toEqual({ in: 4, out: 6, cost: 0.5, costEstimated: true })
    expect(sumUsage([{ in: 1, out: 2 }])).toEqual({ in: 1, out: 2 })
  })
})
