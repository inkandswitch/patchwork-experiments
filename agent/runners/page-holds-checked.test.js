/**
 * A checker's cases of what a workflow driver holds in a page
 * (workflow/driver.js holders and follows, runners/page.js follow and
 * drivePlanHere), counted: a step's session is held by the driver only while
 * the step is running and the driver runs; the driver is held by its holders
 * and stops when the last lets go; and a follow ends only when its last
 * holder, view or driver, lets go.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { follow, drivePlanHere, letGo, _reset, _followers } from "./page.js"
import { ensureDriver, getDriver, sessionHolder, _resetDrivers } from "../workflow/driver.js"
import { initPlan, beginStep, cancelStep, changePlan, STEP } from "../workflow/plan.js"

await initSubduction()

beforeEach(() => {
  _resetIds()
  localStorage.clear()
  localStorage.setItem("patchwork-agent:key:openrouter", "sk-made-up")
  _reset()
})
afterEach(() => {
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

/** A plan with two running steps, `a` and `b`, each in its own session with work, and an orchestrator. */
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
/** How many hold this page's follow of a session: 0 when none is kept. */
const holdersOf = (url) => {
  const entry = _followers().get(url)
  return !entry || entry.disposed ? 0 : entry.holders
}

describe("the driver's follow of a step's session, counted with a view's", () => {
  it("one per running step however often it ticks; let go when that step leaves running; a view's follow outlives it", async () => {
    const repo = new Repo({ network: [] })
    const { a, b, plan } = planIn(repo)
    const shown = follow(a, { repo }) // a view shows step a's session
    expect(holdersOf(a.url)).toBe(1)
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    for (let i = 0; i < 5; i++) await driver.kick()
    expect(holdersOf(a.url)).toBe(2)
    expect(holdersOf(b.url)).toBe(1)

    changePlan(plan, (d) => cancelStep(d, "a"))
    await driver.kick()
    expect(plan.doc().steps[0].status).toBe(STEP.cancelled)
    // The driver let go; the view still holds it.
    expect(holdersOf(a.url)).toBe(1)
    expect(holdersOf(b.url)).toBe(1)
    shown.release()
    expect(holdersOf(a.url)).toBe(0)
    expect(_followers().has(a.url)).toBe(false)
    letGo(view)
    expect(holdersOf(b.url)).toBe(0)
  })

  it("let go when the driver stops, by its last holder or by stop(); a view's follow outlives it", async () => {
    const repo = new Repo({ network: [] })
    const { a, b, plan } = planIn(repo)
    const shown = follow(a, { repo })
    const view = {}
    let driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    await driver.kick()
    expect([holdersOf(a.url), holdersOf(b.url)]).toEqual([2, 1])
    letGo(view)
    expect(driver.stopped).toBe(true)
    expect(getDriver(plan.url)).toBe(null)
    expect([holdersOf(a.url), holdersOf(b.url)]).toEqual([1, 0])

    // Started with no holder: only stop() ends it, and lets go the same way.
    driver = await drivePlanHere(plan.url, { repo, startSession: quiet })
    await driver.kick()
    expect([holdersOf(a.url), holdersOf(b.url)]).toEqual([2, 1])
    letGo(view)
    expect(driver.stopped).toBe(false)
    driver.stop()
    expect([holdersOf(a.url), holdersOf(b.url)]).toEqual([1, 0])
    shown.release()
    expect(holdersOf(a.url)).toBe(0)
  })
})

describe("the driver's holders", () => {
  it("each holder counts once; letting go twice, or a stranger letting go, stops nothing; the last stops it", async () => {
    const repo = new Repo({ network: [] })
    const { a, plan } = planIn(repo)
    const [first, second] = [{}, {}]
    const driver = await drivePlanHere(plan.url, { repo, holder: first, startSession: quiet })
    // Joined twice by one holder, once by another, once by nobody.
    expect(await drivePlanHere(plan.url, { repo, holder: first })).toBe(driver)
    expect(await ensureDriver(plan.url, { repo, holder: second })).toBe(driver)
    expect(await ensureDriver(plan.url, { repo, holder: null })).toBe(driver)
    expect(driver.holders.size).toBe(2)
    await driver.kick()
    letGo(first)
    letGo(first)
    letGo({})
    letGo(null)
    expect(driver.stopped).toBe(false)
    expect(holdersOf(a.url)).toBe(1)
    letGo(second)
    expect(driver.stopped).toBe(true)
    expect(holdersOf(a.url)).toBe(0)
  })

  it("two starts at once make one driver, held by both", async () => {
    const repo = new Repo({ network: [] })
    const { plan } = planIn(repo)
    const [first, second] = [{}, {}]
    const [d1, d2] = await Promise.all([
      ensureDriver(plan.url, { repo, holder: first, startSession: quiet }),
      ensureDriver(plan.url, { repo, holder: second, startSession: quiet }),
    ])
    expect(d1).toBe(d2)
    expect(getDriver(plan.url)).toBe(d1)
    letGo(first)
    expect(d1.stopped).toBe(false)
    letGo(second)
    expect(d1.stopped).toBe(true)
  })

  it("one held for a session's workflow tool stops when this page's last follow of that session lets go", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, plan } = planIn(repo)
    const [shown, other] = [follow(orchestrator, { repo }), follow(orchestrator, { repo })]
    const driver = await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url), startSession: quiet, follow: (h) => {
      const held = follow(h, { repo })
      return () => held.release()
    } })
    await driver.kick()
    expect(holdersOf(a.url)).toBe(1)
    shown.release()
    expect(driver.stopped).toBe(false)
    other.release()
    expect(driver.stopped).toBe(true)
    expect(holdersOf(a.url)).toBe(0)
  })
})

describe("the orchestrator, followed for the channel that wakes it", () => {
  /** Step a answers: the next tick finishes it, and that is news for the orchestrator. */
  const answer = (h) => h.change((d) => d.turns.push(makeTurn("assistant", [textBlock("a is done")])))

  it("is held while the channel is open, and let go when the driver stops", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, plan } = planIn(repo)
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    await driver.kick()
    expect(holdersOf(orchestrator.url)).toBe(0)
    answer(a)
    await driver.kick()
    expect(plan.doc().steps[0].status).toBe(STEP.done)
    expect(holdersOf(a.url)).toBe(0)
    expect(holdersOf(orchestrator.url)).toBe(1)
    letGo(view)
    expect(driver.stopped).toBe(true)
    expect(holdersOf(orchestrator.url)).toBe(0)
  })

  // The case: a view drives the plan here (the orchestrator followed for its
  // channel) and the orchestrator's own workflow tool, run in this page, joins
  // the driver as that session. Every view lets go: the channel's follow does
  // not hold the session's drivers, so the driver stops and the channel
  // closes.
  it("lets go of everything once every view has, while the plan runs on", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, a, b, plan } = planIn(repo)
    const shown = follow(orchestrator, { repo })
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    answer(a)
    await driver.kick()
    expect(holdersOf(orchestrator.url)).toBe(2)
    await ensureDriver(plan.url, { repo, holder: sessionHolder(orchestrator.url) })
    letGo(view)
    shown.release()
    expect(driver.stopped).toBe(true)
    expect(holdersOf(orchestrator.url)).toBe(0)
    expect(holdersOf(b.url)).toBe(0)
  })
})
