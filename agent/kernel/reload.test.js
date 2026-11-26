/**
 * Refreshing a page with a working agent in it.
 *
 * What must hold, whenever the page goes:
 *   - a reply it was streaming is taken out and asked for again whole by the
 *     next runner, and nothing about it is said in the transcript;
 *   - a call it was running is put back to run again when it only reads, and
 *     answered as interrupted otherwise;
 *   - a page that gets to say it is going gives its sessions up, so the next
 *     runner need not wait for the lease to go stale, and the stopping it
 *     does on the way out writes nothing;
 *   - stopping a reply on purpose is not that: what was said stays;
 *   - a person's Stop, here or anywhere, holds: mid-reply or mid-call,
 *     nothing takes the session up again until someone speaks, and then
 *     what was said stays and a call cut off is answered;
 *   - no two claims of a session share a generation unless one renews the
 *     other, so a runner's own dead work never looks like work it is doing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { claimLease } from "../session/lease.js"
import { interruptedTurns, dropInterruptedTurns, resolveOrphans, orphanedCalls, INTERRUPTED, stopSession } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { SessionRunner, needsWork, STALE_AFTER_MS } from "./runner.js"
import { say } from "./loop.js"
import { memoryStore } from "./store.js"
import { statusOf, stopOf, STOP } from "../session/status.js"
import { Interruption } from "../net/network.js"

beforeEach(() => _resetIds())

const flush = () => new Promise((r) => setTimeout(r, 0))
const clone = (x) => JSON.parse(JSON.stringify(x))
const shape = (doc) => doc.turns.map((t) => [t.role, ...(t.blocks ?? []).map((b) => b.text ?? `${b.type}:${b.tool ?? b.callId ?? ""}`)])

function fresh() {
  const doc = {}
  initSession(doc, {})
  doc.turns.push(makeTurn("user", [textBlock("hello")]))
  return doc
}

/** A model that says some of a reply, then hangs until `abort` — as a page that dies mid-reply leaves it. */
function hanging() {
  let reached
  const at = new Promise((r) => (reached = r))
  return {
    at,
    provider: {
      async *stream(request) {
        yield { type: "text", delta: "Half a thou" }
        reached()
        await new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      },
    },
  }
}
const answering = (text = "A whole reply.") => {
  const requests = []
  return { requests, async *stream(request) { requests.push(request); yield { type: "text", delta: text }; yield { type: "stop", reason: "stop" } } }
}
const noTools = async () => ({ tools: [], schemas: [], get: () => null })
const runner = (store, url, provider, extra = {}) =>
  new SessionRunner({ store, runnerUrl: url, buildToolset: noTools, getProvider: async () => provider, canRun: () => true, confirmMs: 0, flushMs: 0, ...extra })

/** Runner A, mid-reply, with what it streamed written to the document. */
async function midReply() {
  const store = memoryStore(fresh())
  const h = hanging()
  const a = runner(store, "tab-A", h.provider)
  const done = a.tick()
  await h.at
  await new Promise((r) => setTimeout(r, 200)) // the appender's batch
  return { store, a, done }
}

describe("a page that dies mid-reply", () => {
  it("leaves the reply marked as streaming, and that is work once its runner is gone", async () => {
    const { store, a, done } = await midReply()
    const doc = clone(store.doc())
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "tab-A", generation: 1 })
    // While A lives, it is A's.
    expect(interruptedTurns(doc, { now: doc.lease.at + 1 })).toEqual([])
    expect(needsWork(doc, () => true, () => true)).toBe(false)
    // Once its lease is stale, it is half a reply nobody will finish.
    expect(interruptedTurns(doc, { now: doc.lease.at + STALE_AFTER_MS + 1 }).map((t) => t.id)).toEqual([doc.turns.at(-1).id])
    expect(needsWork(doc, () => true, () => false)).toBe(true)
    a.stop()
    await done
  })

  it("is asked again whole by the next runner, with nothing said about it", async () => {
    const { store, a } = await midReply()
    const dead = clone(store.doc()) // the page is gone: nothing more of A's lands
    a.stop()

    let t = Date.now()
    const model = answering()
    const b = runner(memoryStore(dead), "tab-B", model, { now: () => t })
    await b.tick() // first sight of A's lease: live
    t += STALE_AFTER_MS + 1
    await b.tick()

    const after = b.store.doc()
    expect(shape(after)).toEqual([["user", "hello"], ["assistant", "A whole reply."]])
    expect(after.turns.some((turn) => turn.streaming)).toBe(false)
    expect(statusOf(after)).toBe(STATUS.idle)
    // The model was asked from the person's message, not from half a reply.
    expect(JSON.stringify(model.requests[0].messages)).not.toContain("Half a thou")
  })
})

describe("a page that says it is going", () => {
  it("gives the lease up, and its stop writes nothing: the reply stays marked, for the next runner to settle", async () => {
    const { store, a, done } = await midReply()
    expect(a.release()).toBe(true)
    a.stop()
    await done
    const doc = store.doc()
    expect(doc.lease).toBeNull()
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "tab-A", generation: 1 })
    expect(needsWork(doc)).toBe(true)
    expect(needsWork(doc)).toBe(true)
  })

  it("and the next runner takes the session up at once", async () => {
    const { store, a, done } = await midReply()
    a.release()
    a.stop()
    await done
    const model = answering()
    const b = runner(memoryStore(clone(store.doc())), "tab-B", model)
    await b.tick()
    expect(shape(b.store.doc())).toEqual([["user", "hello"], ["assistant", "A whole reply."]])
    expect(b.store.doc().lease).toBeNull() // finished, and released in its turn
    expect(b.store.doc().lastGeneration).toBe(2)
  })

  it("a runner holding nothing has nothing to give up", () => {
    const store = memoryStore(fresh())
    expect(runner(store, "tab-A", answering()).release()).toBe(false)
  })
})

describe("stopping a reply on purpose", () => {
  it("keeps what was said, unmarked, and is not taken up again", async () => {
    const { store, a, done } = await midReply()
    a.interrupt()
    await done
    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "Half a thou"]])
    expect(doc.turns.at(-1).streaming).toBeUndefined()
    expect(statusOf(doc)).toBe(STATUS.idle)
    expect(needsWork(doc)).toBe(false)
    a.stop()
  })
})

/**
 * A person's Stop, as the view writes it (ui/session-runners.js stop): the
 * stop into the session, then this tab's runner interrupted. `here: false`
 * is a Stop pressed on another page or device: the change arrives, and the
 * runner hears it as it hears any change (its tick is the change handler).
 */
function personStops(store, a, { here = true } = {}) {
  store.change((d) => stopSession(d, STOP.stopped, null, "automerge:person"))
  if (here) a.interrupt()
  else a.tick()
}

/** As `hanging`, but the read that the abort cuts fails as OpenRouter's does: as an interruption (providers/openrouter.js readBody). */
function hangingAsNetwork() {
  const h = hanging()
  return {
    at: h.at,
    provider: {
      async *stream(request) {
        try {
          yield* h.provider.stream(request)
        } catch {
          throw new Interruption("Could not read the reply (aborted)")
        }
      },
    },
  }
}

const notices = (doc) => doc.turns.flatMap((t) => t.blocks.filter((b) => b.type === "notice"))

describe("a person's Stop", () => {
  const STREAMS = [
    ["ends as aborted", hanging],
    ["fails as an interruption", hangingAsNetwork],
  ]
  const WHERE = [
    ["in this tab", true],
    ["on another page or device", false],
  ]
  const CASES = STREAMS.flatMap(([how, make]) => WHERE.map(([where, here]) => [where, how, make, here]))

  it.each(CASES)("mid-reply, pressed %s, its stream's read %s: the reply stays unmarked, the stop is said once, nothing takes it up, and the next run after a message keeps the reply", async (_where, _how, make, here) => {
    const store = memoryStore(fresh())
    const h = make()
    const a = runner(store, "tab-A", h.provider)
    const done = a.tick()
    await h.at
    await new Promise((r) => setTimeout(r, 200)) // the appender's batch
    personStops(store, a, { here })
    expect((await done).outcome).toBe("aborted")

    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "Half a thou"], ["assistant", "Stopped by a person."]])
    expect(doc.turns.at(-1)).toMatchObject({ role: "assistant", author: "automerge:person" })
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect([statusOf(doc), doc.lease, needsWork(doc)]).toEqual([STATUS.idle, null, false])
    // The poll, and the same Stop again, change nothing.
    const before = JSON.stringify(doc)
    await a.tick()
    personStops(store, a, { here })
    expect(JSON.stringify(store.doc())).toBe(before)
    a.stop()

    say(store, "go on")
    const model = answering("Going on.")
    const b = runner(store, "tab-B", model)
    await b.tick()
    expect(shape(store.doc())).toEqual([["user", "hello"], ["assistant", "Half a thou"], ["assistant", "Stopped by a person."], ["user", "go on"], ["assistant", "Going on."]])
    expect(JSON.stringify(model.requests[0].messages)).toContain("Half a thou")
    expect(notices(store.doc())).toHaveLength(1)
  })

  /** A model that calls `tool` once, then answers in words. */
  function callingOnce(tool) {
    const requests = []
    return {
      requests,
      async *stream(request) {
        requests.push(request)
        if (requests.length === 1) {
          yield { type: "call", id: "c1", name: tool, input: {} }
          yield { type: "stop", reason: "tool_use" }
        } else {
          yield { type: "text", delta: "Carried on." }
          yield { type: "stop", reason: "stop" }
        }
      },
    }
  }
  const toolsOf = (...tools) => async () => ({ tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null })

  it.each(WHERE)("during a tool call, pressed %s: the call's result lands after the notice and changes nothing, and the model is not asked again until someone speaks", async (_where, here) => {
    const store = memoryStore(fresh())
    let a
    const slow = { id: "slow", risk: "edit", where: "worker", execute: async () => (personStops(store, a, { here }), "done") }
    const model = callingOnce("slow")
    a = runner(store, "tab-A", model, { buildToolset: toolsOf(slow) })
    expect((await a.tick()).outcome).toBe("aborted")

    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "call:slow"], ["assistant", "Stopped by a person."], ["tool", "result:c1"]])
    expect([statusOf(doc), doc.lease, needsWork(doc)]).toEqual([STATUS.idle, null, false])
    // What the 5 s poll does: nothing.
    expect(await a.tick()).toBeUndefined()
    expect(model.requests).toHaveLength(1)

    say(store, "go on")
    await a.tick()
    expect(model.requests).toHaveLength(2)
    expect(shape(store.doc()).at(-1)).toEqual(["assistant", "Carried on."])
    // The call's result goes to the model next to its call, the notice after it.
    expect(model.requests[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"])
    a.stop()
  })

  it("during a tool call that never returns: the call stays running under no lease, and the run after the next message answers it as interrupted", async () => {
    const store = memoryStore(fresh())
    let a
    const stuck = { id: "stuck", risk: "edit", where: "worker", execute: () => (personStops(store, a), new Promise(() => {})) }
    const model = callingOnce("stuck")
    a = runner(store, "tab-A", model, { buildToolset: toolsOf(stuck) })
    a.tick() // never ends: its tool never returns
    await vi.waitFor(() => expect(stopOf(store.doc())?.kind).toBe(STOP.stopped))
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.running)
    expect(needsWork(store.doc())).toBe(false)

    say(store, "go on")
    const b = runner(store, "tab-B", model, { buildToolset: toolsOf(stuck) })
    await b.tick()
    expect(String(findResult(store.doc(), "c1").block.output)).toBe(INTERRUPTED)
    expect(shape(store.doc()).at(-1)).toEqual(["assistant", "Carried on."])
    a.stop()
  })
})

describe("a call cut off by a reload", () => {
  function cutOff(tool) {
    const doc = fresh()
    claimLease(doc, "tab-old", 0)
    const call = callBlock(tool, {}, { id: "c1" })
    Object.assign(call, { status: CALL.running, runner: "tab-old", generation: doc.lease.generation })
    doc.turns.push(makeTurn("assistant", [call]))
    return doc
  }

  it("runs again when it only reads", () => {
    const doc = cutOff("look")
    expect(resolveOrphans(doc, { now: STALE_AFTER_MS + 1, rerun: (call) => call.tool === "look" })).toBe(1)
    const block = doc.turns.at(-1).blocks[0]
    expect(block).toMatchObject({ status: CALL.approved, runner: null, generation: null })
    expect(doc.turns.at(-1).role).toBe("assistant") // no result written
  })

  it("is answered as interrupted otherwise", () => {
    const doc = cutOff("poke")
    resolveOrphans(doc, { now: STALE_AFTER_MS + 1, rerun: () => false })
    const result = doc.turns.at(-1).blocks[0]
    expect(result).toMatchObject({ type: "result", isError: true })
    expect(String(result.output)).toBe(INTERRUPTED)
  })

  it("end to end: the runner re-runs a read by its tool's risk, and answers a write", async () => {
    const ran = []
    const tool = (id, risk) => ({ id, risk, where: "worker", execute: async () => (ran.push(id), `${id} ok`) })
    const tools = [tool("look", "read"), tool("poke", "write")]
    const toolset = { tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null }
    const doc = fresh()
    claimLease(doc, "tab-old", Date.now() - 20 * 60 * 1000)
    const calls = ["look", "poke"].map((id) => Object.assign(callBlock(id, {}, { id }), { status: CALL.running, runner: "tab-old", generation: 1 }))
    doc.turns.push(makeTurn("assistant", calls))
    const b = runner(memoryStore(doc), "tab-B", answering("Checked."), { buildToolset: async () => toolset })
    await b.tick()
    expect(ran).toEqual(["look"])
    const out = b.store.doc()
    const results = out.turns.filter((t) => t.role === "tool").flatMap((t) => t.blocks)
    expect(String(results.find((r) => r.callId === "poke").output)).toBe(INTERRUPTED)
    expect(String(results.find((r) => r.callId === "look").output)).toBe("look ok")
    expect(shape(out).at(-1)).toEqual(["assistant", "Checked."])
  })
})

describe("generations", () => {
  /**
   * Every sequence of up to six claims by A or B and releases: a claim that
   * is not a renewal gets a generation above every one before it, and a
   * renewal keeps its own.
   */
  it("never repeat across claims, releases and takeovers", () => {
    const OPS = ["A", "B", "release"]
    let sequences = [[]]
    let checked = 0
    for (let len = 1; len <= 6; len++) {
      sequences = sequences.flatMap((s) => OPS.map((op) => [...s, op]))
      for (const seq of sequences) {
        const doc = {}
        initSession(doc, {})
        const seen = []
        for (const op of seq) {
          if (op === "release") {
            doc.lease = null
            continue
          }
          const renewal = doc.lease?.runner === op
          const before = doc.lease?.generation
          const { generation } = claimLease(doc, op, 0)
          if (renewal) expect(generation).toBe(before)
          else expect(generation).toBeGreaterThan(Math.max(0, ...seen))
          seen.push(generation)
        }
        checked++
      }
    }
    expect(checked).toBe(3 + 9 + 27 + 81 + 243 + 729)
  })

  it("so a runner that takes up again the session it lost does not find its own dead reply live", () => {
    const doc = fresh()
    claimLease(doc, "tab-A", 0)
    doc.turns.push(Object.assign(makeTurn("assistant", [textBlock("half")]), { streaming: { runner: "tab-A", generation: doc.lease.generation } }))
    claimLease(doc, "tab-A-cancel", 0) // stopped from outside
    doc.lease = null // and released
    claimLease(doc, "tab-A", 1)
    expect(interruptedTurns(doc, { now: 2 }).length).toBe(1)
    expect(dropInterruptedTurns(doc, { now: 2 })).toBe(1)
    expect(shape(doc)).toEqual([["user", "hello"]])
  })
})
