/**
 * What happens when things go wrong partway: a tab reloads mid-call, a view is
 * closed twice. And what the session has spent.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { debrisCalls, settleDebris, INTERRUPTED } from "../session/recovery.js"
import { addUsage, costOf, formatCost } from "../session/usage.js"
import { needsWork } from "../kernel/runner.js"
import { burstRunner } from "../fixtures/burst.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { viewUnmount } from "./checking.js"

beforeEach(() => _resetIds())

/** A session whose run claimed a call and then went away, `burst` still naming it. */
function interrupted() {
  const doc = {}
  initSession(doc, {})
  doc.turns.push(makeTurn("user", [textBlock("edit the doc")]))
  doc.burst = { run: "run-old" }
  const call = callBlock("doc_edit", { ops: [] }, { id: "c1" })
  Object.assign(call, { status: CALL.running, runner: "run-old" })
  doc.turns.push(makeTurn("assistant", [call]))
  return doc
}

describe("a call cut off by a reload", () => {
  it("is debris once `burst` no longer names its run, and not while it does", () => {
    const doc = interrupted()
    expect(debrisCalls(doc, doc.burst.run)).toEqual([]) // still being run
    doc.burst = null // its run ended without saying, or a Take over
    expect(debrisCalls(doc, null).map((c) => c.id)).toEqual(["c1"])
    doc.burst = { run: "run-new" } // another run of its task
    expect(debrisCalls(doc, "run-new").map((c) => c.id)).toEqual(["c1"])
  })

  it("counts as work once `burst` names another, so a run comes for it", () => {
    const doc = interrupted()
    doc.burst = null
    expect(needsWork(doc)).toBe(true) // before: false, and the session sat there forever
  })

  it("is closed with an error result saying it may or may not have happened — not re-run", () => {
    const doc = interrupted()
    expect(settleDebris(doc, "run-new", { ownRun: (run) => run === "run-old" })).toBe(1)
    expect(doc.turns[1].blocks[0].status).toBe(CALL.error)
    const result = doc.turns.at(-1).blocks[0]
    expect(result).toMatchObject({ type: "result", callId: "c1", isError: true })
    expect(String(result.output)).toBe(INTERRUPTED)
    expect(settleDebris(doc, "run-new")).toBe(0) // once
  })

  it("a later run of its task tells the model, which carries on", async () => {
    const store = memoryStore(interrupted())
    store.doc().burst = null
    const executed = []
    const provider = makeMock([[{ type: "text", delta: "It was interrupted; I checked and redid it." }]])
    const runner = burstRunner({
      store,
      runnerUrl: "run-new",
      buildToolset: async () => ({ tools: [], schemas: [], get: () => ({ id: "doc_edit", where: "worker", risk: "edit", execute: async () => executed.push("ran") }) }),
      getProvider: async () => provider,
      canRun: () => true,
    })
    await runner.tick()
    expect(executed).toEqual([]) // not run a second time
    expect(JSON.stringify(provider.requests[0].messages)).toContain("interrupted before it finished")
    expect(store.doc().turns.at(-1).blocks[0].text).toMatch(/redid it/)
  })
})

describe("closing a view", () => {
  it("that is not open — closed already, or gone with a reload — is not a failure", async () => {
    const out = await viewUnmount.execute({ mountId: "m-gone" }, {})
    expect(out).toMatch(/Nothing to close/)
    expect(out).toMatch(/reloaded/)
    expect(viewUnmount.summarize({}, out)).toBe("already closed")
  })
})

describe("what a session has spent", () => {
  it("prefers the reported cost, estimates from list prices without one, and knows when it cannot", () => {
    const prices = { promptPerM: 3, completionPerM: 15 }
    expect(costOf({ in: 1000, out: 100, cost: 0.02 }, prices)).toEqual({ cost: 0.02, estimated: false })
    expect(costOf({ in: 1_000_000, out: 100_000 }, prices)).toEqual({ cost: 4.5, estimated: true })
    expect(costOf({ in: 1000, out: 100 }, null)).toEqual({ cost: null, estimated: false })
  })

  it("adds up, marking a total partly estimated, and never shows an unknown as free", () => {
    const doc = {}
    initSession(doc, {})
    addUsage(doc, { in: 10, out: 1, cost: null })
    expect(doc.usage.cost).toBeUndefined()
    expect(formatCost(doc.usage)).toBeNull()
    addUsage(doc, { in: 10, out: 1, cost: 0.25 })
    addUsage(doc, { in: 10, out: 1, cost: 0.5, estimated: true })
    expect(doc.usage.cost).toBeCloseTo(0.75)
    expect(formatCost(doc.usage)).toBe("~$0.75")
  })

  it.each([
    [{ cost: 0.004 }, "<$0.01"],
    [{ cost: 0 }, "$0.00"],
    [{ cost: 3.456 }, "$3.46"],
    [{ cost: 1204.4 }, "$1,204"],
    [{}, null],
  ])("formats %j as %s", (usage, text) => expect(formatCost(usage)).toBe(text))

  it("the loop records each turn's cost, estimating when the provider is silent", async () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("hi")]))
    const store = memoryStore(doc)
    const provider = makeMock([[{ type: "text", delta: "hello" }, { type: "usage", in: 1_000_000, out: 0 }]])
    const runner = burstRunner({
      store,
      buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
      getProvider: async () => provider,
      getModelInfo: async () => ({ id: "m", promptPerM: 2, completionPerM: 10 }),
      canRun: () => true,
    })
    await runner.tick()
    expect(store.doc().usage.cost).toBe(2)
    expect(store.doc().usage.costEstimated).toBe(true)
  })
})
