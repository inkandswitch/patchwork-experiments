/**
 * A burst: one task's run of one session (kernel/burst.js), and the pieces it
 * is built on: the guarded store, debris judged by equality with `burst.run`,
 * and a request that carries calls and results only in pairs.
 */
import { describe, it, expect, beforeEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock, summaryBlock, noticeBlock } from "../session/blocks.js"
import { debrisCalls, debrisTurns, hasDebris, settleDebris, stopSession, INTERRUPTED } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { STOP, stopOf } from "../session/status.js"
import { toRequest } from "../session/request.js"
import { Interruption } from "../net/network.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { memoryStore, guardedStore } from "./store.js"
import { runBurst, BURST } from "./burst.js"
import { OUTCOME } from "./loop.js"
import { needsWork } from "./runner.js"

await initSubduction()

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
    turn.streaming = { runner }
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
    reply.streaming = { runner: "run-1" }
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

// ---------------------------------------------------------------- runBurst

/** A toolset double with the surface the loop reads (as kernel/loop.test.js has it). */
function fakeToolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}
const tool = (id, opts = {}) => {
  const t = { id, name: id, where: "worker", risk: "edit", runs: 0, ...opts }
  const execute = opts.execute ?? (async () => `${id} done`)
  t.execute = async (input, ctx) => (t.runs++, execute(input, ctx))
  return t
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const plain = (handle) => JSON.parse(JSON.stringify(handle.doc()))
const heads = (handle) => [...handle.heads()]

/** A session in an in-memory Repo, as a burst's ctx.repo has it. */
function sessionIn(repo, turns = [], fields = {}) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]), ...turns)
    d.burst = null
    Object.assign(d, fields)
  })
  return handle
}

/** What a task hands its code, with a signal the test aborts and a list of its task's runs. */
function taskOf(repo, { run = "run-1", runs = null, settled = Promise.resolve() } = {}) {
  const controller = new AbortController()
  const progress = []
  const ctx = { repo, signal: controller.signal, run, taskUrl: "automerge:task", settled, progress: (value) => progress.push(value), log: () => {} }
  return { ctx, controller, progress, runs: runs ?? [run] }
}

function burstOf(handle, task, { provider = makeMock([[{ type: "text", delta: "Hi." }]]), tools = [], ...rest } = {}) {
  return runBurst(task.ctx, {
    session: handle.url,
    taskRuns: () => task.runs,
    getProvider: async () => provider,
    buildToolset: async () => fakeToolset(tools),
    flushMs: 5,
    waitForNetwork: async () => {},
    ...rest,
  })
}

/** A model that streams `text`, says so, then waits for the run's signal (or for `gate`, then says `more`). */
function streaming(text, { gate = null, more = [] } = {}) {
  let reached
  const at = new Promise((r) => (reached = r))
  const requests = []
  return {
    at,
    requests,
    async *stream(request) {
      requests.push(request)
      if (requests.length > 1) {
        yield { type: "text", delta: "Again." }
        yield { type: "stop", reason: "stop" }
        return
      }
      yield { type: "text", delta: text }
      reached()
      if (gate) {
        await gate
        for (const delta of more) {
          yield { type: "text", delta }
          await sleep(20)
        }
        yield { type: "stop", reason: "stop" }
        return
      }
      await new Promise((_, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"))
        if (request.signal?.aborted) abort()
        request.signal?.addEventListener("abort", abort)
      })
    },
  }
}

const marked = (runner, text = "half a") => {
  const turn = makeTurn("assistant", [textBlock(text)])
  turn.streaming = { runner }
  return turn
}

describe("a burst writes nothing when", () => {
  it("there is nothing to do", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, [makeTurn("assistant", [textBlock("Done.")])])
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo), { provider })).outcome).toBe(BURST.nothing)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("a stop is in force", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    handle.change((d) => stopSession(d, STOP.stopped, null, "automerge:person"))
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo), { provider })).outcome).toBe(BURST.stopped)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("settled rejects", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const before = heads(handle)
    const settled = Promise.reject(new Error("the run stopped before it settled (yielded)"))
    settled.catch(() => {})
    const task = taskOf(repo, { settled })
    task.controller.abort("yielded")
    const provider = makeMock([])
    expect((await burstOf(handle, task, { provider })).outcome).toBe("yielded")
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("settled rejects while the signal has not yet said why", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const before = heads(handle)
    const settled = Promise.reject(new Error("the run stopped before it settled"))
    settled.catch(() => {})
    expect((await burstOf(handle, taskOf(repo, { settled }))).outcome).toBe("yielded")
    expect(heads(handle)).toEqual(before)
  })

  it("burst names a run its task does not list", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, [], { burst: { run: "someone-elses" } })
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo), { provider })).outcome).toBe(BURST.held)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("it is a step session its plan does not name", async () => {
    const repo = new Repo({ network: [] })
    const plan = repo.create()
    plan.change((d) => {
      d.steps = [{ id: "s1", sessionUrl: "automerge:another-session" }]
    })
    const handle = sessionIn(repo, [], { workflow: { planUrl: plan.url, stepId: "s1" } })
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo), { provider })).outcome).toBe(BURST.notTheStep)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })
})

describe("a burst settles what other runs left, before its request", () => {
  const left = (runner) => [makeTurn("assistant", [textBlock("Writing."), callBlock("doc_edit", {}, { id: "c1", status: CALL.running, runner }), callBlock("doc_read", {}, { id: "c2", status: CALL.running, runner })]), marked(runner)]

  it.each([
    ["marks of an earlier run of its own task", { burst: { run: "run-0" } }, "run-0", ["run-0", "run-1"]],
    ["foreign marks with burst null", { burst: null }, "page-claim", ["run-1"]],
  ])("%s", async (_name, fields, runner, runs) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, left(runner), fields)
    const provider = makeMock([[{ type: "text", delta: "Carrying on." }]])
    const read = tool("doc_read", { risk: "read" })
    const result = await burstOf(handle, taskOf(repo, { runs }), { provider, tools: [tool("doc_edit"), read] })
    expect(result.outcome).toBe(OUTCOME.idle)
    const doc = plain(handle)
    // The half reply went, the write was answered INTERRUPTED, the read ran again.
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect(JSON.stringify(doc.turns)).not.toContain("half a")
    expect(findCall(doc, "c1").block.status).toBe(CALL.error)
    expect(String(findResult(doc, "c1").block.output)).toBe(INTERRUPTED)
    expect(read.runs).toBe(1)
    expect(findCall(doc, "c2").block).toMatchObject({ status: CALL.done, runner: "run-1" })
    // Settled before the request: the model was sent both answers.
    const sent = provider.requests[0].messages.flatMap((m) => m.content).filter((p) => p.type === "result").map((p) => p.callId)
    expect(sent).toEqual(["c1", "c2"])
    expect(doc.burst).toBe(null)
  })
})

describe("a burst", () => {
  it("parks at a call only a page can run, and clears burst", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([[{ type: "call", id: "c1", name: "view_open", input: {} }]])
    const page = tool("view_open", { where: "host", risk: "read" })
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [page] })
    expect(result.outcome).toBe(OUTCOME.parked)
    const doc = plain(handle)
    expect(findCall(doc, "c1").block).toMatchObject({ status: CALL.approved, where: "host" })
    expect(page.runs).toBe(0)
    expect(doc.burst).toBe(null)
    // A page's work, not a pool run's.
    expect(needsWork(doc, (where) => where === "worker")).toBe(false)
  })

  it("waits for the network and carries on when it is back", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    let asked = 0
    const provider = {
      async *stream() {
        if (asked++ === 0) throw new Interruption("no network")
        yield { type: "text", delta: "Back." }
        yield { type: "stop", reason: "stop" }
      },
    }
    const waits = []
    let during = null
    const result = await burstOf(handle, taskOf(repo), { provider, waitForNetwork: async (attempt) => (waits.push(attempt), (during = plain(handle).reconnecting)) })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(waits).toEqual([1])
    expect(during?.reason).toContain("no network")
    const doc = plain(handle)
    expect(doc.reconnecting).toBe(null)
    expect(doc.turns.at(-1).blocks.map((b) => b.text)).toEqual(["Back."])
    expect(doc.burst).toBe(null)
  })

  it("stops mid-stream at a stop written elsewhere: the reply keeps its text, and nothing more is asked", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = streaming("Begun")
    const running = burstOf(handle, taskOf(repo), { provider })
    await provider.at
    await sleep(30)
    expect(plain(handle).burst).toEqual({ run: "run-1" })
    handle.change((d) => stopSession(d, STOP.stopped, null, "automerge:person"))
    const result = await running
    expect(result.outcome).toBe(BURST.stopped)
    const doc = plain(handle)
    expect(stopOf(doc)?.kind).toBe(STOP.stopped)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect(JSON.stringify(doc.turns)).toContain("Begun")
    expect(doc.burst).toBe(null)
    expect(provider.requests).toHaveLength(1)
  })

  it("a stop between two calls of a batch leaves each done call with one result, and runs no more", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([[{ type: "call", id: "c1", name: "first", input: {} }, { type: "call", id: "c2", name: "second", input: {} }]])
    const first = tool("first", {
      execute: async () => {
        handle.change((d) => stopSession(d, STOP.stopped, null, "automerge:person"))
        return "first did it"
      },
    })
    const second = tool("second")
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [first, second], buildToolset: async () => fakeToolset([first, second]) })
    expect(result.outcome).toBe(BURST.stopped)
    const doc = plain(handle)
    const results = doc.turns.flatMap((t) => t.blocks).filter((b) => b.type === "result")
    expect(results.map((r) => [r.callId, r.output])).toEqual([["c1", "first did it"]])
    expect(findCall(doc, "c1").block.status).toBe(CALL.done)
    expect(findCall(doc, "c2").block.status).toBe(CALL.approved)
    expect(second.runs).toBe(0)
    expect(provider.requests).toHaveLength(1)
  })

  it("yielded: writes nothing more and leaves burst", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = streaming("Begun")
    const task = taskOf(repo)
    const running = burstOf(handle, task, { provider })
    await provider.at
    await sleep(30)
    const before = heads(handle)
    task.controller.abort("yielded")
    expect((await running).outcome).toBe("yielded")
    expect(heads(handle)).toEqual(before)
    const doc = plain(handle)
    expect(doc.burst).toEqual({ run: "run-1" })
    // Its reply stays marked: debris for the run that has the task now.
    expect(doc.turns.at(-1).streaming).toEqual({ runner: "run-1" })
  })

  it("its reply deleted mid-stream: it ends superseded and writes no more into it", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    let open
    const gate = new Promise((r) => (open = r))
    const provider = streaming("Begun", { gate, more: [" and", " more", " still"] })
    const running = burstOf(handle, taskOf(repo), { provider })
    await provider.at
    await sleep(30)
    // As another run settling it would.
    handle.change((d) => {
      const i = d.turns.findIndex((t) => t.streaming)
      d.turns.splice(i, 1)
    })
    open()
    const result = await running
    expect(result.outcome).toBe(OUTCOME.superseded)
    const doc = plain(handle)
    expect(JSON.stringify(doc.turns)).not.toContain("Begun")
    expect(JSON.stringify(doc.turns)).not.toContain("more")
    expect(provider.requests).toHaveLength(1)
    expect(doc.burst).toBe(null)
  })

  it("cancelled: closes its own reply, keeping the text, and clears burst", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = streaming("Begun")
    const task = taskOf(repo)
    const running = burstOf(handle, task, { provider })
    await provider.at
    await sleep(30)
    task.controller.abort("cancelled")
    expect((await running).outcome).toBe("cancelled")
    const doc = plain(handle)
    const reply = doc.turns.at(-1)
    expect(reply.blocks.map((b) => b.text)).toEqual(["Begun"])
    expect(reply.streaming).toBeUndefined()
    expect(doc.burst).toBe(null)
  })

  it("takes burst while it works and clears it at its end", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const seen = []
    handle.on("change", ({ doc }) => seen.push(doc.burst?.run ?? null))
    const result = await burstOf(handle, taskOf(repo))
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(seen).toContain("run-1")
    expect(plain(handle).burst).toBe(null)
    expect(plain(handle).turns.at(-1).blocks.map((b) => b.text)).toEqual(["Hi."])
  })

  it("stands back at a turn boundary when burst has come to name another task's run", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([[{ type: "call", id: "c1", name: "crossing", input: {} }], [{ type: "text", delta: "never" }]])
    // Another task's burst merges in while the call runs (two asks crossing).
    const crossing = tool("crossing", { execute: async () => (handle.change((d) => (d.burst = { run: "other-task-run" })), "ran") })
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [crossing] })
    expect(result.outcome).toBe(BURST.held)
    const doc = plain(handle)
    expect(doc.burst).toEqual({ run: "other-task-run" })
    expect(findResult(doc, "c1").block.output).toBe("ran")
    expect(provider.requests).toHaveLength(1)
  })

  it("returns the session's heads and its tools' own writes, and reports them as they grow", async () => {
    const repo = new Repo({ network: [] })
    const other = repo.create()
    other.change((d) => (d.x = 0))
    const handle = sessionIn(repo)
    const provider = makeMock([[{ type: "call", id: "c1", name: "write_other", input: {} }], [{ type: "text", delta: "Wrote it." }]])
    const writer = tool("write_other", {
      execute: async (_input, ctx) => {
        const found = await ctx.repo.find(other.url)
        found.change((d) => (d.x = 1))
        return "wrote"
      },
    })
    const task = taskOf(repo)
    const result = await burstOf(handle, task, { provider, tools: [writer] })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(result.heads).toEqual(heads(handle))
    expect(result.own).toEqual(A.getHeads(other.doc()))
    expect(task.progress.at(-1)).toEqual({ own: result.own })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it("answers a message written while its reply streams, in the same burst", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    let open
    const gate = new Promise((r) => (open = r))
    const provider = streaming("Begun", { gate, more: [" and done."] })
    const running = burstOf(handle, taskOf(repo), { provider })
    await provider.at
    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("And another thing.")])))
    open()
    const result = await running
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(provider.requests).toHaveLength(2)
    const doc = plain(handle)
    expect(doc.turns.at(-1).blocks.map((b) => b.text)).toEqual(["Again."])
    expect(doc.burst).toBe(null)
    expect(result.heads).toEqual(heads(handle))
  })

  it("asks before a read of a sensitive document (the own queue) runs", async () => {
    const repo = new Repo({ network: [] })
    const queue = repo.create({ jobs: {} })
    const handle = sessionIn(repo)
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: { url: queue.url } }], [{ type: "text", delta: "never" }]])
    const read = tool("doc_read", { risk: "read" })
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [read], context: { sensitiveDocs: [queue.url] } })
    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(findCall(plain(handle), "c1").block.status).toBe(CALL.pending)
    expect(read.runs).toBe(0)
  })

  it("chains its loop past 24 turns", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const script = Array.from({ length: 25 }, (_, i) => [{ type: "call", id: `c${i}`, name: "doc_read", input: {} }])
    script.push([{ type: "text", delta: "All read." }])
    const provider = makeMock(script)
    const read = tool("doc_read", { risk: "read" })
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [read] })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(provider.requests).toHaveLength(26)
    expect(read.runs).toBe(25)
    expect(plain(handle).burst).toBe(null)
  })
})
