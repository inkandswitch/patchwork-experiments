/**
 * The composer on its own: no view around it, the session a plain store and
 * where it stands in a workflow handed in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createComposer } from "./composer.js"
import { renderChoices } from "./standing.js"
import { initSession, _resetIds } from "../session/schema.js"
import { memoryStore } from "../kernel/store.js"

beforeEach(() => {
  _resetIds()
  document.body.replaceChildren()
})

const DONE = { role: "step", planUrl: "automerge:plan", stepId: "b", standing: { steer: false, reopen: true, later: ["c"], label: "done" } }

function make({ step = false, place = null } = {}) {
  const doc = {}
  initSession(doc, {})
  if (step) doc.workflow = { planUrl: "automerge:plan", stepId: "b", orchestratorUrl: null }
  const store = memoryStore(doc)
  const root = document.createElement("div")
  document.body.append(root)
  const calls = { sent: 0, stopped: 0 }
  const composer = createComposer({
    handle: { url: "automerge:s", doc: () => store.doc(), change: (fn) => store.change(fn) },
    store,
    repo: null,
    root,
    place: () => place,
    onSent: () => calls.sent++,
    onStop: () => calls.stopped++,
  })
  root.append(composer.element)
  const field = composer.field
  const enter = (text) => {
    field.value = text
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  }
  const choices = () => composer.element.querySelector(".agent-send-choices")
  return { store, composer, field, enter, choices, calls }
}

describe("the composer", () => {
  it("sends what is typed on Enter, clears the box, and says it sent", async () => {
    const { store, field, enter, calls } = make()
    enter("rename it")
    await vi.waitFor(() => expect(calls.sent).toBe(1))
    expect([store.doc().turns.at(-1).blocks[0].text, field.value]).toEqual(["rename it", ""])
  })

  it("keeps a newline for Shift-Enter, and sends nothing for an empty box", () => {
    const { store, field, enter } = make()
    field.value = "two"
    const shifted = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
    field.dispatchEvent(shifted)
    expect(shifted.defaultPrevented).toBe(false)
    enter("   ")
    expect(store.doc().turns).toEqual([])
  })

  it("holds a message to a step whose plan has not loaded, and says so", () => {
    const { store, field, enter, choices } = make({ step: true, place: null })
    enter("why?")
    expect([choices().hidden, choices().textContent]).toEqual([false, "Loading this step's workflow… send again in a moment."])
    expect([store.doc().turns, field.value]).toEqual([[], "why?"])
  })

  it("asks what a message to a finished step is, and Cancel puts it back in the box", () => {
    const { store, field, enter, choices } = make({ step: true, place: DONE })
    enter("redo it")
    expect(choices().hidden).toBe(false)
    expect([...choices().querySelectorAll("button")].map((b) => [b.textContent, b.dataset.choice])).toEqual([
      ["A question, in a side thread", "ask"],
      ["Reopen the step with it", "reopen"],
      ["Reopen it and the 1 step after", "reopen-later"],
      ["Cancel", "cancel"],
    ])
    choices().querySelector("[data-choice=cancel]").click()
    expect([choices().hidden, field.value, document.activeElement === field, store.doc().turns]).toEqual([true, "redo it", true, []])
  })

  it("draws what the view value says, and drops a choice the step no longer needs", () => {
    const { composer, field, enter, choices } = make({ step: true, place: DONE })
    const send = composer.element.querySelector("button[data-variant=primary]")
    const stop = composer.element.querySelector("button[data-variant=danger]")
    composer.render({ hint: "Add an API key to start", placeholder: "This step is done: ask about it…", gate: DONE.standing, canSend: false, canStop: true })
    expect([composer.element.querySelector(".agent-hint").textContent, field.placeholder, send.disabled, stop.style.display]).toEqual([
      "Add an API key to start",
      "This step is done: ask about it…",
      true,
      "",
    ])
    enter("more")
    composer.render({ hint: "", placeholder: "Ask for a change…", gate: null, canSend: true, canStop: false })
    expect([choices().hidden, send.disabled, stop.style.display]).toEqual([true, false, "none"])
  })

  it("passes Stop on", () => {
    const { composer, calls } = make()
    composer.element.querySelector("button[data-variant=danger]").click()
    expect(calls.stopped).toBe(1)
  })
})

describe("the choice a gated message needs", () => {
  it("offers reopening only without attachments, which go with a question only", () => {
    const row = document.createElement("div")
    renderChoices(row, DONE.standing, { attachments: true })
    const reopen = [...row.querySelectorAll("button")].filter((b) => b.dataset.choice.startsWith("reopen"))
    expect(reopen.map((b) => [b.disabled, b.title])).toEqual([
      [true, "Attachments go with a question only"],
      [true, "Attachments go with a question only"],
    ])
    // Drawn again without them, the same buttons are enabled.
    renderChoices(row, DONE.standing, { attachments: false })
    expect(reopen.map((b) => b.isConnected && b.disabled)).toEqual([false, false])
  })

  it("offers only a question for a step that cannot be reopened", () => {
    const row = document.createElement("div")
    renderChoices(row, { ...DONE.standing, reopen: false }, {})
    expect([...row.querySelectorAll("button")].map((b) => b.dataset.choice)).toEqual(["ask", "cancel"])
  })
})
