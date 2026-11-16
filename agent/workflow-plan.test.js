import { describe, it, expect } from "vitest"
import {
  STEP, STATE, PLAN, TIERS, DEFAULT_LIMITS,
  initPlan, validateSteps, findCycle, states, toStart, isSettled, stepPrompt,
} from "./workflow/plan.js"

const STATUSES = Object.values(STEP)
const step = (id, over = {}) => ({ id, title: id, prompt: `do ${id}`, why: "because", where: "worker", tier: "fast", after: [], status: STEP.pending, ...over })
const plan = (steps, over = {}) => ({ status: PLAN.running, limits: { ...DEFAULT_LIMITS }, usage: { in: 0, out: 0 }, steps, ...over })

/** Every acyclic dependency graph on n steps: an edge may only point to an earlier step. */
function* graphs(n) {
  const pairs = []
  for (let later = 1; later < n; later++) for (let earlier = 0; earlier < later; earlier++) pairs.push([later, earlier])
  for (let mask = 0; mask < 1 << pairs.length; mask++) {
    const after = Array.from({ length: n }, () => [])
    pairs.forEach(([later, earlier], bit) => { if (mask & (1 << bit)) after[later].push(`s${earlier}`) })
    yield after
  }
}

function* product(choices, n) {
  if (n === 0) { yield []; return }
  for (const rest of product(choices, n - 1)) for (const c of choices) yield [...rest, c]
}

/** Every plan in the space, with the limits it runs under. */
function* every(n, { wheres = ["host", "worker"], limits = [[1, 1], [2, 1], [3, 2]] } = {}) {
  for (const after of graphs(n)) {
    for (const statuses of product(STATUSES, n)) {
      for (const where of product(wheres, n)) {
        for (const [parallel, hostParallel] of limits) {
          const steps = after.map((deps, i) => step(`s${i}`, { after: deps, status: statuses[i], where: where[i] }))
          yield plan(steps, { limits: { ...DEFAULT_LIMITS, parallel, hostParallel } })
        }
      }
    }
  }
}

/**
 * The reference definition of blocked: a dependency failed or was cancelled,
 * or is itself pending and blocked. A running or finished dependency shields
 * what comes after it — it may yet succeed, or already has.
 */
function doomed(p, id) {
  const byId = new Map(p.steps.map((s) => [s.id, s]))
  return byId.get(id).after.some((d) => {
    const dep = byId.get(d)
    return dep.status === STEP.failed || dep.status === STEP.cancelled || (dep.status === STEP.pending && doomed(p, d))
  })
}

function checkInvariants(p) {
  const started = toStart(p)
  const derived = states(p)
  const byId = new Map(p.steps.map((s) => [s.id, s]))
  const running = p.steps.filter((s) => s.status === STEP.running)
  const runningOnPage = running.filter((s) => s.where === "host")
  const startedOnPage = started.filter((id) => byId.get(id).where === "host")

  // Only pending steps whose every dependency is done.
  for (const id of started) {
    const s = byId.get(id)
    if (s.status !== STEP.pending) return `started ${id}, which is ${s.status}`
    if (!s.after.every((d) => byId.get(d).status === STEP.done)) return `started ${id} before its dependencies were done`
  }
  if (new Set(started).size !== started.length) return "started a step twice"
  // Whatever starts fits. (The space includes states the scheduler could not
  // have produced — three running under a limit of one — and from those it must
  // simply start nothing.)
  if (started.length && running.length + started.length > p.limits.parallel) return "over the parallel limit"
  if (startedOnPage.length && runningOnPage.length + startedOnPage.length > p.limits.hostParallel) return "over the page limit"

  // Nothing ready is left idle without a reason: it does not fit.
  for (const s of p.steps) {
    if (derived.get(s.id) !== STATE.ready || started.includes(s.id)) continue
    const full = running.length + started.length >= p.limits.parallel
    const pageFull = s.where === "host" && runningOnPage.length + startedOnPage.length >= p.limits.hostParallel
    if (!full && !pageFull) return `left ${s.id} ready with room to run it`
  }

  // A pending step is blocked exactly when something it needs failed or was cancelled.
  for (const s of p.steps) {
    if (s.status !== STEP.pending) continue
    const expected = doomed(p, s.id)
    if (expected !== (derived.get(s.id) === STATE.blocked)) return `${s.id} blocked=${derived.get(s.id) === STATE.blocked}, expected ${expected}`
  }

  // Settled exactly when nothing is running, ready or waiting.
  const live = [...derived.values()].some((st) => [STATE.waiting, STATE.ready, STATE.running, STATE.needsInput].includes(st))
  if (isSettled(p) === live) return `isSettled ${isSettled(p)} with live=${live}`
  return null
}

describe("scheduling, over every small plan", () => {
  it("holds every rule for all plans of up to three steps", () => {
    let count = 0
    for (let n = 1; n <= 3; n++) {
      for (const p of every(n)) {
        const broken = checkInvariants(p)
        if (broken) throw new Error(`${broken}\n${JSON.stringify(p.steps.map(({ id, after, status, where }) => ({ id, after, status, where })))} limits ${JSON.stringify(p.limits)}`)
        count++
      }
    }
    // graphs × statuses × placements × limits: 1·5·2·3 + 2·25·4·3 + 8·125·8·3
    expect(count).toBe(24630)
  })

  it("and for every four-step graph, on workers", () => {
    let count = 0
    for (const p of every(4, { wheres: ["worker"], limits: [[2, 1]] })) {
      const broken = checkInvariants(p)
      if (broken) throw new Error(broken)
      count++
    }
    expect(count).toBe(64 * 5 ** 4)
  })

  it("starts nothing in a plan that is not running, or that has spent its budget", () => {
    const steps = [step("a")]
    expect(toStart(plan(steps, { status: PLAN.stopped }))).toEqual([])
    expect(toStart(plan(steps, { status: PLAN.done }))).toEqual([])
    expect(toStart(plan(steps, { usage: { in: DEFAULT_LIMITS.tokens, out: 0 } }))).toEqual([])
    expect(toStart(plan(steps))).toEqual(["a"])
  })

  it("starts in plan order", () => {
    expect(toStart(plan([step("c"), step("a"), step("b")]))).toEqual(["c", "a", "b"])
  })

  it("a host step waiting for the page does not hold up a worker step behind it", () => {
    const p = plan([step("h1", { where: "host", status: STEP.running }), step("h2", { where: "host" }), step("w", { where: "worker" })])
    expect(toStart(p)).toEqual(["w"])
  })
})

describe("derived states", () => {
  it("a running step whose session waits on a person needs input", () => {
    const p = plan([step("a", { status: STEP.running, sessionUrl: "automerge:a" })])
    expect(states(p, { "automerge:a": "awaiting-approval" }).get("a")).toBe(STATE.needsInput)
    expect(states(p, { "automerge:a": "awaiting-answer" }).get("a")).toBe(STATE.needsInput)
    expect(states(p, { "automerge:a": "running" }).get("a")).toBe(STATE.running)
  })

  it("blocking passes down a chain", () => {
    const p = plan([step("a", { status: STEP.failed }), step("b", { after: ["a"] }), step("c", { after: ["b"] })])
    expect(states(p).get("c")).toBe(STATE.blocked)
  })
})

describe("validateSteps", () => {
  const base = plan([step("a", { status: STEP.done }), step("x", { status: STEP.failed })])

  it("accepts good steps, including ones that depend on each other", () => {
    expect(validateSteps(base, [step("b", { after: ["a"] }), step("c", { after: ["b"] })])).toEqual([])
  })

  it.each([
    [[step("a")], /already used/],
    [[step("b"), step("b")], /already used/],
    [[step("b", { after: ["nope"] })], /not a step/],
    [[step("b", { after: ["x"] })], /which failed/],
    [[step("bad id!")], /id must be/],
    [[step("b", { where: "cloud" })], /'where' must be/],
    [[step("b", { tier: "huge" })], /'tier' must be/],
    [[step("b", { why: "" })], /'why' is required/],
    [[step("b", { prompt: " " })], /'prompt' is required/],
    [[step("b", { after: ["c"] }), step("c", { after: ["b"] })], /in a circle: (b → c → b|c → b → c)/],
    [[], /at least one/],
  ])("refuses %j", (steps, message) => {
    expect(validateSteps(base, steps).join("\n")).toMatch(message)
  })

  it("enforces the step limit", () => {
    const small = plan([step("a")], { limits: { ...DEFAULT_LIMITS, steps: 2 } })
    expect(validateSteps(small, [step("b")])).toEqual([])
    expect(validateSteps(small, [step("b"), step("c")]).join()).toMatch(/allows 2/)
  })
})

describe("findCycle", () => {
  it("finds none in any acyclic graph", () => {
    for (let n = 1; n <= 4; n++) {
      for (const after of graphs(n)) expect(findCycle(after.map((deps, i) => ({ id: `s${i}`, after: deps })))).toBeNull()
    }
  })

  it("finds a self-loop and a longer one", () => {
    expect(findCycle([{ id: "a", after: ["a"] }])).toEqual(["a", "a"])
    expect(findCycle([{ id: "a", after: ["c"] }, { id: "b", after: ["a"] }, { id: "c", after: ["b"] }])).toHaveLength(4)
  })
})

describe("initPlan and stepPrompt", () => {
  it("seeds the document with defaults and pending steps", () => {
    const doc = {}
    initPlan(doc, { title: "T", goal: "G", steps: [{ ...step("a"), status: undefined }] })
    expect(doc["@patchwork"].type).toBe("agent-workflow")
    expect(doc.steps[0].status).toBe(STEP.pending)
    expect(Object.keys(doc.tiers)).toEqual(TIERS)
  })

  it("hands a step its goal, its task and what its dependencies found", () => {
    const p = plan([step("a", { title: "Find", status: STEP.done, result: "found three bugs" }), step("b", { title: "Fix", after: ["a"], prompt: "fix them" })], { title: "W", goal: "no bugs" })
    const text = stepPrompt(p, p.steps[1])
    expect(text).toContain("Goal: no bugs")
    expect(text).toContain("fix them")
    expect(text).toContain("### Find (a)\nfound three bugs")
  })
})
