/**
 * The pop-over at rest: a pill while the agent works, a peek when something
 * needs you (answered in place), and notifications while the tab is away.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { generateAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { AmbientAgent, STORAGE_TOOL_ID } from "./ui/ambient.js"
import { initSession, makeTurn, textBlock, callBlock, CALL, STATUS, _resetIds } from "./session/session.js"
import { activityOf, askedInText, watchAttention, LONG_RUN_MS } from "./ui/attention.js"
import { createNotifier, setNotifications, notificationsEnabled, describe as describeNotice } from "./ui/notify.js"
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

const STORAGE = "automerge:storage"
function fakeFrame() {
  const frame = document.createElement("div")
  document.body.append(frame)
  const opened = []
  const openPorts = new Set()
  let views = []
  frame.addEventListener("patchwork:subscribe", (event) => {
    const { selector, port } = event.detail
    if (selector.type === "patchwork:open-views") {
      openPorts.add(port)
      port.postMessage({ type: "change", value: views })
      return
    }
    const value = selector.type === "patchwork:tool-storage" && selector.toolId === STORAGE_TOOL_ID ? STORAGE : []
    port.postMessage({ type: "change", value })
  })
  frame.addEventListener("patchwork:open-document", (event) => opened.push(event.detail))
  /** What the frame has open in its views. */
  const setOpen = (urls) => {
    views = urls.map((url) => ({ url, toolId: null }))
    for (const port of openPorts) port.postMessage({ type: "change", value: views })
  }
  return { frame, opened, setOpen }
}

/** A session in a given state. */
function session(state, { title = "Battery pack" } = {}) {
  const doc = {}
  initSession(doc, { title })
  doc.turns.push(makeTurn("user", [textBlock("design a battery pack")]))
  if (state === "working") {
    const call = callBlock("doc_edit", { url: "automerge:pack", ops: [] }, { id: "c1" })
    call.status = CALL.running
    doc.turns.push(makeTurn("assistant", [call]))
    doc.status = STATUS.running
  } else if (state === "asking") {
    const call = callBlock("ask_user", { question: "Target voltage?", options: ["400 V", "48 V"] }, { id: "q1" })
    call.status = CALL.asking
    doc.turns.push(makeTurn("assistant", [call]))
    doc.status = STATUS.awaitingAnswer
  } else if (state === "approval") {
    const call = callBlock("web_fetch", { url: "https://dnv.com/rules" }, { id: "p1" })
    call.status = CALL.pending
    doc.turns.push(makeTurn("assistant", [call]))
    doc.status = STATUS.awaitingApproval
  } else if (state === "asked-in-text") {
    doc.turns.push(makeTurn("assistant", [textBlock("The research is running.\n\nOne question: do you have a target voltage, **400 V or 48 V?**")]))
  } else if (state === "done") {
    doc.turns.push(makeTurn("assistant", [textBlock("All done. The pack is in /Battery Pack.")]))
  }
  return doc
}

let cleanups = []
beforeEach(() => {
  _resetIds()
  localStorage.clear()
  resetRunners()
  cleanups = []
})
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function mount(doc, extra = {}) {
  const repo = fakeRepo({ [STORAGE]: { sessionUrl: "automerge:s1", sessions: ["automerge:s1"] }, "automerge:s1": doc, ...extra })
  const { frame, opened, setOpen } = fakeFrame()
  const view = document.createElement("patchwork-view")
  const element = document.createElement("div")
  view.append(element)
  frame.append(view)
  cleanups.push(AmbientAgent(element, { repo }))
  const $ = (selector) => element.querySelector(selector)
  return { repo, element, opened, setOpen, $, s1: repo.handles.get("automerge:s1") }
}

// ---- what deserves attention ---------------------------------------------

describe("what a session is doing", () => {
  it("names the call in flight, or says it is thinking or writing", () => {
    expect(activityOf(session("working"))).toMatch(/…$/)
    expect(activityOf(session("working"))).not.toBe("Thinking…")
    const writing = session("idle")
    writing.status = STATUS.running
    writing.turns.push(makeTurn("assistant", [textBlock("Here is")]))
    expect(activityOf(writing)).toBe("Writing…")
    expect(activityOf(session("done"))).toBeNull()
  })
})

describe("a question asked in prose", () => {
  it("is the last paragraph of a finished reply, when it ends with a question mark", () => {
    expect(askedInText(session("asked-in-text"))).toBe("One question: do you have a target voltage, **400 V or 48 V?**")
  })

  it.each([
    ["a reply that ends on a statement", "done"],
    ["a session still working", "working"],
    ["a question asked properly, which shows as a question", "asking"],
  ])("is not found in %s", (_name, state) => {
    expect(askedInText(session(state))).toBeNull()
  })

  it("only counts if it is the last paragraph", () => {
    const doc = session("idle")
    doc.turns.push(makeTurn("assistant", [textBlock("Should I use 400 V?\n\nI went with 400 V.")]))
    expect(askedInText(doc)).toBeNull()
  })
})

describe("following sessions", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it("reports a long run when it ends, once, and not a short one", async () => {
    let t = 0
    const repo = fakeRepo({ "automerge:s1": session("working"), "automerge:s2": session("working") })
    const watcher = watchAttention(repo, () => ["automerge:s1", "automerge:s2"], () => {}, { now: () => t })
    await tick()
    const finish = (url) => repo.handles.get(url).change((d) => {
      d.status = STATUS.idle
      d.turns.push(makeTurn("assistant", [textBlock("Pack designed.\nDetails follow.")]))
    })

    t = 5_000
    finish("automerge:s2") // five seconds: not worth a notification
    t = LONG_RUN_MS + 1
    finish("automerge:s1")
    const { finished } = watcher.snapshot()
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ kind: "finished", sessionUrl: "automerge:s1", summary: "Pack designed." })
    expect(watcher.snapshot().finished).toEqual([]) // once
    watcher.dispose()
  })

  it("does not call a run that stopped for a person finished", async () => {
    let t = 0
    const repo = fakeRepo({ "automerge:s1": session("working") })
    const watcher = watchAttention(repo, () => ["automerge:s1"], () => {}, { now: () => t })
    await tick()
    t = LONG_RUN_MS * 2
    repo.handles.get("automerge:s1").change((d) => { d.status = STATUS.awaitingApproval })
    expect(watcher.snapshot().finished).toEqual([])
    watcher.dispose()
  })

  it("finds what waits on you in your sessions and in their workflows' steps", async () => {
    const orchestrator = session("done")
    orchestrator.made.push({ url: "automerge:plan", name: "Pack", kind: "agent-workflow" })
    const repo = fakeRepo({
      "automerge:s1": orchestrator,
      "automerge:s2": session("asking"),
      "automerge:plan": { title: "Pack", steps: [{ id: "cells", title: "Source cells", status: "running", sessionUrl: "automerge:step" }] },
      "automerge:step": session("approval"),
    })
    const watcher = watchAttention(repo, () => ["automerge:s1", "automerge:s2"], () => {})
    await vi.waitFor(() => expect(watcher.snapshot().needs).toHaveLength(2))
    const needs = watcher.snapshot().needs
    expect(needs.map((n) => n.kind).sort()).toEqual(["approval", "question"])
    expect(needs.find((n) => n.kind === "approval")).toMatchObject({ step: true, title: "Pack · Source cells", tool: "web_fetch" })
    watcher.dispose()
  })
})

// ---- notifications -------------------------------------------------------

describe("notifications", () => {
  function fakeNotification() {
    const sent = []
    class N {
      static permission = "granted"
      static requestPermission = vi.fn(async () => "granted")
      constructor(title, options) {
        this.title = title
        this.options = options
        sent.push(this)
      }
      close() {}
    }
    vi.stubGlobal("Notification", N)
    return sent
  }

  it("go out only while the tab is not in front, once per event, tagged so tabs do not repeat each other", () => {
    const sent = fakeNotification()
    let front = true
    const opened = []
    const notifier = createNotifier({ enabled: () => true, inFront: () => front, onClick: (e) => opened.push(e.key) })
    const asking = { kind: "question", key: "s1:q1", title: "Battery pack", question: "Target voltage?" }

    expect(notifier.notify(asking)).toBe(false) // seen in the tab
    front = false
    expect(notifier.notify(asking)).toBe(false) // and so not again
    expect(notifier.notify({ ...asking, key: "s1:q2" })).toBe(true)
    expect(sent.map((n) => [n.title, n.options.tag])).toEqual([["Battery pack is asking you", "s1:q2"]])
    sent[0].onclick()
    expect(opened).toEqual(["s1:q2"])
  })

  it("stay silent when switched off", () => {
    const sent = fakeNotification()
    const notifier = createNotifier({ enabled: () => false, inFront: () => false })
    notifier.notify({ kind: "finished", key: "k", title: "T" })
    expect(sent).toEqual([])
  })

  it("are switched on per device, asking the browser the first time", async () => {
    fakeNotification()
    Notification.permission = "default"
    Notification.requestPermission.mockImplementation(async () => { Notification.permission = "granted"; return "granted" })
    expect(notificationsEnabled()).toBe(false)
    expect(await setNotifications(true)).toBe(true)
    expect(Notification.requestPermission).toHaveBeenCalledOnce()
    expect(await setNotifications(false)).toBe(false)
  })

  it.each([
    [{ kind: "finished", title: "Battery pack", summary: "Pack designed." }, "Battery pack finished", "Pack designed."],
    [{ kind: "approval", title: "Pack · Source cells", tool: "web_fetch" }, "Pack · Source cells needs your permission", "To run web_fetch."],
    [{ kind: "asked", title: "Battery pack", question: "400 V or 48 V?" }, "Battery pack is asking you", "400 V or 48 V?"],
  ])("say what happened: %j", (event, title, body) => {
    expect(describeNotice(event)).toEqual({ title, body })
  })
})

// ---- the pop-over at rest --------------------------------------------------

describe("the pop-over at rest", () => {
  it("shows nothing while the agent is idle", async () => {
    const { $ } = mount(session("done"))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect($(".agent-pill").hidden).toBe(true)
    expect($(".agent-peek").hidden).toBe(true)
    expect($(".agent-float").hidden).toBe(true)
  })

  it("shows a pill while it works, saying on what; the pill opens it", async () => {
    const { $ } = mount(session("working"))
    await vi.waitFor(() => expect($(".agent-pill").hidden).toBe(false))
    expect($(".agent-pill").textContent).toMatch(/^Battery pack: .+…/)
    $(".agent-pill").click()
    expect($(".agent-float").hidden).toBe(false)
    expect($(".agent-pill").hidden).toBe(true) // open, it is the pop-over itself
  })

  it("peeks up with a question, answered with one of its options", async () => {
    const { $, s1 } = mount(session("asking"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    expect($(".agent-peek").textContent).toContain("Battery pack asks")
    expect($(".agent-peek").textContent).toContain("Target voltage?")
    ;[...$(".agent-peek").querySelectorAll("button")].find((b) => b.textContent === "400 V").click()
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(true))
    expect(JSON.stringify(s1.doc().turns.at(-1))).toContain("400 V")
  })

  it("peeks up for a question asked in prose, and the answer goes to the session", async () => {
    const { $, s1 } = mount(session("asked-in-text"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    expect($(".agent-peek").textContent).toContain("400 V or 48 V?")
    $(".agent-peek input").value = "400 V, propulsion"
    ;[...$(".agent-peek").querySelectorAll("button")].find((b) => b.textContent === "Answer").click()
    expect(s1.doc().turns.at(-1)).toMatchObject({ role: "user" })
    expect(s1.doc().turns.at(-1).blocks.at(-1).text).toBe("400 V, propulsion")
  })

  it("peeks up for a permission; Allow once grants it in the session", async () => {
    const { $, s1 } = mount(session("approval"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    expect($(".agent-peek").textContent).toContain("needs your permission")
    ;[...$(".agent-peek").querySelectorAll("button")].find((b) => b.textContent === "Allow once").click()
    expect(s1.doc().turns[1].blocks[0].status).toBe(CALL.approved)
  })

  it("can be put off with Later", async () => {
    const { $ } = mount(session("asking"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    ;[...$(".agent-peek").querySelectorAll("button")].find((b) => b.textContent === "Later").click()
    expect($(".agent-peek").hidden).toBe(true)
  })

  it("steps aside while the pop-over is open", async () => {
    const { $, element } = mount(session("asking"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }))
    expect($(".agent-float").hidden).toBe(false)
    expect($(".agent-peek").hidden).toBe(true)
    expect(element.querySelector(".agent-pop")).toBeTruthy()
  })

  it("stands aside while the workflow it belongs to is open, which shows it already", async () => {
    // Real document URLs: which views are open is decided by the repo's own
    // parser, which rejects a made-up id.
    const plan = generateAutomergeUrl()
    const step = generateAutomergeUrl()
    const orchestrator = session("done")
    orchestrator.made.push({ url: plan, name: "Pack", kind: "agent-workflow" })
    const { $, setOpen } = mount(orchestrator, {
      [plan]: { title: "Pack", steps: [{ id: "nb", title: "Notebook", status: "running", sessionUrl: step }] },
      [step]: session("approval"),
    })
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    setOpen([`${plan}#${encodeHeads(["ab".repeat(32)])[0]}`]) // the workflow's view, however its URL is spelled
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(true))
    setOpen([])
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    setOpen([step]) // or the step's own session
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(true))
  })

  it("lays its buttons out and styles them — the peek is outside any session view", async () => {
    const { $ } = mount(session("approval"))
    await vi.waitFor(() => expect($(".agent-peek").hidden).toBe(false))
    expect($(".agent-peek .agent-waiting-item .cluster")).toBeTruthy()
    const css = (await import("node:fs")).readFileSync(`${process.cwd()}/ui/styles.css`, "utf8")
    expect(css).toContain(":is(.patchwork-agent, .agent-pop) button {")
    expect(css).toContain(".agent-pop .cluster {")
  })
})
