import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initPlan, PLAN, STEP, DEFAULT_TIER_MODELS, WORKFLOW_TOOL_IDS } from "./workflow/plan.js"
import { WorkflowDriver, sessionOutcome, describeProgress, _resetDrivers } from "./workflow/driver.js"
import { initSession, makeTurn, textBlock, STATUS, CALL } from "./session.js"
import { buildToolset, BUILTIN_TOOLS } from "./tools/index.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/**
 * A stand-in for running a step's session: it reads the step it was given and
 * answers, or fails, the way a real runner would leave the document.
 */
function fakeRunner(behaviour = {}) {
  const started = []
  const interrupted = []
  const startSession = async (handle) => {
    const doc = handle.doc()
    const id = doc.workflow?.stepId
    if (!started.includes(handle.url)) {
      started.push(handle.url)
      const act = behaviour[id] ?? "answer"
      if (act === "answer") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [textBlock(`result of ${id}`)]))
          d.status = STATUS.idle
          d.usage = { in: 100, out: 10, turns: 1 }
        })
      } else if (act === "fail") {
        handle.change((d) => { d.status = STATUS.error })
      } else if (act === "ask") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "http_request", input: {}, status: CALL.pending }]))
          d.status = STATUS.awaitingApproval
        })
      } // "hang": leave it running
    }
    return { runner: { interrupt: () => interrupted.push(id) }, listen: () => {} }
  }
  return { startSession, started, interrupted }
}

async function setup(steps, { behaviour = {}, limits = {}, grants = {} } = {}) {
  const repo = new Repo({ network: [] })
  const orchestrator = repo.create({})
  orchestrator.change((d) => {
    initSession(d, { config: { model: "x", params: { maxTokens: 4000 } } })
    d.grants = grants
  })
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "W", goal: "G", subject: "automerge:subj", sessionUrl: orchestrator.url, limits, steps }))
  const runner = fakeRunner(behaviour)
  const news = []
  const notify = () => ({ notify: (render) => news.push(render()), close: () => {} })
  const make = () => new WorkflowDriver({ repo, handle: plan, startSession: runner.startSession, notify, heartbeatMs: 1e9, toolIds: { worker: ["doc_read", "doc_edit"] } })
  return { repo, plan, orchestrator, runner, news, make }
}

/** Tick until nothing changes. */
async function settle(driver, rounds = 20) {
  for (let i = 0; i < rounds; i++) await driver.kick()
}

const drivers = []
const started = (driver) => { drivers.push(driver); driver.start(); return driver }
afterEach(() => { for (const d of drivers.splice(0)) d.stop(); _resetDrivers() })

describe("running a plan", () => {
  it("runs a chain in order, handing each step what the last one found", async () => {
    const { repo, plan, make } = await setup([step("a"), step("b", { after: ["a"] })])
    await settle(started(make()))

    const doc = plan.doc()
    expect(doc.steps.map((s) => s.status)).toEqual([STEP.done, STEP.done])
    expect(doc.steps.map((s) => s.result)).toEqual(["result of a", "result of b"])
    expect(doc.status).toBe(PLAN.done)
    const b = (await repo.find(doc.steps[1].sessionUrl)).doc()
    expect(b.turns[0].blocks[0].text).toContain("### Step a (a)\nresult of a")
  })

  it("gives each step its tier's model, its tools, and the orchestrator's grants", async () => {
    const { repo, plan, make } = await setup(
      [step("w", { tier: "deep", behaviour: "hang" }), step("h", { where: "host", tier: "standard" })],
      { behaviour: { w: "hang", h: "hang" }, grants: { "files@*": "session" } }
    )
    await settle(started(make()))
    const [w, h] = await Promise.all(plan.doc().steps.map(async (s) => (await repo.find(s.sessionUrl)).doc()))

    expect(w.config.model).toBe(DEFAULT_TIER_MODELS.deep)
    expect(h.config.model).toBe(DEFAULT_TIER_MODELS.standard)
    expect(w.config.params.maxTokens).toBe(4000)
    expect(w.tools).toEqual({ enabled: ["doc_read", "doc_edit"] })
    expect(h.tools).toEqual({ disabled: WORKFLOW_TOOL_IDS })
    expect(w.grants).toEqual({ "files@*": "session" })
    expect(w.subject).toBe("automerge:subj")
    expect(w.workflow).toEqual({ planUrl: plan.url, stepId: "w", orchestratorUrl: expect.any(String) })
    expect(w["@patchwork"]).toEqual({ type: "agent-session" })
  })

  it("never runs more at once than the limit", async () => {
    const { plan, make } = await setup([step("a"), step("b"), step("c")], { behaviour: { a: "hang", b: "hang", c: "hang" }, limits: { parallel: 2 } })
    await settle(started(make()))
    expect(plan.doc().steps.map((s) => s.status)).toEqual([STEP.running, STEP.running, STEP.pending])
  })

  it("a failure blocks what depends on it, and the rest still runs", async () => {
    const { plan, make } = await setup([step("a"), step("b", { after: ["a"] }), step("c")], { behaviour: { a: "fail" } })
    await settle(started(make()))
    const doc = plan.doc()
    expect(doc.steps.map((s) => s.status)).toEqual([STEP.failed, STEP.pending, STEP.done])
    expect(doc.steps[0].error).toMatch(/error/)
    expect(doc.status).toBe(PLAN.done) // settled: b can never run
  })

  it("adds up what the steps cost", async () => {
    const { plan, make } = await setup([step("a"), step("b")])
    await settle(started(make()))
    expect(plan.doc().usage).toEqual({ in: 200, out: 20 })
  })
})

describe("one plan, two tabs", () => {
  it("only the driver holding the plan starts steps: each step gets exactly one session", async () => {
    const { plan, runner, make } = await setup([step("a"), step("b"), step("c", { after: ["a", "b"] })])
    const first = started(make())
    const second = started(make())
    await Promise.all([settle(first), settle(second)])
    expect(plan.doc().steps.every((s) => s.status === STEP.done)).toBe(true)
    expect(runner.started).toHaveLength(3)
    expect(new Set(plan.doc().steps.map((s) => s.sessionUrl)).size).toBe(3)
  })
})

describe("after a reload", () => {
  it("a new driver picks the plan up: running steps get their runners back", async () => {
    const { plan, runner, make } = await setup([step("a")], { behaviour: { a: "hang" } })
    const before = started(make())
    await settle(before)
    before.stop()
    plan.change((d) => { d.lease.at = 0 }) // the old tab's lease has gone stale

    runner.started.length = 0
    await settle(started(make()))
    expect(runner.started).toEqual([plan.doc().steps[0].sessionUrl])
    expect(plan.doc().steps[0].status).toBe(STEP.running) // the same session, not a new one
  })
})

describe("stopping", () => {
  it("cancels what has not finished and interrupts what is running", async () => {
    const { plan, runner, make } = await setup([step("a"), step("b"), step("c", { after: ["a"] })], { behaviour: { b: "hang" } })
    const driver = started(make())
    await settle(driver)
    await driver.cancel()
    expect(plan.doc().steps.map((s) => s.status)).toEqual([STEP.done, STEP.cancelled, STEP.done])
    expect(runner.interrupted).toEqual(["b"])
    expect(plan.doc().status).toBe(PLAN.stopped)
  })
})

describe("telling the orchestrator", () => {
  it("reports each finished step once, and says when it is over", async () => {
    const { news, make } = await setup([step("a"), step("b", { after: ["a"] })])
    await settle(started(make()))
    const all = news.join("\n")
    expect(all.match(/## Done: Step a/g)).toHaveLength(1)
    expect(all.match(/## Done: Step b/g)).toHaveLength(1)
    expect(news.at(-1)).toMatch(/The workflow is over/)
  })

  it("describes a step waiting on a person as running, and says how to continue", () => {
    const text = describeProgress({ title: "W", status: PLAN.running, steps: [step("a", { status: STEP.done, result: "r" })] }, [])
    expect(text).toMatch(/1 done/)
    expect(text).toMatch(/workflow_add_steps/)
  })
})

describe("sessionOutcome", () => {
  const session = (over) => {
    const doc = {}
    initSession(doc, {})
    Object.assign(doc, over)
    return doc
  }
  it.each([
    ["just created", session({ turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["thinking", session({ status: STATUS.running, turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["waiting on a person", session({ status: STATUS.awaitingApproval, turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["answered", session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("done it")])] }), "done"],
    ["broke", session({ status: STATUS.error }), "failed"],
  ])("%s → %s", (_name, doc, state) => {
    expect(sessionOutcome(doc).state).toBe(state)
  })

  it("the result is the last thing it said", () => {
    const doc = session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("first"), textBlock("second")])] })
    expect(sessionOutcome(doc).result).toBe("first\nsecond")
  })
})

describe("which tools a session gets", () => {
  const ids = async (doc) => (await buildToolset(doc, { skipPlugins: true })).tools.map((t) => t.id)

  it("no workflow tools unless the session's switch is on", async () => {
    expect(await ids({ config: {} })).not.toContain("workflow_start")
    expect(await ids({ config: { workflows: { enabled: true } } })).toEqual(expect.arrayContaining(WORKFLOW_TOOL_IDS))
  })

  it("a step never gets them, even with the switch on", async () => {
    expect(await ids({ config: { workflows: { enabled: true } }, tools: { disabled: WORKFLOW_TOOL_IDS } })).not.toContain("workflow_start")
  })

  it("a worker step gets only tools that run without the page", async () => {
    const worker = BUILTIN_TOOLS.filter((t) => t.where === "worker" && !WORKFLOW_TOOL_IDS.includes(t.id)).map((t) => t.id)
    const got = await ids({ config: {}, tools: { enabled: worker } })
    expect(got.every((id) => BUILTIN_TOOLS.find((t) => t.id === id).where === "worker")).toBe(true)
    expect(got).toContain("doc_edit")
    expect(got).not.toContain("view_mount")
  })
})
