import { describe, it, expect, beforeEach } from "vitest"
import { run, OUTCOME } from "./kernel/loop.js"
import { memoryStore } from "./kernel/store.js"
import { makeMock } from "./providers/mock.js"
import {
  initSession, claimLease, makeTurn, textBlock, summaryBlock, toRequest, estimateTokens, _resetIds,
} from "./session/session.js"

const toolset = { tools: [], schemas: [], get: () => null }

function longSession(turnCount, filler = 400) {
  const doc = {}
  initSession(doc, { title: "Long" })
  for (let i = 0; i < turnCount; i++) {
    doc.turns.push(makeTurn(i % 2 ? "assistant" : "user", [textBlock(`turn ${i} ${"x".repeat(filler)}`)]))
  }
  claimLease(doc, "runner-a", Date.now())
  return doc
}

beforeEach(_resetIds)

describe("toRequest with a summary", () => {
  it("skips superseded turns and leads with the summary", () => {
    const doc = longSession(4, 10)
    const upTo = doc.turns[1]
    doc.turns.push(makeTurn("user", [summaryBlock("we did some things", upTo.id)]))

    const { messages } = toRequest(doc)
    const text = JSON.stringify(messages)

    expect(messages[0].content[0].text).toMatch(/\[Summary of the earlier conversation\]/)
    expect(messages[0].content[0].text).toContain("we did some things")
    expect(text).not.toContain("turn 0")
    expect(text).not.toContain("turn 1")
    expect(text).toContain("turn 2")
    expect(text).toContain("turn 3")
  })

  it("leaves the superseded turns in the document — compaction is not deletion", () => {
    const doc = longSession(4, 10)
    doc.turns.push(makeTurn("user", [summaryBlock("notes", doc.turns[1].id)]))
    expect(doc.turns).toHaveLength(5)
    expect(doc.turns[0].blocks[0].text).toContain("turn 0")
  })

  it("uses only the most recent summary", () => {
    const doc = longSession(6, 10)
    doc.turns.push(makeTurn("user", [summaryBlock("first summary", doc.turns[1].id)]))
    doc.turns.push(makeTurn("user", [summaryBlock("second summary", doc.turns[4].id)]))

    const { messages } = toRequest(doc)
    const text = JSON.stringify(messages)
    expect(text).toContain("second summary")
    expect(text).not.toContain("first summary")
    expect(text).not.toContain("turn 3")
    expect(text).toContain("turn 5")
  })

  it("shrinks the estimate", () => {
    const doc = longSession(10, 400)
    const before = estimateTokens(doc)
    doc.turns.push(makeTurn("user", [summaryBlock("short", doc.turns[7].id)]))
    expect(estimateTokens(doc)).toBeLessThan(before / 2)
  })
})

describe("the loop compacts when it needs to", () => {
  it("summarizes before taking the turn, once over the threshold", async () => {
    const doc = longSession(20, 500)
    doc.config.compactAt = 500 // tiny, so this session is over it
    const store = memoryStore(doc)

    const provider = makeMock([
      [{ type: "text", delta: "SUMMARY: they asked about leeks; I read the doc." }],
      [{ type: "text", delta: "Carrying on." }],
    ])

    const events = []
    const result = await run({
      store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0,
      onEvent: (e) => events.push(e.type),
    })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(events).toContain("compacting")
    expect(events).toContain("compacted")

    const summaries = store.doc().turns.flatMap((t) => t.blocks).filter((b) => b.type === "summary")
    expect(summaries).toHaveLength(1)
    expect(summaries[0].text).toContain("SUMMARY:")

    // The turn that followed must have been sent the summary, not the old turns.
    const second = JSON.stringify(provider.requests[1].messages)
    expect(second).toContain("SUMMARY:")
    expect(second).not.toContain("turn 0")
  })

  it("does not compact a short session", async () => {
    const doc = longSession(2, 10)
    const store = memoryStore(doc)
    const events = []
    await run({
      store, provider: makeMock([[{ type: "text", delta: "hi" }]]), toolset,
      runnerUrl: "runner-a", generation: 1, flushMs: 0, onEvent: (e) => events.push(e.type),
    })
    expect(events).not.toContain("compacting")
  })

  it("carries on uncompacted when summarizing fails", async () => {
    const doc = longSession(20, 500)
    doc.config.compactAt = 500
    const store = memoryStore(doc)

    let call = 0
    const provider = {
      id: "flaky",
      async *stream() {
        call++
        if (call === 1) throw new Error("summarizer unavailable")
        yield { type: "text", delta: "answered anyway" }
        yield { type: "stop", reason: "end" }
      },
    }

    const events = []
    const result = await run({
      store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0,
      onEvent: (e) => events.push(e.type),
    })

    expect(events).toContain("compact-failed")
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(JSON.stringify(store.doc().turns)).toContain("answered anyway")
  })

  it("keeps the most recent turns out of the summary", async () => {
    const doc = longSession(20, 500)
    doc.config.compactAt = 500
    const store = memoryStore(doc)
    const provider = makeMock([[{ type: "text", delta: "notes" }], [{ type: "text", delta: "ok" }]])

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    const summarized = JSON.stringify(provider.requests[0].messages)
    expect(summarized).toContain("turn 0")
    expect(summarized).not.toContain("turn 19") // the recent window is preserved
  })
})
