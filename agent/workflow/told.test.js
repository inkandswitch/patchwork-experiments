/**
 * Told once: every kind of news the orchestrator gets is keyed by the
 * occurrence, so it is told exactly once, and a thing that happens again is
 * news again with nothing reset. Each case is written out: the plan, what has
 * been told, and what is news after each change to it.
 */

import { describe, it, expect } from "vitest"
import {
  PLAN, initPlan, tell, told, reopenSteps, keepSteps, beginStep, finishStep, failStep, settlePlan, stopPlan, runAgain,
  pausePlan, askForBudget, resumePlan, finishedKey, endKey, pauseKey, budgetKey, staleKey, questionKey, requestKey,
} from "./plan.js"
import { untold } from "./driver.js"

const step = (id, over = {}) => ({ id, title: id, prompt: "p", why: "w", where: "worker", tier: "fast", after: [], ...over })
const planOf = (steps, limits = {}) => {
  const doc = {}
  initPlan(doc, { title: "W", goal: "G", steps, limits })
  return doc
}
/** Tell everything that is news, as the driver does when it reports. */
const tellAll = (doc, waiting = [], out = []) => {
  for (const key of untold(doc, waiting, out).keys) tell(doc, key)
}
const run = (doc, id, result = "r") => {
  beginStep(doc, id, { session: { url: `automerge:${id}`, model: "m" }, now: 1 })
  return finishStep(doc, id, { result, now: 2 })
}

describe("told once", () => {
  it("nothing is news in a plan that has just begun, and told is a map of keys", () => {
    const doc = planOf([step("a")])
    expect(doc.told).toEqual({})
    expect(untold(doc).keys).toEqual([])
    tell(doc, "x")
    expect([told(doc, "x"), told(doc, "y"), told({}, "x")]).toEqual([true, false, false])
  })

  it("a step's finish is news once; reopened and finished again, it is news again", () => {
    const doc = planOf([step("a")])
    run(doc, "a")
    expect(untold(doc).finished.map((s) => s.id)).toEqual(["a"])
    tellAll(doc)
    expect(untold(doc).keys).toEqual([])
    reopenSteps(doc, ["a"], { note: "again", now: 3 })
    expect(untold(doc).keys).toEqual([])
    run(doc, "a", "r2")
    expect(untold(doc).keys).toContain(finishedKey(doc.steps[0]))
    expect(finishedKey(doc.steps[0])).toBe("finished:a:1")
  })

  it("a failure is news once, as a finish is", () => {
    const doc = planOf([step("a")])
    beginStep(doc, "a", { now: 1 })
    failStep(doc, "a", { error: "broke", now: 2 })
    expect(untold(doc).finished.map((s) => s.id)).toEqual(["a"])
    tellAll(doc)
    expect(untold(doc).finished).toEqual([])
  })

  it("the end is news once per run: not again when a finished plan is stopped, again when it runs again and ends", () => {
    const doc = planOf([step("a"), step("b")])
    run(doc, "a")
    run(doc, "b")
    expect(settlePlan(doc, 5)).toBe(true)
    expect(untold(doc).end).toBe(true)
    tellAll(doc)
    expect(stopPlan(doc, 6)).toBe(true)
    expect(untold(doc).end).toBe(false)
    reopenSteps(doc, ["a"], { note: "again", now: 7 })
    expect([doc.status, doc.runs]).toEqual([PLAN.running, 2])
    expect(untold(doc).end).toBe(false)
    run(doc, "a")
    settlePlan(doc, 8)
    expect(untold(doc).end).toBe(true)
    expect(endKey(doc)).toBe("end:2")
  })

  it("keeping a step that frees nothing leaves a finished plan finished, and its end told", () => {
    const doc = planOf([step("a"), step("b", { after: ["a"] })])
    run(doc, "a")
    run(doc, "b")
    reopenSteps(doc, ["a"], { note: "again", now: 3 })
    run(doc, "a", "r2")
    settlePlan(doc, 4)
    tellAll(doc)
    keepSteps(doc, ["b"])
    expect([doc.status, doc.runs, untold(doc).keys]).toEqual([PLAN.done, 1, []])
    expect(runAgain(doc)).toBe(false)
  })

  it("a pause the driver makes is news; one the orchestrator asked for is not; an ask added to a pause leaves it as it was; the next pause is news", () => {
    const doc = planOf([step("a"), step("b")], { cost: 1 })
    doc.usage.cost = 1
    expect(pausePlan(doc, { stopped: [], now: 1 })).toBe(true)
    expect(pausePlan(doc, { now: 2 })).toBe(false)
    expect(untold(doc).paused).toBe(true)
    askForBudget(doc, doc.steps[0], 2, "more", 3)
    expect(untold(doc).paused).toBe(true)
    tellAll(doc)
    resumePlan(doc, 1, 4)
    expect(doc.paused).toBe(null)
    askForBudget(doc, doc.steps[0], 5, "more", 5)
    expect(untold(doc).paused).toBe(false)
    expect(pauseKey(doc)).toBe("pause:1")
    resumePlan(doc, 10, 6)
    doc.usage.cost = 99
    pausePlan(doc, { now: 7 })
    expect(untold(doc).paused).toBe(true)
  })

  it("a step stopped for its budget is news once per stop, and again after the person resumes the plan", () => {
    const doc = planOf([step("a")])
    beginStep(doc, "a", { now: 1 })
    const stop = (at) => [{ stepId: "a", spent: 2, limit: 2, at }]
    expect(untold(doc, [], stop(5)).budgets).toHaveLength(1)
    tellAll(doc, [], stop(5))
    expect(untold(doc, [], stop(5)).budgets).toEqual([])
    expect(untold(doc, [], stop(6)).budgets).toHaveLength(1)
    resumePlan(doc, 5, 7)
    expect(untold(doc, [], stop(5)).budgets).toHaveLength(1)
    expect(budgetKey(doc, "a", 5)).toBe("budget:a:5:1")
  })

  it("a stale step is news once per change of its inputs, including a dependency reopened again at the same version", () => {
    const doc = planOf([step("a"), step("b", { after: ["a"] })])
    run(doc, "a")
    run(doc, "b")
    const news = () => untold(doc).stale.map((s) => s.id)
    reopenSteps(doc, ["a"], { note: "1", now: 3 })
    expect(news()).toEqual(["b"])
    tellAll(doc)
    expect(news()).toEqual([])
    beginStep(doc, "a", { now: 4 })
    failStep(doc, "a", { error: "x", now: 5 })
    expect(news()).toEqual(["b"])
    tellAll(doc)
    reopenSteps(doc, ["a"], { note: "2", now: 6 })
    // Pending at the same version as the first time, but another run of it.
    expect(news()).toEqual(["b"])
    expect(staleKey(doc, doc.steps[1])).toBe("stale:b:0:a@pending.1.2")
    tellAll(doc)
    run(doc, "a", "r2")
    expect(news()).toEqual(["b"])
    tellAll(doc)
    keepSteps(doc, ["b"])
    expect(news()).toEqual([])
    reopenSteps(doc, ["a"], { note: "3", now: 7 })
    expect(news()).toEqual(["b"])
  })

  it("a question and a request are each news once, by id", () => {
    const doc = planOf([step("a")])
    beginStep(doc, "a", { now: 1 })
    doc.requests = [{ id: "r1", stepId: "a", why: "w", add: null, reopen: ["a"], status: "open", at: 1, decidedAt: null, note: null }]
    const waiting = [{ kind: "question", callId: "q1", question: "?", options: [] }, { kind: "approval", callId: "c1", tool: "x" }]
    expect(untold(doc, waiting).keys).toEqual([questionKey("q1"), requestKey({ id: "r1" })])
    tellAll(doc, waiting)
    expect(untold(doc, [...waiting, { kind: "question", callId: "q2", question: "?", options: [] }]).keys).toEqual([questionKey("q2")])
  })

  it("the keys of everything that is news at once, in a fixed order", () => {
    const doc = planOf([step("a"), step("b"), step("c")])
    run(doc, "a")
    beginStep(doc, "b", { now: 1 })
    failStep(doc, "b", { error: "x", now: 2 })
    beginStep(doc, "c", { now: 1 })
    doc.requests = [{ id: "r1", stepId: "a", why: "w", add: null, reopen: ["a"], status: "open", at: 1, decidedAt: null, note: null }]
    doc.usage.cost = 99
    pausePlan(doc, { stopped: ["c"], now: 3 })
    stopPlan(doc, 4)
    const waiting = [{ kind: "question", callId: "q1", question: "?", options: [] }]
    expect(untold(doc, waiting, [{ stepId: "c", spent: 1, limit: 1, at: 9 }]).keys).toEqual([
      "finished:a:0", "finished:b:0", "question:q1", "end:1", "pause:0", "budget:c:9:0", "request:r1",
    ])
  })
})
