/**
 * The runners a session view keeps working, on their own: no view built.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { sessionRunners } from "./session-runners.js"
import { initSession, _resetIds } from "../session/schema.js"
import { STOP, stopOf } from "../session/status.js"
import { handleStore } from "../kernel/store.js"
import { _reset as resetRunners, getEntry } from "../runners/registry.js"

let counter = 0
function fakeHandle() {
  const doc = {}
  initSession(doc, {})
  const listeners = new Set()
  return {
    url: `automerge:runners${++counter}`,
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (event, fn) => listeners.delete(fn),
  }
}

const repo = { find: async () => ({ doc: () => ({}) }) }

function make(handle = fakeHandle()) {
  const runners = sessionRunners({ handle, store: handleStore(handle), repo, element: document.createElement("div") })
  return { handle, runners }
}

beforeEach(() => {
  _resetIds()
  resetRunners()
  localStorage.clear()
})

describe("the runners of a session view", () => {
  it("are pending until kicked, then the tab's, with the worker not switched on", async () => {
    const { handle, runners } = make()
    expect(runners.kind()).toBe("pending")
    await runners.kick()
    expect(runners.kind()).toBe("tab")
    await vi.waitFor(() => expect(getEntry(handle.url)?.runner).toBeTruthy())
    runners.dispose()
  })

  it("leave the tab's runner running when the view goes away", async () => {
    const { handle, runners } = make()
    await runners.kick()
    await vi.waitFor(() => expect(getEntry(handle.url)?.runner).toBeTruthy())
    runners.dispose()
    expect(getEntry(handle.url).runner.stopped).toBeFalsy()
  })

  it("say when another runner holds a live lease, and not when none does", () => {
    const { handle, runners } = make()
    expect(runners.elsewhere(handle.doc())).toBe(false)
    handle.change((d) => (d.lease = { runner: "tab-elsewhere", generation: 1, at: Date.now() }))
    expect(runners.elsewhere(handle.doc())).toBe(true)
  })

  it("stop waiting for the network when stopped, with nothing running", () => {
    const { handle, runners } = make()
    handle.change((d) => (d.reconnecting = { reason: "offline", since: 1, attempts: 2 }))
    runners.stop()
    expect([handle.doc().reconnecting, stopOf(handle.doc())?.kind]).toEqual([null, STOP.stopped])
  })

  it("change nothing when stopped with nothing to stop", () => {
    const { handle, runners } = make()
    const before = JSON.stringify(handle.doc())
    runners.stop()
    expect(JSON.stringify(handle.doc())).toBe(before)
  })
})
