/**
 * A workflow's graph changes as the work goes: closed steps reopen, the
 * dependencies of steps not yet started are edited, and steps ask for more.
 * Real sessions, real runners and a real driver; only the models are scripted.
 *
 * What must hold:
 *   - a reopened step — done, failed or cancelled — continues in its own
 *     session, told why and handed its inputs as they now stand, and its new
 *     result replaces the old, which is kept in `previous`;
 *   - with cascade, what was built on it is reopened too and revised in order;
 *     without, it is out of date once the reopened step finishes, what waits on
 *     it is held, and keeping it releases them;
 *   - a step's request reaches the plan, holds the workflow open, and changes
 *     the plan only when the orchestrator accepts it;
 *   - a halted session is never taken up again until it is continued.
 */
import { describe, it, expect, afterEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner, needsWork } from "./kernel/runner.js"
import { handleStore } from "./kernel/store.js"
import { buildToolset } from "./tools/index.js"
import { initSession, STATUS } from "./session/schema.js"
import { makeTurn, textBlock } from "./session/blocks.js"
import { PLAN, STEP, STATE, initPlan, states, STEP_TOOL_IDS } from "./workflow/plan.js"
import { ensureDriver, _resetDrivers, describeProgress } from "./workflow/driver.js"
import { workflowReopen, workflowKeep, workflowEditSteps, workflowDecide, workflowAddSteps, workflowRequest } from "./workflow/tools.js"

await initSubduction()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(20)
  }
  return false
}

/** A model that plays one entry per request: events, an Error to throw, or a function of the request giving events. */
function scripted(entries) {
  let i = 0
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const entry = entries[Math.min(i++, entries.length - 1)]
      const events = typeof entry === "function" ? entry(request) : entry
      if (events instanceof Error) throw events
      for (const e of events) yield e
      if (!events.some((e) => e.type === "stop")) yield { type: "stop", reason: events.some((e) => e.type === "call") ? "tool_use" : "end" }
    },
  }
}
const say = (text) => [{ type: "text", delta: text }]
const lastUser = (request) => JSON.stringify(request.messages.filter((m) => m.role === "user").at(-1))

const runners = []
afterEach(() => {
  for (const r of runners.splice(0)) r.stop()
  _resetDrivers()
})

const step = (id, over = {}) => ({ id, title: id.toUpperCase(), prompt: `Do ${id}.`, where: "worker", tier: "fast", why: "test", ...over })

/** A plan driven here, its steps run on `models[stepId]`. */
async function workflow(steps, models) {
  const repo = new Repo({ network: [] })
  const startSession = async (handle) => {
    const id = handle.doc().workflow.stepId
    const runner = new SessionRunner({
      store: handleStore(handle, A.splice),
      ctx: { repo, sessionUrl: handle.url },
      buildToolset: (doc) => buildToolset(doc, { skipPlugins: true }),
      getProvider: async () => models[id],
      getKey: () => "test",
      canRun: () => true,
      confirmMs: 0,
    })
    handle.on("change", () => runner.tick())
    runner.start()
    runners.push(runner)
    return { runner, listen: () => {} }
  }
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "W", goal: "G", steps }))
  await ensureDriver(plan.url, { repo, startSession, confirmMs: 0, settleMs: 10, heartbeatMs: 200 })
  const ctx = { workflows: { repo, startSession }, events: null }
  const run = (tool, input) => tool.execute({ plan: plan.url, ...input }, ctx)
  const at = (id) => plan.doc().steps.find((s) => s.id === id)
  const sessionOf = async (id) => (await repo.find(at(id).sessionUrl)).doc()
  return { repo, plan, run, at, sessionOf, derived: () => states(plan.doc()) }
}

describe("reopening", () => {
  it("resumes a failed step in its own session, and what was held behind it runs", async () => {
    const a = scripted([new Error("OpenRouter 400: the model refused the request"), (r) => say(lastUser(r).includes("use the smaller model") ? "A, second try" : "wrong")])
    const b = scripted([(r) => say(JSON.stringify(r.messages).includes("A, second try") ? "B built on A" : "B without A")])
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { a, b })

    expect(await until(() => w.at("a").status === STEP.failed)).toBe(true)
    expect(w.derived().get("b")).toBe(STATE.blocked)
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)
    const session = w.at("a").sessionUrl

    await w.run(workflowReopen, { steps: ["a"], note: "It failed on the request: use the smaller model.", cascade: false })
    expect(await until(() => w.plan.doc().status === PLAN.done && w.at("b").status === STEP.done)).toBe(true)

    expect(w.at("a")).toMatchObject({ status: STEP.done, result: "A, second try", sessionUrl: session, version: 1, reopen: null })
    expect(w.at("a").previous.map((p) => p.status)).toEqual([STEP.failed])
    expect(w.at("b").result).toBe("B built on A")
    // One session, both runs in it: the failure, then the reopen message.
    const turns = (await w.sessionOf("a")).turns
    expect(String(turns.at(-2).blocks[0].text)).toMatch(/^\[Your step has been reopened\. It failed before/)
  }, 20000)

  it("resumes a cancelled step, which a late result could not wake meanwhile", async () => {
    let release
    const gate = new Promise((r) => (release = r))
    const a = scripted([
      [{ type: "call", id: "slow", name: "skill_list", input: {} }],
      say("A finished after all"),
    ])
    // Hold the first model turn until the step has been cancelled.
    const held = {
      requests: a.requests,
      async *stream(request) {
        if (!a.requests.length) await gate
        yield* a.stream(request)
      },
    }
    const w = await workflow([step("a")], { a: held })
    expect(await until(() => w.at("a").status === STEP.running && w.at("a").sessionUrl)).toBe(true)
    await w.run((await import("./workflow/tools.js")).workflowStop, { steps: ["a"] })
    release()
    expect(w.at("a").status).toBe(STEP.cancelled)
    const halted = await w.sessionOf("a")
    expect(halted.halted?.reason).toMatch(/cancelled/)
    // Whatever landed after the stop, nothing is work for a runner now.
    await sleep(300)
    expect(needsWork(await w.sessionOf("a"))).toBe(false)

    await w.run(workflowReopen, { steps: ["a"], note: "Carry on.", cascade: false })
    expect(await until(() => w.at("a").status === STEP.done)).toBe(true)
    expect(w.at("a").previous.map((p) => p.status)).toEqual([STEP.cancelled])
    expect((await w.sessionOf("a")).halted).toBe(null)
  }, 20000)

  it("with cascade, revises everything built on it, in order", async () => {
    const version = (r, name) => (JSON.stringify(r.messages).match(new RegExp(`${name} v(\\d)`, "g")) ?? []).at(-1)
    const a = scripted([say("A v1"), say("A v2")])
    const b = scripted([(r) => say(`B v1 on ${version(r, "A")}`), (r) => say(`B v2 on ${version(r, "A")}`)])
    const c = scripted([(r) => say(`C v1 on ${version(r, "B")}`), (r) => say(`C v2 on ${version(r, "B")}`)])
    const w = await workflow([step("a"), step("b", { after: ["a"] }), step("c", { after: ["b"] })], { a, b, c })
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)
    expect(w.at("c").result).toBe("C v1 on B v1")

    const out = await w.run(workflowReopen, { steps: ["a"], note: "A source was withdrawn.", cascade: true })
    expect(out).toMatch(/and what is built on them: b, c/)
    expect(await until(() => w.plan.doc().status === PLAN.done && w.at("c").status === STEP.done)).toBe(true)
    expect([w.at("a").result, w.at("b").result, w.at("c").result]).toEqual(["A v2", "B v2 on A v2", "C v2 on B v2"])
    expect([...w.derived().values()]).toEqual([STATE.done, STATE.done, STATE.done])
    // Each was told why, the dependants by name of what changed.
    expect(lastUser(b.requests.at(-1))).toContain("'a', which this step is built on, was reopened (A source was withdrawn.)")
  }, 20000)

  it("without cascade, leaves what was built on it out of date, holds what waits on that, and keeping releases it", async () => {
    const a = scripted([say("A v1"), say("A v2")])
    const b = scripted([say("B")])
    const c = scripted([say("C")])
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { a, b, c })
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)

    await w.run(workflowReopen, { steps: ["a"], note: "Recheck.", cascade: false })
    // Built on a step that is not done: out of date at once, and still while it reruns.
    expect(w.derived().get("b")).toBe(STATE.stale)
    expect(await until(() => w.at("a").status === STEP.done && w.at("a").version === 2)).toBe(true)
    expect(w.derived().get("b")).toBe(STATE.stale)

    // A step added after it waits, held, and the orchestrator hears why.
    await w.run(workflowAddSteps, { steps: [step("c", { after: ["b"] })] })
    await sleep(200)
    expect(w.derived().get("c")).toBe(STATE.blocked)
    expect(w.at("c").status).toBe(STEP.pending)
    expect(describeProgress(w.plan.doc(), [], [], [], { stale: [w.at("b")] })).toMatch(/## Out of date: B \(b\)\nIt was built on A \(a\)/)

    await w.run(workflowKeep, { steps: ["b"] })
    expect(w.derived().get("b")).toBe(STATE.done)
    expect(await until(() => w.at("c").status === STEP.done && w.plan.doc().status === PLAN.done)).toBe(true)
    expect(b.requests).toHaveLength(1)
  }, 20000)

  it("refuses what cannot be reopened, kept or edited, and changes nothing", async () => {
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { a: scripted([say("A")]), b: scripted([say("B")]) })
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)
    const before = JSON.stringify(w.plan.doc().steps)
    await expect(w.run(workflowReopen, { steps: ["nope"], note: "x", cascade: false })).rejects.toThrow(/No step 'nope'/)
    await expect(w.run(workflowReopen, { steps: ["a"], note: "x" })).rejects.toThrow(/Say `cascade`/)
    await expect(w.run(workflowReopen, { steps: ["a"], note: " ", cascade: true })).rejects.toThrow(/Give a `note`/)
    await expect(w.run(workflowKeep, { steps: ["b"] })).rejects.toThrow(/up to date; there is nothing to keep/)
    await expect(w.run(workflowEditSteps, { steps: [{ id: "a", after: ["b"] }] })).rejects.toThrow(/only a step that has not started/)
    expect(JSON.stringify(w.plan.doc().steps)).toBe(before)
  }, 20000)
})

describe("editing what waits", () => {
  it("rewires a pending step to wait on one added since, and refuses a circle", async () => {
    let release
    const gate = new Promise((r) => (release = r))
    const a = { requests: [], async *stream() { await gate; yield* say("A"); yield { type: "stop", reason: "end" } } }
    const w = await workflow([step("a"), step("b", { after: ["a"] })], { a, b: scripted([(r) => say(JSON.stringify(r.messages).includes("X found") ? "B saw X" : "B without X")]), x: scripted([say("X found")]) })
    await w.run(workflowAddSteps, { steps: [step("x")] })
    await expect(w.run(workflowEditSteps, { steps: [{ id: "b", after: ["a", "b"] }] })).rejects.toThrow(/cannot depend on itself/)
    await w.run(workflowEditSteps, { steps: [{ id: "b", after: ["a", "x"] }] })
    release()
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)
    expect(w.at("b").result).toBe("B saw X")
  }, 20000)
})

describe("a step's requests", () => {
  const ask = (input) => [{ type: "call", id: `ask-${Math.random().toString(36).slice(2, 6)}`, name: "workflow_request", input }]

  it("reach the plan, hold the workflow open, and change it only when accepted", async () => {
    const a = scripted([ask({ why: "Found a second supplier.", add_steps: [step("s2", { prompt: "Check the second supplier." })] }), say("A done")])
    const w = await workflow([step("a")], { a, s2: scripted([say("S2 checked")]) })

    expect(await until(() => w.at("a").status === STEP.done && (w.plan.doc().requests ?? []).length === 1)).toBe(true)
    await sleep(200)
    const [request] = w.plan.doc().requests
    expect(request).toMatchObject({ stepId: "a", why: "Found a second supplier.", status: "open", reopen: null })
    // Nothing added on the step's word, and not finished while it waits.
    expect(w.plan.doc().steps.map((s) => s.id)).toEqual(["a"])
    expect(w.plan.doc().status).toBe(PLAN.running)
    expect(describeProgress(w.plan.doc(), [], [], [], { requests: [request] })).toContain(`workflow_decide { request: "${request.id}"`)

    await w.run(workflowDecide, { request: request.id, accept: true })
    expect(await until(() => w.at("s2")?.status === STEP.done && w.plan.doc().status === PLAN.done)).toBe(true)
    expect(w.plan.doc().requests[0].status).toBe("accepted")
    await expect(w.run(workflowDecide, { request: request.id, accept: true })).rejects.toThrow(/already accepted/)
  }, 20000)

  it("a declined one changes nothing but lets the workflow finish", async () => {
    const a = scripted([ask({ why: "B looks wrong.", reopen: ["b"] }), say("A done")])
    const w = await workflow([step("b"), step("a", { after: ["b"] })], { a, b: scripted([say("B")]) })
    expect(await until(() => (w.plan.doc().requests ?? []).length === 1 && w.at("a").status === STEP.done)).toBe(true)
    await expect(w.run(workflowDecide, { request: w.plan.doc().requests[0].id, accept: true })).rejects.toThrow(/say `cascade`/)
    await w.run(workflowDecide, { request: w.plan.doc().requests[0].id, accept: false, note: "B is fine." })
    expect(await until(() => w.plan.doc().status === PLAN.done)).toBe(true)
    expect(w.at("b").version).toBe(1)
    expect(w.plan.doc().requests[0]).toMatchObject({ status: "declined", note: "B is fine." })
  }, 20000)

  it("an accepted reopen tells the step what was found", async () => {
    const a = scripted([ask({ why: "B's figure is off by ten.", reopen: ["b"] }), say("A done")])
    const b = scripted([say("B v1"), (r) => say(lastUser(r).includes("off by ten") && lastUser(r).includes("Recheck the units") ? "B v2" : "B unaware")])
    const w = await workflow([step("b"), step("a", { after: ["b"] })], { a, b })
    expect(await until(() => (w.plan.doc().requests ?? []).length === 1 && w.at("a").status === STEP.done)).toBe(true)
    await w.run(workflowDecide, { request: w.plan.doc().requests[0].id, accept: true, cascade: false, note: "Recheck the units." })
    expect(await until(() => w.at("b").result === "B v2")).toBe(true)
    // a was built on B v1: out of date now, for the orchestrator to decide.
    expect(await until(() => w.derived().get("a") === STATE.stale)).toBe(true)
  }, 20000)

  it("is a tool only a step has, a research step included, and a malformed one is refused", async () => {
    const ids = async (doc) => (await buildToolset(doc, { skipPlugins: true })).tools.map((t) => t.id)
    expect(await ids({ config: { workflows: { enabled: true } } })).not.toContain("workflow_request")
    expect(await ids({ config: {}, workflow: { planUrl: "automerge:x", stepId: "a" } })).toEqual(expect.arrayContaining(STEP_TOOL_IDS))
    const { SCOPED_TOOL_IDS } = await import("./kernel/scope.js")
    expect(SCOPED_TOOL_IDS).toContain("workflow_request")
    await expect(workflowRequest.execute({ why: "" })).rejects.toThrow(/Say `why`/)
    await expect(workflowRequest.execute({ why: "x" })).rejects.toThrow(/`why` alone asks for nothing/)
    await expect(workflowRequest.execute({ why: "x", add_steps: [{ id: "bad id" }] })).rejects.toThrow(/id must be/)
    await expect(workflowRequest.execute({ why: "x", reopen: ["a"] })).resolves.toMatch(/orchestrator decides/)
  })
})

describe("a halted session", () => {
  it("is not work until it is spoken to", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("go")])]
    expect(needsWork(doc)).toBe(true)
    doc.halted = { reason: "cancelled", at: 1 }
    expect(needsWork(doc)).toBe(false)
    expect(doc.status).toBe(STATUS.idle)
  })
})
