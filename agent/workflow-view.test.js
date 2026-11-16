import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { WorkflowView, stages } from "./workflow/view.js"
import { initPlan, PLAN, STEP } from "./workflow/plan.js"
import { initSession, STATUS, _resetIds } from "./session.js"
import { _resetDrivers } from "./workflow/driver.js"
import { AgentTool } from "./tool.js"
import { _reset as resetRunners } from "./runners.js"

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
