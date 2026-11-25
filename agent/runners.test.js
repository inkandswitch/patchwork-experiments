import { describe, it, expect, beforeEach } from "vitest"
import {
  ensureRunner, attachView, stopRunner, reapIdle, stopAll, getEntry, liveCount, _reset,
  IDLE_GRACE_MS, MAX_LIVE_RUNNERS,
} from "./runners/registry.js"

/** A runner double with the bits the registry touches. */
const fakeRunner = (running = false) => {
  const r = { running, stopped: false, stop() { this.stopped = true } }
  return r
}

const make = (sessionUrl, runner = fakeRunner()) => {
  const ctx = { element: null }
  return ensureRunner(sessionUrl, async () => ({ runner, ctx }))
}

beforeEach(_reset)

describe("one runner per session", () => {
  it("creates a runner the first time", async () => {
    const runner = fakeRunner()
    const entry = await make("automerge:s1", runner)
    expect(entry.runner).toBe(runner)
    expect(liveCount()).toBe(1)
  })

  it("reuses the same runner for a second view", async () => {
    const first = await make("automerge:s1", fakeRunner())
    let created = false
    const second = await ensureRunner("automerge:s1", async () => {
      created = true
      return { runner: fakeRunner(), ctx: {} }
    })
    expect(created).toBe(false)
    expect(second.runner).toBe(first.runner)
  })

  it("does not start two runners when two views open at once", async () => {
    let creations = 0
    const create = async () => {
      creations++
      await new Promise((r) => setTimeout(r, 10))
      return { runner: fakeRunner(), ctx: {} }
    }
    const [a, b] = await Promise.all([
      ensureRunner("automerge:race", create),
      ensureRunner("automerge:race", create),
    ])
    expect(creations).toBe(1)
    expect(a.runner).toBe(b.runner)
  })
})

describe("detaching a view", () => {
  it("does not stop the runner — this is the whole point", async () => {
    const runner = fakeRunner(true)
    await make("automerge:s1", runner)

    const detach = attachView("automerge:s1", { element: {}, onEvent: () => {} })
    detach()

    expect(runner.stopped).toBe(false)
    expect(getEntry("automerge:s1")).toBeTruthy()
  })

  it("clears the element so host tools stop pointing at a removed view", async () => {
    const entry = await make("automerge:s1")
    const element = { tag: "div" }
    const detach = attachView("automerge:s1", { element })
    expect(entry.ctx.element).toBe(element)

    detach()
    expect(entry.ctx.element).toBeNull()
  })

  it("keeps the element while another view is still attached", async () => {
    const entry = await make("automerge:s1")
    const first = { id: 1 }
    const detachFirst = attachView("automerge:s1", { element: first })
    attachView("automerge:s1", { element: { id: 2 } })

    detachFirst()
    expect(entry.ctx.element).not.toBeNull()
  })

  it("stops delivering events to a detached view", async () => {
    const seen = []
    let emit = null
    await ensureRunner("automerge:s1", async (fanout) => {
      emit = fanout
      return { runner: fakeRunner(), ctx: {} }
    })

    const detach = attachView("automerge:s1", { onEvent: (e) => seen.push(e) })
    emit({ type: "one" })
    detach()
    emit({ type: "two" })

    expect(seen).toEqual([{ type: "one" }])
  })

  it("fans events out to every attached view", async () => {
    const a = []
    const b = []
    let emit = null
    await ensureRunner("automerge:s1", async (fanout) => {
      emit = fanout
      return { runner: fakeRunner(), ctx: {} }
    })
    attachView("automerge:s1", { onEvent: (e) => a.push(e) })
    attachView("automerge:s1", { onEvent: (e) => b.push(e) })

    emit({ type: "tick" })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it("survives a view whose handler throws", async () => {
    let emit = null
    await ensureRunner("automerge:s1", async (fanout) => {
      emit = fanout
      return { runner: fakeRunner(), ctx: {} }
    })
    const good = []
    attachView("automerge:s1", { onEvent: () => { throw new Error("bad view") } })
    attachView("automerge:s1", { onEvent: (e) => good.push(e) })

    expect(() => emit({ type: "tick" })).not.toThrow()
    expect(good).toHaveLength(1)
  })
})

describe("reaping", () => {
  it("never reaps a runner that is still working, however long it is unwatched", async () => {
    const runner = fakeRunner(true)
    await make("automerge:busy", runner)
    attachView("automerge:busy", {})()

    reapIdle({ now: Date.now() + IDLE_GRACE_MS * 10 })

    expect(getEntry("automerge:busy")).toBeTruthy()
    expect(runner.stopped).toBe(false)
  })

  it("reaps an idle, unwatched runner after the grace period", async () => {
    const runner = fakeRunner(false)
    await make("automerge:idle", runner)
    attachView("automerge:idle", {})()

    expect(reapIdle({ now: Date.now() + 1000 })).toEqual([])
    expect(reapIdle({ now: Date.now() + IDLE_GRACE_MS + 1000 })).toEqual(["automerge:idle"])
    expect(runner.stopped).toBe(true)
  })

  it("keeps a watched runner even when idle", async () => {
    await make("automerge:watched", fakeRunner(false))
    attachView("automerge:watched", {})

    expect(reapIdle({ now: Date.now() + IDLE_GRACE_MS * 5 })).toEqual([])
  })

  it("drops the longest-unwatched first when over the cap", async () => {
    for (let i = 0; i < MAX_LIVE_RUNNERS + 3; i++) {
      await make(`automerge:s${i}`, fakeRunner(false))
      attachView(`automerge:s${i}`, {})()
    }
    reapIdle({ now: Date.now() })
    expect(liveCount()).toBeLessThanOrEqual(MAX_LIVE_RUNNERS)
  })
})

describe("stopping", () => {
  it("stops one and forgets it", async () => {
    const runner = fakeRunner()
    await make("automerge:s1", runner)
    expect(stopRunner("automerge:s1")).toBe(true)
    expect(runner.stopped).toBe(true)
    expect(getEntry("automerge:s1")).toBeNull()
  })

  it("stops everything, so leases are released rather than left stale", async () => {
    const a = fakeRunner(true)
    const b = fakeRunner(true)
    await make("automerge:a", a)
    await make("automerge:b", b)

    expect(stopAll()).toBe(2)
    expect(a.stopped).toBe(true)
    expect(b.stopped).toBe(true)
    expect(liveCount()).toBe(0)
  })
})
