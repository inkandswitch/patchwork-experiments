/** `onWake`: whoever owns a session's events is told after each wake is written, and only then. */
import { describe, it, expect } from "vitest"
import { createEvents, SETTLE_MS, MIN_GAP_MS } from "./events.js"
import { memoryStore } from "./store.js"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"

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

function idle() {
  _resetIds()
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("watch")]), makeTurn("assistant", [textBlock("watching")])]
  return memoryStore(doc)
}

describe("onWake", () => {
  it("is told once per wake, after the wake's turn is in the session", () => {
    const time = fakeTime()
    const store = idle()
    const seen = []
    const events = createEvents(store, { ...time, onWake: () => seen.push(store.doc().turns.at(-1).blocks[0].type) })
    const channel = events.forTool("watch").open("a")
    channel.notify(() => "moved")
    time.advance(SETTLE_MS - 1)
    expect(seen).toEqual([])
    time.advance(1)
    expect(seen).toEqual(["event"])

    // The session answered; the next wake is held by the gap, and told when it lands.
    store.change((d) => d.turns.push(makeTurn("assistant", [textBlock("ok")])))
    channel.notify(() => "moved again")
    time.advance(SETTLE_MS)
    expect(seen).toEqual(["event"])
    time.advance(MIN_GAP_MS)
    expect(seen).toEqual(["event", "event"])
  })

  it("is not told when nothing is delivered, and an asker that throws or rejects does not undo the wake", async () => {
    const time = fakeTime()
    const store = idle()
    let told = 0
    const events = createEvents(store, { ...time, onWake: () => (told++, Promise.reject(new Error("no queue"))) })
    const channel = events.forTool("watch").open("a")
    channel.notify(() => "") // dissolves
    time.advance(SETTLE_MS)
    expect(told).toBe(0)

    channel.notify(() => "moved")
    time.advance(MIN_GAP_MS)
    expect(told).toBe(1)
    expect(store.doc().turns.at(-1).role).toBe("user")

    const throwing = createEvents(idle(), {
      ...time,
      onWake: () => {
        throw new Error("boom")
      },
    })
    const other = throwing.forTool("watch").open("b")
    other.notify(() => "moved")
    expect(() => time.advance(SETTLE_MS)).not.toThrow()
  })
})
