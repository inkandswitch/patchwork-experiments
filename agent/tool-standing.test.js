/**
 * The panel of a step's session: it says where the step stands, and a message
 * to a step that is not running waits for a choice — a question in a side
 * thread, or reopening the step — instead of going in. Real documents, a real
 * driver; nothing runs a model.
 */
import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { AgentTool } from "./ui/session-view.js"
import { initSession, makeTurn, textBlock, STATUS } from "./session/session.js"
import { initPlan, STEP } from "./workflow/plan.js"
import { ensureDriver, _resetDrivers } from "./workflow/driver.js"
import { _reset as resetRunners } from "./runners/registry.js"

await initSubduction()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(20)
  }
  return false
}

const cleanups = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  _resetDrivers()
  resetRunners()
  document.body.replaceChildren()
})

/** A two-step plan, a → b, both done; and b's session. */
async function world(bStatus = STEP.done) {
  const repo = new Repo({ network: [] })
  const plan = await repo.create2()
  const session = await repo.create2()
  plan.change((d) => {
    initPlan(d, {
      title: "Rig study",
      goal: "g",
      steps: [
        { id: "a", title: "Loads", prompt: "p", why: "w", after: [], where: "worker", tier: "cheap" },
        { id: "b", title: "Sizing", prompt: "p", why: "w", after: ["a"], where: "worker", tier: "cheap" },
      ],
    })
    d.steps[0].status = STEP.done
    d.steps[0].version = 1
    d.steps[1].status = bStatus
    d.steps[1].version = bStatus === STEP.done ? 1 : 0
    d.steps[1].inputs = { a: 1 }
    d.steps[1].sessionUrl = session.url
    d.steps[1].result = "Use 8 mm wire."
  })
  session.change((d) => {
    initSession(d, { title: "Rig study · Sizing" })
    d.workflow = { planUrl: plan.url, stepId: "b", orchestratorUrl: null }
    d.turns.push(makeTurn("user", [textBlock("Size the wire.")]))
    d.turns.push(makeTurn("assistant", [textBlock("Use 8 mm wire.")]))
  })
  return { repo, plan, session }
}

function mount(repo, handle) {
  const element = document.createElement("div")
  document.body.append(element)
  const opened = []
  element.addEventListener("patchwork:open-document", (event) => opened.push(event.detail.url))
  cleanups.push(AgentTool(handle, element, { repo }))
  const q = (sel) => element.querySelector(sel)
  const type = (text) => {
    const box = q(".agent-composer textarea")
    box.value = text
    // Enter, not the Send button: with no API key here the button is
    // disabled, and no key also means no runner ever calls a model.
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  }
  const choose = (label) => [...element.querySelectorAll(".agent-send-choices button")].find((b) => b.textContent.startsWith(label)).click()
  return { element, q, type, choose, opened }
}

describe("a step's session in its panel", () => {
  it("says where its step stands, live with the plan", async () => {
    const { repo, plan, session } = await world()
    const { q } = mount(repo, session)
    expect(await until(() => !q(".agent-standing").hidden)).toBe(true)
    expect(q(".agent-standing").dataset.state).toBe("done")
    expect(q(".agent-standing").textContent).toContain("Step “Sizing” of “Rig study”")

    plan.change((d) => (d.steps[0].version = 2))
    expect(await until(() => q(".agent-standing").dataset.state === "stale")).toBe(true)
    expect(q(".agent-standing").textContent).toContain("Loads changed since it finished")
  })

  it("a message to a running step goes straight in", async () => {
    const { repo, session } = await world(STEP.running)
    const { q, type } = mount(repo, session)
    await until(() => !q(".agent-standing").hidden)
    type("Use stainless.")
    await until(() => session.doc().turns.length === 3)
    expect(session.doc().turns.at(-1).blocks.at(-1).text).toBe("Use stainless.")
    expect(q(".agent-send-choices").hidden).toBe(true)
  })

  it("a message to a done step waits for a choice, and a question goes to a side thread", async () => {
    const { repo, session } = await world()
    const { q, type, choose, opened } = mount(repo, session)
    await until(() => !q(".agent-standing").hidden)
    type("Why 8 mm?")
    expect(q(".agent-send-choices").hidden).toBe(false)
    expect(session.doc().turns.length).toBe(2)
    expect(q(".agent-composer textarea").value).toBe("Why 8 mm?")

    choose("A question")
    expect(await until(() => opened.length === 1)).toBe(true)
    const aside = (await repo.find(opened[0])).doc()
    expect(aside.aside.sessionUrl).toBe(session.url)
    expect(aside.turns.at(-1).blocks.at(-1).text).toBe("Why 8 mm?")
    // The step's own conversation is as it was.
    expect(session.doc().turns.length).toBe(2)
    expect(q(".agent-composer textarea").value).toBe("")
  })

  it("Cancel keeps the message and sends nothing", async () => {
    const { repo, session } = await world()
    const { q, type, choose } = mount(repo, session)
    await until(() => !q(".agent-standing").hidden)
    type("Hmm")
    choose("Cancel")
    expect(q(".agent-send-choices").hidden).toBe(true)
    expect(q(".agent-composer textarea").value).toBe("Hmm")
    expect(session.doc().turns.length).toBe(2)
  })

  it("reopening carries the step on in its own session, told the message", async () => {
    const { repo, plan, session } = await world()
    await ensureDriver(plan.url, { repo, startSession: async () => ({ runner: null }) })
    const { q, type, choose } = mount(repo, session)
    await until(() => !q(".agent-standing").hidden)
    type("Redo it for a 40 ft mast.")
    choose("Reopen the step")
    expect(await until(() => plan.doc().steps[1].previous?.length === 1)).toBe(true)
    expect(await until(() => plan.doc().steps[1].status === STEP.running)).toBe(true)
    expect(JSON.stringify(session.doc().turns.at(-1))).toContain("Redo it for a 40 ft mast.")
    expect(await until(() => q(".agent-standing").dataset.state === "running")).toBe(true)
    // Running again: the next message goes straight in.
    expect(q(".agent-composer textarea").placeholder).toBe("Ask for a change…")
  })

  it("a side thread links back to its step and takes messages straight", async () => {
    const { repo, session } = await world()
    const first = mount(repo, session)
    await until(() => !first.q(".agent-standing").hidden)
    first.type("Why?")
    first.choose("A question")
    await until(() => first.opened.length === 1)

    const aside = await repo.find(first.opened[0])
    const view = mount(repo, aside)
    expect(await until(() => !view.q(".agent-standing").hidden)).toBe(true)
    expect(view.q(".agent-standing").textContent).toContain("A question about step “Sizing” of “Rig study”, which is now done")
    view.type("And 10 mm?")
    expect(await until(() => aside.doc().turns.at(-1).blocks.at(-1).text === "And 10 mm?")).toBe(true)
    view.q(".agent-standing-link").click()
    expect(view.opened).toEqual([session.url])
  })
})
