import { describe, it, expect, beforeEach } from "vitest"
import { createEvents, canWake, SETTLE_MS, MAX_DELAY_MS, MIN_GAP_MS, WAKES_PER_HOUR } from "../kernel/events.js"
import { memoryStore } from "../kernel/store.js"
import { initSession, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { toRequest } from "../session/request.js"
import { needsWork } from "../kernel/runner.js"
import { renderTranscript } from "./transcript.js"

/** A clock and timers that only move when the test says so. */
function fakeTime() {
  let t = 1_000_000
  let timers = []
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const timer = { at: t + ms, fn }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      timers = timers.filter((x) => x !== timer)
    },
    advance(ms) {
      const until = t + ms
      for (;;) {
        const next = timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        timers = timers.filter((x) => x !== next)
        t = next.at
        next.fn()
      }
      t = until
    },
  }
}

/** An idle session whose last word was the agent's: nothing to do until something happens. */
function idleSession() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Watching" })
  doc.turns = [makeTurn("user", [textBlock("watch the box")]), makeTurn("assistant", [textBlock("watching")])]
  return memoryStore(doc)
}

const eventTurns = (store) => store.doc().turns.filter((t) => t.blocks.some((b) => b.type === "event"))

let time
beforeEach(() => {
  time = fakeTime()
})

describe("events", () => {
  it("folds notices together and wakes the session once things settle", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("lm_world").open("box", { label: "Box #box" })
    let n = 0
    channel.notify(() => `moved ${++n}`)
    time.advance(500)
    channel.notify(() => `moved ${++n}`)
    time.advance(SETTLE_MS - 1)
    expect(eventTurns(store)).toHaveLength(0)

    time.advance(1)
    const [turn] = eventTurns(store)
    expect(turn.role).toBe("user")
    expect(turn.blocks).toHaveLength(1)
    expect(turn.blocks[0]).toMatchObject({ type: "event", source: "lm_world", label: "Box #box", count: 2, text: "moved 1" })
    // Described once, at delivery.
    expect(n).toBe(1)
    expect(needsWork(store.doc())).toBe(true)
  })

  it("tells the model the news is not the user speaking", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    events.forTool("lm_world").open("box", { label: "Box #box" }).notify(() => "Box #box moved")
    time.advance(SETTLE_MS)
    const last = toRequest(store.doc()).messages.at(-1)
    expect(last.role).toBe("user")
    expect(last.content[0].text).toContain("[Event from lm_world, watching Box #box. Not a message from the user")
    expect(last.content[0].text).toContain("Box #box moved")
  })

  it("a channel that never goes quiet still wakes within the maximum delay", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("t").open("busy")
    for (let i = 0; i < MAX_DELAY_MS / 100; i++) {
      channel.notify(() => "busy")
      time.advance(100)
    }
    expect(eventTurns(store)).toHaveLength(1)
  })

  it("waits while the session is busy, then delivers", () => {
    const store = idleSession()
    store.change((d) => (d.burst = { run: "run-elsewhere" }))
    const events = createEvents(store, time)
    events.forTool("t").open("k").notify(() => "news")
    time.advance(SETTLE_MS * 5)
    expect(eventTurns(store)).toHaveLength(0)

    store.change((d) => (d.burst = null))
    time.advance(SETTLE_MS)
    expect(eventTurns(store)).toHaveLength(1)
  })

  it("does not wake a session whose last word was the user's, or that waits on a person", () => {
    const store = idleSession()
    expect(canWake(store.doc())).toBe(true)
    store.change((d) => d.turns.push(makeTurn("user", [textBlock("and another thing")])))
    expect(canWake(store.doc())).toBe(false)
    store.change((d) => {
      d.turns.pop()
      d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "http_request", input: {}, where: "worker", status: "pending" }]))
    })
    expect(canWake(store.doc())).toBe(false)
  })

  it("news already reported dissolves the wake", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    events.forTool("t").open("k").notify(() => "")
    time.advance(SETTLE_MS)
    expect(eventTurns(store)).toHaveLength(0)
  })

  it("several channels wake the session in one turn", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    events.forTool("t").open("a").notify(() => "a changed")
    events.forTool("t").open("b").notify(() => "b changed")
    time.advance(SETTLE_MS)
    const [turn] = eventTurns(store)
    expect(turn.blocks.map((b) => b.text)).toEqual(["a changed", "b changed"])
  })

  it("leaves a gap between wakes", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("t").open("k")
    channel.notify(() => "first")
    time.advance(SETTLE_MS)
    // The agent answers, and the session is idle again.
    store.change((d) => d.turns.push(makeTurn("assistant", [textBlock("ok")])))

    channel.notify(() => "second")
    // The gap counts from the first wake, which was just now.
    time.advance(MIN_GAP_MS - 1)
    expect(eventTurns(store)).toHaveLength(1)
    time.advance(1)
    expect(eventTurns(store)).toHaveLength(2)
  })

  it("stops waking after the hourly budget, and resumes when it frees up", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("t").open("k")
    for (let i = 0; i < WAKES_PER_HOUR + 3; i++) {
      channel.notify(() => `change ${i}`)
      time.advance(MIN_GAP_MS)
      store.change((d) => d.turns.push(makeTurn("assistant", [textBlock("ok")])))
    }
    expect(eventTurns(store)).toHaveLength(WAKES_PER_HOUR)
    time.advance(60 * 60 * 1000)
    expect(eventTurns(store)).toHaveLength(WAKES_PER_HOUR + 1)
  })

  it("closing a channel drops what it had pending", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("t").open("k")
    expect(events.listening()).toBe(1)
    channel.notify(() => "never mind")
    channel.close()
    expect(events.listening()).toBe(0)
    time.advance(MAX_DELAY_MS)
    expect(eventTurns(store)).toHaveLength(0)
  })

  it("reopening a key replaces the old channel", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const old = events.forTool("t").open("k")
    const fresh = events.forTool("t").open("k")
    old.notify(() => "stale")
    expect(events.listening()).toBe(1)
    time.advance(MAX_DELAY_MS)
    expect(eventTurns(store)).toHaveLength(0)
    fresh.notify(() => "current")
    time.advance(SETTLE_MS)
    expect(eventTurns(store)[0].blocks[0].text).toBe("current")
  })

  it("a stopped events object delivers nothing", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("t").open("k")
    channel.notify(() => "news")
    events.stop()
    time.advance(MAX_DELAY_MS)
    expect(eventTurns(store)).toHaveLength(0)
    expect(events.listening()).toBe(0)
  })
})

describe("the transcript", () => {
  it("shows a wake as news from the tool, not as the user", () => {
    const store = idleSession()
    const events = createEvents(store, time)
    const channel = events.forTool("lm_world").open("box", { label: "Box #box" })
    channel.notify(() => "x")
    channel.notify(() => "Box #box moved to (40, 20)")
    time.advance(SETTLE_MS)

    const container = document.createElement("div")
    renderTranscript(container, store.doc(), { open: new Set(), names: new Map(), subject: null }, {})
    const node = container.querySelector('[data-role="event"]')
    expect(node.textContent).toContain("Woken by lm_world · Box #box (2 changes)")
    expect(node.textContent).toContain("Box #box moved to (40, 20)")
    expect(container.querySelectorAll('[data-role="user"]')).toHaveLength(1)
  })
})
