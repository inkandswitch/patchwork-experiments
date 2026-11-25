/**
 * A step's session says where its step stands, and what a message to it does
 * follows from that (workflow/standing.js, workflow/aside.js):
 *
 *   - a message goes straight in exactly when the step is running;
 *   - otherwise it is a question, asked in a side thread, or a reopening,
 *     offered exactly when the plan would accept one — and "with the steps
 *     after" reopens exactly what reopenSteps with cascade reopens;
 *   - a side thread is a copy of the step's session that is not a step: the
 *     driver never reads it, it keeps the step's confinement and permissions,
 *     and the step's own conversation is untouched by it.
 */
import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, STATUS } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { unansweredCalls } from "../session/calls.js"
import { STEP, STATE, PLAN, reopenErrors, reopenSteps, states } from "../workflow/plan.js"
import { stepStanding, laterReopened, planGlance, glanceText } from "../workflow/standing.js"
import { askAside, asideOf, makeAside, reusableAside, NOT_IN_ASIDE, ASIDE_NOTE } from "../workflow/aside.js"
import { sessionOutcome } from "../workflow/driver.js"
import { webScope } from "../kernel/scope.js"
import { SCOPED_TOOL_IDS, researchToolset } from "../fixtures/tool-ids.js"
import { statusOf } from "../session/status.js"

await initSubduction()

const ALL = [STEP.pending, STEP.running, STEP.done, STEP.failed, STEP.cancelled]

/** a → b → c, with b's status and the others' chosen. */
function chain(a, b, c, { reopened = false, planStatus = PLAN.running } = {}) {
  const step = (id, status, after) => ({ id, title: id.toUpperCase(), status, after, version: status === STEP.done ? 1 : 0, inputs: Object.fromEntries(after.map((x) => [x, 1])), sessionUrl: status === STEP.pending && !reopened ? null : `automerge:${id}` })
  const plan = { title: "Plan", status: planStatus, steps: [step("a", a, []), step("b", b, ["a"]), step("c", c, ["b"])] }
  if (reopened) plan.steps[1].reopen = { note: "again", at: 0, by: "person" }
  return plan
}

describe("what a message to a step does, over every combination of three chained steps", () => {
  const cases = []
  for (const a of ALL) for (const b of ALL) for (const c of ALL) for (const reopened of [false, true]) for (const planStatus of Object.values(PLAN)) cases.push(chain(a, b, c, { reopened, planStatus }))

  it(`goes straight in exactly when the step is running (${cases.length} plans)`, () => {
    for (const plan of cases) for (const step of plan.steps) expect(stepStanding(plan, step.id).steer).toBe(step.status === STEP.running)
  })

  it("offers reopening exactly when the plan would take it", () => {
    for (const plan of cases) {
      for (const step of plan.steps) {
        const s = stepStanding(plan, step.id)
        expect(s.reopen).toBe(!s.steer && reopenErrors(plan, [step.id]).length === 0)
      }
    }
  })

  it("'with the steps after' names exactly what a cascading reopen reopens, and leaves the plan alone", () => {
    for (const plan of cases) {
      for (const step of plan.steps) {
        const before = JSON.stringify(plan)
        const s = stepStanding(plan, step.id)
        expect(JSON.stringify(plan)).toBe(before)
        if (!s.reopen) {
          expect(s.later).toEqual([])
          continue
        }
        const copy = JSON.parse(before)
        const { reopened } = reopenSteps(copy, [step.id], { note: "x", cascade: true, now: 0 })
        expect([step.id, ...s.later].sort()).toEqual([...reopened].sort())
      }
    }
  })

  it("says the step's derived state, and the plan's when it is not simply running", () => {
    for (const plan of cases) {
      const derived = states(plan)
      for (const step of plan.steps) {
        const s = stepStanding(plan, step.id)
        expect(s.state).toBe(derived.get(step.id))
        expect(typeof s.label).toBe("string")
        expect(s.plan === null).toBe(plan.status === PLAN.running && !plan.paused)
      }
    }
  })

  it("explains each state that has a reason", () => {
    for (const plan of cases) {
      const derived = states(plan)
      for (const step of plan.steps) {
        const s = stepStanding(plan, step.id)
        if ([STATE.waiting, STATE.blocked, STATE.stale].includes(derived.get(step.id))) expect(s.detail, `${step.id} ${derived.get(step.id)}`).toMatch(/\w/)
      }
    }
  })
})

describe("what a step's line says", () => {
  it("a done step names who uses its result; a stale one names what changed", () => {
    const plan = chain(STEP.done, STEP.done, STEP.done)
    expect(stepStanding(plan, "b").detail).toBe("its result is used by 1 step")
    plan.steps[0].version = 2
    expect(stepStanding(plan, "b")).toMatchObject({ state: STATE.stale, label: "out of date", detail: "A changed since it finished" })
  })

  it("a reopened step waiting on another says so, and counts its runs", () => {
    const plan = chain(STEP.running, STEP.pending, STEP.pending, { reopened: true })
    plan.steps[1].previous = [{ status: STEP.done }]
    expect(stepStanding(plan, "b")).toMatchObject({ state: STATE.waiting, detail: "reopened; waits for A", run: 2, steer: false, reopen: false })
  })

  it("a step whose session waits on a person needs them", () => {
    const plan = chain(STEP.running, STEP.pending, STEP.pending)
    expect(stepStanding(plan, "a", { "automerge:a": STATUS.awaitingApproval })).toMatchObject({ state: STATE.needsInput, label: "needs you", steer: true })
  })

  it("a step that is no longer in its plan can only be asked about", () => {
    expect(stepStanding(chain(STEP.done, STEP.done, STEP.done), "gone")).toMatchObject({ steer: false, reopen: false, later: [] })
  })

  it("the orchestrator's glance counts the steps", () => {
    const plan = chain(STEP.done, STEP.running, STEP.pending)
    plan.requests = [{ status: "open" }]
    expect(glanceText(planGlance(plan))).toBe("running · 1 of 3 done · 1 running · 1 request to decide")
  })
})

// ------------------------------------------------------------ side threads

async function stepSession(repo, { scoped = false } = {}) {
  const handle = await repo.create2()
  handle.change((d) => {
    initSession(d, { title: "Plan · B", config: { model: "m", budget: { cost: 1 } } })
    d.workflow = { planUrl: "automerge:2ZB7EhdqPcSAApFM3bwf7gNxh7fv", stepId: "b", orchestratorUrl: null }
    d.grants = { "web:*": "session" }
    d.tools = { disabled: ["workflow_start"] }
    if (scoped) d.scope = webScope("automerge:2ZB7EhdqPcSAApFM3bwf7gNxh7fv", "b")
    d.turns.push(makeTurn("user", [textBlock("Find the rig loads.")]))
    d.turns.push(makeTurn("assistant", [textBlock("Working."), callBlock("web_fetch", { url: "https://x" }, { id: "c1", status: CALL.running })]))
    d.lease = { runner: "tab-x", at: 1, generation: 3 }
    d.reconnecting = { reason: "offline", since: 1, attempts: 1 }
  })
  return handle
}

describe("a question in a side thread", () => {
  it("is asked of a copy that is no longer a step, and the step is untouched but for a pointer to it", async () => {
    const repo = new Repo({ network: [] })
    const step = await stepSession(repo, { scoped: true })
    const turnsBefore = JSON.stringify(step.doc().turns)

    const url = await askAside(repo, step, "Why 12 kN?", { now: 5 })
    const aside = (await repo.find(url)).doc()

    expect(JSON.stringify(step.doc().turns)).toBe(turnsBefore)
    expect(step.doc().asides).toEqual([{ url, at: 5, turns: 2 }])
    expect(asideOf(aside)).toEqual({ sessionUrl: step.url, planUrl: "automerge:2ZB7EhdqPcSAApFM3bwf7gNxh7fv", stepId: "b" })
    expect(aside.workflow).toBeUndefined()
    expect(aside.asides).toBeUndefined()
    // What it may do and reach is the step's, confinement included.
    expect(aside.scope).toEqual(step.doc().scope)
    expect(aside.grants).toEqual(step.doc().grants)
    expect(aside.tools).toEqual(step.doc().tools)
    // What was mid-flight is settled, and it starts with nothing spent and no step budget.
    expect(aside.lease).toBeNull()
    expect(aside.reconnecting ?? null).toBeNull()
    expect(aside.config.budget).toBeUndefined()
    expect(aside.config.workflows).toEqual({ enabled: false })
    expect(aside.usage).toEqual({ in: 0, out: 0, turns: 0 })
    expect(unansweredCalls(aside)).toEqual([])
    expect(JSON.stringify(aside.turns.at(-2))).toContain(NOT_IN_ASIDE)
    // The question is the last word, so a runner takes it up.
    expect(aside.turns.at(-1)).toMatchObject({ role: "user" })
    expect(aside.turns.at(-1).blocks.map((b) => b.text)).toEqual([ASIDE_NOTE, "Why 12 kN?"])
    expect(statusOf(aside)).toBe(STATUS.idle)
  })

  it("is never read as the step's work: a finished side thread is not a step outcome the driver could take", async () => {
    const repo = new Repo({ network: [] })
    const step = await stepSession(repo)
    const aside = (await repo.find(await askAside(repo, step, "Why?"))).doc()
    // The driver reads only the session a step names; and this one names no step.
    expect(aside.workflow).toBeUndefined()
    expect(sessionOutcome(step.doc()).state).not.toBe("done")
  })

  it("continues the same thread while the step stands still, and copies afresh once it has moved", async () => {
    const repo = new Repo({ network: [] })
    const step = await stepSession(repo)
    const first = await askAside(repo, step, "One?")
    expect(await askAside(repo, step, "Two?")).toBe(first)
    // Told once, when the thread is made; not again with each question.
    expect((await repo.find(first)).doc().turns.at(-1).blocks.map((b) => b.text)).toEqual(["Two?"])
    expect((await repo.find(first)).doc().turns.filter((t) => t.role === "user").map((t) => t.blocks.at(-1).text).slice(-2)).toEqual(["One?", "Two?"])

    step.change((d) => d.turns.push(makeTurn("assistant", [textBlock("Revised.")])))
    expect(reusableAside(step.doc())).toBeNull()
    const second = await askAside(repo, step, "Three?")
    expect(second).not.toBe(first)
    expect(step.doc().asides.map((a) => a.url)).toEqual([first, second])
  })

  it("makeAside on a session with nothing open adds no tool turn", () => {
    const doc = {}
    initSession(doc, {})
    doc.workflow = { planUrl: "automerge:p", stepId: "s" }
    doc.turns.push(makeTurn("user", [textBlock("hi")]))
    makeAside(doc, { sessionUrl: "automerge:s", now: 1 })
    expect(doc.turns.length).toBe(1)
  })
})

describe("a confined session that is not a step", () => {
  it("has the research tools but not the ones for asking an orchestrator", async () => {
    expect((await researchToolset()).tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
    const ids = (await researchToolset({ step: false })).tools.map((t) => t.id)
    expect(ids).toEqual(SCOPED_TOOL_IDS.filter((id) => id !== "workflow_request"))
  })
})
