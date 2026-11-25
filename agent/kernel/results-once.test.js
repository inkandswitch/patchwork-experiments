/**
 * Every call is answered exactly once in a request.
 *
 * A provider refuses a call with two results ("each tool_use must have a
 * single result"), and the session document can hold two: a runner that took
 * the session over closes a call as interrupted while the displaced runner
 * finishes it, or two runners record results before their writes meet. The
 * document cannot prevent that — it is a merge of writes — so the request
 * does: every arrangement of results a call can end up with is enumerated
 * below, and each must send one result, a real one if there is one.
 *
 * The loop's own part is to never add the second: a call answered while it
 * ran keeps its answer, and what did run before a lease was lost is recorded.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { run, OUTCOME } from "./loop.js"
import { memoryStore } from "./store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { claimLease } from "../session/lease.js"
import { makeTurn, textBlock, callBlock, resultBlock } from "../session/blocks.js"
import { resolveOrphans, INTERRUPTED } from "../session/recovery.js"
import { toRequest } from "../session/request.js"
import { findCall } from "../session/calls.js"

beforeEach(_resetIds)

const interrupted = () => resultBlock("c1", INTERRUPTED, { isError: true, summary: "interrupted", placeholder: true })
const KINDS = {
  interrupted,
  found: () => resultBlock("c1", "25 hits for waterline", { summary: "grep waterline" }),
  failed: () => resultBlock("c1", "view_interact failed", { isError: true, summary: "failed" }),
}

/** Every ordering of every subset of `items`, the empty one included. */
function orderings(items) {
  const out = [[]]
  for (const [i, item] of items.entries()) {
    for (const rest of orderings(items.filter((_, j) => j !== i))) out.push([item, ...rest])
  }
  return [...new Map(out.map((a) => [a.join(","), a])).values()]
}

/** Every ordering of every non-empty subset of `items`. */
const arrangements = (items) => orderings(items).filter((a) => a.length)

/** Ways to put `n` results into tool turns: each run of results shares a turn. */
function groupings(n) {
  if (n === 0) return [[]]
  const out = []
  for (let first = 1; first <= n; first++) for (const rest of groupings(n - first)) out.push([first, ...rest])
  return out
}

function sessionWith(kinds, grouping) {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Results" })
  doc.turns = [
    makeTurn("user", [textBlock("find the waterline")]),
    makeTurn("assistant", [callBlock("fs_grep", { pattern: "waterline" }, { id: "c1", status: CALL.error }), callBlock("doc_read", {}, { id: "c2", status: CALL.done })]),
  ]
  const blocks = kinds.map((k) => KINDS[k]())
  blocks.splice(1, 0, resultBlock("c2", "the document"))
  let at = 0
  for (const size of grouping) {
    doc.turns.push(makeTurn("tool", blocks.slice(at, at + size)))
    at += size
  }
  doc.turns.push(makeTurn("user", [textBlock("carry on")]))
  return { doc, blocks }
}

describe("a request answers each call once, however many results the document holds", () => {
  it("for every ordering of an interrupted note and two real results, in every grouping into turns", () => {
    let cases = 0
    for (const kinds of arrangements(Object.keys(KINDS))) {
      for (const grouping of groupings(kinds.length + 1)) {
        const { doc } = sessionWith(kinds, grouping)
        const results = toRequest(doc).messages.flatMap((m) => m.content.filter((p) => p.type === "result"))
        const label = `${kinds.join(" then ")} in turns of ${grouping.join("+")}`

        expect(results.map((r) => r.callId).sort(), label).toEqual(["c1", "c2"])
        const sent = results.find((r) => r.callId === "c1")
        const firstReal = kinds.find((k) => k !== "interrupted")
        const expected = firstReal === "found" ? "25 hits for waterline" : firstReal === "failed" ? "view_interact failed" : INTERRUPTED
        expect(sent.output, label).toBe(expected)
        cases++
      }
    }
    // 15 arrangements of up to three results, each grouped every way with c2's result among them.
    expect(cases).toBe(3 * 2 + 6 * 4 + 6 * 8)
  })

  it("a result's image goes only with the result that is sent", () => {
    const { doc } = sessionWith(["interrupted", "found"], [1, 1, 1])
    doc.turns[2].blocks[0].image = "data:image/png;base64,AAAA"
    const results = toRequest(doc).messages.flatMap((m) => m.content.filter((p) => p.type === "result"))
    expect(results.filter((r) => r.image)).toEqual([])
  })
})

// ---------------------------------------------------------------- the loop

function toolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}

function pendingCalls(ids) {
  const doc = {}
  initSession(doc, { title: "Loop" })
  doc.turns = [
    makeTurn("user", [textBlock("go")]),
    makeTurn("assistant", ids.map((id) => callBlock("work", { id }, { id, status: CALL.approved }))),
  ]
  claimLease(doc, "runner-a", Date.now())
  return memoryStore(doc)
}

const resultsFor = (store, id) => store.doc().turns.flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "result" && b.callId === id))

describe("the loop never writes a second result", () => {
  it("a call another runner closed as interrupted while it ran keeps that answer", async () => {
    const store = pendingCalls(["c1"])
    const work = {
      id: "work",
      where: "worker",
      risk: "read",
      execute: async () => {
        // Meanwhile another browser decides this runner is gone, takes over,
        // and closes the call.
        store.change((d) => {
          claimLease(d, "runner-b", Date.now())
          resolveOrphans(d, { live: () => true })
        })
        return "what it found"
      },
    }
    const result = await run({ store, provider: makeMock([]), toolset: toolset([work]), runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    expect(result.outcome).toBe(OUTCOME.aborted)
    expect(resultsFor(store, "c1").map((r) => String(r.output))).toEqual([INTERRUPTED])
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.error)
  })

  it("what ran before the lease was lost is recorded, and the call it did not reach is left for the new runner", async () => {
    const store = pendingCalls(["c1", "c2"])
    const work = {
      id: "work",
      where: "worker",
      risk: "read",
      execute: async ({ id }) => {
        // The other browser claims the session while c1 runs, before it gets
        // round to closing anything.
        if (id === "c1") store.change((d) => claimLease(d, "runner-b", Date.now()))
        return `ran ${id}`
      },
    }
    const result = await run({ store, provider: makeMock([]), toolset: toolset([work]), runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    expect(result.outcome).toBe(OUTCOME.aborted)
    expect(resultsFor(store, "c1").map((r) => String(r.output))).toEqual(["ran c1"])
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.done)
    expect(resultsFor(store, "c2")).toEqual([])
    expect(findCall(store.doc(), "c2").block.status).toBe(CALL.approved)
  })
})
