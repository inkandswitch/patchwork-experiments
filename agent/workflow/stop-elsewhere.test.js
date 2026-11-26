/**
 * A person's Stop, written on one copy of a session while a burst works on
 * another: two Automerge copies, each change reaching the other only when the
 * test delivers it. The burst hears each delivery as it hears any change to
 * its session (kernel/burst.js), and a page asks on hearing one
 * (fixtures/burst.js `ask`).
 *
 * What holds, case by case:
 *   - a Stop pressed during a tool call or a reply, on the other copy, stops
 *     the run when it is heard; the call keeps what it did; the reply keeps
 *     its text and loses its mark; `burst` is cleared on both copies, and
 *     nothing asks the model again, however often either side looks, until
 *     someone speaks;
 *   - a Stop crossing the end of the run, or the claim of the session, holds
 *     once the two have met;
 *   - a nudge crossing a Stop does not end it;
 *   - a Stop, then a message at once, is a message: the run carries on, and
 *     the call that was running is answered once;
 *   - calls cleared to run when the Stop lands are never run after it: not
 *     on a poll, not after a message, which answers them as not run;
 *   - a workflow's halt written the same way stops the run the same way;
 *   - a Stop while the runner waits for the network leaves nothing to retry,
 *     and what was put back for the network is closed, never run;
 *   - a step's session stopped this way is never read as finished on either
 *     copy once the two have met (before that, a copy that saw the run end
 *     and not the Stop reads it as done: a crossing, not a defect);
 *   - a reply begun after the stopper's copy last heard loses its mark to its
 *     own run, and keeps its text; a call run across a Stop and a message is
 *     sent as what it did, not as not run; a run's error crossing a Stop
 *     never takes its place.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, noticeBlock } from "../session/blocks.js"
import { liftBudget } from "../session/usage.js"
import { Interruption } from "../net/network.js"
import { stopSession, NOT_RUN } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { STOP, stopOf, statusOf } from "../session/status.js"
import { sessionOutcome } from "./driver.js"
import { needsWork } from "../kernel/runner.js"
import { burstRunner } from "../fixtures/burst.js"
import { say } from "../kernel/loop.js"
import { toRequest } from "../session/request.js"

beforeEach(() => _resetIds())

/** Made up: who pressed Stop. */
const PERSON = "automerge:2Lw7qGJgk2QJd8y3pFvPFRqhVmTd"

/**
 * Two copies of a session holding one message. `actors` decides which of two
 * concurrent writes Automerge keeps, so a case can be run both ways round.
 */
function copies(actors = ["aa", "bb"]) {
  const base = A.change(A.init({ actor: "cc".repeat(16) }), (d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]))
  })
  const sides = actors.map((a) => ({ doc: A.clone(base, { actor: a.repeat(16) }), heard: () => {}, listeners: new Set() }))
  // A burst hears its copy's changes (its handle's change event), and so
  // does whatever the test hangs on `heard`: a page asking on change.
  const hear = (i) => {
    for (const fn of [...sides[i].listeners]) fn(sides[i].doc)
    sides[i].heard()
  }
  const store = (i) => ({
    url: "automerge:session",
    doc: () => sides[i].doc,
    change(fn) {
      sides[i].doc = A.change(sides[i].doc, (d) => {
        fn(d)
      })
      hear(i)
    },
    onChange(fn) {
      sides[i].listeners.add(fn)
      return () => sides[i].listeners.delete(fn)
    },
    appendText(path, delta) {
      if (!delta) return
      this.change((d) => {
        let node = d
        for (let k = 0; k < path.length - 1; k++) node = node[path[k]]
        const key = path[path.length - 1]
        node[key] = (node[key] ?? "") + delta
      })
    },
  })
  const deliver = (from, to) => {
    sides[to].doc = A.merge(sides[to].doc, A.clone(sides[from].doc))
    hear(to)
  }
  return { sides, stores: [store(0), store(1)], deliver, sync: () => (deliver(0, 1), deliver(1, 0)) }
}

/** A model answering with each reply in turn; a reply is a function of the request yielding events. */
function model(...replies) {
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const reply = replies[requests.length - 1] ?? says("(asked again)")
      yield* reply(request)
    },
  }
}
const says = (text) =>
  async function* () {
    yield { type: "text", delta: text }
    yield { type: "stop", reason: "stop" }
  }
const calls = (...ids) =>
  async function* () {
    for (const [id, name] of ids) yield { type: "call", id, name, input: {} }
    yield { type: "stop", reason: "tool_use" }
  }
/** Says `text`, then waits until the request is aborted, failing as fetch does. */
const hangs = (text, reached) =>
  async function* (request) {
    yield { type: "text", delta: text }
    reached()
    await new Promise((_, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"))
      if (request.signal?.aborted) abort()
      request.signal?.addEventListener("abort", abort)
    })
  }

/** A tool that runs until its call's signal aborts, then fails as a stopped fetch does. */
function untilAborted(id, started = () => {}) {
  return {
    id,
    risk: "edit",
    where: "worker",
    execute: (_input, ctx) =>
      new Promise((_, reject) => {
        started()
        const abort = () => reject(new Error(`${id} stopped`))
        if (ctx.signal?.aborted) abort()
        ctx.signal?.addEventListener("abort", abort)
      }),
  }
}
/** A tool that counts its runs and answers at once. */
function counted(id) {
  const tool = { id, risk: "edit", where: "worker", runs: 0, execute: async () => (tool.runs++, `${id} done`) }
  return tool
}

function runnerOn(store, url, provider, tools = []) {
  return burstRunner({
    store,
    runnerUrl: url,
    buildToolset: async () => ({ tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null }),
    getProvider: async () => provider,
    canRun: () => true,
  })
}

const flushed = () => new Promise((r) => setTimeout(r, 200)) // the appender's batch is 120 ms
const shape = (doc) => doc.turns.map((t) => [t.role, ...(t.blocks ?? []).map((b) => b.text ?? `${b.type}:${b.tool ?? b.callId ?? ""}`)])
const stops = (doc) => doc.turns.flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "notice" && b.kind === STOP.stopped))
const plain = (doc) => JSON.parse(JSON.stringify(doc))

/** Both copies, once met: the same, stopped by the person, nothing marked, nobody holding it, no work, not done. */
function expectStoppedOnBoth(sides) {
  const [a, b] = sides.map((s) => plain(s.doc))
  expect(a.turns).toEqual(b.turns)
  for (const doc of [a, b]) {
    expect(stopOf(doc)?.kind).toBe(STOP.stopped)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect(doc.burst).toBe(null)
    expect(needsWork(doc)).toBe(false)
    expect(statusOf(doc)).toBe(STATUS.idle)
    expect(sessionOutcome(doc)).toMatchObject({ state: "running", waiting: true, stopped: {} })
  }
}

/** Every look either side could take — the change handler, the poll — finds nothing to do. */
async function nothingAsksAgain(runners, provider, asked) {
  for (let i = 0; i < 3; i++) for (const r of runners) expect((await r.ask()).asked).toBe(false)
  expect(provider.requests).toHaveLength(asked)
}

describe("a person's Stop written on another copy", () => {
  it("during a tool call: the run stops on hearing it, the call keeps its result, and nothing asks again until someone speaks", async () => {
    const { sides, stores, deliver, sync } = copies()
    let inTool
    const started = new Promise((r) => (inTool = r))
    const slow = untilAborted("slow", inTool)
    const m = model(calls(["c1", "slow"]), says("Carried on."))
    const a = runnerOn(stores[0], "tab-A", m, [slow])
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await started
    deliver(0, 1)
    expect(statusOf(sides[1].doc)).toBe(STATUS.running)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)

    expectStoppedOnBoth(sides)
    const doc = plain(sides[0].doc)
    expect(stops(doc)).toHaveLength(1)
    expect(doc.turns.find((t) => t.blocks.some((b) => b.kind === STOP.stopped)).author).toBe(PERSON)
    // The call is closed with what the tool said as it stopped, after the notice.
    expect(findCall(doc, "c1").block.status).toBe(CALL.error)
    expect(String(findResult(doc, "c1").block.output)).toContain("slow stopped")
    expect(shape(doc).map(([role]) => role)).toEqual(["user", "assistant", "assistant", "tool"])

    const b = runnerOn(stores[1], "tab-B", m, [slow])
    await nothingAsksAgain([a, b], m, 1)

    // A word on B carries it on, run on A.
    say(stores[1], "go on")
    deliver(1, 0)
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "Carried on."]))
    expect(m.requests).toHaveLength(2)
    expect(m.requests[1].messages.map((x) => x.role)).toEqual(["user", "assistant", "tool", "assistant", "user"])
    sync()
    expect(stopOf(sides[1].doc)).toBe(null)
  })

  it("while a reply streams that the stopper sees: the stream is cancelled, its text kept and unmarked, and nothing asks again until someone speaks", async () => {
    const { sides, stores, deliver } = copies()
    let reached
    const at = new Promise((r) => (reached = r))
    let cancelled = false
    const m = model(async function* (request) {
      request.signal?.addEventListener("abort", () => (cancelled = true))
      yield* hangs("Half a thou", reached)(request)
    }, says("Going on."))
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    await flushed()
    deliver(0, 1)
    expect(shape(sides[1].doc).at(-1)).toEqual(["assistant", "Half a thou"])
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    expect(cancelled).toBe(true)
    deliver(0, 1)

    expectStoppedOnBoth(sides)
    expect(shape(plain(sides[0].doc))).toEqual([["user", "hello"], ["assistant", "Half a thou"], ["assistant", "Stopped by a person."]])
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 1)

    say(stores[1], "go on")
    deliver(1, 0)
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "Going on."]))
    expect(JSON.stringify(m.requests[1].messages)).toContain("Half a thou")
  })

  it.each([["aa", "bb"], ["bb", "aa"]])("crossing the end of the run (actors %s, %s): once met, the reply is whole, the stop holds, and the step is not done", async (...actors) => {
    const { sides, stores, deliver } = copies(actors)
    let reached
    let go
    const at = new Promise((r) => (reached = r))
    const gate = new Promise((r) => (go = r))
    const m = model(async function* () {
      yield { type: "text", delta: "All of " }
      reached()
      await gate
      yield { type: "text", delta: "it." }
      yield { type: "stop", reason: "stop" }
    })
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    await flushed()
    deliver(0, 1)
    // B stops; A finishes before it hears.
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    go()
    expect((await run).outcome).toBe("idle")
    expect(sessionOutcome(sides[0].doc).state).toBe("done")
    deliver(1, 0)
    deliver(0, 1)

    expectStoppedOnBoth(sides)
    expect(shape(plain(sides[0].doc)).find(([role, text]) => role === "assistant" && text?.startsWith("All"))).toEqual(["assistant", "All of it."])
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 1)
  })

  it.each([["aa", "bb"], ["bb", "aa"]])("crossing a claim of the session (actors %s, %s): once heard, the run stops and `burst` is cleared on both copies", async (...actors) => {
    const { sides, stores, deliver } = copies(actors)
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Begun", reached))
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    // B saw the message and nothing else: there is a word waiting for an
    // answer, so the Stop is said, while A claims the session.
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    expect(stops(sides[1].doc)).toHaveLength(1)
    const run = a.ask()
    await at
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)
    deliver(1, 0)
    expect(plain(sides[0].doc).turns).toEqual(plain(sides[1].doc).turns)
    for (const side of sides) {
      expect(stopOf(side.doc)?.kind).toBe(STOP.stopped)
      expect(side.doc.burst).toBe(null)
      expect(needsWork(side.doc)).toBe(false)
    }
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 1)
  })

  it.each([["aa", "bb"], ["bb", "aa"]])("crossing a nudge (actors %s, %s): the nudge written after it does not end it", async (...actors) => {
    const { sides, stores, deliver } = copies(actors)
    let reached
    let go
    const at = new Promise((r) => (reached = r))
    const gate = new Promise((r) => (go = r))
    // Says nothing (the loop nudges it once), and the second answer hangs.
    const m = model(
      async function* () {
        reached()
        await gate
        yield { type: "stop", reason: "stop" }
      },
      hangs("Now then", () => {})
    )
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    go()
    await vi.waitFor(() => expect(m.requests).toHaveLength(2))
    expect(sides[0].doc.turns.some((t) => t.blocks.some((b) => b.kind === "nudge"))).toBe(true)
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)
    for (const side of sides) {
      expect(stopOf(side.doc)?.kind).toBe(STOP.stopped)
      expect(needsWork(side.doc)).toBe(false)
    }
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 2)
  })

  it("then a message at once: the run on A carries on with the message, and the call it was running is answered once", async () => {
    const { sides, stores, deliver } = copies()
    let inTool
    const started = new Promise((r) => (inTool = r))
    let finish
    const slow = { id: "slow", risk: "edit", where: "worker", execute: () => (inTool(), new Promise((r) => (finish = r))) }
    const m = model(calls(["c1", "slow"]), says("On it."))
    const a = runnerOn(stores[0], "tab-A", m, [slow])
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await started
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    say(stores[1], "do something else")
    deliver(1, 0)
    finish("slow done")
    await run
    // The run that followed the message (the poll, here) answers it.
    await a.ask()
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "On it."]))
    const doc = plain(sides[0].doc)
    expect(doc.turns.flatMap((t) => t.blocks).filter((b) => b.type === "result" && b.callId === "c1")).toHaveLength(1)
    expect(String(findResult(doc, "c1").block.output)).toBe("slow done")
    expect(stopOf(doc)).toBe(null)
    expect(m.requests).toHaveLength(2)
    const roles = m.requests[1].messages.map((x) => x.role)
    expect(roles.slice(0, 3)).toEqual(["user", "assistant", "tool"])
  })

  it("a workflow's halt, written on the other copy mid-reply, stops the run the same way and is never read as done", async () => {
    const { sides, stores, deliver } = copies()
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Part of a result", reached))
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    await flushed()
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.halted, "cancelled by its workflow"))
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)
    for (const side of sides) {
      expect(stopOf(side.doc)?.kind).toBe(STOP.halted)
      expect(side.doc.turns.some((t) => t.streaming)).toBe(false)
      expect([side.doc.burst, needsWork(side.doc)]).toEqual([null, false])
      expect(sessionOutcome(side.doc)).toEqual({ state: "running", waiting: true })
    }
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 1)
  })

  it("two Stops at once, one on each copy: the session stays stopped and asks nothing", async () => {
    const { sides, stores, deliver } = copies()
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Half", reached))
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    await flushed()
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    stores[0].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    // The Stop pressed here also stops the task on this person's queue.
    a.interrupt("cancelled")
    expect((await run).outcome).toBe("cancelled")
    deliver(1, 0)
    deliver(0, 1)
    expectStoppedOnBoth(sides)
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m)], m, 1)
  })
})

describe("calls cleared to run when a Stop lands", () => {
  it("are never run: not on the poll, not after a message, which answers them as not run", async () => {
    const { sides, stores, deliver } = copies()
    let inTool
    const started = new Promise((r) => (inTool = r))
    const first = untilAborted("first", inTool)
    const second = counted("second")
    const m = model(calls(["c1", "first"], ["c2", "second"]), says("Fine."))
    const a = runnerOn(stores[0], "tab-A", m, [first, second])
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await started
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    await run
    deliver(0, 1)
    expectStoppedOnBoth(sides)
    expect(findCall(sides[1].doc, "c2").block.status).toBe(CALL.approved)
    await nothingAsksAgain([a, runnerOn(stores[1], "tab-B", m, [first, second])], m, 1)
    expect(second.runs).toBe(0)

    say(stores[1], "leave it")
    expect(findCall(sides[1].doc, "c2").block.status).toBe(CALL.error)
    expect(String(findResult(sides[1].doc, "c2").block.output)).toBe(NOT_RUN)
    deliver(1, 0)
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "Fine."]))
    expect(second.runs).toBe(0)
  })

  it("under a budget's stop are kept, and run once the budget is lifted", async () => {
    const { sides, stores } = copies()
    const tool = counted("later")
    // A call the person approved after the session ran out of money.
    stores[0].change((d) => {
      d.turns.push(makeTurn("assistant", [callBlock("later", {}, { id: "c1", status: CALL.approved })]))
      d.turns.push(makeTurn("assistant", [noticeBlock(STOP.budget, "Out of money.", { spent: 2, limit: 1 })]))
      d.usage = { in: 1, out: 1, turns: 1, cost: 2 }
      d.config.budget = 1
    })
    const m = model(says("Done."))
    const a = runnerOn(stores[0], "tab-A", m, [tool])
    expect((await a.ask()).asked).toBe(false)
    expect(tool.runs).toBe(0)
    stores[0].change((d) => liftBudget(d, 1))
    expect(findCall(sides[0].doc, "c1").block.status).toBe(CALL.approved)
    expect((await a.ask()).outcome).toBe("idle")
    expect(tool.runs).toBe(1)
    expect(String(findResult(sides[0].doc, "c1").block.output)).toBe("later done")
  })

  it("put back for the network, under a person's Stop: the runner's retry finds nothing, and the message after closes them, never run", async () => {
    const { sides, stores, deliver } = copies()
    let fetches = 0
    const fetch = { id: "web_fetch", risk: "read", where: "worker", execute: async () => (fetches++, Promise.reject(new Interruption("no relay"))) }
    const m = model(calls(["c1", "web_fetch"]), says("Fine."))
    const a = runnerOn(stores[0], "tab-A", m, [fetch])
    expect((await a.ask()).outcome).toBe("reconnecting")
    expect(statusOf(sides[0].doc)).toBe(STATUS.reconnecting)
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    expect(stops(sides[1].doc)[0].text).toBe("Stopped while waiting for the network (no relay).")
    deliver(1, 0)
    expect([sides[0].doc.reconnecting, statusOf(sides[0].doc), needsWork(sides[0].doc)]).toEqual([null, STATUS.idle, false])
    // Asking again (the network back, a page looking): nothing runs. The
    // page's own look once the burst ended may still be under way, and it
    // finds the stop.
    const again = await a.ask()
    expect(again.asked === false || again.outcome === "stopped").toBe(true)
    expect([fetches, m.requests.length]).toEqual([1, 1])

    say(stores[1], "never mind")
    expect(String(findResult(sides[1].doc, "c1").block.output)).toBe(NOT_RUN)
    deliver(1, 0)
    a.ask()
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "Fine."]))
    expect(fetches).toBe(1)
    a.stop()
  })

  it("under a person's Stop, then a lifted budget's word, stay not run", () => {
    const { sides, stores } = copies()
    stores[0].change((d) => {
      d.turns.push(makeTurn("assistant", [callBlock("later", {}, { id: "c1", status: CALL.approved })]))
      stopSession(d, STOP.stopped, null, PERSON)
    })
    expect(stopOf(sides[0].doc)?.kind).toBe(STOP.stopped)
    // A lift says nothing under a person's stop (session/usage.js), so it ends nothing.
    stores[0].change((d) => liftBudget(d, 1))
    expect(stopOf(sides[0].doc)?.kind).toBe(STOP.stopped)
    expect(needsWork(sides[0].doc)).toBe(false)
  })
})

/** Both ways round: which of two concurrent writes Automerge keeps. */
const order = [["aa", "bb"], ["bb", "aa"]]

describe("crossings a Stop could lose to, put right", () => {
  it("a reply begun after the stopper's copy last heard: its run takes its own mark off on hearing the Stop, and the text stays through the next message", async () => {
    const { sides, stores, deliver } = copies()
    let inTool, go, reached
    const started = new Promise((r) => (inTool = r))
    const gate = new Promise((r) => (go = r))
    const at = new Promise((r) => (reached = r))
    const quick = { id: "quick", risk: "edit", where: "worker", execute: async () => (inTool(), await gate, "quick done") }
    const m = model(calls(["c1", "quick"]), hangs("Second reply, seen on A", reached), says("Going on."))
    const a = runnerOn(stores[0], "tab-A", m, [quick])
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await started
    deliver(0, 1) // B sees the call running, and no more
    go()
    await at
    await flushed()
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)
    expectStoppedOnBoth(sides)
    const second = plain(sides[1].doc).turns.find((t) => t.blocks.some((b) => b.text === "Second reply, seen on A"))
    expect(second.streaming ?? null).toBe(null)

    say(stores[1], "go on")
    deliver(1, 0)
    await vi.waitFor(() => expect(shape(sides[0].doc).at(-1)).toEqual(["assistant", "Going on."]))
    expect(shape(plain(sides[0].doc))).toContainEqual(["assistant", "Second reply, seen on A"])
    a.stop()
  })

  it("a mark another run holds is not the stopped run's to take off", async () => {
    const { sides, stores, deliver } = copies()
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Mine", reached))
    const a = runnerOn(stores[0], "tab-A", m)
    // B hears A's claim, and nothing after it.
    let heard = false
    sides[0].heard = () => {
      if (!heard && sides[0].doc.burst) (heard = true), deliver(0, 1)
      a.ask()
    }
    const run = a.ask()
    await at
    await flushed()
    // Before A hears the Stop, its turn's mark is made another's (a crossing
    // claim): A takes nothing off that is not its own.
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    sides[0].doc = A.change(sides[0].doc, (d) => {
      d.turns[d.turns.length - 1].streaming = { runner: "tab-C" }
    })
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    expect(plain(sides[0].doc).burst).toBe(null)
    expect(plain(sides[0].doc).turns.find((t) => t.blocks.some((b) => b.text === "Mine")).streaming).toEqual({ runner: "tab-C" })
  })

  /**
   * B, which has written much A has not seen when `ahead`, hears A write a
   * call cleared to run, and at once stops and speaks. A claims the call
   * first, and runs it. Whichever order the two results land in, what the
   * call did is what the model is told.
   */
  const AHEAD = [...order.map((actors) => [actors, false]), [["aa", "bb"], true]]
  it.each(AHEAD)("a Stop and a message at once, crossing a claim (actors %j, B ahead %s): the call ran, and the model is told what it did", async (actors, ahead) => {
    const { sides, stores, deliver } = copies(actors)
    if (ahead) stores[1].change((d) => {
      d.pad = []
      for (let i = 0; i < 500; i++) d.pad.push(i)
    })
    let finish, inTool
    const started = new Promise((r) => (inTool = r))
    const slow = { id: "slow", risk: "edit", where: "worker", runs: 0, execute: () => (slow.runs++, inTool(), new Promise((r) => (finish = r))) }
    const m = model(calls(["c1", "slow"]), says("Next."))
    const a = runnerOn(stores[0], "tab-A", m, [slow])
    let acted = false
    sides[0].heard = () => {
      const c1 = findCall(sides[0].doc, "c1")
      if (!acted && c1?.block.status === CALL.approved) {
        acted = true
        deliver(0, 1)
        stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
        say(stores[1], "do something else")
      }
      a.ask()
    }
    const run = a.ask()
    await started
    finish("slow did it")
    await run
    deliver(1, 0)
    deliver(0, 1)
    const doc = plain(sides[0].doc)
    const results = doc.turns.flatMap((t) => t.blocks).filter((b) => b.type === "result" && b.callId === "c1")
    const sent = toRequest(doc).messages.flatMap((x) => x.content).filter((p) => p.type === "result" && p.callId === "c1").map((p) => p.output)
    expect(slow.runs).toBe(1)
    expect(results.map((r) => String(r.output)).sort()).toEqual([NOT_RUN, "slow did it"].sort())
    expect(sent).toEqual(["slow did it"])
    a.stop()
  })

  it.each(order)("a run's error crossing a person's Stop (actors %s, %s): the Stop stays in force, and the step is not failed", async (...actors) => {
    const { sides, stores, deliver } = copies(actors)
    let reached, go
    const at = new Promise((r) => (reached = r))
    const gate = new Promise((r) => (go = r))
    const m = model(async function* () {
      yield { type: "text", delta: "Part" }
      reached()
      await gate
      throw new Error("OpenRouter 500: upstream")
    })
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.ask()
    const run = a.ask()
    await at
    await flushed()
    deliver(0, 1)
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    go()
    expect((await run).outcome).toBe("error")
    deliver(1, 0)
    deliver(0, 1)
    for (const side of sides) {
      const doc = plain(side.doc)
      expect(stopOf(doc)?.kind).toBe(STOP.stopped)
      expect(statusOf(doc)).toBe(STATUS.idle)
      expect(sessionOutcome(doc)).toMatchObject({ state: "running", waiting: true, stopped: {} })
    }
  })
})
