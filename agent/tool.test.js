/**
 * Mount tests: the (handle, element) => cleanup contract, rendering, and the
 * things that only break in a DOM — stale listeners, lost composer text,
 * collapsed-state churn.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { AgentTool } from "./tool.js"
import { initSession, makeTurn, textBlock, callBlock, resultBlock, CALL, STATUS, _resetIds } from "./session.js"
import { renderTranscript, callSummary } from "./ui/transcript.js"
import { _reset as resetRunners } from "./runners.js"

/** A DocHandle double with the parts the tool actually uses. */
let handleCounter = 0

function fakeHandle(seed = {}) {
  const doc = {}
  initSession(doc, seed)
  const listeners = new Set()
  return {
    // Distinct per handle: runners are registered by session url, so a shared
    // one would let a runner from an earlier test drive a later one's document.
    url: `automerge:session${++handleCounter}`,
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (event, fn) => listeners.delete(fn),
    listenerCount: () => listeners.size,
  }
}

const mount = (handle, options = {}) => {
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) }, ...options })
  return { element, cleanup }
}

beforeEach(() => {
  _resetIds()
  resetRunners()
  document.body.replaceChildren()
  localStorage.clear()
})

describe("the render contract", () => {
  it("mounts a root, a transcript and a composer", () => {
    const { element, cleanup } = mount(fakeHandle())
    expect(element.querySelector(".patchwork-agent")).toBeTruthy()
    expect(element.querySelector(".agent-transcript")).toBeTruthy()
    expect(element.querySelector(".agent-composer textarea")).toBeTruthy()
    cleanup()
  })

  it("removes its DOM and its change listener on cleanup", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    expect(handle.listenerCount()).toBe(1)

    cleanup()
    expect(element.querySelector(".patchwork-agent")).toBeNull()
    expect(handle.listenerCount()).toBe(0)
  })

  it("stops rendering after cleanup even if a change arrives late", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    cleanup()
    expect(() => handle.change((d) => d.turns.push(makeTurn("user", [textBlock("late")])))).not.toThrow()
    expect(element.textContent).not.toContain("late")
  })

  it("marks the mode so the pop-out can lay out differently", () => {
    const { element, cleanup } = mount(fakeHandle(), { mode: "panel" })
    expect(element.querySelector(".patchwork-agent").dataset.mode).toBe("panel")
    cleanup()
  })
})

describe("the composer", () => {
  it("appends a user turn and clears the box", async () => {
    // Send is disabled without a key, so a key has to exist for this to be a
    // test of the composer rather than of the disabled state.
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-test")
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)

    const input = element.querySelector("textarea")
    input.value = "rename the title to Soup"
    element.querySelector(".agent-composer button[data-variant='primary']").click()

    // Assert on the first turn, not the count: once a key exists the runner
    // starts and appends its own turns, so the total is a moving target.
    await vi.waitFor(() => {
      expect(handle.doc().turns.length).toBeGreaterThan(0)
    })
    expect(handle.doc().turns[0].role).toBe("user")
    expect(handle.doc().turns[0].blocks[0].text).toBe("rename the title to Soup")
    expect(input.value).toBe("")
    cleanup()
  })

  it("ignores an empty message", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    element.querySelector("textarea").value = "   "
    element.querySelector(".agent-composer button[data-variant='primary']").click()
    expect(handle.doc().turns).toHaveLength(0)
    cleanup()
  })

  it("disables send until a key is present", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    const send = element.querySelector(".agent-composer button[data-variant='primary']")
    expect(send.disabled).toBe(true)
    expect(element.querySelector(".agent-hint").textContent).toMatch(/API key/i)
    cleanup()
  })

  it("enables send once a key is stored", () => {
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-test")
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    expect(element.querySelector(".agent-composer button[data-variant='primary']").disabled).toBe(false)
    cleanup()
  })

  it("does not clobber what you are typing when the document changes", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    const input = element.querySelector("textarea")
    input.value = "half a thought"

    handle.change((d) => d.turns.push(makeTurn("assistant", [textBlock("hello")])))

    expect(input.value).toBe("half a thought")
    cleanup()
  })
})

describe("status", () => {
  it("shows the session status on the dot", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    handle.change((d) => {
      d.status = STATUS.running
    })
    expect(element.querySelector(".agent-status").dataset.status).toBe("running")
    cleanup()
  })

  it("offers a stop button only while running", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    const stop = element.querySelector("button[data-variant='danger']")
    expect(stop.style.display).toBe("none")

    handle.change((d) => {
      d.status = STATUS.running
    })
    expect(stop.style.display).not.toBe("none")
    cleanup()
  })
})

describe("transcript rendering", () => {
  const state = () => ({ open: new Set(), names: new Map() })

  it("renders text as text, never as markup", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("<img src=x onerror=alert(1)>")]))

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  it("collapses a tool call to one line, with its result inside", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("fs_read", { path: "tool.js" }, { id: "c1", status: CALL.done })]))
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "line one\nline two")]))

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    const call = container.querySelector(".agent-call")
    expect(call).toBeTruthy()
    expect(call.open).toBe(false)
    expect(call.querySelector("summary").textContent).toContain("read")
    expect(call.querySelector("summary").textContent).toContain("tool.js")
    expect(call.querySelector("pre").textContent).toContain("line two")
  })

  it("leaves a failed call open, because failure should not need a click", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", {}, { id: "c1", status: CALL.error })]))
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "Error: no such path", { isError: true })]))

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    const call = container.querySelector(".agent-call")
    expect(call.open).toBe(true)
    expect(call.dataset.status).toBe("error")
  })

  it("shows an approval card with the exact input, and reports the choice", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(
      makeTurn("assistant", [
        callBlock("doc_edit", { ops: [{ path: [], range: "title", value: "Soup" }] }, { id: "c1", status: CALL.pending }),
      ])
    )

    const chosen = []
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: (id, scope) => chosen.push([id, scope]) })

    const card = container.querySelector(".agent-approval")
    expect(card).toBeTruthy()
    expect(card.textContent).toContain("Soup")

    const buttons = [...card.querySelectorAll("button")].map((b) => b.textContent)
    expect(buttons).toEqual(["Allow once", "This session", "Deny"])

    card.querySelectorAll("button")[1].click()
    expect(chosen).toEqual([["c1", "session"]])
  })

  it("keeps a call open across re-renders once you have opened it", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("fs_read", {}, { id: "c1", status: CALL.done })]))

    const uiState = state()
    const container = document.createElement("div")
    renderTranscript(container, doc, uiState, { decide: () => {} })

    const call = container.querySelector(".agent-call")
    call.open = true
    call.dispatchEvent(new Event("toggle"))

    renderTranscript(container, doc, uiState, { decide: () => {} })
    expect(container.querySelector(".agent-call").open).toBe(true)
  })

  it("hides reasoning behind a summary", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [{ type: "reasoning", id: "r1", text: "one two three" }]))

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    const reasoning = container.querySelector(".agent-reasoning")
    expect(reasoning.open).toBe(false)
    expect(reasoning.querySelector("summary").textContent).toBe("thought for 3 words")
  })

  it("says something useful when the session is empty", () => {
    const doc = {}
    initSession(doc, { subject: "automerge:x" })
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })
    expect(container.querySelector(".agent-empty").textContent).toMatch(/this document/i)
  })
})

describe("callSummary", () => {
  it("names the verb and the target", () => {
    const summary = callSummary({ tool: "fs_grep", input: { pattern: "TODO" }, status: CALL.done }, null)
    expect(summary.verb).toBe("grep")
    expect(summary.detail).toBe("TODO")
  })

  it("renders a document url as words, not base58", () => {
    const summary = callSummary({ tool: "doc_read", input: { url: "automerge:abc123" }, status: CALL.done }, null)
    expect(summary.detail).toBe("this document")
  })

  it("prefers the tool's own summary over the first line of output", () => {
    const summary = callSummary(
      { tool: "doc_read", input: {}, status: CALL.done },
      { output: "{\n  \"title\": \"x\"\n}", summary: "read document · 62 B" }
    )
    expect(summary.note).toBe("read document · 62 B")
  })

  it("falls back to the first line for results recorded before summaries", () => {
    const summary = callSummary(
      { tool: "fs_read", input: {}, status: CALL.done },
      { output: "tool.js · 120 lines\n1\tconst x = 1" }
    )
    expect(summary.note).toBe("tool.js · 120 lines")
  })

  it("renders a path array as a path", () => {
    const summary = callSummary({ tool: "doc_read", input: { path: ["messages", "0"] }, status: CALL.done }, null)
    expect(summary.detail).toBe("/messages/0")
  })

  it("surfaces the error text for a failed call", () => {
    const summary = callSummary(
      { tool: "doc_edit", input: {}, status: CALL.error },
      { output: "Error: no value at /nope", isError: true }
    )
    expect(summary.note).toBe("no value at /nope")
  })

  it("marks a pending call as needing approval", () => {
    expect(callSummary({ tool: "doc_edit", input: {}, status: CALL.pending }, null).note).toBe("needs approval")
  })
})
