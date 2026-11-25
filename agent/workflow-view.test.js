import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { WorkflowView, stages } from "./ui/workflow-view.js"
import { initPlan, PLAN, STEP } from "./workflow/plan.js"
import { initSession, STATUS, _resetIds } from "./session/session.js"
import { _resetDrivers, ensureDriver } from "./workflow/driver.js"
import { AgentTool } from "./ui/session-view.js"
import { _reset as resetRunners } from "./runners/registry.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: "p", why: `why ${id}`, where: "worker", tier: "fast", after: [], ...over })
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => { document.body.replaceChildren(); _resetIds(); resetRunners() })
afterEach(() => _resetDrivers())

/** A finished-looking plan, so mounting the view does not start driving it. */
async function planWith(steps, over = {}) {
  const repo = new Repo({ network: [] })
  const plan = repo.create({})
  plan.change((d) => {
    initPlan(d, { title: "Review the agent", goal: "Find automerge misuse", steps })
    Object.assign(d, over)
  })
  return { repo, plan }
}

function mount(plan, repo) {
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = WorkflowView(plan, element, { repo })
  return { element, cleanup }
}

describe("stages", () => {
  it("puts each step one stage after the deepest thing it waits for", () => {
    const out = stages([step("a"), step("b"), step("c", { after: ["a"] }), step("d", { after: ["b", "c"] })])
    expect(out.map((stage) => stage.map((s) => s.id))).toEqual([["a", "b"], ["c"], ["d"]])
  })
})

describe("the workflow view", () => {
  it("shows the plan in stages, with each step's state, placement, model and reason", async () => {
    const { repo, plan } = await planWith([step("find", { where: "worker", tier: "fast" }), step("judge", { where: "host", tier: "deep", after: ["find"] })], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)

    expect(element.querySelector("h2").textContent).toBe("Review the agent")
    const columns = [...element.querySelectorAll(".agent-wf-stage")]
    expect(columns.map((c) => c.querySelector("h3").textContent)).toEqual(["Start", "Stage 2"])
    const judge = columns[1].querySelector(".agent-wf-step")
    expect(judge.dataset.state).toBe("waiting")
    expect(judge.textContent).toContain("frontend")
    expect(judge.textContent).toContain("deep · claude-opus-latest")
    expect(judge.textContent).toContain("why judge")
    expect(columns[0].textContent).toContain("worker")
    cleanup()
  })

  it("shows results, failures, and what is blocked behind them", async () => {
    const { repo, plan } = await planWith(
      [step("a"), step("b"), step("c", { after: ["b"] })],
      { status: PLAN.done }
    )
    plan.change((d) => {
      Object.assign(d.steps[0], { status: STEP.done, result: "Found 3 problems\nmore detail" })
      Object.assign(d.steps[1], { status: STEP.failed, error: "it broke" })
    })
    const { element, cleanup } = mount(plan, repo)
    const cards = [...element.querySelectorAll(".agent-wf-step")]
    expect(cards.map((c) => c.dataset.state)).toEqual(["done", "failed", "blocked"])
    expect(cards[0].querySelector("summary").textContent).toBe("Found 3 problems")
    expect(cards[1].textContent).toContain("it broke")
    expect(element.querySelector(".agent-wf-summary").textContent).toMatch(/1\/3 done · 1 failed · 1 blocked/)
    cleanup()
  })

  it("marks a step whose session is waiting on a person, and sends you to it", async () => {
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped })
    const child = repo.create({})
    child.change((d) => { initSession(d, {}); d.status = STATUS.awaitingApproval })
    plan.change((d) => Object.assign(d.steps[0], { status: STEP.running, sessionUrl: child.url }))
    const { element, cleanup } = mount(plan, repo)
    await tick()

    const card = element.querySelector(".agent-wf-step")
    expect(card.dataset.state).toBe("needs-input")
    const opened = []
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url))
    card.querySelector(".agent-wf-open").click()
    expect(card.querySelector(".agent-wf-open").textContent).toBe("Answer in its session")
    expect(opened).toEqual([child.url])
    cleanup()
  })

  it("follows the plan as it changes", async () => {
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    plan.change((d) => Object.assign(d.steps[0], { status: STEP.done, result: "ok" }))
    expect(element.querySelector(".agent-wf-step").dataset.state).toBe("done")
    cleanup()
  })

  it("links what the research steps kept, and says on each research step how much it kept", async () => {
    const { repo, plan } = await planWith([step("r", { access: "web" }), step("b")], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    // Nothing kept yet: no link to an empty folder, no count.
    expect(element.querySelector(".agent-wf-sources")).toBeNull()
    expect(element.querySelector(".agent-wf-kept")).toBeNull()

    plan.change((d) => {
      d.sourcesFolderUrl = "automerge:sources-folder"
      d.sources = {
        a: { kind: "source", what: "extract", by: "r" },
        b: { kind: "finding", what: "finding", by: "r" },
        c: { kind: "source", what: null, by: "r" }, // made, not yet written
      }
    })
    const opened = []
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url))
    const link = element.querySelector(".agent-wf-sources")
    expect(link.textContent).toBe("Sources (2)")
    link.click()
    expect(opened).toEqual(["automerge:sources-folder"])
    const [research, full] = element.querySelectorAll(".agent-wf-step")
    expect(research.querySelector(".agent-wf-kept").textContent).toBe("kept 1 source · 1 finding")
    expect(full.querySelector(".agent-wf-kept")).toBeNull()
    cleanup()
  })

  it("says why a step was cancelled when there is a reason", async () => {
    const { repo, plan } = await planWith([step("r", { access: "web" })], { status: PLAN.stopped })
    plan.change((d) => Object.assign(d.steps[0], { status: STEP.cancelled, error: "its research scope was removed" }))
    const { element, cleanup } = mount(plan, repo)
    expect(element.querySelector(".agent-wf-error").textContent).toBe("its research scope was removed")
    cleanup()
  })

  it("shows a step that is out of date, what steps asked for, and how many times a step has run", async () => {
    const { repo, plan } = await planWith([step("a"), step("b", { after: ["a"] })], { status: PLAN.done })
    plan.change((d) => {
      Object.assign(d.steps[0], { status: STEP.done, result: "A v2", version: 2, previous: [{ status: STEP.done, result: "A v1", error: null, startedAt: 1, finishedAt: 2 }] })
      Object.assign(d.steps[1], { status: STEP.done, result: "B on A v1", inputs: { a: 1 }, version: 1 })
      d.requests = [
        { id: "r1", stepId: "b", why: "A's figure looks off.", add: null, reopen: ["a"], status: "open", at: 3, decidedAt: null, note: null, reported: false },
        { id: "r2", stepId: "b", why: "Another source.", add: [step("c")], reopen: null, status: "declined", at: 4, decidedAt: 5, note: null, reported: true },
      ]
    })
    const { element, cleanup } = mount(plan, repo)
    const [a, b] = element.querySelectorAll(".agent-wf-step")
    expect(b.dataset.state).toBe("stale")
    expect(b.querySelector(".agent-wf-chip").textContent).toBe("out of date")
    expect(b.querySelector(".agent-wf-stale").textContent).toMatch(/^Out of date: built on a as it was before/)
    expect(b.querySelector("summary").textContent).toBe("B on A v1")
    expect([...b.querySelectorAll(".agent-wf-request")].map((r) => [r.dataset.status, r.textContent])).toEqual([
      ["open", "Asks to reopen a: A's figure looks off.waiting on the orchestrator"],
      ["declined", "Asks to add c: Another source.declined"],
    ])
    expect(a.textContent).toContain("run 2")
    cleanup()
  })

  it("offers Resume on a failed step, which reopens it to continue in its own session", async () => {
    const { repo, plan } = await planWith([step("a"), step("b", { after: ["a"] })], { status: PLAN.done })
    const session = repo.create({})
    session.change((d) => initSession(d, {}))
    plan.change((d) => Object.assign(d.steps[0], { status: STEP.failed, error: "it broke", sessionUrl: session.url }))
    await ensureDriver(plan.url, { repo, startSession: async () => null, confirmMs: 0, settleMs: 10 })
    const { element, cleanup } = mount(plan, repo)
    const cards = element.querySelectorAll(".agent-wf-step")
    expect(cards[1].querySelector("button")?.textContent ?? null).not.toBe("Resume")
    const resume = [...cards[0].querySelectorAll("button")].find((b) => b.textContent === "Resume")
    resume.click()
    await tick()
    const a = plan.doc().steps[0]
    expect(a.previous.map((p) => [p.status, p.error])).toEqual([[STEP.failed, "it broke"]])
    expect(plan.doc().status).toBe(PLAN.running)
    // It continues in the same session, told it was resumed.
    expect(await (async () => { for (let i = 0; i < 50 && plan.doc().steps[0].status !== STEP.running; i++) await tick(); return plan.doc().steps[0] })()).toMatchObject({ status: STEP.running, sessionUrl: session.url })
    expect(String(session.doc().turns.at(-1).blocks[0].text)).toContain("Resumed by the person")
    cleanup()
  })

  it("cleans up after itself", async () => {
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    cleanup()
    expect(element.children).toHaveLength(0)
  })
})

describe("the settings switch", () => {
  function sessionHandle() {
    const doc = {}
    initSession(doc, {})
    const listeners = new Set()
    return {
      url: "automerge:wf-settings",
      doc: () => doc,
      change(fn) { fn(doc); for (const l of [...listeners]) l({ doc }) },
      on: (e, fn) => e === "change" && listeners.add(fn),
      off: (e, fn) => listeners.delete(fn),
    }
  }

  it("is on by default, switches off, and records limits and tier models for the session", () => {
    const handle = sessionHandle()
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) } })

    const box = element.querySelector(".agent-wf-settings")
    const toggle = box.querySelector("input[type=checkbox]")
    expect(toggle.checked).toBe(true) // on by default
    toggle.checked = false
    toggle.dispatchEvent(new Event("change"))
    expect(handle.doc().config.workflows.enabled).toBe(false)
    toggle.checked = true
    toggle.dispatchEvent(new Event("change"))
    expect(handle.doc().config.workflows.enabled).toBe(true)

    const parallel = box.querySelector("input[data-key=parallel]")
    parallel.value = "5"
    parallel.dispatchEvent(new Event("change"))
    const deep = box.querySelector("input[data-tier=deep]")
    deep.value = "anthropic/claude-opus-5.5"
    deep.dispatchEvent(new Event("change"))
    expect(handle.doc().config.workflows).toEqual({ enabled: true, parallel: 5, tiers: { deep: "anthropic/claude-opus-5.5" } })
    cleanup()
  })
})

describe("the workflow view keeps your place", () => {
  it("re-rendering keeps where you scrolled to, down and across the board", async () => {
    const { repo, plan } = await planWith([step("a"), step("b", { after: ["a"] })], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    const root = element.querySelector(".agent-workflow")
    root.scrollTop = 420
    root.querySelector(".agent-wf-board").scrollLeft = 130
    plan.change((d) => { d.steps[0].title = "Renamed" })
    await tick()
    expect(root.querySelector(".agent-wf-step strong").textContent).toBe("Renamed")
    expect(root.scrollTop).toBe(420)
    expect(root.querySelector(".agent-wf-board").scrollLeft).toBe(130)
    cleanup()
  })

  it("a step streaming leaves an opened result open, scrolled where you left it, and its buttons in place", async () => {
    const { repo, plan } = await planWith([step("a"), step("b")], { status: PLAN.stopped })
    const child = repo.create({})
    child.change((d) => { initSession(d, {}); d.status = STATUS.running })
    plan.change((d) => {
      Object.assign(d.steps[0], { status: STEP.done, result: "Found 3 problems\nmore detail" })
      Object.assign(d.steps[1], { status: STEP.running, sessionUrl: child.url })
    })
    const { element, cleanup } = mount(plan, repo)
    await tick()
    const details = element.querySelector(".agent-wf-result")
    details.open = true
    const pre = details.querySelector("pre")
    pre.scrollTop = 80
    const open = element.querySelectorAll(".agent-wf-step")[1].querySelector(".agent-wf-open")
    // The running step's session changes, as it does many times a second while it streams.
    for (let i = 0; i < 3; i++) {
      child.change((d) => { d.usage = { in: 1000 * (i + 1), out: 10, cost: 0.01 * (i + 1) } })
      await tick()
    }
    expect(element.querySelectorAll(".agent-wf-step")[1].querySelector(".agent-wf-activity").textContent).toContain("3k tokens")
    expect(element.querySelector(".agent-wf-result")).toBe(details)
    expect(details.open).toBe(true)
    expect(details.querySelector("pre")).toBe(pre)
    expect(pre.scrollTop).toBe(80)
    expect(element.querySelectorAll(".agent-wf-step")[1].querySelector(".agent-wf-open")).toBe(open)
    const opened = []
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url))
    open.click()
    expect(opened).toEqual([child.url])
    cleanup()
  })

  it("waits while you type in it, and catches up when you stop", async () => {
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    const root = element.querySelector(".agent-workflow")
    // Something answerable in the view, being typed into.
    const field = document.createElement("input")
    root.querySelector(".agent-wf-step").append(field)
    field.focus()
    field.value = "half an ans"
    plan.change((d) => { d.steps[0].title = "Changed meanwhile" })
    await tick()
    expect(root.contains(field)).toBe(true)
    expect(field.value).toBe("half an ans")
    field.blur()
    await tick()
    expect(root.querySelector(".agent-wf-step strong").textContent).toBe("Changed meanwhile")
    cleanup()
  })

  it("folds a long goal so the board is in view, and remembers when you open it", async () => {
    const brief = "Design a 100 kWh LiFePO4 battery for a boat. ".repeat(20)
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped, goal: brief })
    const { element, cleanup } = mount(plan, repo)
    const goal = () => element.querySelector(".agent-wf-goal")
    const toggle = () => element.querySelector(".agent-wf-goal-toggle")
    expect([goal().dataset.open, toggle().textContent]).toEqual(["false", "Show the whole goal"])
    toggle().click()
    expect([goal().dataset.open, toggle().textContent]).toEqual(["true", "Show less"])
    plan.change((d) => { d.steps[0].title = "Another render" })
    await tick()
    expect(goal().dataset.open).toBe("true")
    cleanup()
  })

  it("leaves a short goal alone", async () => {
    const { repo, plan } = await planWith([step("a")], { status: PLAN.stopped })
    const { element, cleanup } = mount(plan, repo)
    expect(element.querySelector(".agent-wf-goal-toggle")).toBe(null)
    cleanup()
  })
})
