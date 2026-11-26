/**
 * A run going away with a working agent in it: its worker killed, its pool
 * stopping it, or its task cancelled. Each burst is one run of the session's
 * task (kernel/burst.js); its marks name its run.
 *
 * What must hold, whenever a run goes:
 *   - a reply it was streaming is taken out and asked for again whole by the
 *     next run, and nothing about it is said in the transcript;
 *   - a call it was running is put back to run again when it only reads, and
 *     answered as interrupted otherwise;
 *   - a run its pool stops (`stopping`) writes nothing more, and the next run
 *     of its task settles what it left;
 *   - a cancel is not that: what was said stays;
 *   - a person's Stop, here or anywhere, holds: mid-reply or mid-call,
 *     nothing takes the session up again until someone speaks, and then
 *     what was said stays and a call cut off is answered;
 *   - marks are judged by equality with the run `burst` names, so a later
 *     run of a task settles every earlier run's marks, and never its own.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { debrisTurns, settleDebris, INTERRUPTED, stopSession } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { needsWork } from "./runner.js"
import { burstRunner } from "../fixtures/burst.js"
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
  burstRunner({ store, runnerUrl: url, buildToolset: noTools, getProvider: async () => provider, canRun: () => true, flushMs: 0, ...extra })

/** Run A, mid-reply, with what it streamed written to the document. */
async function midReply() {
  const store = memoryStore(fresh())
  const h = hanging()
  const a = runner(store, "tab-A", h.provider)
  const done = a.tick()
  await h.at
  await new Promise((r) => setTimeout(r, 200)) // the appender's batch
  return { store, a, done }
}

describe("a run that dies mid-reply", () => {
  it("leaves the reply marked as streaming, and that is work once `burst` no longer names its run", async () => {
    const { store, a, done } = await midReply()
    const doc = clone(store.doc())
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "tab-A" })
    expect(doc.burst).toEqual({ run: "tab-A" })
    // While `burst` names A, it is A's.
    expect(debrisTurns(doc, doc.burst.run)).toEqual([])
    expect(needsWork(doc)).toBe(false)
    // Once it names nothing, or another run, it is half a reply nobody will finish.
    for (const burst of [null, { run: "tab-B" }]) {
      const other = { ...clone(doc), burst }
      expect(debrisTurns(other, burst?.run ?? null).map((t) => t.id)).toEqual([doc.turns.at(-1).id])
      expect(needsWork(other)).toBe(true)
    }
    a.stop()
    await done
  })

  it("is asked again whole by the next run of its task, with nothing said about it", async () => {
    const { store, a } = await midReply()
    const dead = clone(store.doc()) // the worker is gone: nothing more of A's lands
    a.stop()

    const model = answering()
    const b = runner(memoryStore(dead), "tab-B", model, { taskRuns: () => ["tab-A", "tab-B"] })
    await b.tick()

    const after = b.store.doc()
    expect(shape(after)).toEqual([["user", "hello"], ["assistant", "A whole reply."]])
    expect(after.turns.some((turn) => turn.streaming)).toBe(false)
    expect(after.burst).toBe(null)
    expect(statusOf(after)).toBe(STATUS.idle)
    // The model was asked from the person's message, not from half a reply.
    expect(JSON.stringify(model.requests[0].messages)).not.toContain("Half a thou")
  })

  it("and a run of another task that finds `burst` naming A stands back, writing nothing", async () => {
    const { store, a } = await midReply()
    const dead = clone(store.doc())
    a.stop()
    const model = answering()
    const b = runner(memoryStore(clone(dead)), "tab-B", model)
    expect((await b.tick()).outcome).toBe("held")
    expect(b.store.doc()).toEqual(dead)
    expect(model.requests).toHaveLength(0)
  })
})

describe("a run its pool stops", () => {
  it("writes nothing more: the reply stays marked, for the next run of its task to settle", async () => {
    const { store, a, done } = await midReply()
    a.interrupt("stopping")
    expect((await done).outcome).toBe("stopping")
    const doc = store.doc()
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "tab-A" })
    expect(needsWork(doc)).toBe(true)
  })

  it("and the next run takes the session up at once", async () => {
    const { store, a, done } = await midReply()
    a.interrupt("stopping")
    await done
    const model = answering()
    const b = runner(memoryStore(clone(store.doc())), "tab-B", model, { taskRuns: () => ["tab-A", "tab-B"] })
    await b.tick()
    expect(shape(b.store.doc())).toEqual([["user", "hello"], ["assistant", "A whole reply."]])
    expect(b.store.doc().burst).toBe(null) // finished, and cleared at its end
  })
})

describe("cancelling a reply on purpose", () => {
  it("keeps what was said, unmarked, and is not taken up again", async () => {
    const { store, a, done } = await midReply()
    a.interrupt("cancelled")
    expect((await done).outcome).toBe("cancelled")
    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "Half a thou"]])
    expect(doc.turns.at(-1).streaming).toBeUndefined()
    expect(statusOf(doc)).toBe(STATUS.idle)
    expect(needsWork(doc)).toBe(false)
  })
})

/**
 * A person's Stop, as the view writes it (runners/ask.js stop): the stop
 * into the session, then the task under the key stopped on the stopper's
 * own queue, which cancels the run. `here: false` is a Stop pressed on a
 * device that cannot see the queue: only the change arrives, and the burst
 * hears it as it hears any change to its session.
 */
function personStops(store, a, { here = true } = {}) {
  store.change((d) => stopSession(d, STOP.stopped, null, "automerge:person"))
  if (here) a.interrupt("cancelled")
}
const stoppedAs = (here) => (here ? "cancelled" : "stopped")

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
    expect((await done).outcome).toBe(stoppedAs(here))

    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "Half a thou"], ["assistant", "Stopped by a person."]])
    expect(doc.turns.at(-1)).toMatchObject({ role: "assistant", author: "automerge:person" })
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect([statusOf(doc), doc.burst, needsWork(doc)]).toEqual([STATUS.idle, null, false])
    // Another burst, and the same Stop again, change nothing.
    const before = JSON.stringify(doc)
    expect((await a.tick()).outcome).toBe("stopped")
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
    expect((await a.tick()).outcome).toBe(stoppedAs(here))

    const doc = store.doc()
    expect(shape(doc)).toEqual([["user", "hello"], ["assistant", "call:slow"], ["assistant", "Stopped by a person."], ["tool", "result:c1"]])
    expect([statusOf(doc), doc.burst, needsWork(doc)]).toEqual([STATUS.idle, null, false])
    // A burst asked meanwhile does nothing.
    expect((await a.tick()).outcome).toBe("stopped")
    expect(model.requests).toHaveLength(1)

    say(store, "go on")
    await a.tick()
    expect(model.requests).toHaveLength(2)
    expect(shape(store.doc()).at(-1)).toEqual(["assistant", "Carried on."])
    // The call's result goes to the model next to its call, the notice after it.
    expect(model.requests[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"])
    a.stop()
  })

  it("during a tool call that never returns: the call stays running with `burst` cleared, and the run after the next message answers it as interrupted", async () => {
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

describe("a call cut off by a run that went", () => {
  function cutOff(tool) {
    const doc = fresh()
    doc.burst = { run: "run-old" }
    const call = callBlock(tool, {}, { id: "c1" })
    Object.assign(call, { status: CALL.running, runner: "run-old" })
    doc.turns.push(makeTurn("assistant", [call]))
    return doc
  }

  it("runs again when it only reads", () => {
    const doc = cutOff("look")
    expect(settleDebris(doc, "run-new", { ownRun: (run) => run === "run-old", rerun: (call) => call.tool === "look" })).toBe(1)
    const block = doc.turns.at(-1).blocks[0]
    expect(block).toMatchObject({ status: CALL.approved, runner: null })
    expect(doc.turns.at(-1).role).toBe("assistant") // no result written
  })

  it("is answered as interrupted otherwise", () => {
    const doc = cutOff("poke")
    settleDebris(doc, "run-new", { ownRun: (run) => run === "run-old", rerun: () => false })
    const result = doc.turns.at(-1).blocks[0]
    expect(result).toMatchObject({ type: "result", isError: true })
    expect(String(result.output)).toBe(INTERRUPTED)
  })

  it("end to end: the next run re-runs a read by its tool's risk, and answers a write", async () => {
    const ran = []
    const tool = (id, risk) => ({ id, risk, where: "worker", execute: async () => (ran.push(id), `${id} ok`) })
    const tools = [tool("look", "read"), tool("poke", "write")]
    const toolset = { tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null }
    const doc = fresh()
    doc.burst = { run: "run-old" }
    const calls = ["look", "poke"].map((id) => Object.assign(callBlock(id, {}, { id }), { status: CALL.running, runner: "run-old" }))
    doc.turns.push(makeTurn("assistant", calls))
    const b = runner(memoryStore(doc), "run-new", answering("Checked."), { buildToolset: async () => toolset, taskRuns: () => ["run-old", "run-new"] })
    await b.tick()
    expect(ran).toEqual(["look"])
    const out = b.store.doc()
    const results = out.turns.filter((t) => t.role === "tool").flatMap((t) => t.blocks)
    expect(String(results.find((r) => r.callId === "poke").output)).toBe(INTERRUPTED)
    expect(String(results.find((r) => r.callId === "look").output)).toBe("look ok")
    expect(shape(out).at(-1)).toEqual(["assistant", "Checked."])
  })
})

describe("marks name runs", () => {
  /**
   * Every task of one to five runs, each leaving a marked reply, with `burst`
   * naming any one of them or none: the next run settles every mark, and
   * names itself.
   */
  it("a later run of a task settles every earlier run's marks, whichever `burst` names", () => {
    let checked = 0
    for (let n = 1; n <= 5; n++) {
      const runs = Array.from({ length: n }, (_, i) => `run-${i + 1}`)
      for (const named of [null, ...runs]) {
        const doc = fresh()
        for (const run of runs) doc.turns.push(Object.assign(makeTurn("assistant", [textBlock(`half of ${run}`)]), { streaming: { runner: run } }))
        doc.burst = named ? { run: named } : null
        const next = `run-${n + 1}`
        expect(settleDebris(doc, next, { ownRun: (run) => runs.includes(run) })).toBe(n)
        expect(doc.burst).toEqual({ run: next })
        expect(shape(doc)).toEqual([["user", "hello"]])
        checked++
      }
    }
    expect(checked).toBe(2 + 3 + 4 + 5 + 6)
  })

  it("and never its own: a reply marked by the run `burst` names is not debris to it", () => {
    const doc = fresh()
    doc.turns.push(Object.assign(makeTurn("assistant", [textBlock("half")]), { streaming: { runner: "run-1" } }))
    doc.burst = { run: "run-1" }
    expect(settleDebris(doc, "run-1")).toBe(0)
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "run-1" })
  })
})
