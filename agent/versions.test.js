/**
 * Two versions of the agent's code meeting one session.
 *
 * Patchwork reloads a package in place when a new version arrives. The view
 * came up with the new code while the runner, made by the old code, went on
 * running the session — and sent the model a message without the image
 * attached to it, because the old code did not know attachments. Now a newer
 * version takes over from an older runner, and no runner runs a session
 * holding something it cannot read.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { SessionRunner } from "./runner.js"
import { ensureRunner, getEntry, CODE_VERSION, _reset } from "./runners.js"
import { memoryStore } from "./store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, makeTurn, textBlock, unknownBlocks, BLOCK_TYPES, _resetIds } from "./session.js"
import { AgentTool } from "./tool.js"

beforeEach(() => {
  _resetIds()
  _reset()
  document.body.replaceChildren()
})

function session(extraBlocks = []) {
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("here are the icons"), ...extraBlocks])]
  return memoryStore(doc)
}

function runnerFor(store, events = []) {
  const provider = makeMock([[{ type: "text", delta: "seen" }]])
  const runner = new SessionRunner({
    store,
    runnerUrl: "r",
    buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
    getProvider: async () => provider,
    canRun: () => true,
    confirmMs: 0,
    onEvent: (event) => events.push(event),
  })
  return { runner, provider }
}

describe("a runner meets something it cannot read", () => {
  it("knows every kind of block this version writes, and names any other", () => {
    const store = session(BLOCK_TYPES.filter((t) => t !== "text").map((type) => ({ type })))
    expect(unknownBlocks(store.doc())).toEqual([])
    expect(unknownBlocks(session([{ type: "hologram" }, { type: "hologram" }, { type: "smell" }]).doc())).toEqual(["hologram", "smell"])
  })

  it("leaves the session for a runner that can, and says why", async () => {
    const events = []
    const store = session([{ type: "hologram", url: "automerge:x" }])
    const { runner, provider } = runnerFor(store, events)
    await runner.tick()
    expect(provider.requests).toHaveLength(0)
    expect(store.doc().lease).toBe(null)
    expect(events).toContainEqual({ type: "outdated", unknown: ["hologram"] })
  })

  it("and runs it as usual when it knows everything in it", async () => {
    const store = session([{ type: "attachment", url: "automerge:icons", name: "icons.png" }])
    const { runner, provider } = runnerFor(store)
    await runner.tick()
    expect(provider.requests).toHaveLength(1)
  })
})

describe("an older runner hands over to a newer version", () => {
  it("an idle runner, retired, stops at once and is told so", () => {
    const { runner } = runnerFor(session())
    let done = 0
    runner.retire(() => done++)
    expect([runner.stopped, done]).toEqual([true, 1])
  })

  it("a busy one finishes its turn, then stops, and takes no more work", async () => {
    const store = session()
    const { runner, provider } = runnerFor(store)
    let done = 0
    const turn = runner.tick()
    runner.retire(() => done++)
    expect(done).toBe(0)
    await turn
    expect([store.doc().turns.at(-1).role, runner.stopped, done]).toEqual(["assistant", true, 1])
    store.change((d) => d.turns.push(makeTurn("user", [textBlock("again")])))
    await runner.tick()
    expect(provider.requests).toHaveLength(1)
  })

  it("the registry retires a runner another version made, and starts one of its own", async () => {
    const store = session()
    const first = runnerFor(store)
    let disposed = 0
    await ensureRunner("automerge:s", async () => ({ runner: first.runner, dispose: () => disposed++ }))
    expect(getEntry("automerge:s").version).toBe(CODE_VERSION)
    // The same session's runner, as an older build of this code left it.
    getEntry("automerge:s").version = "an older build"
    const second = runnerFor(store)
    const entry = await ensureRunner("automerge:s", async () => ({ runner: second.runner }))
    expect(entry.runner).toBe(second.runner)
    expect([first.runner.retired, first.runner.stopped, disposed]).toEqual([true, true, 1])
  })

  it("lives where a reloaded module finds it", () => {
    expect(globalThis.__patchworkAgentRunners).toBeInstanceOf(Map)
  })
})

describe("the view says to reload", () => {
  it("when the session holds something this version cannot read", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("hi"), { type: "hologram" }])]
    const listeners = new Set()
    const handle = { url: "automerge:skew", doc: () => doc, change: (fn) => fn(doc), on: (e, fn) => listeners.add(fn), off: (e, fn) => listeners.delete(fn) }
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) } })
    expect(element.querySelector(".agent-hint").textContent).toBe("Something here needs a newer version of the agent: reload the page")
    cleanup()
  })
})
