/**
 * Steps that need someone: a question reaches the orchestrator, which can
 * answer it; a permission reaches the person, wherever they are looking.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner } from "./runner.js"
import { handleStore } from "./store.js"
import { createEvents } from "./events.js"
import { buildToolset } from "./tools/index.js"
import { makeMock } from "./providers/mock.js"
import { initSession, makeTurn, textBlock, callBlock, STATUS, CALL, _resetIds } from "./session.js"
import { initPlan, PLAN, STEP } from "./workflow/plan.js"
import { WorkflowDriver, describeProgress, _resetDrivers } from "./workflow/driver.js"
import { waitingIn } from "./workflow/waiting.js"
import { workflowAnswer } from "./tools/workflow.js"
import { watchWaiting, renderWaiting } from "./ui/waiting.js"
import { WorkflowView } from "./workflow/view.js"
import { _reset as resetRunners } from "./runners.js"

await initSubduction()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(25)
  }
  return false
}

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/** A session that is waiting: on a question, or on a permission. */
function waitingSession(repo, kind) {
  const h = repo.create({})
  h.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("go")]))
    if (kind === "question") {
      const call = callBlock("ask_user", { question: "Metric or imperial?", options: ["metric", "imperial"] }, { id: "q1" })
      call.status = CALL.asking
      d.turns.push(makeTurn("assistant", [call]))
      d.status = STATUS.awaitingAnswer
    } else {
      const call = callBlock("web_fetch", { url: "https://iba-world.com/negroni" }, { id: "p1" })
      call.status = CALL.pending
      d.turns.push(makeTurn("assistant", [call]))
      d.status = STATUS.awaitingApproval
    }
  })
  return h
}

/** A plan with one running step whose session is waiting. */
function planWaiting(repo, kind, orchestratorUrl = null) {
  const child = waitingSession(repo, kind)
  const plan = repo.create({})
  plan.change((d) => {
    initPlan(d, { title: "Cocktails", goal: "G", sessionUrl: orchestratorUrl, steps: [step("research", { title: "Research" })] })
    Object.assign(d.steps[0], { status: STEP.running, sessionUrl: child.url })
  })
  return { plan, child }
}

beforeEach(() => { _resetIds(); resetRunners(); document.body.replaceChildren() })
const stops = []
afterEach(() => { for (const s of stops.splice(0)) s(); _resetDrivers() })

describe("what a step waits on", () => {
  it("reads questions and permissions off its session", () => {
    const repo = new Repo({ network: [] })
    expect(waitingIn(waitingSession(repo, "question").doc())).toEqual([
      { kind: "question", callId: "q1", question: "Metric or imperial?", options: [{ label: "metric", detail: null }, { label: "imperial", detail: null }] },
    ])
    expect(waitingIn(waitingSession(repo, "approval").doc())).toEqual([
      { kind: "approval", callId: "p1", tool: "web_fetch", input: { url: "https://iba-world.com/negroni" } },
    ])
  })
})

describe("the driver tells the orchestrator", () => {
  async function drive(kind) {
    const repo = new Repo({ network: [] })
    const { plan } = planWaiting(repo, kind)
    const news = []
    const driver = new WorkflowDriver({
      repo, handle: plan, heartbeatMs: 1e9, toolIds: { worker: [] },
      startSession: async () => ({ runner: {}, listen: () => {} }),
      notify: () => ({ notify: (render) => { const text = render(); if (text) news.push(text) }, close: () => {} }),
    })
    driver.start()
    stops.push(() => driver.stop())
    for (let i = 0; i < 5; i++) await driver.kick()
    return news
  }

  it("about a question, once, with how to answer it", async () => {
    const news = await drive("question")
    expect(news).toHaveLength(1)
    expect(news[0]).toContain("## Question from step Research (research)\nMetric or imperial?\nOptions: metric / imperial")
    expect(news[0]).toMatch(/workflow_answer/)
  })

  it("but is not woken by a permission only the person can give", async () => {
    expect(await drive("approval")).toEqual([])
  })

  it("and says, when it does hear news, who is waiting for a permission", () => {
    const text = describeProgress({ title: "W", status: PLAN.running, steps: [step("research", { title: "Research", status: STEP.running })] }, [], [
      { kind: "approval", stepId: "research", tool: "web_fetch" },
    ])
    expect(text).toMatch(/Research wants to run web_fetch\. Only they can grant it/)
  })
})

describe("workflow_answer", () => {
  it("answers the step's question, and the step can carry on", async () => {
    const repo = new Repo({ network: [] })
    const { plan, child } = planWaiting(repo, "question")
    const out = await workflowAnswer.execute({ plan: plan.url, step: "research", answer: "metric" }, { workflows: { repo } })
    expect(out).toMatch(/Metric or imperial\?" → metric/)
    expect(waitingIn(child.doc())).toEqual([])
    expect(JSON.stringify(child.doc().turns.at(-1))).toContain("metric")
  })

  it("cannot grant a permission, and says so", async () => {
    const repo = new Repo({ network: [] })
    const { plan } = planWaiting(repo, "approval")
    await expect(workflowAnswer.execute({ plan: plan.url, step: "research", answer: "yes" }, { workflows: { repo } })).rejects.toThrow(/permission to run web_fetch, which only the person can give/)
  })
})

describe("in the orchestrator's view", () => {
  async function strip(kind) {
    const repo = new Repo({ network: [] })
    const orchestrator = repo.create({})
    orchestrator.change((d) => initSession(d, {}))
    const { plan, child } = planWaiting(repo, kind, orchestrator.url)
    orchestrator.change((d) => { d.made.push({ url: plan.url, name: "Cocktails", kind: "agent-workflow" }) })

    const container = document.createElement("div")
    document.body.append(container)
    let watcher
    const draw = () => renderWaiting(container, watcher.items(), { onOpen: () => {} })
    watcher = watchWaiting(repo, orchestrator, draw)
    stops.push(() => watcher.dispose())
    await until(() => watcher.items().length > 0)
    draw()
    return { container, child }
  }

  it("lists a step waiting for permission, and Allow once grants it in the step's session", async () => {
    const { container, child } = await strip("approval")
    expect(container.hidden).toBe(false)
    expect(container.textContent).toContain("Waiting on you in workflow steps (1)")
    expect(container.textContent).toContain("Research · Cocktails")
    const allow = [...container.querySelectorAll("button")].find((b) => b.textContent === "Allow once")
    allow.click()
    expect(child.doc().turns.at(-1).blocks[0].status).toBe(CALL.approved)
  })

  it("lists a step's question, answered with one of its options", async () => {
    const { container, child } = await strip("question")
    expect(container.textContent).toContain("Metric or imperial?")
    ;[...container.querySelectorAll("button")].find((b) => b.textContent === "imperial").click()
    expect(waitingIn(child.doc())).toEqual([])
  })
})

describe("in the workflow view", () => {
  it("the step's card asks for the permission itself", async () => {
    const repo = new Repo({ network: [] })
    const { plan, child } = planWaiting(repo, "approval")
    plan.change((d) => { d.status = PLAN.stopped }) // so the view does not start driving it
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = WorkflowView(plan, element, { repo })
    await until(() => element.querySelector(".agent-waiting-item"))
    const card = element.querySelector(".agent-wf-step")
    expect(card.textContent).toMatch(/Wants to .*iba-world\.com/)
    ;[...card.querySelectorAll("button")].find((b) => b.textContent === "Deny").click()
    // The call itself, not the last turn: a refusal is recorded as its result, in a turn of its own.
    expect(child.doc().turns[1].blocks[0].status).toBe(CALL.denied)
    cleanup()
  })
})

describe("end to end: a step asks, the orchestrator answers", () => {
  it("the question wakes the orchestrator, its answer reaches the step, and the step finishes with it", async () => {
    const repo = new Repo({ network: [] })
    const runners = []
    const run = (handle, provider, toolset, ctx = {}) => {
      const runner = new SessionRunner({
        store: handleStore(handle, A.splice),
        ctx: { ...ctx, sessionUrl: handle.url },
        buildToolset: toolset,
        getProvider: async () => provider,
        getKey: () => "test",
        canRun: () => true,
      })
      handle.on("change", () => runner.tick())
      runner.start()
      runners.push(runner)
      stops.push(() => runner.stop())
      return runner
    }

    // The step asks which units to use, then answers with what it was told.
    const stepSession = async (handle) => {
      const provider = makeMock([
        [{ type: "call", id: "ask", name: "ask_user", input: { question: "Metric or imperial?", options: ["metric", "imperial"] } }],
        (request) => {
          const told = JSON.stringify(request.messages).includes("metric") ? "metric" : "unknown"
          return [{ type: "text", delta: `Specs in ${told} units.` }]
        },
      ])
      // With the repo: a runner checks a step's session against its plan.
      const runner = run(handle, provider, (doc) => buildToolset(doc, { skipPlugins: true }), { repo })
      return { runner, listen: () => {} }
    }

    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { config: { workflows: { enabled: true } } })
      d.turns.push(makeTurn("user", [textBlock("research cocktails")]))
    })
    const provider = makeMock([
      [{ type: "call", id: "s", name: "workflow_start", input: { title: "Cocktails", goal: "Specs for a European bar", steps: [step("research", { title: "Research" })] } }],
      [{ type: "text", delta: "Started." }],
      // Woken by the question: it is a European bar, so metric.
      [{ type: "call", id: "a", name: "workflow_answer", input: { step: "research", answer: "metric" } }],
      [{ type: "text", delta: "Told it metric." }],
      [{ type: "text", delta: "Done: specs in metric." }],
    ])
    const events = createEvents(handleStore(orchestrator, A.splice), { policy: { settleMs: 10, maxDelayMs: 50, minGapMs: 0 } })
    stops.push(() => events.stop())
    run(orchestrator, provider, (doc) => buildToolset(doc, { skipPlugins: true }), { repo, events, startStepSession: stepSession })

    const planUrl = async () => orchestrator.doc().made?.find((m) => m.kind === "agent-workflow")?.url
    expect(await until(planUrl)).toBe(true)
    const plan = await repo.find(await planUrl())
    expect(await until(() => plan.doc().status === PLAN.done)).toBe(true)

    expect(plan.doc().steps[0].result).toBe("Specs in metric units.")
    const woken = JSON.stringify(provider.requests[2].messages)
    expect(woken).toContain("Question from step Research")
    expect(woken).toContain("Metric or imperial?")
  }, 20000)
})
