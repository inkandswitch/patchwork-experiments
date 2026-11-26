/**
 * A second checker's cases of the five fixes after the tidy, each the first
 * checker's case varied once: a plan reopened twice and three workflow views
 * (ui/workflow-view.js joining the driver whenever the plan runs); the
 * orchestrator followed only for its channel (runners/page.js follow
 * `channel`); a session that can never be found, over a simulated minute,
 * and a failure whose words hold a web address, a file url
 * and a document url (runners/ask.js).
 * Then two of the three it found, fixed: a view that holds its plan's driver
 * already does not join it on every change, and a document url leaves the
 * sentence's punctuation behind. The third, the orchestrator followed only
 * for its channel keeping its plan's driver going, is the known leak
 * (WORKFLOW.md), kept as it.fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { follow, drivePlanHere, askFor, followWorkFor, _reset, _followers } from "../runners/page.js"
import { askWork, forget } from "../runners/ask.js"
import { ensureDriver, getDriver, letGo, sessionHolder, _resetDrivers } from "../workflow/driver.js"
import { initPlan, beginStep, changePlan, finishStep, settlePlan, reopenSteps, runAgain, PLAN } from "../workflow/plan.js"
import { WorkflowView } from "./workflow-view.js"

await initSubduction()

/** Made up. */
const QUEUE = "automerge:3vQm8zKXyT1pRwNbHc4LdFsEaGj"

let used = []
beforeEach(() => {
  document.body.replaceChildren()
  _resetIds()
  localStorage.clear()
  localStorage.setItem("patchwork-agent:key:openrouter", "sk-made-up")
  _reset()
})
afterEach(() => {
  vi.useRealTimers()
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

/** A plan with two steps, `a` and `b`, begun in their own sessions, and an orchestrator. */
function planIn(repo) {
  const orchestrator = sessionIn(repo, [makeTurn("assistant", [textBlock("started")])])
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
const finishAll = (plan) =>
  changePlan(plan, (d) => {
    for (const step of d.steps) if (step.status === "running") finishStep(d, step.id, { result: step.id })
    settlePlan(d)
  })
const holdersOf = (url) => {
  const entry = _followers().get(url)
  return !entry || entry.disposed ? 0 : entry.holders
}

/** As workflow_reopen does, in a page showing the orchestrator: the plan run again, its driver held for that session, then that view closed. */
async function reopenFromTheOrchestrator(repo, plan, orchestrator) {
  const shown = follow(orchestrator, { repo })
  changePlan(plan, (d) => {
    reopenSteps(d, ["a"], { note: "again", cascade: false, by: "orchestrator" })
    runAgain(d)
  })
  expect(plan.doc().status).toBe(PLAN.running)
  await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url), startSession: quiet })
  await settle()
  shown.release()
}

function viewOn(plan, repo) {
  const element = document.createElement("div")
  document.body.append(element)
  return WorkflowView(plan, element, { repo })
}

describe("a workflow view open on a plan reopened twice", () => {
  it("joins the driver each time the plan runs again, and holds nothing once closed", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, plan } = planIn(repo)
    finishAll(plan)
    const close = viewOn(plan, repo)
    expect(getDriver(plan.url)).toBe(null)
    try {
      await reopenFromTheOrchestrator(repo, plan, orchestrator)
      const first = getDriver(plan.url)
      expect(first).not.toBe(null)
      expect(first.stopped).toBe(false)

      finishAll(plan)
      await settle()
      expect(plan.doc().status).toBe(PLAN.done)

      await reopenFromTheOrchestrator(repo, plan, orchestrator)
      const second = getDriver(plan.url)
      expect(second).not.toBe(null)
      expect(second.stopped).toBe(false)
      // The view, one holder however many changes it saw.
      expect(second.holders.size).toBe(1)
    } finally {
      close()
    }
    expect(getDriver(plan.url)).toBe(null)
  })
})

describe("three workflow views open on a running plan", () => {
  it("one driver, held once by each; it stops only when the last closes", async () => {
    const repo = new Repo({ network: [] })
    const { plan } = planIn(repo)
    const closes = [viewOn(plan, repo), viewOn(plan, repo), viewOn(plan, repo)]
    await settle()
    const driver = getDriver(plan.url)
    expect(driver).not.toBe(null)
    // Changes while it runs: each view joins again, and counts once.
    for (let i = 0; i < 5; i++) changePlan(plan, (d) => (d.goal = `g${i}`))
    await settle()
    expect(getDriver(plan.url)).toBe(driver)
    expect(driver.holders.size).toBe(3)
    closes[0]()
    closes[2]()
    expect(driver.stopped).toBe(false)
    closes[1]()
    expect(driver.stopped).toBe(true)
    expect(getDriver(plan.url)).toBe(null)
  })

  it("a view closed before its driver is found holds nothing", async () => {
    const repo = new Repo({ network: [] })
    const { plan } = planIn(repo)
    const [keep, gone] = [viewOn(plan, repo), viewOn(plan, repo)]
    gone()
    await settle()
    const driver = getDriver(plan.url)
    expect(driver).not.toBe(null)
    expect(driver.holders.size).toBe(1)
    keep()
    expect(driver.stopped).toBe(true)
  })
})

describe("the orchestrator followed only for its channel", () => {
  const answer = (h) => h.change((d) => d.turns.push(makeTurn("assistant", [textBlock("a is done")])))

  // The case: a view drives the plan here; step a's news opens the channel,
  // so this page follows the orchestrator for it alone. The orchestrator's
  // workflow tool (a host tool) runs in this page through that follow and
  // joins the driver as that session. The view closes: no follow but the
  // channel's ever held the session's drivers, so none is let go, and the
  // channel holds the follow that holds the driver that holds the channel,
  // until the plan's end news closes it (the edge the fixer named).
  // The known leak (WORKFLOW.md, *The driver*): small, and no wrong result.
  it.fails("lets go of everything once the view has, while the plan runs on", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, b, plan } = planIn(repo)
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    answer(a)
    await driver.kick()
    expect(holdersOf(orchestrator.url)).toBe(1)
    await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url) })
    letGo(view)
    expect(driver.stopped).toBe(true)
    expect(holdersOf(orchestrator.url)).toBe(0)
    expect(holdersOf(b.url)).toBe(0)
  })

  it("a session also shown here holds the driver its tool joins, until that view closes", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, plan } = planIn(repo)
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    answer(a)
    await driver.kick()
    const shown = follow(orchestrator, { repo })
    await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url) })
    letGo(view)
    expect(driver.stopped).toBe(false)
    shown.release()
    expect(driver.stopped).toBe(true)
    expect(holdersOf(orchestrator.url)).toBe(0)
  })
})

describe("a workflow view open on a running plan, through a burst of plan changes", () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  /** Ticks of the plan's driver over twenty changes ten milliseconds apart. */
  async function ticksOver(withView) {
    const repo = new Repo({ network: [] })
    const { plan } = planIn(repo)
    const close = withView ? viewOn(plan, repo) : null
    const holder = {}
    const driver = await drivePlanHere(plan.url, { repo, holder, startSession: quiet })
    await settle()
    await driver.ticking
    expect(driver.holders.size).toBe(withView ? 2 : 1)
    const tick = vi.spyOn(driver, "tick")
    for (let i = 0; i < 20; i++) {
      changePlan(plan, (d) => (d.goal = `g${i}`))
      await wait(10)
    }
    await wait(300)
    await driver.ticking
    const ticks = tick.mock.calls.length
    close?.()
    letGo(holder)
    expect(driver.stopped).toBe(true)
    return ticks
  }

  it("costs about as many ticks as with no view open", async () => {
    const none = await ticksOver(false)
    const viewed = await ticksOver(true)
    expect(none).toBeGreaterThan(0)
    expect(none).toBeLessThan(6)
    expect(viewed).toBeLessThanOrEqual(none + 1)
  })
})

describe("a session that can never be found", () => {
  it("looks once over a simulated minute, and asks nothing", async () => {
    vi.useFakeTimers()
    let finds = 0
    const repo = {
      find: async () => {
        finds++
        throw new Error("Document 4abc is unavailable")
      },
    }
    const url = "automerge:2Lh9xQpR7sWmTnVbYc3KdJfGeAz"
    used.push(url)
    const client = {
      doWork: vi.fn(async () => ({ outcome: "idle" })),
      watchWork: () => () => {},
      stopWork: async () => false,
      ownQueue: async () => QUEUE,
    }
    await askWork(repo, url, { client, onOnline: () => () => {} }).catch(() => {})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(finds).toBe(1)
    expect(client.doWork).not.toHaveBeenCalled()
  })

  it("found once, then never: a counted failure asks nothing more by itself", async () => {
    vi.useFakeTimers()
    const real = new Repo({ network: [] })
    const handle = sessionIn(real, [makeTurn("user", [textBlock("hello")])])
    used.push(handle.url)
    let finds = 0
    const repo = {
      find: async (u) => {
        if (finds++ === 0) return real.find(u)
        throw new Error("Document 4abc is unavailable")
      },
    }
    const client = {
      doWork: vi.fn(async () => {
        throw new Error("fetch failed")
      }),
      watchWork: () => () => {},
      stopWork: async () => false,
      ownQueue: async () => QUEUE,
    }
    await askWork(repo, handle.url, { client, onOnline: () => () => {} }).catch(() => {})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.doWork).toHaveBeenCalledTimes(1)
    expect(finds).toBe(1)
  })
})

describe("a failure whose words hold a web address, a file url and a document url", () => {
  it("none of them is said, and the words around them are", async () => {
    const why = `fetch failed: http://localhost:3030/sync, reading file:///Users/someone/keys.txt; opening ${QUEUE}#4abc.`
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
    expect(told.failed).not.toMatch(/automerge:|[a-z][a-z0-9+.-]*:\/\//i)
    // Each leaves the sentence's punctuation behind: the web address its
    // comma, the document url with heads its full stop.
    expect(told.failed).toBe("fetch failed: a web address, reading a web address; opening a document.")
    expect(result.why).toBe(told.failed)
  })
})
