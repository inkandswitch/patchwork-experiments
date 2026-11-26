/**
 * A checker's cases of a burst waiting for the network (kernel/burst.js with
 * the real loop and the real OpenRouter provider over a stand-in fetch), on a
 * real Automerge session, with the clock moved by hand: the burst's own
 * backoff (net/network.js reconnectDelay) and the provider's retries run on
 * it. Every value `reconnecting` takes and every change to the turns is
 * recorded, and the line under the composer (ui/session-value.js) is read off
 * each change as a page whose pool runs the burst would read it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { stopSession } from "../session/recovery.js"
import { STOP, stopOf } from "../session/status.js"
import { stream } from "../providers/openrouter.js"
import { reconnectDelay } from "../net/network.js"
import { sessionValue } from "./session-value.js"
import { runBurst } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"

await initSubduction()

/** Made up: who pressed Stop. */
const PERSON = "automerge:person"
const WAITING = /^Waiting for the network; carries on when it is back \(/
const HERE = "Working on this browser… Enter to steer, Stop to interrupt"
/** The provider's own tries per request, and its sleeps between them (providers/openrouter.js stream). */
const TRIES = 4
const PROVIDER_SLEEPS = 500 + 1000 + 2000

beforeEach(() => {
  _resetIds()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})
afterEach(() => vi.useRealTimers())

/** An SSE answer, the shape `fetch` gives. */
function answer(text) {
  const frames = [`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n"]
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => (i < frames.length ? { done: false, value: encoder.encode(frames[i++]) } : { done: true }),
        cancel: async () => {},
        releaseLock() {},
      }),
    },
  }
}

/** A fetch that cannot reach anything while `down()`, as a browser with no network fails; then answers. */
function network() {
  const net = { up: false, calls: 0 }
  net.fetch = async () => {
    net.calls++
    if (!net.up) throw new TypeError("Failed to fetch")
    return answer("Back.")
  }
  return net
}

/** The real provider over that fetch. */
const providerOver = (net) => ({ stream: (request) => stream({ ...request, fetchImpl: net.fetch }) })

/** A session, and what every change to it showed. */
function recorded() {
  const repo = new Repo({ network: [] })
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.burst = null
    d.turns.push(makeTurn("user", [textBlock("hello")]))
  })
  const changes = []
  // A page of this browser's pool, whose run has the task, reads the line off each change.
  const local = { hasKey: true, pool: "pool-here", work: { state: "running", runs: [{ id: "run-1", pool: "pool-here", start: 1 }] } }
  handle.on("change", ({ doc }) => {
    const value = sessionValue(doc, local)
    changes.push({
      reconnecting: doc.reconnecting ? { ...doc.reconnecting } : null,
      turns: doc.turns.map((t) => `${t.role}:${t.blocks.length}`).join(" "),
      hint: value.hint,
      canStop: value.canStop,
    })
  })
  return { repo, handle, changes }
}

function burstOf(repo, handle, net) {
  const controller = new AbortController()
  const ctx = { repo, signal: controller.signal, run: "run-1", taskUrl: "automerge:task", settled: Promise.resolve(), progress: () => {}, log: () => {} }
  const done = runBurst(ctx, {
    session: handle.url,
    taskRuns: () => ["run-1"],
    getProvider: async () => providerOver(net),
    buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
    key: "made-up-key",
    flushMs: 5,
  })
  return { done, controller }
}

/** Distinct values in order, each run of equal ones once. */
const runs = (list) => list.filter((x, i) => i === 0 || JSON.stringify(x) !== JSON.stringify(list[i - 1]))

/** Move the clock through `n` failed tries: each is the provider's own sleeps, then the burst's backoff for that attempt. */
async function throughTries(n, from = 1) {
  for (let attempt = from; attempt < from + n; attempt++) {
    await vi.advanceTimersByTimeAsync(PROVIDER_SLEEPS + 50)
    await vi.advanceTimersByTimeAsync(reconnectDelay(attempt))
  }
}

describe("a burst with the provider unreachable for five tries", () => {
  it("reconnecting is set once and only counts up until the model answers; no turn is written or taken back while it waits; the line holds still", async () => {
    const { repo, handle, changes } = recorded()
    const net = network()
    const t0 = Date.now()
    const { done } = burstOf(repo, handle, net)
    await throughTries(4)
    await vi.advanceTimersByTimeAsync(PROVIDER_SLEEPS + 50)
    // Five tries refused, each the provider's four fetches; the burst waits out attempt 5's backoff.
    expect(net.calls).toBe(5 * TRIES)
    expect(handle.doc().reconnecting).toMatchObject({ attempts: 5 })
    const waitingSince = handle.doc().reconnecting.since

    // The network is back: the sixth try gets through.
    net.up = true
    await vi.advanceTimersByTimeAsync(reconnectDelay(5) + 1000)
    const result = await done
    expect(result.outcome).toBe(OUTCOME.idle)

    // Every value `reconnecting` took, in order: null, then attempts 1 to 5 with one `since`, then null once the model answered.
    const values = runs(changes.map((c) => c.reconnecting))
    expect(values.map((v) => v && v.attempts)).toEqual([null, 1, 2, 3, 4, 5, null])
    expect(new Set(values.filter(Boolean).map((v) => v.since))).toEqual(new Set([waitingSince]))
    expect(waitingSince).toBeGreaterThanOrEqual(t0)
    expect(values.filter(Boolean).every((v) => v.reason === "Could not reach OpenRouter (Failed to fetch)")).toBe(true)

    // Every change to the turns, in order: the message alone until the model answered, then its reply once, filling.
    const turns = runs(changes.map((c) => c.turns))
    expect(turns[0]).toBe("user:1")
    const firstReply = turns.findIndex((t) => t !== "user:1")
    expect(turns.slice(firstReply)).toEqual(["user:1 assistant:0", "user:1 assistant:1"])
    // No change shows the reply while `reconnecting` is set.
    expect(changes.filter((c) => c.reconnecting && c.turns !== "user:1")).toEqual([])

    // The line: from the first refused try until the answer, the same row, with Stop.
    const firstWait = changes.findIndex((c) => c.reconnecting)
    const answered = changes.findIndex((c, i) => i > firstWait && !c.reconnecting)
    const during = changes.slice(firstWait, answered)
    expect(during.length).toBeGreaterThanOrEqual(5)
    expect(during.every((c) => WAITING.test(c.hint) && c.canStop)).toBe(true)
    expect(during.some((c) => c.hint === HERE)).toBe(false)
    const doc = JSON.parse(JSON.stringify(handle.doc()))
    expect(doc.turns.map((t) => [t.role, t.blocks.map((b) => b.text).join("")])).toEqual([["user", "hello"], ["assistant", "Back."]])
    expect(doc.reconnecting).toBe(null)
    expect(doc.burst).toBe(null)
  })

  it("the 'online' event ends the wait early, and the same holds", async () => {
    const { repo, handle, changes } = recorded()
    const net = network()
    const { done } = burstOf(repo, handle, net)
    await throughTries(4)
    await vi.advanceTimersByTimeAsync(PROVIDER_SLEEPS + 50)
    expect(handle.doc().reconnecting).toMatchObject({ attempts: 5 })
    net.up = true
    globalThis.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(100)
    expect((await done).outcome).toBe(OUTCOME.idle)
    expect(runs(changes.map((c) => c.reconnecting?.attempts ?? null))).toEqual([null, 1, 2, 3, 4, 5, null])
  })

  it("a Stop during the wait: said as a stop while waiting for the network; nothing asked after it; no empty turn ever", async () => {
    const { repo, handle, changes } = recorded()
    const net = network()
    const { done } = burstOf(repo, handle, net)
    await throughTries(2)
    await vi.advanceTimersByTimeAsync(PROVIDER_SLEEPS + 50)
    expect(handle.doc().reconnecting).toMatchObject({ attempts: 3 })
    // Waiting out attempt 3's backoff: a person's Stop.
    await vi.advanceTimersByTimeAsync(1000)
    handle.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const callsAtStop = net.calls
    await vi.advanceTimersByTimeAsync(120_000)
    const result = await done
    expect(net.calls).toBe(callsAtStop)
    const doc = JSON.parse(JSON.stringify(handle.doc()))
    expect(stopOf(doc)).toMatchObject({ kind: STOP.stopped, text: "Stopped while waiting for the network (Could not reach OpenRouter (Failed to fetch))." })
    expect(doc.reconnecting).toBe(null)
    expect(doc.burst).toBe(null)
    expect(doc.turns.map((t) => t.role)).toEqual(["user", "assistant"])
    // Set once, counting 1 to 3, then cleared by the Stop.
    expect(runs(changes.map((c) => c.reconnecting?.attempts ?? null))).toEqual([null, 1, 2, 3, null])
    // The turns changed once: the Stop's notice.
    expect(runs(changes.map((c) => c.turns))).toEqual(["user:1", "user:1 assistant:1"])
    // After the Stop, the line says nothing and Stop is gone (the queue still says the run is under way).
    const last = changes.at(-1)
    expect([last.hint, last.canStop]).toEqual(["", false])
    expect(result.outcome).toBe("stopped")
    expect(result.heads).not.toBe(null)
  })
})
