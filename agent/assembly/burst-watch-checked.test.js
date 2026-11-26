/**
 * E (watches in a pool run) through a burst (kernel/burst.js) with the real
 * doc_watch tool: in a burst the events only record, so doc_watch writes the
 * session's `watches` and opens nothing; the page showing the session opens
 * it (restoreWatches), and the hashes the burst reports as its own
 * (`progress({ own })`, and its result's `own`) reach rememberOwn, so the
 * restored watch is not told of the agent's own edits and wakes the session
 * for everyone else's.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { runBurst } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"
import { handleStore } from "../kernel/store.js"
import { createEvents } from "../kernel/events.js"
import { rememberOwn } from "../kernel/own-changes.js"
import { docWatch, restoreWatches } from "../tools/watch.js"

await initSubduction()

beforeEach(() => _resetIds())

/** A tool that edits a document through the run's repo, as the agent's own edit tools do. */
const poke = {
  id: "poke",
  name: "poke",
  where: "worker",
  risk: "self",
  description: "",
  input_schema: { type: "object" },
  async execute(input, ctx) {
    const handle = await ctx.repo.find(input.url)
    handle.change((d) => (d.x = 1))
    return "poked"
  },
}

function world() {
  const repo = new Repo({ network: [] })
  const other = repo.create()
  other.change((d) => (d.x = 0))
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("watch it")]))
    d.burst = null
  })
  return { repo, other, handle }
}

const burst = (repo, handle, provider, progress = () => {}) =>
  runBurst(
    { repo, signal: new AbortController().signal, run: "run-1", taskUrl: "automerge:task", settled: Promise.resolve(), progress, log: () => {} },
    { session: handle.url, taskRuns: () => ["run-1"], getProvider: async () => provider, builtins: [docWatch, poke], flushMs: 5 }
  )

/** What the page showing the session does: its events, which ask when they wake it, and the watches opened. */
async function page(repo, handle) {
  const store = handleStore(handle)
  const woke = []
  const events = createEvents(store, { policy: { settleMs: 5, maxDelayMs: 20, minGapMs: 0 }, onWake: () => woke.push(handle.doc().turns.at(-1)) })
  const restored = await restoreWatches({ repo, events, store })
  return { events, woke, restored }
}

describe("E: doc_watch in a burst", () => {
  it("writes the watch into the session and opens nothing", async () => {
    const { repo, other, handle } = world()
    const open = globalThis.__patchworkAgentWatches?.size ?? 0
    const provider = makeMock([[{ type: "call", id: "w1", name: "doc_watch", input: { url: other.url } }], [{ type: "text", delta: "ok" }]])
    const result = await burst(repo, handle, provider)
    expect(result.outcome).toBe(OUTCOME.idle)
    const doc = JSON.parse(JSON.stringify(handle.doc()))
    const answer = doc.turns.flatMap((t) => t.blocks).find((b) => b.type === "result" && b.callId === "w1")
    expect(String(answer?.output)).toMatch(/^Watching/)
    expect(Object.values(doc.watches ?? {}).map((w) => w.url)).toEqual([other.url])
    expect(globalThis.__patchworkAgentWatches?.size ?? 0).toBe(open)
  })

  it("the page restores it: the burst's own edit is not reported, someone else's wakes the session", async () => {
    const { repo, other, handle } = world()
    // The burst watches, then edits the watched document itself.
    const provider = makeMock([
      [{ type: "call", id: "w1", name: "doc_watch", input: { url: other.url } }],
      [{ type: "call", id: "p1", name: "poke", input: { url: other.url } }],
      [{ type: "text", delta: "watching" }],
    ])
    const reported = []
    const result = await burst(repo, handle, provider, (value) => reported.push(value?.own ?? []))
    expect(result.own.length).toBeGreaterThan(0)
    expect(reported.at(-1)).toEqual(result.own)
    // What a page following the key does with what the run reports
    // (runners/ask.js). In one process the burst's context has noted them
    // already; in a page apart from the pool this is how they arrive.
    rememberOwn(handle.url, result.own)

    const { events, woke, restored } = await page(repo, handle)
    expect(restored.map((r) => r.ok)).toEqual([true])
    await new Promise((r) => setTimeout(r, 80))
    // Caught up from the heads the watch was written at: only the agent's own poke since, so nothing.
    expect(woke).toEqual([])

    // Someone else edits it: the session is woken.
    other.change((d) => (d.x = 2))
    await vi.waitFor(() => expect(woke).toHaveLength(1), { timeout: 2000 })
    expect(woke[0].role).toBe("user")
    expect(JSON.stringify(woke[0].blocks)).toContain("/x")
    events.stop()
  })
})
