/**
 * The ambient agent: a floating box summoned from anywhere, whose messages
 * carry what was open when they were sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { AmbientAgent, STORAGE_TOOL_ID, STORAGE_PATIENCE_MS } from "./ui/ambient.js"
import { contextBlock, describeContext, toRequest, initSession, makeTurn, textBlock } from "./session/session.js"
import { say } from "./kernel/loop.js"
import { memoryStore } from "./kernel/store.js"
import { _reset as resetRunners } from "./runners/registry.js"

// ---- doubles -------------------------------------------------------------

let counter = 0

function fakeHandle(doc = {}, url = `automerge:doc${++counter}`) {
  const listeners = new Set()
  return {
    url,
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (_event, fn) => listeners.delete(fn),
  }
}

function fakeRepo(seed = {}) {
  const handles = new Map(Object.entries(seed).map(([url, doc]) => [url, fakeHandle(doc, url)]))
  return {
    handles,
    find: async (url) => {
      const handle = handles.get(url)
      if (!handle) throw new Error(`no ${url}`)
      return handle
    },
    create2: async () => {
      const handle = fakeHandle({})
      handles.set(handle.url, handle)
      return handle
    },
  }
}

/**
 * A frame, as far as the agent can tell: something above it that answers
 * `patchwork:subscribe` for the selection, the open views and tool storage,
 * and that hears `patchwork:open-document`.
 */
function fakeFrame({ selected = null, open = [], storageUrl = null } = {}) {
  const frame = document.createElement("div")
  document.body.append(frame)
  const ports = { selected: new Set(), open: new Set(), storage: new Set() }
  const opened = []
  const send = (port, value) => port.postMessage({ type: "change", value })

  frame.addEventListener("patchwork:subscribe", (event) => {
    const { selector, port } = event.detail
    if (selector.type === "patchwork:selected-doc") {
      ports.selected.add(port)
      send(port, selected ? [selected] : [])
    } else if (selector.type === "patchwork:open-views") {
      ports.open.add(port)
      send(port, open)
    } else if (selector.type === "patchwork:tool-storage" && selector.toolId === STORAGE_TOOL_ID) {
      ports.storage.add(port)
      if (storageUrl) send(port, storageUrl)
    }
  })
  frame.addEventListener("patchwork:open-document", (event) => opened.push(event.detail))

  return {
    frame,
    opened,
    select(url) {
      selected = url
      for (const port of ports.selected) send(port, url ? [url] : [])
    },
    setOpen(views) {
      open = views
      for (const port of ports.open) send(port, views)
    },
    /** The account's storage arriving, however late. */
    answerStorage(url) {
      storageUrl = url
      for (const port of ports.storage) send(port, url)
    },
  }
}

const press = (key, opts = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, ...opts }))

const STORAGE = "automerge:storage"

let cleanups = []
beforeEach(() => {
  localStorage.clear()
  resetRunners()
  cleanups = []
})
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup()
  document.body.replaceChildren()
})

function mountAmbient(frameOpts = {}, repoSeed = {}) {
  const repo = fakeRepo({ [STORAGE]: {}, ...repoSeed })
  const frame = fakeFrame({ storageUrl: STORAGE, ...frameOpts })
  // As the frame mounts it: a content element inside the overlay's view.
  const view = document.createElement("patchwork-view")
  const element = document.createElement("div")
  view.append(element)
  frame.frame.append(view)
  cleanups.push(AmbientAgent(element, { repo }))
  const box = () => element.querySelector(".agent-float")
  return { repo, frame, view, element, box, storage: () => repo.handles.get(STORAGE).doc() }
}

// ---- the context block ---------------------------------------------------

describe("the context block", () => {
  it("names the focused document and what else is open, for the model", () => {
    const block = contextBlock({
      focused: { url: "automerge:a", title: "Soup", toolId: "markdown" },
      open: [
        { url: "automerge:a", title: "Soup", toolId: "markdown" },
        { url: "automerge:b", title: null, toolId: null },
      ],
    })
    // The focused document is not repeated among the others.
    expect(block.open.map((v) => v.url)).toEqual(["automerge:b"])
    const text = describeContext(block)
    expect(text).toContain('Focused: "Soup" — automerge:a (in markdown)')
    expect(text).toContain("- untitled — automerge:b")
  })

  it("stores no undefined, which automerge refuses", () => {
    const block = contextBlock({ focused: { url: "automerge:a" } })
    expect(JSON.stringify(block)).not.toContain("undefined")
    expect(block.focused).toEqual({ url: "automerge:a", title: null, toolId: null })
  })

  it("is sent ahead of the words it explains", () => {
    const doc = {}
    initSession(doc)
    const store = memoryStore(doc)
    say(store, "fix the typo here", null, { focused: { url: "automerge:a", title: "Soup" } })
    const [message] = toRequest(store.doc()).messages
    expect(message.content.map((c) => c.type)).toEqual(["text", "text"])
    expect(message.content[0].text).toMatch(/^\[Workspace when this message was sent\]/)
    expect(message.content[1].text).toBe("fix the typo here")
  })

  it("is left out when nothing was open", () => {
    const doc = {}
    initSession(doc)
    const store = memoryStore(doc)
    say(store, "hello", null, { focused: null, open: [] })
    expect(store.doc().turns[0].blocks.map((b) => b.type)).toEqual(["text"])
  })

  it("does not become the session's title", async () => {
    const { sessionTitle } = await import("./session/session.js")
    const doc = {}
    initSession(doc)
    doc.turns.push(
      makeTurn("user", [contextBlock({ focused: { url: "automerge:a", title: "Soup" } }), textBlock("rename it")])
    )
    expect(sessionTitle(doc)).toBe("rename it")
  })
})

// ---- the floating box ----------------------------------------------------

describe("the ambient box", () => {
  it("starts hidden and makes no session until summoned", async () => {
    const { box, storage } = mountAmbient()
    expect(box().hidden).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(storage().sessionUrl).toBeUndefined()
  })

  it("is summoned and dismissed with Ctrl/Cmd+J", async () => {
    const { box, storage, repo } = mountAmbient()
    press("j")
    expect(box().hidden).toBe(false)
    await vi.waitFor(() => expect(box().querySelector(".patchwork-agent")).toBeTruthy())

    // The session is the account's, kept in tool storage, and has no subject.
    const url = storage().sessionUrl
    expect(url).toBeTruthy()
    expect(storage().sessions).toEqual([url])
    expect(repo.handles.get(url).doc().subject).toBeNull()

    press("j", { ctrlKey: false, metaKey: true })
    expect(box().hidden).toBe(true)
  })

  it("is dismissed with Escape from inside it, and gives focus back", async () => {
    const { box } = mountAmbient()
    const before = document.createElement("button")
    document.body.append(before)
    before.focus()

    press("j")
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"))
    press("Escape", { ctrlKey: false })
    expect(box().hidden).toBe(true)
    expect(document.activeElement).toBe(before)
  })

  it("comes back to the same session", async () => {
    const first = mountAmbient()
    press("j")
    await vi.waitFor(() => expect(first.storage().sessionUrl).toBeTruthy())
    const url = first.storage().sessionUrl
    cleanups.pop()()

    // A second mount over the same storage reuses it rather than starting over.
    const element = document.createElement("div")
    first.frame.frame.append(element)
    cleanups.push(AmbientAgent(element, { repo: first.repo }))
    press("j")
    await vi.waitFor(() => expect(element.querySelector(".patchwork-agent")).toBeTruthy())
    expect(first.storage().sessionUrl).toBe(url)
    expect(first.storage().sessions).toEqual([url])
  })

  it("starts a new session on New, keeping the old one in its history", async () => {
    const { box, storage } = mountAmbient()
    press("j")
    await vi.waitFor(() => expect(storage().sessionUrl).toBeTruthy())
    const first = storage().sessionUrl
    box().querySelector("button[title='Start a new session']").click()
    await vi.waitFor(() => expect(storage().sessionUrl).not.toBe(first))
    expect(storage().sessions).toEqual([storage().sessionUrl, first])
  })

  it("waits for the account's storage, however long it takes, and keeps no list of its own", async () => {
    // What an older version left on this device is neither read nor written.
    localStorage.setItem("patchwork-agent:ambient", JSON.stringify({ sessionUrl: "automerge:old", sessions: ["automerge:old"] }))
    const { box, frame, storage, repo } = mountAmbient({ storageUrl: null })
    press("j")
    expect(box().hidden).toBe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(box().querySelector(".patchwork-agent")).toBeNull()
    expect(repo.handles.size).toBe(1) // only the storage document: no session made in the meantime

    frame.answerStorage(STORAGE)
    await vi.waitFor(() => expect(box().querySelector(".patchwork-agent")).toBeTruthy())
    expect(storage().sessions).toEqual([storage().sessionUrl])
    expect(storage().sessions).not.toContain("automerge:old")
    expect(JSON.parse(localStorage.getItem("patchwork-agent:ambient")).sessions).toEqual(["automerge:old"])
  })

  it("says it is waiting when the account's storage is slow", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const { box, frame, repo } = mountAmbient({ storageUrl: null })
      press("j")
      await vi.advanceTimersByTimeAsync(STORAGE_PATIENCE_MS * 10)
      expect(box().textContent).toContain("Waiting for your account's agent storage")
      // Long past when the old stand-in took over: no session, no local list.
      expect(repo.handles.size).toBe(1)
      expect(localStorage.getItem("patchwork-agent:ambient")).toBeNull()
      frame.answerStorage(STORAGE)
      vi.useRealTimers()
      await vi.waitFor(() => expect(box().querySelector(".patchwork-agent")).toBeTruthy())
      expect(box().textContent).not.toContain("Waiting for your account's agent storage")
    } finally {
      vi.useRealTimers()
    }
  })

  it("docks the session as a panel", async () => {
    const { box, storage, frame } = mountAmbient()
    press("j")
    await vi.waitFor(() => expect(storage().sessionUrl).toBeTruthy())
    box().querySelector("button[title='Open this session as a panel']").click()
    expect(frame.opened).toEqual([{ url: storage().sessionUrl, toolId: "agent-session" }])
    expect(box().hidden).toBe(true)
  })

  it("labels its bar with the focused document", async () => {
    const { box, frame } = mountAmbient({ selected: "automerge:soup" }, { "automerge:soup": { title: "Soup" } })
    await vi.waitFor(() => expect(box().querySelector(".agent-float-on").textContent).toBe("on Soup"))
    frame.select(null)
    await vi.waitFor(() => expect(box().querySelector(".agent-float-on").textContent).toBe("Agent"))
  })

  it("sends what was focused and open with each message", async () => {
    // A key enables Send, which also starts the runner; keep it off the network.
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }))
    cleanups.push(() => vi.unstubAllGlobals())
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-test")
    const { box, storage, repo, frame } = mountAmbient(
      {
        selected: "automerge:soup",
        open: [
          { url: "automerge:soup", toolId: "markdown", selected: true },
          { url: "automerge:salad", toolId: "markdown", selected: false },
        ],
      },
      { "automerge:soup": { title: "Soup" }, "automerge:salad": { title: "Salad" } }
    )
    press("j")
    await vi.waitFor(() => expect(box().querySelector("textarea")).toBeTruthy())
    const session = repo.handles.get(storage().sessionUrl)

    // Docked or not, clicking into the session itself does not make the agent
    // the subject of its own conversation: "this" is still the soup.
    frame.select(session.url)
    frame.setOpen([
      { url: "automerge:soup", toolId: "markdown", selected: false },
      { url: "automerge:salad", toolId: "markdown", selected: false },
      { url: session.url, toolId: "agent-session", selected: true },
    ])
    await new Promise((r) => setTimeout(r, 10))

    box().querySelector("textarea").value = "fix the typo here"
    box().querySelector(".agent-composer button[data-variant='primary']").click()
    await vi.waitFor(() => expect(session.doc().turns?.length).toBeGreaterThan(0))

    const [context, text] = session.doc().turns[0].blocks
    expect(text.text).toBe("fix the typo here")
    expect(context.type).toBe("context")
    expect(context.focused).toEqual({ url: "automerge:soup", title: "Soup", toolId: "markdown" })
    expect(context.open).toEqual([{ url: "automerge:salad", title: "Salad", toolId: "markdown" }])
  })
})

// ---- the frame's button --------------------------------------------------

describe("the frame's button for it", () => {
  it("toggles the box, and hears whether it is open", async () => {
    const { box, frame, view } = mountAmbient()
    const states = []
    frame.frame.addEventListener("patchwork:overlay-state", (e) => states.push(e.detail.open))

    view.dispatchEvent(new CustomEvent("patchwork:toggle-overlay"))
    expect(box().hidden).toBe(false)
    view.dispatchEvent(new CustomEvent("patchwork:toggle-overlay"))
    expect(box().hidden).toBe(true)

    // The shortcut and Close report too, so the button never shows stale.
    press("j")
    box().querySelector(".agent-float-close").click()
    expect(states).toEqual([true, false, true, false])
  })
})
