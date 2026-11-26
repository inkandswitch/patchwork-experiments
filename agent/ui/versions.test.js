/**
 * Two versions of the agent's code meeting one session.
 *
 * Patchwork reloads a package in place when a new version arrives. An old
 * runner, made by the old code, once went on running the session under a
 * view of the new code — and sent the model a message without the image
 * attached to it, because the old code did not know attachments. Now:
 *   - a burst runs the module its asker loaded (runners/ask.js asks for this
 *     package's runners/session-task.js at the version the page runs);
 *   - a page retires, on load, the runners an older version left on
 *     globalThis, and the followers of another version of runners/page.js;
 *   - no burst runs a session holding something it cannot read.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { burstRunner } from "../fixtures/burst.js"
import { retireEarlier, CODE_VERSION, _reset } from "../runners/page.js"
import { askWork, SESSION_TASK, forget } from "../runners/ask.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, unknownBlocks, BLOCK_TYPES, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { AgentTool } from "./session-view.js"

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

function runnerFor(store) {
  const provider = makeMock([[{ type: "text", delta: "seen" }]])
  const runner = burstRunner({
    store,
    runnerUrl: "r",
    buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
    getProvider: async () => provider,
    canRun: () => true,
  })
  return { runner, provider }
}

describe("a burst meets something it cannot read", () => {
  it("knows every kind of block this version writes, and names any other", () => {
    const store = session(BLOCK_TYPES.filter((t) => t !== "text").map((type) => ({ type })))
    expect(unknownBlocks(store.doc())).toEqual([])
    expect(unknownBlocks(session([{ type: "hologram" }, { type: "hologram" }, { type: "smell" }]).doc())).toEqual(["hologram", "smell"])
  })

  it("leaves the session for a version that can, writing nothing", async () => {
    const store = session([{ type: "hologram", url: "automerge:x" }])
    const before = JSON.stringify(store.doc())
    const { runner, provider } = runnerFor(store)
    expect((await runner.tick()).outcome).toBe("outdated")
    expect(provider.requests).toHaveLength(0)
    expect(JSON.stringify(store.doc())).toBe(before)
  })

  it("and runs it as usual when it knows everything in it", async () => {
    const store = session([{ type: "attachment", url: "automerge:icons", name: "icons.png" }])
    const { runner, provider } = runnerFor(store)
    await runner.tick()
    expect(provider.requests).toHaveLength(1)
  })
})

describe("a burst runs the version its asker runs", () => {
  it("what is asked for is the module the asking page loaded, unless the asker names another", async () => {
    const asked = []
    const client = {
      doWork: async (_repo, request) => (asked.push(request.importUrl), { outcome: "idle" }),
      watchWork: () => () => {},
      stopWork: async () => false,
    }
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("go")]))
    doc.burst = null
    const repo = { find: async () => ({ doc: () => doc, heads: () => ["h1"] }) }
    await askWork(repo, "automerge:versions-a", { client })
    await askWork(repo, "automerge:versions-b", { client, importUrl: "automerge:other-build/runners/session-task.js" })
    forget("automerge:versions-a")
    forget("automerge:versions-b")
    expect(asked).toEqual([SESSION_TASK, "automerge:other-build/runners/session-task.js"])
  })
})

describe("a page retires what an older version left", () => {
  it("every runner on globalThis: an idle one retired at once, a busy one when its turn ends, and the map goes", () => {
    const scope = {}
    const told = []
    const runner = (name) => ({ retire: (done) => (told.push(name), done()) })
    scope.__patchworkAgentRunners = new Map([
      ["automerge:a", { runner: runner("a"), dispose: () => told.push("disposed a") }],
      ["automerge:b", { runner: { stop: () => told.push("stopped b") }, dispose: () => told.push("disposed b") }],
    ])
    retireEarlier(scope)
    expect(told).toEqual(["a", "disposed a", "stopped b", "disposed b"])
    expect("__patchworkAgentRunners" in scope).toBe(false)
  })

  it("and the followers another version of runners/page.js made, but not this version's", () => {
    const scope = {}
    const disposed = []
    scope.__patchworkAgentFollowers = new Map([
      ["automerge:old", { version: "an older build", dispose: () => disposed.push("old") }],
      ["automerge:new", { version: CODE_VERSION, dispose: () => disposed.push("new") }],
    ])
    retireEarlier(scope)
    expect(disposed).toEqual(["old"])
    expect([...scope.__patchworkAgentFollowers.keys()]).toEqual(["automerge:new"])
  })

  it("and it ran on load: nothing of an older version's runners is left here", () => {
    expect(globalThis.__patchworkAgentRunners).toBeUndefined()
    expect(globalThis.__patchworkAgentFollowers).toBeInstanceOf(Map)
  })
})

describe("the view says it waits for a newer version", () => {
  // Patchwork brings new code without a reload, so the view never asks for one.
  it("when the session holds something this version cannot read", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("hi"), { type: "hologram" }])]
    const listeners = new Set()
    const handle = { url: "automerge:skew", doc: () => doc, change: (fn) => fn(doc), on: (e, fn) => listeners.add(fn), off: (e, fn) => listeners.delete(fn) }
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) } })
    expect(element.querySelector(".agent-hint").textContent).toBe("Waiting for a newer version of the agent: something in this session needs it")
    cleanup()
  })
})
