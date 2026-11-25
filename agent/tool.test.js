/**
 * Mount tests: the (handle, element) => cleanup contract, rendering, and the
 * things that only break in a DOM — stale listeners, lost composer text,
 * collapsed-state churn.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { AgentTool } from "./ui/session-view.js"
import { initSession, makeTurn, textBlock, callBlock, resultBlock, CALL, STATUS, _resetIds } from "./session/session.js"
import { renderTranscript, callSummary } from "./ui/transcript.js"
import { _reset as resetRunners } from "./runners/registry.js"
import { viewMount, _resetMounts } from "./tools/checking.js"

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
    // No target here, so there is one standing grant to offer rather than a
    // choice of subtrees.
    expect(buttons).toEqual(["Allow once", "Deny", "always"])

    card.querySelectorAll("button")[0].click()
    expect(chosen).toEqual([["c1", "once"]])
  })

  it("offers page, section and site scopes when the call names a URL", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(
      makeTurn("assistant", [
        callBlock("web_fetch", { url: "https://docs.python.org/3/library/os.html" }, { id: "c1", status: CALL.pending }),
      ])
    )

    const chosen = []
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: (id, scope) => chosen.push([id, scope]) })

    const card = container.querySelector(".agent-approval")
    const scopes = [...card.querySelectorAll(".agent-approval-scopes button")]
    expect(scopes.map((b) => b.textContent)).toEqual([
      "this page",
      "/3/library/",
      "docs.python.org",
      "any site",
    ])
    expect(scopes[2].title).toBe("anything on docs.python.org")

    scopes[2].click()
    expect(chosen).toEqual([["c1", { grant: "web@https://docs.python.org/" }]])
  })

  it("shows a captured image in the log, not only inside the call", () => {
    const image = "data:image/jpeg;base64,AAAA"
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("view_screenshot", {}, { id: "c1", status: CALL.done })]))
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "Captured 400×200 via dom.", { image, summary: "screenshot" })]))

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    const figure = container.querySelector(".agent-shot")
    expect(figure).toBeTruthy()
    expect(figure.querySelector("img").getAttribute("src")).toBe(image)
    // Outside the <details>, so it is visible without opening the call.
    expect(figure.closest(".agent-call")).toBeNull()
    expect(figure.dataset.size).toBe("small")

    figure.click()
    expect(figure.dataset.size).toBe("large")
  })

  it("keeps an enlarged image enlarged across a re-render", () => {
    const image = "data:image/jpeg;base64,BBBB"
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("view_screenshot", {}, { id: "c1", status: CALL.done })]))
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "Captured.", { image })]))

    const uiState = state()
    const container = document.createElement("div")
    renderTranscript(container, doc, uiState, { decide: () => {} })
    container.querySelector(".agent-shot").click()

    renderTranscript(container, doc, uiState, { decide: () => {} })
    expect(container.querySelector(".agent-shot").dataset.size).toBe("large")
  })

  it("links the document a tool saved its content into", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock("web_fetch", { url: "https://x.test/a" }, { id: "c1", status: CALL.done })]))
    doc.turns.push(
      makeTurn("tool", [
        resultBlock("c1", "excerpt…", { doc: { url: "automerge:saved1", name: "A Page.md", bytes: 42000 } }),
      ])
    )

    const opened = []
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {}, openDoc: (url) => opened.push(url) })

    const chip = container.querySelector(".agent-doc-chip")
    expect(chip.textContent).toContain("A Page.md")
    expect(chip.textContent).toContain("42 kB")

    chip.click()
    expect(opened).toEqual(["automerge:saved1"])
  })

  it("renders prose as markdown rather than as a wall of text", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(
      makeTurn("assistant", [textBlock("## Findings\n\n- one **important** thing\n- see [the docs](https://x.test/)")])
    )

    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })

    expect(container.querySelector("h2").textContent).toBe("Findings")
    expect(container.querySelectorAll("li")).toHaveLength(2)
    expect(container.querySelector("strong").textContent).toBe("important")
    expect(container.querySelector("a").getAttribute("href")).toBe("https://x.test/")
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
    const call = { tool: "doc_read", input: { url: "automerge:abc123" }, status: CALL.done }
    // The session's own document is "this document"; any OTHER document is not,
    // and saying so would be a lie about which one was read.
    expect(callSummary(call, null, "automerge:abc123").detail).toBe("this document")
    expect(callSummary(call, null, "automerge:elsewhere").detail).toBe("doc abc123")
    expect(callSummary(call, null).detail).toBe("doc abc123")
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

describe("an approval a person can actually see", () => {
  const state = () => ({ open: new Set(), names: new Map() })

  function pendingCall(tool = "web_fetch", input = { url: "https://docs.python.org/3/library/os.html" }) {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock(tool, input, { id: "c1", status: CALL.pending })]))
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {} })
    return container
  }

  it("renders the card outside the collapsed call, not inside it", () => {
    // The bug this exists for: the card was inside <details>, which is closed
    // for a pending call. querySelector still found it, so every probe passed
    // while a person saw a stuck session and no buttons.
    const container = pendingCall()
    const card = container.querySelector(".agent-approval")
    expect(card).toBeTruthy()
    expect(card.closest("details")).toBeNull()
  })

  it("puts the call's own disclosure back in the collapsed state it belongs in", () => {
    const container = pendingCall()
    expect(container.querySelector(".agent-call").open).toBe(false)
  })
})

describe("an approval for a call that will ask again anyway", () => {
  const state = () => ({ open: new Set(), names: new Map() })

  function card(tool, input, alwaysAsks) {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [callBlock(tool, input, { id: "c1", status: CALL.pending })]))
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {}, alwaysAsks })
    return container.querySelector(".agent-approval")
  }

  it("offers no standing grant, and says why", () => {
    // A real session collected four http_request grants, including "any site",
    // and was asked eleven times regardless — alwaysAsk is checked before
    // grants are. Offering the buttons was worse than offering nothing.
    const node = card("http_request", { url: "https://api.test/x", method: "POST" }, () => true)
    expect(node.querySelector(".agent-approval-scopes")).toBeNull()
    expect(node.querySelector(".agent-approval-note").textContent).toMatch(/asks every time/)
  })

  it("still offers allow-once and deny", () => {
    const node = card("http_request", { url: "https://api.test/x" }, () => true)
    expect([...node.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Allow once", "Deny"])
  })

  it("offers the scopes as normal for a call that honours them", () => {
    const node = card("web_fetch", { url: "https://docs.python.org/3/os.html" }, () => false)
    expect(node.querySelector(".agent-approval-scopes")).toBeTruthy()
    expect(node.querySelector(".agent-approval-note")).toBeNull()
  })

  it("offers them when nothing answers the question", () => {
    // No toolset to ask — better to offer than to claim it will always ask.
    const node = card("web_fetch", { url: "https://x.test/" }, undefined)
    expect(node.querySelector(".agent-approval-scopes")).toBeTruthy()
  })
})

describe("what a call made or opened, inline", () => {
  /** A repo with one package whose tool draws a button. */
  function packageRepo() {
    const docs = new Map([["automerge:package", { docs: [{ name: "package.json", type: "file", url: "automerge:pkg" }] }]])
    let n = 0
    const handle = (url) => ({ url, doc: () => docs.get(url), change(fn) { fn(docs.get(url)) }, heads: () => ["h1"], on() {}, off() {} })
    return {
      async create2() { const url = `automerge:new${++n}`; docs.set(url, {}); return handle(url) },
      async find(url) { if (!docs.has(url)) throw new Error("missing"); return handle(url) },
    }
  }
  const module = {
    plugins: [
      { type: "patchwork:datatype", id: "widget", name: "Widget", async load() { return { init: (d) => { d.title = "W" }, getTitle: (d) => d.title } } },
      { type: "patchwork:tool", id: "widget", name: "Widget", supportedDatatypes: ["widget"], async load() {
        return (handle, element) => { const b = document.createElement("button"); b.textContent = "roll"; element.append(b); return () => b.remove() }
      } },
    ],
  }

  function sessionWith(callId, input, output, doc = null) {
    const handle = fakeHandle()
    handle.change((d) => {
      d.turns.push(makeTurn("assistant", [callBlock("view_mount", input, { id: callId, status: CALL.done })]))
      d.turns.push(makeTurn("tool", [resultBlock(callId, output, doc ? { doc } : {})]))
    })
    return handle
  }

  beforeEach(() => _resetMounts())

  it("adopts the agent's live mount beside its call, keeps it across re-renders, and parks it on cleanup", async () => {
    const repo = packageRepo()
    const out = await viewMount.execute({ url: "automerge:package", screenshot: false }, { repo, importModule: async () => module })
    const mountId = String(out).match(/mountId: (mount_\w+)/)[1]
    const container = document.body.querySelector(".agent-mount-holder .agent-mount")
    expect(container).toBeTruthy()
    expect(container.querySelector("button").textContent).toBe("roll")

    const handle = sessionWith("c1", { url: "automerge:package" }, out)
    const { element, cleanup } = mount(handle, { repo })

    const view = element.querySelector('.agent-view[data-kind="mount"]')
    expect(view).toBeTruthy()
    expect(view.dataset.expanded).toBe("yes")
    expect(view.querySelector(".agent-view-body").firstElementChild).toBe(container)
    expect(document.body.querySelector(".agent-mount-holder .agent-mount")).toBeNull() // moved, not copied

    // A re-render moves the same running tool; it is not torn down and remade.
    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("looks good")])))
    expect(element.querySelector('.agent-view[data-kind="mount"] .agent-view-body').firstElementChild).toBe(container)
    expect(container.querySelector("button").textContent).toBe("roll")

    // Closing the session view parks the agent's mount; the agent keeps working.
    cleanup()
    expect(document.body.querySelector(".agent-mount-holder .agent-mount")).toBe(container)
    expect(container.querySelector("button")).toBeTruthy()
  })

  it("shows a package the agent wrote as a view with Try it and install controls, not a chip", () => {
    const handle = fakeHandle()
    handle.change((d) => {
      d.turns.push(makeTurn("assistant", [callBlock("fs_write", { files: { "tally/index.js": "" } }, { id: "c1", status: CALL.done })]))
      d.turns.push(makeTurn("tool", [resultBlock("c1", "Wrote 1 file(s)", { doc: { url: "automerge:tally", name: "tally", kind: "package" } })]))
    })
    const { element, cleanup } = mount(handle)
    const view = element.querySelector('.agent-view[data-kind="package"]')
    expect(view).toBeTruthy()
    expect(view.dataset.expanded).toBe("no")
    expect(view.querySelector(".agent-view-title").textContent).toBe("tally")
    expect([...view.querySelectorAll("button")].map((b) => b.textContent)).toContain("Try it")
    expect(element.querySelector(".agent-doc-chip")).toBeNull()
    expect(element.querySelector(".agent-made")).toBeNull()
    expect(element.querySelector(".agent-bench-pane")).toBeNull()
    cleanup()
  })
})

describe("the workflow link in the header", () => {
  const opened = (element) => {
    const urls = []
    element.addEventListener("patchwork:open-document", (event) => urls.push(event.detail.url))
    return urls
  }

  it("is hidden when the session has no workflow", () => {
    const { element, cleanup } = mount(fakeHandle())
    expect(element.querySelector(".agent-workflow-link").hidden).toBe(true)
    cleanup()
  })

  it("on a step's session opens the plan it is a step of", () => {
    const handle = fakeHandle()
    handle.change((d) => {
      d.workflow = { planUrl: "automerge:plan", stepId: "research", orchestratorUrl: "automerge:orch" }
    })
    const { element, cleanup } = mount(handle)
    const urls = opened(element)
    const link = element.querySelector(".agent-workflow-link")
    expect([link.hidden, link.textContent]).toEqual([false, "↑ Workflow"])
    link.click()
    expect(urls).toEqual(["automerge:plan"])
    cleanup()
  })

  it("on an orchestrator opens the latest workflow it started, and appears as soon as one is started", () => {
    const handle = fakeHandle()
    const { element, cleanup } = mount(handle)
    const urls = opened(element)
    const link = element.querySelector(".agent-workflow-link")
    expect(link.hidden).toBe(true)
    handle.change((d) => {
      d.made = [
        { url: "automerge:first", kind: "agent-workflow", name: "First" },
        { url: "automerge:pkg", kind: "package", name: "pkg" },
        { url: "automerge:second", kind: "agent-workflow", name: "Second" },
      ]
    })
    expect([link.hidden, link.textContent]).toEqual([false, "Workflow"])
    link.click()
    expect(urls).toEqual(["automerge:second"])
    cleanup()
  })
})
