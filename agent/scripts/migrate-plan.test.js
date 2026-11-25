/**
 * The one-off migration of a workflow plan from version 1 to version 2: each
 * flag that said something was told becomes the key of what it was told
 * about, so the driver tells nothing twice, and leaves untold what was not.
 */

import { describe, it, expect } from "vitest"
import { migratePlan } from "./migrate-plan.js"
import { PLAN, STEP, PLAN_VERSION, told, finishedKey, endKey, pauseKey, budgetKey, staleKey, questionKey, requestKey, resumePlan } from "../workflow/plan.js"
import { untold } from "../workflow/driver.js"

const step = (id, over = {}) => ({ id, title: id, prompt: "p", why: "w", where: "worker", tier: "fast", after: [], status: STEP.pending, ...over })
const v1 = (steps, over = {}) => ({
  "@patchwork": { type: "agent-workflow" },
  title: "W",
  goal: "G",
  status: PLAN.running,
  limits: { cost: 20 },
  usage: { in: 0, out: 0 },
  steps,
  ...over,
})
const question = (callId) => ({ kind: "question", callId, question: "?", options: [] })

describe("a version 1 plan", () => {
  it("says it is version 2, on its first run, with nothing told and no flags left", () => {
    const doc = v1([step("a")])
    expect(migratePlan(doc)).toBe(true)
    expect(doc).toMatchObject({ schemaVersion: PLAN_VERSION, runs: 1, told: {} })
    expect(untold(doc).keys).toEqual([])
  })

  it("is migrated once: a second pass changes nothing", () => {
    const doc = v1([step("a", { status: STEP.done, reported: true })], { status: PLAN.done, reportedEnd: true, asked: ["q1"] })
    migratePlan(doc)
    const after = JSON.stringify(doc)
    expect(migratePlan(doc)).toBe(false)
    expect(JSON.stringify(doc)).toBe(after)
  })

  it("is not touched unless it is a plan", () => {
    const session = { "@patchwork": { type: "agent-session" }, status: "idle", turns: [] }
    expect(migratePlan(session)).toBe(false)
    expect(session).toEqual({ "@patchwork": { type: "agent-session" }, status: "idle", turns: [] })
  })

  // A step's finish: [its status, reported, runs before this one] → told?
  it.each([
    [STEP.done, true, 0, true],
    [STEP.done, false, 0, false],
    [STEP.failed, true, 0, true],
    [STEP.failed, false, 0, false],
    [STEP.done, true, 2, true],
    [STEP.done, false, 2, false],
  ])("a %s step, reported %s, after %i earlier runs: its finish is told %s", (status, reported, runs, expected) => {
    const previous = Array.from({ length: runs }, () => ({ status: STEP.done, result: "old", error: null, startedAt: 1, finishedAt: 2 }))
    const doc = v1([step("a", { status, reported, previous })])
    migratePlan(doc)
    expect(told(doc, finishedKey(doc.steps[0]))).toBe(expected)
    expect(untold(doc).finished.map((s) => s.id)).toEqual(expected ? [] : ["a"])
    expect("reported" in doc.steps[0]).toBe(false)
  })

  // The plan's end: [status, reportedEnd] → news after?
  it.each([
    [PLAN.done, true, false],
    [PLAN.done, false, true],
    [PLAN.stopped, true, false],
    [PLAN.stopped, false, true],
    [PLAN.running, false, false],
  ])("a %s plan, its end reported %s: its end is news %s", (status, reportedEnd, news) => {
    const doc = v1([step("a", { status: STEP.done, reported: true })], { status, reportedEnd })
    migratePlan(doc)
    expect(untold(doc).end).toBe(news)
    expect(told(doc, endKey(doc))).toBe(status !== PLAN.running && reportedEnd)
    expect("reportedEnd" in doc).toBe(false)
  })

  it("questions it was told stay told; others are news", () => {
    const doc = v1([step("a", { status: STEP.running })], { asked: ["q1", "q2"] })
    migratePlan(doc)
    expect(Object.keys(doc.told).sort()).toEqual([questionKey("q1"), questionKey("q2")])
    expect(untold(doc, [question("q1"), question("q3")]).questions.map((q) => q.callId)).toEqual(["q3"])
    expect("asked" in doc).toBe(false)
  })

  // The pause in force: reported → news after?
  it.each([[true, false], [false, true]])("a pause reported %s is news %s, and its next one is news again", (reported, news) => {
    const doc = v1([step("a", { status: STEP.done }), step("b")], { usage: { in: 0, out: 0, cost: 25 }, paused: { reason: "budget", at: 3, spent: 25, limit: 20, reported } })
    migratePlan(doc)
    expect(untold(doc).paused).toBe(news)
    expect(doc.paused).toEqual({ reason: "budget", at: 3, spent: 25, limit: 20 })
    resumePlan(doc, 5, 4)
    doc.paused = { reason: "budget", at: 5, spent: 30, limit: 30 }
    expect(untold(doc).paused).toBe(true)
    expect(pauseKey(doc)).not.toBe(pauseKey({ ...doc, resumes: [] }))
  })

  // A step stopped for its budget: [budgetNoticed, the stop in force] → news?
  it.each([
    [5, 5, false],
    [5, 6, true],
    [undefined, 5, true],
  ])("a step that noticed the stop at %s, stopped at %s: news %s", (noticed, at, news) => {
    const doc = v1([step("a", { status: STEP.running, ...(noticed != null ? { budgetNoticed: noticed } : {}) })])
    migratePlan(doc)
    expect(untold(doc, [], [{ stepId: "a", spent: 2, limit: 2, at }]).budgets.length > 0).toBe(news)
    expect(told(doc, budgetKey(doc, "a", 5))).toBe(noticed === 5)
    expect("budgetNoticed" in doc.steps[0]).toBe(false)
  })

  // A stale step: what it noticed, against what it is out of date over now.
  it.each([
    ["the inputs as they stand", "a:done:2", false],
    ["an older change", "a:pending:1", true],
    ["nothing", undefined, true],
  ])("a stale step that noticed %s is news %s", (_name, noticed, news) => {
    const doc = v1([
      step("a", { status: STEP.done, version: 2, previous: [{ status: STEP.done }] }),
      step("b", { status: STEP.done, after: ["a"], inputs: { a: 1 }, version: 1, ...(noticed ? { staleNoticed: noticed } : {}) }),
    ])
    migratePlan(doc)
    expect(untold(doc).stale.map((s) => s.id)).toEqual(news ? ["b"] : [])
    expect(told(doc, staleKey(doc, doc.steps[1]))).toBe(!news)
    expect("staleNoticed" in doc.steps[1]).toBe(false)
  })

  it("a step's stale notice is dropped when the step is no longer done", () => {
    const doc = v1([
      step("a", { status: STEP.done, version: 2 }),
      step("b", { status: STEP.pending, after: ["a"], inputs: { a: 1 }, staleNoticed: "a:done:2", previous: [{ status: STEP.done }] }),
    ])
    migratePlan(doc)
    expect(doc.told).toEqual({})
  })

  it("requests it was told of stay told; others are news", () => {
    const request = (id, reported) => ({ id, stepId: "a", why: "w", add: null, reopen: ["a"], status: "open", at: 1, decidedAt: null, note: null, reported })
    const doc = v1([step("a", { status: STEP.done, reported: true })], { requests: [request("r1", true), request("r2", false)] })
    migratePlan(doc)
    expect(told(doc, requestKey({ id: "r1" }))).toBe(true)
    expect(untold(doc).requests.map((r) => r.id)).toEqual(["r2"])
    expect(doc.requests.every((r) => !("reported" in r))).toBe(true)
  })

  it("a plan whose orchestrator was told everything has nothing to tell after", () => {
    const doc = v1(
      [
        step("a", { status: STEP.done, version: 2, reported: true, previous: [{ status: STEP.done }] }),
        step("b", { status: STEP.done, after: ["a"], inputs: { a: 1 }, version: 1, reported: true, staleNoticed: "a:done:2" }),
        step("c", { status: STEP.failed, reported: true }),
        step("d", { status: STEP.running, budgetNoticed: 9 }),
      ],
      {
        status: PLAN.running,
        asked: ["q1"],
        usage: { in: 0, out: 0, cost: 25 },
        paused: { reason: "budget", at: 3, spent: 25, limit: 20, reported: true, stopped: ["d"] },
        requests: [{ id: "r1", stepId: "b", why: "w", add: null, reopen: ["a"], status: "open", at: 1, decidedAt: null, note: null, reported: true }],
      }
    )
    migratePlan(doc)
    expect(untold(doc, [question("q1")], [{ stepId: "d", spent: 1, limit: 1, at: 9 }]).keys).toEqual([])
  })
})
