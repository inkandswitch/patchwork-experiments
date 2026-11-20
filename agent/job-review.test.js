/**
 * What the battery workflow's review turned up, each held down:
 *
 *   - a step waiting on a permission was recorded as done, with nothing said;
 *   - a step whose model spent its whole output on thinking failed after
 *     three tries, each with more room to think in;
 *   - opening a view for the person asked permission, and the orchestrator
 *     waited an hour on it, unseen;
 *   - the workflow view showed none of what the orchestrator waited on.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { run, OUTCOME, mostlyThinking, quieterReasoning } from "./loop.js"
import { memoryStore } from "./store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, makeTurn, textBlock, callBlock, claimLease, needsApproval, CALL, STATUS, _resetIds } from "./session.js"
import { sessionOutcome, _resetDrivers } from "./workflow/driver.js"
import { initPlan, PLAN, STEP } from "./workflow/plan.js"
import { WorkflowView } from "./workflow/view.js"
import { BUILTIN_TOOLS } from "./tools/index.js"

await initSubduction()
beforeEach(() => {
  _resetIds()
  document.body.replaceChildren()
  _resetDrivers()
})

const withPendingFetch = (over = {}) => {
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("write the assembly instructions")]), makeTurn("assistant", [callBlock("web_fetch", { url: "https://torque.test/" }, { id: "f1", status: CALL.pending })])]
  return Object.assign(doc, over)
}

describe("a step waiting on a permission is waiting, whatever its status says", () => {
  it.each([STATUS.idle, STATUS.awaitingApproval, STATUS.running])("status %s with a permission pending: running, waiting", (status) => {
    expect(sessionOutcome(withPendingFetch({ status }))).toEqual({ state: "running", waiting: true })
  })

  it("and with nothing pending, an idle step that answered is done", () => {
    const doc = withPendingFetch({ status: STATUS.idle })
    doc.turns = [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("Done.")])]
    expect(sessionOutcome(doc)).toEqual({ state: "done", result: "Done." })
  })
})

describe("a turn that was all thinking is retried with less thinking", () => {
  it("knows a turn of nothing but reasoning", () => {
    expect(mostlyThinking({ blocks: [{ type: "reasoning", text: "hm" }] })).toBe(true)
    expect(mostlyThinking({ blocks: [{ type: "reasoning" }, { type: "text", text: "a" }] })).toBe(false)
    expect(mostlyThinking({ blocks: [] })).toBe(false)
  })

  it("steps effort down one level at a time, among the levels the model takes, and caps tokens where it takes none", () => {
    const LEVELS = ["xhigh", "high", "medium", "low", "minimal"]
    for (const from of [undefined, ...LEVELS]) {
      for (const efforts of [null, ["low", "medium", "high"], ["high", "low"], []]) {
        const next = quieterReasoning(from ? { effort: from } : null, { efforts }, 16000)
        if (next.effort) {
          // Always strictly less than where it was (unset counts as high), and a level the model takes.
          expect(LEVELS.indexOf(next.effort), `${from} ${efforts}`).toBeGreaterThan(LEVELS.indexOf(from ?? "high"))
          if (efforts?.length) expect(efforts).toContain(next.effort)
        } else {
          expect(next.max_tokens, `${from} ${efforts}`).toBeGreaterThanOrEqual(512)
          expect(next.max_tokens).toBeLessThanOrEqual(4000)
        }
      }
    }
    // A cap already set is halved, never below 512.
    expect(quieterReasoning({ max_tokens: 3000 }, { efforts: [] }, 16000)).toEqual({ max_tokens: 1500 })
    expect(quieterReasoning({ max_tokens: 600 }, { efforts: [] }, 16000)).toEqual({ max_tokens: 512 })
  })

  it("in a run: two turns of only thinking, cut off; the retries think less, and the third acts", async () => {
    const doc = {}
    initSession(doc, { config: { params: { maxTokens: 4000 } } })
    doc.turns = [makeTurn("user", [textBlock("model the pack")])]
    claimLease(doc, "r", Date.now())
    const store = memoryStore(doc)
    const thinking = [{ type: "reasoning", delta: "Let me consider every option…" }, { type: "stop", reason: "length" }]
    const provider = makeMock([thinking, thinking, [{ type: "text", delta: "Here is the model." }, { type: "stop", reason: "end" }]])
    const toolset = { tools: [], schemas: [], get: () => null }
    const result = await run({ store, provider, toolset, runnerUrl: "r", generation: 1, flushMs: 0, notes: false, modelInfo: { efforts: null, maxOutput: 64000 } })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(provider.requests.map((r) => r.params.reasoning?.effort ?? null)).toEqual([null, "medium", "low"])
    expect(provider.requests.map((r) => r.params.maxTokens)).toEqual([4000, 8000, 16000])
  })
})

describe("showing the person a document asks nothing", () => {
  it("view_open needs no approval, on any document", () => {
    const tool = BUILTIN_TOOLS.find((t) => t.id === "view_open")
    const doc = {}
    initSession(doc, {})
    expect(tool.risk).toBe("read")
    expect(needsApproval(doc, tool, { input: { url: "automerge:anything" } }, "automerge:subject", [])).toBe(false)
  })
})

describe("the workflow view shows what the orchestrator waits on", () => {
  async function workflow({ orchestratorWaits = false, stepWaits = false } = {}) {
    const repo = new Repo({ network: [] })
    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { title: "Battery" })
      d.turns.push(makeTurn("user", [textBlock("design it")]))
      if (orchestratorWaits) d.turns.push(makeTurn("assistant", [callBlock("fs_write", { path: "x.scad", content: "cube(1);" }, { id: "o1", status: CALL.pending })]))
      d.status = STATUS.idle
    })
    const step = repo.create({})
    step.change((d) => {
      initSession(d, {})
      d.turns.push(makeTurn("user", [textBlock("assemble")]))
      if (stepWaits) d.turns.push(makeTurn("assistant", [callBlock("web_fetch", { url: "https://torque.test/" }, { id: "s1", status: CALL.pending })]))
      // The status that hid it.
      d.status = STATUS.idle
    })
    const plan = repo.create({})
    plan.change((d) => {
      initPlan(d, { title: "Battery", goal: "G", sessionUrl: orchestrator.url, steps: [{ id: "asm", title: "Assembly", prompt: "p", why: "w", where: "worker", tier: "standard", after: [] }] })
      Object.assign(d.steps[0], { status: STEP.running, sessionUrl: step.url })
      d.status = PLAN.stopped // so mounting the view does not start driving it
    })
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = WorkflowView(plan, element, { repo })
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { element, cleanup, orchestrator }
  }

  it("as the first node on the board, not a button", async () => {
    const { element, cleanup } = await workflow()
    const first = element.querySelector(".agent-wf-stage")
    expect(first.querySelector("h3").textContent).toBe("Orchestrator")
    expect(first.querySelector(".agent-wf-orchestrator strong").textContent).toBe("Battery")
    expect([...element.querySelectorAll("button")].some((b) => b.textContent === "Open orchestrator")).toBe(false)
    cleanup()
  })

  it("with what it waits on you for, answerable there", async () => {
    const { element, cleanup, orchestrator } = await workflow({ orchestratorWaits: true })
    const node = element.querySelector(".agent-wf-orchestrator")
    expect(node.dataset.state).toBe("needs-input")
    const allow = [...node.querySelectorAll("button")].find((b) => b.textContent === "Allow once")
    allow.click()
    expect(orchestrator.doc().turns.at(-1).blocks[0].status).toBe(CALL.approved)
    cleanup()
  })

  it("and a step's pending permission, even when its status says idle", async () => {
    const { element, cleanup } = await workflow({ stepWaits: true })
    const card = [...element.querySelectorAll(".agent-wf-step")].find((c) => c.textContent.includes("Assembly"))
    expect(card.dataset.state).toBe("needs-input")
    expect(card.textContent).toMatch(/Wants to/)
    cleanup()
  })
})
