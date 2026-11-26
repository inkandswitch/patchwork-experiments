/**
 * A driver writes nothing without a change.
 *
 * The bug this first pinned: a driver renewed its lease on every tick, and
 * every write to the plan scheduled another tick, so, left running with a
 * clock that moves, it rewrote the plan as fast as automerge could go and
 * locked up the tab. There is no lease now and no timer: a driver ticks on
 * changes to the plan and to the documents it watches, and a tick writes
 * only what a change calls for. So however long it is left, and however the
 * clock moves, a driver with nothing new to act on writes nothing.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initPlan, STEP } from "./plan.js"
import { WorkflowDriver, _resetDrivers } from "./driver.js"
import { initSession, STATUS } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: id, prompt: "p", why: "w", where: "worker", tier: "fast", after: [], ...over })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const drivers = []
afterEach(() => { for (const d of drivers.splice(0)) d.stop(); _resetDrivers() })

/** A plan with one step whose session runs and never finishes, as a real one mid-work. */
function setup() {
  const repo = new Repo({ network: [] })
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] })] }))
  let writes = 0
  plan.on("change", () => { writes++ })
  // The session keeps changing, the way a step streaming its answer does.
  const sessions = []
  const startSession = async (handle) => {
    sessions.push(handle)
    return { runner: {}, listen: () => {} }
  }
  // A clock that always moves: every call is a new millisecond.
  let t = 1_000_000
  const now = () => (t += 3)
  const driver = new WorkflowDriver({ repo, handle: plan, startSession, now })
  drivers.push(driver)
  return { repo, plan, driver, sessions, writes: () => writes }
}

describe("a quiet driver", () => {
  it("does not write to the plan when it ticks with nothing to do", async () => {
    const { plan, driver } = setup()
    driver.start()
    await sleep(50)
    expect(plan.doc().steps[0].status).toBe(STEP.running)
    const heads = A.getHeads(plan.doc())
    for (let i = 0; i < 20; i++) await driver.kick()
    expect(A.getHeads(plan.doc())).toEqual(heads)
  })

  it("left running on its own, settles instead of rewriting the plan forever", async () => {
    const { driver, writes } = setup()
    driver.start()
    await sleep(300)
    // Start step a: a handful of writes, not thousands.
    expect(writes()).toBeLessThan(10)
  })

  it("a step session that keeps changing does not turn into writes to the plan", async () => {
    const { driver, sessions, writes } = setup()
    driver.start()
    await sleep(50)
    const before = writes()
    const session = sessions[0]
    for (let i = 0; i < 50; i++) {
      session.change((d) => { d.turns.push(makeTurn("assistant", [textBlock(`chunk ${i}`)])) })
      await sleep(2)
    }
    await sleep(100)
    expect(writes() - before).toBeLessThan(3)
  })

  it("no write without a change: left for an hour with a moving clock, it writes nothing and has no tick waiting", async () => {
    const { plan, driver } = setup()
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] })
    try {
      driver.start()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(plan.doc().steps[0].status).toBe(STEP.running)
      const heads = A.getHeads(plan.doc())
      // An hour of this page's time, the clock moving at every read.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(A.getHeads(plan.doc())).toEqual(heads)
      expect(driver.soon).toBe(null)
      expect("lease" in plan.doc()).toBe(false)
      expect("lastGeneration" in plan.doc()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
