/**
 * What the agent's own notes worked around, each held down.
 *
 * The agent keeps notes of what it learns, and several were workarounds for
 * our bugs: a step that stopped without a word was taken as done, and one
 * that thought at length before a long write was cut off three times with the
 * same thinking. (The others are held down beside their code: checking,
 * vision, testing and openrouter tests.)
 */

import { describe, it, expect, beforeEach } from "vitest"
import { run, OUTCOME, saidNothing, mostlyThinking } from "./kernel/loop.js"
import { memoryStore } from "./kernel/store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, makeTurn, textBlock, callBlock, claimLease, STATUS, _resetIds } from "./session/session.js"
import { sessionOutcome } from "./workflow/driver.js"
import { domSnapshot } from "./tools/environment.js"

beforeEach(() => _resetIds())

const toolset = { tools: [], schemas: [], get: () => null }

function sessionWith(params = {}) {
  const doc = {}
  initSession(doc, { config: { params } })
  doc.turns = [makeTurn("user", [textBlock("write the assembly instructions")])]
  claimLease(doc, "r", Date.now())
  return memoryStore(doc)
}

const go = (store, provider, modelInfo = { efforts: null, maxOutput: 64000 }) =>
  run({ store, provider, toolset, runnerUrl: "r", generation: 1, flushMs: 0, notes: false, modelInfo })

describe("a turn with neither words nor a call", () => {
  it("is told so, once, and goes on", async () => {
    const store = sessionWith()
    const provider = makeMock([
      [{ type: "reasoning", delta: "I could write it now." }, { type: "stop", reason: "end" }],
      [{ type: "text", delta: "Wrote the instructions to assembly.md." }, { type: "stop", reason: "end" }],
    ])
    const result = await go(store, provider)
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(provider.requests).toHaveLength(2)
    const nudge = store.doc().turns.at(-2)
    expect(nudge.role).toBe("user")
    expect(nudge.blocks[0].text).toMatch(/stopped without saying anything/)
    expect(sessionOutcome(store.doc())).toEqual({ state: "done", result: "Wrote the instructions to assembly.md." })
  })

  it("a second time, ends the run as a failure, so a workflow step is not counted done", async () => {
    const store = sessionWith()
    const silent = [{ type: "stop", reason: "end" }]
    const provider = makeMock([silent, silent])
    const result = await go(store, provider)
    expect(result.outcome).toBe(OUTCOME.silent)
    expect(store.doc().status).toBe(STATUS.error)
    expect(sessionOutcome(store.doc())).toEqual({ state: "failed" })
  })

  it("is any turn without a call or a non-blank word", () => {
    const cases = [
      [[], true],
      [[{ type: "reasoning", text: "hm" }], true],
      [[{ type: "text", text: "  \n" }], true],
      [[{ type: "text", text: "Done." }], false],
      [[callBlock("doc_read", { url: "automerge:x" })], false],
    ]
    for (const [blocks, expected] of cases) expect(saidNothing({ blocks }), JSON.stringify(blocks)).toBe(expected)
  })
})

describe("a cut-off turn that was mostly thinking thinks less next time", () => {
  it("weighs its thinking against its words, its calls, and a call that was cut off", () => {
    const think = (n) => ({ type: "reasoning", text: "x".repeat(n) })
    expect(mostlyThinking({ blocks: [think(5000)] }, [{ argsLength: 900 }])).toBe(true)
    expect(mostlyThinking({ blocks: [think(500)] }, [{ argsLength: 30000 }])).toBe(false)
    expect(mostlyThinking({ blocks: [think(500), { type: "text", text: "y".repeat(600) }] })).toBe(false)
    expect(mostlyThinking({ blocks: [think(700), callBlock("fs_write", { content: "z".repeat(100) })] })).toBe(true)
  })

  it("in a run: long thinking, then a write cut off mid-arguments; the retry thinks less", async () => {
    const store = sessionWith({ maxTokens: 4000 })
    const cutOff = [
      { type: "reasoning", delta: "Plan the two models in detail. ".repeat(200) },
      { type: "call", id: "w1", name: "fs_write", input: {}, parseError: "Unterminated string", argsLength: 1200 },
      { type: "stop", reason: "tool_use" },
    ]
    const provider = makeMock([cutOff, [{ type: "text", delta: "Written." }, { type: "stop", reason: "end" }]])
    await go(store, provider)
    expect(provider.requests.map((r) => r.params.reasoning?.effort ?? null)).toEqual([null, "medium"])
    expect(provider.requests.map((r) => r.params.maxTokens)).toEqual([4000, 8000])
  })

  it("and a cut-off that was mostly the write leaves the thinking alone", async () => {
    const store = sessionWith({ maxTokens: 4000 })
    const cutOff = [
      { type: "reasoning", delta: "Write it." },
      { type: "call", id: "w1", name: "fs_write", input: {}, parseError: "Unterminated string", argsLength: 14000 },
      { type: "stop", reason: "tool_use" },
    ]
    const provider = makeMock([cutOff, [{ type: "text", delta: "Written." }, { type: "stop", reason: "end" }]])
    await go(store, provider)
    expect(provider.requests.map((r) => r.params.reasoning ?? null)).toEqual([null, null])
  })
})

describe("dom_snapshot straight after view_open", () => {
  function openLater(url, ms, html) {
    setTimeout(() => {
      const view = document.createElement("patchwork-view")
      view.setAttribute("doc-url", url)
      view.innerHTML = html
      document.body.append(view)
    }, ms)
  }

  it("waits for the view to render, and looks only inside the one showing that document", async () => {
    document.body.replaceChildren()
    // Another document's view, already on the page, with the same class in it.
    const other = document.createElement("patchwork-view")
    other.setAttribute("doc-url", "automerge:other")
    other.innerHTML = `<div class="openscad-status">Render failed</div>`
    document.body.append(other)
    openLater("automerge:pack", 150, `<div class="openscad-status">Rendered in 812ms</div>`)
    const out = await domSnapshot.execute({ url: "automerge:pack#heads", selector: ".openscad-status", text: true }, { element: null })
    expect(out).toBe("Rendered in 812ms")
  })

  it("says the document is not open when no view of it appears", async () => {
    document.body.replaceChildren()
    await expect(domSnapshot.execute({ url: "automerge:closed", selector: ".x", waitMs: 50 }, {})).rejects.toThrow(/not open on the page/)
  })
})
