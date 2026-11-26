/**
 * A checker's test of E (watches in a pool run) through a burst
 * (kernel/burst.js) with the real doc_watch tool, as a burst is handed its
 * context today: no `events` unless its caller puts them in `opts.context`.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { runBurst } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"
import { docWatch } from "../tools/watch.js"

await initSubduction()

beforeEach(() => _resetIds())

describe("E: doc_watch in a burst", () => {
  it("with no events in the context it is handed, doc_watch refuses and no watch is written", async () => {
    const repo = new Repo({ network: [] })
    const other = repo.create()
    other.change((d) => (d.x = 0))
    const handle = repo.create()
    handle.change((d) => {
      initSession(d, {})
      d.turns.push(makeTurn("user", [textBlock("watch it")]))
      d.burst = null
    })
    const provider = makeMock([[{ type: "call", id: "w1", name: "doc_watch", input: { url: other.url } }], [{ type: "text", delta: "ok" }]])
    const ctx = { repo, signal: new AbortController().signal, run: "run-1", taskUrl: "automerge:task", settled: Promise.resolve(), progress: () => {}, log: () => {} }
    const result = await runBurst(ctx, { session: handle.url, taskRuns: () => ["run-1"], getProvider: async () => provider, builtins: [docWatch], flushMs: 5 })
    expect(result.outcome).toBe(OUTCOME.idle)
    const doc = JSON.parse(JSON.stringify(handle.doc()))
    const answer = doc.turns.flatMap((t) => t.blocks).find((b) => b.type === "result" && b.callId === "w1")
    expect(String(answer?.output)).toMatch(/cannot be woken/)
    expect(Object.keys(doc.watches ?? {})).toHaveLength(0)
  })
})
