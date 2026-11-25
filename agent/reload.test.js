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
 *   - no two claims of a session share a generation unless one renews the
 *     other, so a runner's own dead work never looks like work it is doing.
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  initSession, makeTurn, textBlock, callBlock, claimLease, CALL, STATUS, _resetIds,
  interruptedTurns, dropInterruptedTurns, resolveOrphans, orphanedCalls, INTERRUPTED,
} from "./session/session.js"
import { SessionRunner, needsWork, STALE_AFTER_MS } from "./kernel/runner.js"
import { memoryStore } from "./kernel/store.js"

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
    expect(after.status).toBe(STATUS.idle)
    // The model was asked from the person's message, not from half a reply.
    expect(JSON.stringify(model.requests[0].messages)).not.toContain("Half a thou")
  })
})

describe("a page that says it is going", () => {
  it("gives the lease up, and its stop writes nothing: the reply stays marked, the status as it was", async () => {
    const { store, a, done } = await midReply()
    expect(a.release()).toBe(true)
    a.stop()
    await done
    const doc = store.doc()
    expect(doc.lease).toBeNull()
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "tab-A", generation: 1 })
    expect(doc.status).toBe(STATUS.running)
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
    expect(doc.status).toBe(STATUS.idle)
    expect(needsWork(doc)).toBe(false)
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
    doc.status = STATUS.running
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
