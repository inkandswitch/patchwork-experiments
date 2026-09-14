import { describe, it, expect } from "vitest"
import { SessionRunner, needsWork } from "./runner.js"
import { memoryStore } from "./store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, makeTurn, textBlock, _resetIds } from "./session.js"

/**
 * A store that notifies on every change, the way a live automerge handle does.
 *
 * Views used to own the document subscription; now the runner does, so a write
 * from inside `tick()` comes straight back as a call to `tick()`. That
 * re-entrancy is the whole point of these tests.
 */
function notifyingStore(doc, onChange) {
  const inner = memoryStore(doc)
  return {
    ...inner,
    doc: () => inner.doc(),
    change: (fn, options) => {
      const result = inner.change(fn, options)
      onChange()
      return result
    },
    appendText: (path, delta) => {
      const result = inner.appendText(path, delta)
      onChange()
      return result
    },
  }
}

function pending() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Re-entrancy", subject: "automerge:subject" })
  doc.turns = [makeTurn("user", [textBlock("hello")])]
  return doc
}

function runnerOver(store, extra = {}) {
  return new SessionRunner({
    store,
    runnerUrl: "runner-test",
    buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
    getProvider: async () => makeMock([[{ type: "text", delta: "hi" }]]),
    canRun: () => true,
    ...extra,
  })
}

describe("a runner whose own writes call it back", () => {
  it("does not re-enter itself when it claims the lease", async () => {
    // Before the guard moved ahead of the lease write, this blew the stack:
    // claim -> change -> handler -> tick -> claim -> ...
    let ticks = 0
    let store
    store = notifyingStore(pending(), () => {
      ticks++
      store && runner.tick()
    })
    const runner = runnerOver(store)

    await runner.tick()

    expect(ticks).toBeGreaterThan(0)
    expect(store.doc().turns.length).toBe(2)
  })

  it("finishes the turn rather than looping on its own changes", async () => {
    let store
    const seen = []
    store = notifyingStore(pending(), () => {
      seen.push(store.doc().turns.length)
      runner.tick()
    })
    const runner = runnerOver(store)

    await runner.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(needsWork(store.doc(), () => true)).toBe(false)
    expect(runner.running).toBe(false)
    // One assistant turn, not one per change notification.
    expect(store.doc().turns.filter((t) => t.role === "assistant").length).toBe(1)
  })

  it("clears the busy flag when the lease write itself throws", async () => {
    const doc = pending()
    const store = {
      doc: () => doc,
      change: () => {
        throw new Error("document is gone")
      },
    }
    const runner = runnerOver(store)

    const result = await runner.tick()

    expect(runner.running).toBe(false)
    expect(result?.reason).toMatch(/document is gone/)
  })
})
