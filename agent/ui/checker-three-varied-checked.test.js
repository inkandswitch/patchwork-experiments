/**
 * A third checker's cases of the three fixes in 26d21ea0, each the second
 * checker's case varied once: the orchestrator followed only for its channel
 * running its real workflow tools on another plan (workflow/tools.js); a
 * workflow view opened on a plan another holder already drives, through a
 * burst of changes (ui/workflow-view.js); and two document urls with heads,
 * one before a comma and one inside brackets, and one whose heads are empty
 * (runners/ask.js withoutUrls).
 * The first fix, which let such a follow hold no driver, made workflow_reopen
 * and workflow_stop on that other plan throw, and is taken back: they start a
 * driver again and pass. One is kept as it.fails: a document url with empty
 * heads leaves its '#' behind.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { drivePlanHere, askFor, followWorkFor, _reset, _followers } from "../runners/page.js"
import { askWork, forget } from "../runners/ask.js"
import { getDriver, letGo, _resetDrivers } from "../workflow/driver.js"
import { initPlan, beginStep, changePlan, finishStep, settlePlan, PLAN } from "../workflow/plan.js"
import { workflowReopen, workflowStop } from "../workflow/tools.js"
import { WorkflowView } from "./workflow-view.js"

await initSubduction()

/** Made up. */
const DOC = "automerge:3vQm8zKXyT1pRwNbHc4LdFsEaGj"

let used = []
beforeEach(() => {
  document.body.replaceChildren()
  _resetIds()
  localStorage.clear()
  localStorage.setItem("patchwork-agent:key:openrouter", "sk-made-up")
  _reset()
})
afterEach(() => {
  for (const url of used) forget(url)
  used = []
  _resetDrivers()
  _reset()
})

function sessionIn(repo, turns) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(...turns)
    d.burst = null
  })
  return handle
}

/** A plan with two steps begun in their own sessions, orchestrated by `orchestrator` (made here if not given). */
function planIn(repo, orchestrator = sessionIn(repo, [makeTurn("assistant", [textBlock("started")])])) {
  const a = sessionIn(repo, [makeTurn("user", [textBlock("do a")])])
  const b = sessionIn(repo, [makeTurn("user", [textBlock("do b")])])
  const plan = repo.create()
  plan.change((d) => {
    initPlan(d, {
      title: "t",
      goal: "g",
      sessionUrl: orchestrator.url,
      steps: [
        { id: "a", title: "A", prompt: "do a", why: "w", where: "worker", tier: "fast", after: [] },
        { id: "b", title: "B", prompt: "do b", why: "w", where: "worker", tier: "fast", after: [] },
      ],
    })
    beginStep(d, "a", { session: { url: a.url, model: null } })
    beginStep(d, "b", { session: { url: b.url, model: null } })
  })
  return { orchestrator, a, b, plan }
}

const quiet = async () => ({ asked: false, why: "a test asks nothing" })
const settle = () => new Promise((r) => setTimeout(r, 20))
const holdersOf = (url) => {
  const entry = _followers().get(url)
  return !entry || entry.disposed ? 0 : entry.holders
}
const answer = (h) => h.change((d) => d.turns.push(makeTurn("assistant", [textBlock("a is done")])))

function viewOn(plan, repo) {
  const element = document.createElement("div")
  document.body.append(element)
  return WorkflowView(plan, element, { repo })
}

describe("the orchestrator followed only for its channel, running its workflow tools on its other plan", () => {
  /** Plan one driven here by a view, its orchestrator followed for the channel alone; plan two, the same orchestrator's, driven nowhere here. */
  async function channelOnly() {
    const repo = new Repo({ network: [] })
    const one = planIn(repo)
    const two = planIn(repo, one.orchestrator)
    const view = {}
    const driver = await drivePlanHere(one.plan.url, { repo, holder: view, startSession: quiet })
    answer(one.a)
    await driver.kick()
    expect(holdersOf(one.orchestrator.url)).toBe(1)
    // As kernel/runner.js privileges hands a host tool run in this page.
    const ctx = { workflows: { repo, startSession: quiet, follow: null }, session: { url: one.orchestrator.url }, events: null }
    return { repo, one, two, view, driver, ctx }
  }

  // The driver each tool starts for plan two is held for the orchestrator,
  // whose follow here is plan one's channel: it goes when that follow does.
  it("workflow_reopen on the other plan, which had finished, runs it again; its driver goes with plan one's", async () => {
    const { one, two, view, driver, ctx } = await channelOnly()
    changePlan(two.plan, (d) => {
      for (const step of d.steps) finishStep(d, step.id, { result: step.id })
      settlePlan(d)
    })
    expect(two.plan.doc().status).toBe(PLAN.done)
    await workflowReopen.execute({ plan: two.plan.url, steps: ["a"], note: "again", cascade: false }, ctx)
    expect(two.plan.doc().status).toBe(PLAN.running)
    const other = getDriver(two.plan.url)
    expect(other).not.toBe(null)
    letGo(view)
    expect(driver.stopped).toBe(true)
    expect(other.stopped).toBe(true)
    expect(holdersOf(one.orchestrator.url)).toBe(0)
  })

  it("workflow_stop on the other plan, while it runs, stops it; its driver goes with plan one's", async () => {
    const { one, two, view, driver, ctx } = await channelOnly()
    expect(two.plan.doc().status).toBe(PLAN.running)
    await workflowStop.execute({ plan: two.plan.url }, ctx)
    expect(two.plan.doc().status).not.toBe(PLAN.running)
    letGo(view)
    expect(driver.stopped).toBe(true)
    expect(getDriver(two.plan.url)).toBe(null)
    expect(holdersOf(one.orchestrator.url)).toBe(0)
  })
})

describe("a workflow view opened on a plan another holder already drives", () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  it("joins it once, keeps it when that holder lets go, and a burst of changes costs a driver's own ticks", async () => {
    const repo = new Repo({ network: [] })
    const { plan } = planIn(repo)
    const other = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: other, startSession: quiet })
    await driver.ticking
    const close = viewOn(plan, repo)
    await settle()
    expect(getDriver(plan.url)).toBe(driver)
    expect(driver.holders.size).toBe(2)
    letGo(other)
    expect(driver.stopped).toBe(false)
    expect(driver.holders.size).toBe(1)
    await driver.ticking
    const tick = vi.spyOn(driver, "tick")
    for (let i = 0; i < 20; i++) {
      changePlan(plan, (d) => (d.goal = `g${i}`))
      await wait(10)
    }
    await wait(300)
    await driver.ticking
    expect(tick.mock.calls.length).toBeGreaterThan(0)
    expect(tick.mock.calls.length).toBeLessThan(6)
    expect(driver.holders.size).toBe(1)
    close()
    expect(driver.stopped).toBe(true)
    expect(getDriver(plan.url)).toBe(null)
  })
})

describe("a failure whose words hold document urls with heads", () => {
  async function failedWith(why) {
    const client = {
      doWork: vi.fn(async () => {
        throw new Error(why)
      }),
      watchWork: () => () => {},
      stopWork: async () => false,
    }
    _reset(askWork, { with: client })
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("hello")])])
    used.push(handle.url)
    const told = { failed: null }
    followWorkFor(repo, handle.url, (view, failed) => (told.failed = failed))
    const result = await askFor(repo, handle.url)
    expect(result.error).toBe(true)
    expect(result.why).toBe(told.failed)
    return told.failed
  }

  it("one before a comma and one in brackets each leave the punctuation after them", async () => {
    const failed = await failedWith(`no change at ${DOC}#h1|h2, then (from ${DOC}#h3) and done.`)
    expect(failed).toBe("no change at a document, then (from a document) and done.")
  })

  it.fails("one whose heads are empty is taken out whole, its full stop left", async () => {
    const failed = await failedWith(`opening ${DOC}#.`)
    expect(failed).not.toMatch(/automerge:/)
    expect(failed).toBe("opening a document.")
  })
})
