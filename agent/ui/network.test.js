/**
 * The network going away is an interruption, not a failure (net/network.js).
 *
 * What must hold, whatever was under way when it went:
 *
 *   1. nothing is written to the transcript for it — no ⚠ turn, no result;
 *   2. a turn it cut off is taken back whole, and asked for again;
 *   3. a call it cut off is back to waiting to run, as it was before it was
 *      claimed, and runs again; a call that ran before it in the batch stands;
 *   4. the session says it is reconnecting, never that it failed — and a
 *      workflow step in that state is still running;
 *   5. the runner tries again on the network's return, or after a backoff,
 *      and not on every poll in between;
 *   6. a person can stop it, and then nothing is left to run: what waited for
 *      the network is closed, not run, by the message that carries it on.
 */
import { describe, it, expect, vi } from "vitest"
import { run, say, OUTCOME } from "../kernel/loop.js"
import { SessionRunner, needsWork } from "../kernel/runner.js"
import { memoryStore } from "../kernel/store.js"
import { initSession, STATUS, CALL, _resetIds } from "../session/schema.js"
import { claimLease } from "../session/lease.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { findCall, findResult } from "../session/calls.js"
import { stopSession, markReconnecting, NOT_RUN } from "../session/recovery.js"
import { STOP, statusOf } from "../session/status.js"
import { Interruption, isInterruption, networkDown, asInterruption, reconnectDelay, onOnline, RECONNECT_MAX_MS } from "../net/network.js"
import { relayFetch } from "../net/relay.js"
import { webSearch } from "../tools/web.js"
import { sessionOutcome } from "../workflow/driver.js"
import { activityOf } from "./attention.js"
import { settled } from "../fixtures/session.js"

function toolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}

/** A provider following a script of turns; an Error in a turn is thrown at that point of the stream. */
function scripted(script) {
  let i = 0
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const step = script[i++] ?? [{ type: "text", delta: "(exhausted)" }]
      for (const event of step) {
        if (event instanceof Error) throw event
        yield event
      }
      if (!step.some((e) => e.type === "stop")) yield { type: "stop", reason: step.some((e) => e.type === "call") ? "tool_use" : "end" }
    },
  }
}

function session(turns) {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Net", subject: "automerge:subject" })
  doc.turns = turns
  claimLease(doc, "runner-a", Date.now())
  return memoryStore(doc)
}

const go = (store, provider, tools = []) =>
  run({ store, provider, toolset: toolset(tools), runnerUrl: "runner-a", generation: store.doc().lease.generation, flushMs: 0, canRun: () => true })

const blocks = (store) => store.doc().turns.flatMap((t) => t.blocks.map((b) => ({ role: t.role, ...b })))
const offlineErr = () => new Interruption("Could not reach OpenRouter (Failed to fetch)")

describe("network.js", () => {
  it("backs off from 2 s, doubling, to a minute and no further", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelay)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
    expect(reconnectDelay(1000)).toBe(RECONNECT_MAX_MS)
  })

  it("says this machine's network is down only for codes that mean it, through causes", () => {
    for (const code of ["ENETUNREACH", "ENETDOWN", "EAI_AGAIN", "ENOTCONN"]) {
      expect(networkDown({ code }), code).toBe(true)
      expect(networkDown(new TypeError("fetch failed", { cause: { code } })), code).toBe(true)
    }
    // The far end's trouble, not ours.
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", undefined]) expect(networkDown({ code }), String(code)).toBe(false)
    expect(networkDown(new TypeError("Failed to fetch"))).toBe(false)
  })

  it("believes a browser that says it is offline, and only that", () => {
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator")
    try {
      Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true })
      expect(networkDown(new TypeError("Failed to fetch"))).toBe(true)
      expect(isInterruption(asInterruption(new TypeError("x"), "Could not fetch y"))).toBe(true)
      Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true })
      expect(networkDown(new TypeError("Failed to fetch"))).toBe(false)
      expect(asInterruption(new TypeError("x"), "Could not fetch y")).toBe(null)
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was)
      else delete globalThis.navigator
    }
  })

  it("hears 'online' where there is such an event, and nothing where there is not", () => {
    const target = new EventTarget()
    const heard = vi.fn()
    const off = onOnline(heard, target)
    target.dispatchEvent(new Event("online"))
    off()
    target.dispatchEvent(new Event("online"))
    expect(heard).toHaveBeenCalledTimes(1)
    expect(typeof onOnline(heard, {})).toBe("function")
  })
})

describe("the loop, when the network goes", () => {
  it("before the model answers: no turn, no ⚠, reconnecting", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const result = await go(store, scripted([[offlineErr()]]))
    expect(result.outcome).toBe(OUTCOME.reconnecting)
    expect(settled(store.doc())).toBe(STATUS.reconnecting)
    expect(store.doc().reconnecting).toMatchObject({ reason: "Could not reach OpenRouter (Failed to fetch)", attempts: 1 })
    expect(store.doc().turns).toHaveLength(1)
    expect(needsWork(store.doc())).toBe(true)
  })

  it("mid-reply: the half-turn is taken back, and the whole one asked for again", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const provider = scripted([
      [{ type: "reasoning", delta: "thinking" }, { type: "text", delta: "Hal" }, offlineErr()],
      [{ type: "text", delta: "Hello again." }],
    ])
    await go(store, provider)
    expect(store.doc().turns).toHaveLength(1)
    const since = store.doc().reconnecting.since

    const result = await go(store, provider)
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(settled(store.doc())).toBe(STATUS.idle)
    expect(store.doc().reconnecting).toBe(null)
    expect(blocks(store).map((b) => [b.role, b.type, b.text])).toEqual([
      ["user", "text", "hello"],
      ["assistant", "text", "Hello again."],
    ])
    // The second request is the first one again: nothing of the lost half went with it.
    expect(JSON.stringify(provider.requests[1].messages)).toBe(JSON.stringify(provider.requests[0].messages))
    expect(since).toBeTypeOf("number")
  })

  it("takes back the cut-off turn, not one the person sent while it streamed", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const provider = {
      async *stream() {
        yield { type: "text", delta: "Hal" }
        store.change((d) => d.turns.push(makeTurn("user", [textBlock("also this")])))
        throw offlineErr()
      },
    }
    await go(store, provider)
    expect(blocks(store).map((b) => b.text)).toEqual(["hello", "also this"])
  })

  it("keeps the time it first went across attempts, and counts them", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const provider = scripted([[offlineErr()], [offlineErr()], [offlineErr()]])
    await go(store, provider)
    const first = store.doc().reconnecting.since
    await go(store, provider)
    await go(store, provider)
    expect(store.doc().reconnecting).toMatchObject({ since: first, attempts: 3 })
  })

  it("under a tool call: the call is back to waiting, no result, and runs again; what ran before it stands", async () => {
    const store = session([makeTurn("user", [textBlock("read two")])])
    let fetches = 0
    const tools = [
      { id: "doc_read", where: "worker", risk: "read", execute: async () => "first ok" },
      {
        id: "web_fetch",
        where: "worker",
        risk: "read",
        execute: async () => {
          if (fetches++ === 0) throw new Interruption("The fetch relay could not be reached (Failed to fetch)")
          return "page"
        },
      },
    ]
    const provider = scripted([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }, { type: "call", id: "c2", name: "web_fetch", input: {} }],
      [{ type: "text", delta: "Both read." }],
    ])
    // Read-risk calls run without asking; if this toolset's policy asks, approve them here.
    const result = await go(store, provider, tools)
    expect(result.outcome).toBe(OUTCOME.reconnecting)
    const doc = store.doc()
    expect(String(findResult(doc, "c1")?.block.output)).toBe("first ok")
    expect(findResult(doc, "c2")).toBeFalsy()
    expect(findCall(doc, "c2").block.status).toBe(CALL.approved)
    expect(blocks(store).some((b) => /⚠|Error/.test(String(b.text ?? b.output ?? "")))).toBe(false)

    const again = await go(store, provider, tools)
    expect(again.outcome).toBe(OUTCOME.idle)
    expect(String(findResult(store.doc(), "c2")?.block.output)).toBe("page")
    expect(fetches).toBe(2)
    expect(store.doc().reconnecting).toBe(null)
    // One request per model turn: the interrupted batch did not cost a model call.
    expect(provider.requests).toHaveLength(2)
  })

  it("a real error is still an error", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const result = await go(store, scripted([[new Error("OpenRouter 401: bad key")]]))
    expect(result.outcome).toBe(OUTCOME.error)
    expect(settled(store.doc())).toBe(STATUS.error)
    expect(blocks(store).at(-1)).toMatchObject({ type: "notice", kind: "error", text: expect.stringMatching(/^OpenRouter 401/) })
  })

  it("stopped by the person while a call waits: the session says so once, nothing is left to run, and the call is closed by the next message, not run", async () => {
    const store = session([makeTurn("user", [textBlock("fetch")])])
    let fetches = 0
    const tools = [{ id: "web_fetch", where: "worker", risk: "read", execute: async () => { fetches++; throw new Interruption("no relay") } }]
    await go(store, scripted([[{ type: "call", id: "c1", name: "web_fetch", input: {} }], [{ type: "text", delta: "Fine." }]]), tools)
    expect(settled(store.doc())).toBe(STATUS.reconnecting)

    let stopped
    store.change((d) => (stopped = stopSession(d, STOP.stopped, null, "automerge:person")))
    expect(stopped).toBe(true)
    let doc = store.doc()
    // Put back for the network, it stays cleared to run under the stop, unanswered.
    expect(findCall(doc, "c1").block.status).toBe(CALL.approved)
    expect(findResult(doc, "c1")).toBeNull()
    expect(doc.turns.at(-1)).toMatchObject({ role: "assistant", author: "automerge:person" })
    expect(blocks(store).at(-1)).toMatchObject({ type: "notice", kind: "stopped", text: "Stopped while waiting for the network (no relay)." })
    expect([settled(doc), doc.reconnecting, doc.lease, needsWork(doc)]).toEqual([STATUS.idle, null, null, false])
    // Said once.
    store.change((d) => (stopped = stopSession(d, STOP.stopped)))
    expect(stopped).toBe(false)
    expect(blocks(store).filter((b) => b.type === "notice")).toHaveLength(1)

    // A message carries it on; the call is answered as not run, and never runs.
    say(store, "never mind that")
    doc = store.doc()
    expect(findCall(doc, "c1").block.status).toBe(CALL.error)
    expect(String(findResult(doc, "c1").block.output)).toBe(NOT_RUN)
    expect(needsWork(doc)).toBe(true)
    store.change((d) => claimLease(d, "runner-a", Date.now()))
    expect((await go(store, scripted([[{ type: "text", delta: "Fine." }]]), tools)).outcome).toBe(OUTCOME.idle)
    expect(fetches).toBe(1)
    expect(blocks(store).at(-1).text).toBe("Fine.")
  })
})

describe("the runner, waiting for the network", () => {
  function runnerOver(store, provider, extra = {}) {
    return new SessionRunner({
      store,
      runnerUrl: "runner-a",
      buildToolset: async () => toolset([]),
      getProvider: async () => provider,
      canRun: () => true,
      confirmMs: 0,
      system: "",
      ...extra,
    })
  }

  it("does not try again on every poll, but at the end of the backoff or when the network is back", async () => {
    vi.useFakeTimers()
    try {
      const store = session([makeTurn("user", [textBlock("hello")])])
      const provider = scripted([[offlineErr()], [offlineErr()], [{ type: "text", delta: "Back." }]])
      let back = null
      const events = []
      const runner = runnerOver(store, provider, { onOnline: (fn) => ((back = fn), () => (back = null)), now: () => Date.now(), onEvent: (e) => events.push(e) })
      runner.unlisten = runner.onOnline(() => runner.resume())

      await runner.tick()
      expect(provider.requests).toHaveLength(1)
      expect(events.find((e) => e.type === "reconnecting")).toMatchObject({ attempt: 1, delay: 2000 })

      // Polls and changes in the meantime do nothing.
      await runner.tick()
      await runner.tick()
      expect(provider.requests).toHaveLength(1)

      // The backoff ends: one more try, which fails, and the wait doubles.
      await vi.advanceTimersByTimeAsync(2000)
      expect(provider.requests).toHaveLength(2)
      expect(events.filter((e) => e.type === "reconnecting").at(-1)).toMatchObject({ attempt: 2, delay: 4000 })

      // The network is back before that: at once.
      back()
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() => expect(settled(store.doc())).toBe(STATUS.idle))
      expect(provider.requests).toHaveLength(3)
      expect(store.doc().reconnecting).toBe(null)
      expect(runner.reconnects).toBe(0)
      expect(blocks(store).map((b) => b.text)).toEqual(["hello", "Back."])
      runner.stop()
      expect(back).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it("an interruption before the run starts is waited out too, not recorded as an error", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    const runner = runnerOver(store, null, {
      getProvider: async () => {
        throw new Interruption("Could not start the run: this machine has no network")
      },
    })
    const result = await runner.tick()
    runner.stop()
    expect(result.outcome).toBe(OUTCOME.reconnecting)
    expect(settled(store.doc())).toBe(STATUS.reconnecting)
    expect(store.doc().turns).toHaveLength(1)
  })

  it("a retry that cannot start for another reason says so, and is no longer waiting for the network, in one change", async () => {
    const store = session([makeTurn("user", [textBlock("hello")])])
    store.change((d) => markReconnecting(d, "no relay"))
    // After every change: is there an error notice, and is it still waiting?
    const seen = []
    const change = store.change.bind(store)
    store.change = (fn) => {
      change(fn)
      const doc = store.doc()
      seen.push([doc.turns.some((t) => t.blocks.some((b) => b.type === "notice" && b.kind === STOP.error)), doc.reconnecting != null])
    }
    const runner = runnerOver(store, null, {
      getProvider: async () => {
        throw new Error("No provider called nowhere")
      },
    })
    const result = await runner.tick()
    runner.stop()
    expect(result.outcome).toBe(OUTCOME.error)
    expect(seen).not.toContainEqual([true, true])
    expect(store.doc().reconnecting).toBe(null)
    expect(settled(store.doc())).toBe(STATUS.error)
    say(store, "try again")
    expect(statusOf(store.doc())).not.toBe(STATUS.reconnecting)
  })
})

describe("what counts as the network going, in the web tools", () => {
  it("the relay not answering is an interruption; the relay answering that a site would not is not", async () => {
    const relay = () => ({ url: "https://relay.example" })
    const down = relayFetch({ fetch: async () => { throw new TypeError("Failed to fetch") }, relay })
    const err = await down("https://example.com/").catch((e) => e)
    expect(isInterruption(err)).toBe(true)

    const refused = relayFetch({ fetch: async () => ({ ok: false, status: 502, headers: new Headers({ "x-relay-error": "connect ECONNREFUSED" }) }), relay })
    const err2 = await refused("https://example.com/").catch((e) => e)
    expect(isInterruption(err2)).toBe(false)
    expect(err2.message).toMatch(/did not fetch/)
  })

  it("a stopped run's abort is not an interruption", async () => {
    const controller = new AbortController()
    controller.abort()
    const relayed = relayFetch({ fetch: async () => { throw new DOMException("aborted", "AbortError") }, relay: () => ({ url: "https://relay.example" }) })
    const err = await relayed("https://example.com/", { signal: controller.signal }).catch((e) => e)
    expect(isInterruption(err)).toBe(false)
  })

  it("web_search that cannot reach the search API is an interruption, whatever stopped it", async () => {
    const fetchImpl = async () => {
      throw new Error("unused")
    }
    for (const failure of [new TypeError("Failed to fetch"), Object.assign(new Error("refused"), { refused: true, reason: "api.search.brave.com did not resolve" })]) {
      const search = async () => {
        throw failure
      }
      search.ready = () => true
      const err = await webSearch.execute({ query: "q" }, { fetchImpl, direct: true, search }).catch((e) => e)
      expect(isInterruption(err), failure.message).toBe(true)
    }
  })
})

describe("a workflow step waiting for the network", () => {
  it("is running, not failed, and says what it is doing", () => {
    const doc = { status: STATUS.reconnecting, reconnecting: { reason: "x", since: 1, attempts: 1 }, turns: [makeTurn("user", [textBlock("go")])] }
    expect(sessionOutcome(doc).state).toBe("running")
    expect(activityOf(doc)).toBe("Waiting for the network…")
  })
})
