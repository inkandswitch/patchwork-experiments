/**
 * A burst: one task's run of one session (kernel/burst.js), and the pieces it
 * is built on: the guarded store, debris judged by equality with `burst.run`,
 * and a request that carries calls and results only in pairs.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock, summaryBlock } from "../session/blocks.js"
import { debrisCalls, debrisTurns, hasDebris, settleDebris, stopSession, INTERRUPTED } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { STOP } from "../session/status.js"
import { toRequest } from "../session/request.js"
import { memoryStore, guardedStore } from "./store.js"

beforeEach(() => _resetIds())

function fresh(turns = []) {
  const doc = {}
  initSession(doc, {})
  doc.turns.push(makeTurn("user", [textBlock("hello")]), ...turns)
  return doc
}

/** A `settled` promise that has resolved, or rejected, as a task's does. */
function settledAs(resolves) {
  const settled = resolves ? Promise.resolve() : Promise.reject(new Error("the run stopped before it settled (yielded)"))
  settled.catch(() => {})
  return settled
}

describe("guardedStore", () => {
  const cases = []
  for (const settled of [true, false]) for (const aborted of [true, false]) for (const stopped of [true, false]) cases.push([settled, aborted, stopped])

  it.each(cases)("settled %s, aborted %s, stopped %s: change runs only when settled, not aborted and not stopped", async (settled, aborted, stopped) => {
    const doc = fresh()
    if (stopped) stopSession(doc, STOP.halted)
    const store = memoryStore(doc)
    const controller = new AbortController()
    if (aborted) controller.abort("cancelled")
    const guarded = guardedStore(store, { signal: controller.signal, settled: settledAs(settled) })
    await Promise.resolve()

    const ran = guarded.change((d) => (d.mark = "change"))
    expect(ran).toBe(settled && !aborted && !stopped)
    expect(store.doc().mark === "change").toBe(settled && !aborted && !stopped)

    // A run's own value is written after an abort or a stop, never before it settled.
    const own = guarded.changeOwn((d) => (d.own = "own"))
    expect(own).toBe(settled)
    expect(store.doc().own === "own").toBe(settled)

    guarded.appendText(["turns", 0, "blocks", 0, "text"], " there")
    expect(store.doc().turns[0].blocks[0].text).toBe(settled && !aborted && !stopped ? "hello there" : "hello")
  })

  it("a stop is checked inside the change: one merged in after the run looked refuses the next write", async () => {
    const store = memoryStore(fresh())
    const guarded = guardedStore(store, { signal: new AbortController().signal, settled: settledAs(true) })
    await Promise.resolve()
    expect(guarded.change((d) => (d.a = 1))).toBe(true)
    store.change((d) => stopSession(d, STOP.halted))
    expect(guarded.change((d) => (d.b = 1))).toBe(false)
    expect(store.doc().b).toBeUndefined()
  })

  it("nothing is written before settled resolves", async () => {
    let resolve
    const settled = new Promise((r) => (resolve = r))
    const store = memoryStore(fresh())
    const guarded = guardedStore(store, { settled })
    expect(guarded.change((d) => (d.a = 1))).toBe(false)
    expect(guarded.changeOwn((d) => (d.a = 1))).toBe(false)
    resolve()
    await settled
    expect(guarded.change((d) => (d.a = 2))).toBe(true)
    expect(store.doc().a).toBe(2)
  })
})

describe("debris, judged by equality with burst.run", () => {
  const marked = (runner) => {
    const turn = makeTurn("assistant", [textBlock("half a")])
    turn.streaming = { runner, generation: null }
    return turn
  }
  const running = (id, runner, tool = "doc_edit") => callBlock(tool, {}, { id, status: CALL.running, runner })
  const withDebris = () =>
    fresh([makeTurn("assistant", [running("c1", "run-1"), running("c2", "run-1", "doc_read"), running("c3", "run-2")]), marked("run-1"), marked("run-2")])

  it("a mark is debris when it does not name the holder, and every mark is when there is none", () => {
    const doc = withDebris()
    expect(debrisCalls(doc, "run-1").map((c) => c.id)).toEqual(["c3"])
    expect(debrisTurns(doc, "run-1").map((t) => t.streaming.runner)).toEqual(["run-2"])
    expect(debrisCalls(doc, null).map((c) => c.id)).toEqual(["c1", "c2", "c3"])
    expect(debrisTurns(doc, null)).toHaveLength(2)
    expect(hasDebris(doc, "run-3")).toBe(true)
    expect(hasDebris(fresh(), null)).toBe(false)
  })

  it("settleDebris with burst null: takes burst, drops every marked reply, puts back a read and answers the rest INTERRUPTED", () => {
    const doc = withDebris()
    doc.burst = null
    doc.reconnecting = { reason: "gone", since: 1, attempts: 1 }
    const rerun = (call) => call.tool === "doc_read"
    expect(settleDebris(doc, "run-3", { rerun })).toBe(5)
    expect(doc.burst).toEqual({ run: "run-3" })
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect(findCall(doc, "c2").block.status).toBe(CALL.approved)
    expect(findCall(doc, "c2").block.runner).toBe(null)
    for (const id of ["c1", "c3"]) {
      expect(findCall(doc, id).block.status).toBe(CALL.error)
      expect(String(findResult(doc, id).block.output)).toBe(INTERRUPTED)
      expect(findResult(doc, id).block.placeholder).toBe(true)
    }
    expect(doc.reconnecting).toBe(null)
  })

  it("settleDebris with burst naming another run of its task: rewrites burst and settles that run's marks", () => {
    const doc = withDebris()
    doc.burst = { run: "run-1" }
    expect(settleDebris(doc, "run-3", { ownRun: (run) => run === "run-1" })).toBe(5)
    expect(doc.burst).toEqual({ run: "run-3" })
  })

  it("settleDebris with burst naming its own run leaves its own marks", () => {
    const doc = withDebris()
    doc.burst = { run: "run-1" }
    expect(settleDebris(doc, "run-1")).toBe(2)
    expect(findCall(doc, "c1").block.status).toBe(CALL.running)
    expect(doc.turns.filter((t) => t.streaming).map((t) => t.streaming.runner)).toEqual(["run-1"])
  })

  it("settleDebris under a foreign burst writes nothing", () => {
    const doc = withDebris()
    doc.burst = { run: "someone-else" }
    const before = JSON.stringify(doc)
    expect(settleDebris(doc, "run-3", { ownRun: () => false })).toBe(null)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe("a request carries calls and results only in pairs", () => {
  const parts = (doc) => toRequest(doc).messages.map((m) => [m.role, ...m.content.map((p) => (p.type === "call" ? `call:${p.id}` : p.type === "result" ? `result:${p.callId}` : p.text))])

  it("a call with no result is left out, and its turn's words stay", () => {
    const doc = fresh([makeTurn("assistant", [textBlock("Looking."), callBlock("doc_read", {}, { id: "c1", status: CALL.running, runner: "run-1" })])])
    expect(parts(doc)).toEqual([["user", "hello"], ["assistant", "Looking."]])
  })

  it("a result whose call is not sent is left out", () => {
    const doc = fresh([makeTurn("tool", [resultBlock("gone", "orphan")]), makeTurn("user", [textBlock("next")])])
    expect(parts(doc)).toEqual([["user", "hello"], ["user", "next"]])
  })

  it("a reply still marked as streaming is left out, and with it the result of a call it made", () => {
    const reply = makeTurn("assistant", [textBlock("half"), callBlock("doc_read", {}, { id: "c1", status: CALL.done })])
    reply.streaming = { runner: "run-1", generation: null }
    const doc = fresh([reply, makeTurn("tool", [resultBlock("c1", "read")])])
    expect(parts(doc)).toEqual([["user", "hello"]])
  })

  it("a result for a call before a summary is not sent", () => {
    const doc = fresh([makeTurn("assistant", [callBlock("doc_read", {}, { id: "c1", status: CALL.done })])])
    const upTo = doc.turns.at(-1).id
    doc.turns.push(makeTurn("user", [summaryBlock("so far", upTo)]), makeTurn("tool", [resultBlock("c1", "late")]), makeTurn("user", [textBlock("go on")]))
    expect(parts(doc)).toEqual([["user", "[Summary of the earlier conversation]\nso far"], ["user", "go on"]])
  })

  it("pairs are sent as they are", () => {
    const doc = fresh([makeTurn("assistant", [callBlock("doc_read", {}, { id: "c1", status: CALL.done })]), makeTurn("tool", [resultBlock("c1", "read")])])
    expect(parts(doc)).toEqual([["user", "hello"], ["assistant", "call:c1"], ["tool", "result:c1"]])
  })
})
