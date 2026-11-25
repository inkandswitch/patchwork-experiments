/**
 * Lifting a spent budget, answered where the person is — as a permission is.
 *
 * A session that spent its budget (a workflow step, or any session given
 * one) waits on a person like a permission; its card says what it spent and
 * offers Give more, inline at the end of its transcript, on its workflow card,
 * in the orchestrator's strip and the pop-over. A workflow that spent its
 * budget offers Resume inline in the orchestrator's own transcript.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { liftBudget, liftAmounts } from "../session/usage.js"
import { waitingIn } from "../workflow/waiting.js"
import { renderWaitingItem } from "./waiting.js"
import { needsWork } from "../kernel/runner.js"
import { AgentTool } from "./session-view.js"
import { WorkflowView } from "./workflow-view.js"
import { initPlan, PLAN, STEP } from "../workflow/plan.js"
import { _resetDrivers } from "../workflow/driver.js"
import { _reset as resetRunners } from "../runners/registry.js"

await initSubduction()

beforeEach(() => {
  _resetIds()
  resetRunners()
  _resetDrivers()
  document.body.replaceChildren()
  localStorage.clear()
})

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

function stoppedSession({ limit = 0.5, spent = 0.52 } = {}) {
  const doc = {}
  initSession(doc, { title: "Assembly", config: { budget: limit } })
  doc.turns = [makeTurn("user", [textBlock("write it")]), makeTurn("assistant", [textBlock("⚠ Stopped: spent")])]
  doc.usage = { in: 1, out: 1, turns: 1, cost: spent }
  doc.stopped = { reason: "budget", spent, limit, at: 77 }
  return doc
}

function fakeHandle(doc) {
  const listeners = new Set()
  return {
    url: `automerge:lift${Math.random().toString(36).slice(2, 8)}`,
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (event, fn) => listeners.delete(fn),
  }
}

describe("lifting a spent budget", () => {
  it("gives more than whichever is higher, its budget or what it spent, and the session carries on", () => {
    for (const [limit, spent, add, expected] of [
      [0.5, 0.52, 1, 1.52],
      [2, 1.4, 1, 3],
      [0.5, 0.5, 0.25, 0.75],
    ]) {
      const doc = stoppedSession({ limit, spent })
      expect(liftBudget(doc, add)).toBe(expected)
      expect([doc.config.budget, doc.stopped, doc.turns.at(-1).role]).toEqual([expected, null, "user"])
      expect(doc.turns.at(-1).blocks[0].text).toBe(`[Your budget is now ${"$"}${expected.toFixed(2)}. Carry on from where you stopped.]`)
      expect(needsWork(doc)).toBe(true)
    }
  })

  it("on a session that has not stopped, only raises the budget", () => {
    const doc = stoppedSession()
    doc.stopped = null
    const turns = doc.turns.length
    liftBudget(doc, 1)
    expect(doc.turns).toHaveLength(turns)
  })

  it("refuses nothing or less", () => {
    for (const add of [0, -1, Number.NaN, "x"]) expect(() => liftBudget(stoppedSession(), add)).toThrow(/positive/)
  })

  it("offers as much again, or four times as much, never less than fifty cents", () => {
    expect(liftAmounts(0.5)).toEqual([0.5, 2])
    expect(liftAmounts(2)).toEqual([2, 8])
    expect(liftAmounts(0.1)).toEqual([0.5, 2])
  })

  it("is waiting on a person, like a permission, and its card lifts it", () => {
    const doc = stoppedSession()
    const items = waitingIn(doc)
    expect(items).toEqual([{ kind: "budget", scope: "session", callId: "budget:77", spent: 0.52, limit: 0.5 }])
    const card = renderWaitingItem({ ...items[0], handle: { change: (fn) => fn(doc), doc: () => doc } }, { showStep: false })
    expect(card.textContent).toMatch(/Spent its \$0\.50 budget \(\$0\.52\) and stopped part-way/)
    const buttons = [...card.querySelectorAll("button")]
    expect(buttons.map((b) => b.textContent)).toEqual(["Give $0.50 more", "Give $2.00 more"])
    buttons[1].click()
    expect([doc.config.budget, doc.stopped]).toEqual([2.52, null])
  })
})

describe("the lift, inline where the person is", () => {
  it("a session that spent its budget shows Give more at the end of its transcript", () => {
    const doc = stoppedSession()
    const handle = fakeHandle(doc)
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) } })
    const transcript = element.querySelector(".agent-transcript")
    expect(transcript.lastElementChild.classList.contains("agent-inline-waiting")).toBe(true)
    transcript.lastElementChild.querySelector("button").click()
    expect(doc.config.budget).toBe(1.02)
    expect(transcript.querySelector(".agent-inline-waiting")).toBe(null)
    cleanup()
  })

  it("an orchestrator whose workflow spent its budget shows Resume inline, not in the strip", async () => {
    const repo = new Repo({ network: [] })
    const plan = repo.create({})
    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { title: "Battery" })
      d.turns.push(makeTurn("user", [textBlock("design it")]), makeTurn("assistant", [textBlock("Started.")]))
      d.made = [{ url: plan.url, kind: "agent-workflow", name: "W" }]
    })
    plan.change((d) => {
      initPlan(d, { title: "W", goal: "G", sessionUrl: orchestrator.url, limits: { cost: 1 }, steps: [step("a"), step("b", { after: ["a"] })] })
      d.usage = { in: 1, out: 1, cost: 1.2 }
      d.paused = { reason: "budget", at: 5, spent: 1.2, limit: 1, reported: true }
      d.status = PLAN.stopped // so nothing starts driving it
    })
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(orchestrator, element, { repo })
    await settle()
    orchestrator.change((d) => {
      d.title = "Battery design" // a render, now the plan has loaded
    })
    await settle(20)
    const inline = element.querySelector(".agent-transcript .agent-inline-waiting")
    expect(inline.textContent).toMatch(/whole budget \(\$1\.20 of \$1\.00/)
    expect(element.querySelector(".agent-waiting").textContent).not.toMatch(/whole budget/)
    inline.querySelector("button").click()
    expect([plan.doc().paused, plan.doc().limits.cost]).toEqual([null, 6.2])
    cleanup()
  })

  it("a step that spent its budget offers Give more on its workflow card", async () => {
    const repo = new Repo({ network: [] })
    const stepSession = repo.create({})
    stepSession.change((d) => Object.assign(d, JSON.parse(JSON.stringify(stoppedSession()))))
    const plan = repo.create({})
    plan.change((d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("asm", { title: "Assembly" })] })
      Object.assign(d.steps[0], { status: STEP.running, sessionUrl: stepSession.url })
      d.status = PLAN.stopped
    })
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = WorkflowView(plan, element, { repo })
    await settle()
    const card = [...element.querySelectorAll(".agent-wf-step")].find((c) => c.textContent.includes("Assembly"))
    expect(card.dataset.state).toBe("needs-input")
    const give = [...card.querySelectorAll("button")].find((b) => b.textContent === "Give $0.50 more")
    give.click()
    expect(stepSession.doc().config.budget).toBe(1.02)
    expect(stepSession.doc().stopped).toBe(null)
    cleanup()
  })
})

describe("every node on the board says what it spent, of what budget", () => {
  it("steps against their own budget or their tier's, the orchestrator against nothing, and over budget is marked", async () => {
    const repo = new Repo({ network: [] })
    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { title: "Battery" })
      d.usage = { in: 1, out: 1, turns: 3, cost: 2.55 }
    })
    const spentStep = repo.create({})
    spentStep.change((d) => Object.assign(d, JSON.parse(JSON.stringify(stoppedSession()))))
    const plan = repo.create({})
    plan.change((d) => {
      initPlan(d, {
        title: "W",
        goal: "G",
        sessionUrl: orchestrator.url,
        steps: [step("asm", { title: "Assembly", tier: "standard" }), step("bom", { title: "Bill", tier: "deep", budget: 7 }), step("next", { title: "Later", tier: "fast", after: ["asm"] })],
      })
      Object.assign(d.steps[0], { status: STEP.running, sessionUrl: spentStep.url })
      d.status = PLAN.stopped
    })
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = WorkflowView(plan, element, { repo })
    await settle()
    const chip = (title) => [...element.querySelectorAll(".agent-wf-step")].find((c) => c.querySelector("strong")?.textContent === title).querySelector(".agent-wf-money")
    expect(chip("Battery").textContent).toBe("$2.55 spent")
    expect([chip("Assembly").textContent, chip("Assembly").dataset.over]).toEqual(["$0.52 / $0.50", "true"])
    expect([chip("Bill").textContent, chip("Bill").dataset.over]).toEqual(["$0.00 / $7.00", undefined])
    expect(chip("Later").textContent).toBe("$0.00 / $0.50")
    cleanup()
  })
})
