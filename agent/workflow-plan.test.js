import { describe, it, expect } from "vitest"
import {
  STEP, STATE, PLAN, TIERS, DEFAULT_LIMITS,
  initPlan, validateSteps, findCycle, states, toStart, isSettled, stepPrompt,
  overBudget, shouldPause, resumePlan, budgetOf, notStarted, reopenSteps, reopenPrompt,
  newStep, editSteps, editErrors, EDITABLE, MISSING_TOOL_GUIDANCE,
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
 * The reference definition of out of date: a done step one of whose
 * dependencies is not done, or is at a version other than the one it took.
 */
function outOfDate(p, id) {
  const byId = new Map(p.steps.map((s) => [s.id, s]))
  const s = byId.get(id)
  if (s.status !== STEP.done) return false
  return s.after.some((d) => byId.get(d).status !== STEP.done || (byId.get(d).version ?? 0) !== (s.inputs?.[d] ?? 0))
}

/**
 * The reference definition of blocked: a dependency failed or was cancelled,
 * is out of date, or is itself pending and blocked. A running dependency, or a
 * finished one that is up to date, shields what comes after it — it may yet
 * succeed, or already has.
 */
function doomed(p, id) {
  const byId = new Map(p.steps.map((s) => [s.id, s]))
  return byId.get(id).after.some((d) => {
    const dep = byId.get(d)
    return dep.status === STEP.failed || dep.status === STEP.cancelled || outOfDate(p, d) || (dep.status === STEP.pending && doomed(p, d))
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
    if (s.after.some((d) => outOfDate(p, d))) return `started ${id} on a dependency that is out of date`
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

  // Out of date exactly by the reference.
  for (const s of p.steps) {
    if (outOfDate(p, s.id) !== (derived.get(s.id) === STATE.stale)) return `${s.id} stale=${derived.get(s.id) === STATE.stale}, expected ${outOfDate(p, s.id)}`
  }

  // Settled exactly when nothing is running, ready or waiting.
  const live = [...derived.values()].some((st) => [STATE.waiting, STATE.ready, STATE.running, STATE.needsInput].includes(st))
  if (isSettled(p) === live) return `isSettled ${isSettled(p)} with live=${live}`
  return null
}

describe("the budget, over every small plan", () => {
  // Every plan of up to three steps, under budget and spent, paused or not.
  function* budgeted() {
    for (let n = 1; n <= 3; n++) {
      for (const p of every(n)) {
        for (const cost of [0, 19.99, 20, 31]) {
          for (const paused of [null, { reason: "budget", at: 1, spent: cost, limit: 20, reported: false }]) {
            yield { ...p, usage: { in: 9e9, out: 9e9, cost }, paused }
          }
        }
      }
    }
  }
  /** The same plan with all the budget it could want, and not paused. */
  const flush = (p) => ({ ...p, paused: null, limits: { ...p.limits, cost: Infinity } })

  it("counts dollars, not tokens: billions of tokens under budget still start work", () => {
    const p = plan([step("a")], { usage: { in: 9e9, out: 9e9, cost: 0.24 } })
    expect([overBudget(p), toStart(p)]).toEqual([false, ["a"]])
    expect(budgetOf(p)).toMatchObject({ spent: 0.24, limit: DEFAULT_LIMITS.cost })
  })

  it("starts nothing paused or spent; pauses exactly when more budget would start something with nothing running; is never stuck without pausing", () => {
    let count = 0
    for (const p of budgeted()) {
      const label = () => `${JSON.stringify(p.steps.map(({ id, after, status }) => ({ id, after, status })))} cost ${p.usage.cost} paused ${!!p.paused}`
      if ((p.paused || overBudget(p)) && toStart(p).length) throw new Error(`started work: ${label()}`)

      const nothingRunning = !p.steps.some((x) => x.status === STEP.running)
      const expected = !p.paused && overBudget(p) && nothingRunning && toStart(flush(p)).length > 0
      if (shouldPause(p) !== expected) throw new Error(`shouldPause ${shouldPause(p)}, expected ${expected}: ${label()}`)

      // The bug this exists for: spent, nothing running, not finished — and
      // nobody told. Every such plan pauses.
      if (!p.paused && overBudget(p) && nothingRunning && !isSettled(p) && !shouldPause(p)) throw new Error(`stuck without pausing: ${label()}`)
      count++
    }
    expect(count).toBe(24630 * 8)
  })

  it("resuming lifts the pause and leaves the plan scheduling exactly as if it had budget", () => {
    let count = 0
    for (const p of budgeted()) {
      if (!p.paused) continue
      const unlimited = toStart(flush(p)).join(",")
      for (const add of [0.01, 5, 20]) {
        // resumePlan writes only `limits` and `paused`.
        const d = { ...p, limits: { ...p.limits } }
        resumePlan(d, add)
        const broken =
          d.paused !== null ? "still paused"
          : Math.abs(d.limits.cost - (p.usage.cost + add)) > 0.005 ? `limit ${d.limits.cost}`
          : overBudget(d) ? "still over budget"
          : toStart(d).join(",") !== unlimited ? `starts ${toStart(d)} not ${unlimited}`
          : null
        if (broken) throw new Error(`${broken} after +${add}: cost ${p.usage.cost}`)
        count++
      }
    }
    expect(count).toBe(24630 * 4 * 3)
  })

  it("refuses to resume with nothing", () => {
    for (const add of [0, -5, Number.NaN, "lots"]) expect(() => resumePlan(plan([step("a")]), add)).toThrow(/positive/)
  })

  it("names what has not started", () => {
    const p = plan([step("a", { status: STEP.done }), step("b"), step("c", { status: STEP.running }), step("d")])
    expect(notStarted(p).map((x) => x.id)).toEqual(["b", "d"])
  })
})

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

  it("and for every three-step plan whose done steps took their inputs at every version, current or not", () => {
    // Each done step's taken version of each dependency: the current one, one
    // behind, or one ahead (a version it cannot have seen; still not current).
    let count = 0
    for (const base of every(3, { wheres: ["worker"], limits: [[3, 1]] })) {
      for (const versions of product([0, 1, 2], 3)) {
        const withVersions = base.steps.map((s, i) => ({ ...s, version: versions[i] }))
        const done = withVersions.filter((s) => s.status === STEP.done && s.after.length)
        for (const offsets of product([0, -1, 1], done.length)) {
          const steps = withVersions.map((s) => {
            const at = done.findIndex((d) => d.id === s.id)
            if (at < 0) return s
            const byId = new Map(withVersions.map((x) => [x.id, x]))
            return { ...s, inputs: Object.fromEntries(s.after.map((d, k) => [d, byId.get(d).version + (k === 0 ? offsets[at] : 0)])) }
          })
          const p = { ...base, steps }
          const broken = checkInvariants(p)
          if (broken) throw new Error(`${broken}\n${JSON.stringify(steps.map(({ id, after, status, version, inputs }) => ({ id, after, status, version, inputs })))}`)
          count++
        }
      }
    }
    expect(count).toBe(42120)
  })

  it("starts nothing in a plan that is not running, or that has spent its budget", () => {
    const steps = [step("a")]
    expect(toStart(plan(steps, { status: PLAN.stopped }))).toEqual([])
    expect(toStart(plan(steps, { status: PLAN.done }))).toEqual([])
    expect(toStart(plan(steps, { usage: { in: 0, out: 0, cost: DEFAULT_LIMITS.cost } }))).toEqual([])
    expect(toStart(plan(steps, { paused: { reason: "budget", at: 1, spent: 1, limit: 1 } }))).toEqual([])
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

  it("accepts a step on one that failed: it is blocked until that one is reopened", () => {
    expect(validateSteps(base, [step("b", { after: ["x"] })])).toEqual([])
    const p = plan([...base.steps, step("b", { after: ["x"] })])
    expect(states(p).get("b")).toBe(STATE.blocked)
  })

  it.each([
    [[step("a")], /already used/],
    [[step("b"), step("b")], /already used/],
    [[step("b", { after: ["nope"] })], /not a step/],
    [[step("bad id!")], /id must be/],
    [[step("b", { where: "cloud" })], /'where' must be/],
    [[step("b", { tier: "huge" })], /'tier' must be/],
    [[step("b", { why: "" })], /'why' is required/],
    [[step("b", { prompt: " " })], /'prompt' is required/],
    [[step("b", { after: ["c"] }), step("c", { after: ["b"] })], /in a circle: (b → c → b|c → b → c)/],
    [[], /at least one/],
    [[step("b", { tools: "doc_read" })], /'tools' must be a list of tool ids/],
    [[step("b", { tools: ["doc_read", ""] })], /'tools' must be a list of tool ids/],
    [[step("b", { tools: ["doc read"] })], /'tools' must be a list of tool ids/],
    [[step("b", { subject: "report.md" })], /'subject' must be a document's automerge: URL/],
    [[step("b", { subject: "automerge:abc", access: "web" })], /a research step has no document of the person's/],
  ])("refuses %j", (steps, message) => {
    expect(validateSteps(base, steps).join("\n")).toMatch(message)
  })

  it("enforces the step limit", () => {
    const small = plan([step("a")], { limits: { ...DEFAULT_LIMITS, steps: 2 } })
    expect(validateSteps(small, [step("b")])).toEqual([])
    expect(validateSteps(small, [step("b"), step("c")]).join()).toMatch(/allows 2/)
  })
})

describe("a step's tools", () => {
  it("are kept as listed, once each, and left out when none are", () => {
    expect(newStep(step("a", { tools: ["doc_read", "assumptions_set", "doc_read"] })).tools).toEqual(["doc_read", "assumptions_set"])
    expect("tools" in newStep(step("a"))).toBe(false)
    expect("tools" in newStep(step("a", { tools: [] }))).toBe(false)
    expect(validateSteps(plan([]), [step("a", { tools: ["doc_read", "agent:x.y-z"] })])).toEqual([])
  })

  it("can be set, changed and cleared on a step that has not started", () => {
    expect(EDITABLE).toContain("tools")
    const doc = plan([step("a")])
    editSteps(doc, [{ id: "a", tools: ["view_mount"] }])
    expect(doc.steps[0].tools).toEqual(["view_mount"])
    editSteps(doc, [{ id: "a", tools: [] }])
    expect("tools" in doc.steps[0]).toBe(false)
    expect(editErrors(doc, [{ id: "a", tools: [3] }]).join()).toMatch(/'tools' must be/)
  })
})

describe("a step's main document", () => {
  it("is kept on the step, and can be set, changed and cleared before it starts", () => {
    expect(newStep(step("a", { subject: "automerge:abc" })).subject).toBe("automerge:abc")
    expect("subject" in newStep(step("a"))).toBe(false)
    const doc = plan([step("a")])
    editSteps(doc, [{ id: "a", subject: "automerge:def" }])
    expect(doc.steps[0].subject).toBe("automerge:def")
    editSteps(doc, [{ id: "a", subject: "" }])
    expect("subject" in doc.steps[0]).toBe(false)
    // Made a research step while it has one: refused, whichever field changes.
    editSteps(doc, [{ id: "a", subject: "automerge:def" }])
    expect(editErrors(doc, [{ id: "a", access: "web" }]).join()).toMatch(/takes no 'subject'/)
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

describe("a step told to report a missing tool", () => {
  it.each([["a full step", {}], ["a research step", { access: "web" }]])("%s reports it and does not search for it", (name, over) => {
    const p = plan([step("a", over)], { title: "W", goal: "G" })
    const text = stepPrompt(p, p.steps[0])
    expect(text).toContain(MISSING_TOOL_GUIDANCE)
    expect(MISSING_TOOL_GUIDANCE).toMatch(/say so in your result.*Do not search documents or code for it/s)
    // web_capture is offered wherever the package is installed, worker or tab.
    expect(text).not.toMatch(/runs in a tab/)
  })
})

describe("reopening, as a change to the plan", () => {
  it("a step cancelled before it began starts fresh, told why", () => {
    const p = plan([step("a", { status: STEP.cancelled })], { status: PLAN.stopped })
    reopenSteps(p, ["a"], { note: "Needed after all.", now: 5 })
    expect(p.steps[0]).toMatchObject({ status: STEP.pending, reopen: { note: "Needed after all.", at: 5, by: "orchestrator" } })
    expect(p.status).toBe(PLAN.running)
    expect(stepPrompt(p, p.steps[0])).toContain("## Note\n\nNeeded after all.")
  })

  it("cascades through done and running steps, stopping at failed and cancelled ones, and says which to interrupt", () => {
    const p = plan([
      step("a", { status: STEP.done, version: 1 }),
      step("b", { status: STEP.running, after: ["a"], sessionUrl: "automerge:b" }),
      step("c", { status: STEP.done, after: ["b"] }),
      step("d", { status: STEP.cancelled, after: ["a"] }),
      step("e", { status: STEP.done, after: ["d"] }),
      step("f", { status: STEP.pending, after: ["a"] }),
      step("g", { status: STEP.done, after: ["f"] }),
    ])
    const { reopened, interrupt } = reopenSteps(p, ["a"], { note: "x", cascade: true })
    // Through a pending step too: g was built on f, which waits on a.
    expect([...reopened].sort()).toEqual(["a", "b", "c", "g"])
    expect(interrupt).toEqual(["automerge:b"])
    expect(p.steps.find((s) => s.id === "d").status).toBe(STEP.cancelled)
    expect(p.steps.find((s) => s.id === "e").status).toBe(STEP.done)
  })

  it("refuses running and pending steps, and changes nothing", () => {
    const p = plan([step("a", { status: STEP.running }), step("b"), step("c", { status: STEP.done })])
    const before = JSON.stringify(p)
    expect(() => reopenSteps(p, ["c", "a"], { note: "x" })).toThrow(/'a' is running/)
    expect(() => reopenSteps(p, ["b"], { note: "x" })).toThrow(/'b' has not started yet/)
    expect(JSON.stringify(p)).toBe(before)
  })

  it("the continuing message says what it was and hands the inputs as they stand", () => {
    const p = plan([step("a", { status: STEP.done, result: "A v2" }), step("b", { status: STEP.failed, after: ["a"] })])
    reopenSteps(p, ["b"], { note: "Try the other API." })
    const text = reopenPrompt(p, p.steps[1])
    expect(text).toMatch(/^\[Your step has been reopened\. It failed before/)
    expect(text).toContain("Try the other API.")
    expect(text).toContain("A v2")
  })
})
