/**
 * A checker's tests of a burst (kernel/burst.js) with the real loop, on real
 * Automerge copies of a session that merge only when a test says so, and a
 * stand-in task context whose `settled` and `signal` the test controls.
 */
import { describe, it, expect, beforeEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { stopSession, speak } from "../session/recovery.js"
import { findCall } from "../session/calls.js"
import { STOP, stopOf } from "../session/status.js"
import { toRequest } from "../session/request.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { runBurst, BURST } from "./burst.js"
import { OUTCOME } from "./loop.js"
import { needsWork } from "./runner.js"

await initSubduction()

beforeEach(() => _resetIds())

/** Made up: who pressed Stop. */
const PERSON = "automerge:person"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const plain = (handle) => JSON.parse(JSON.stringify(handle.doc()))
const heads = (handle) => [...handle.heads()]

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

/** A copy of `handle` in another Repo: the same document, merged only by `merge`. */
function copyOf(handle) {
  const repo = new Repo({ network: [] })
  return { repo, handle: repo.import(A.save(handle.doc()), { docId: handle.documentId }) }
}

/** A copy written by `actor`, from `handle`'s document now, holding what `fn` writes. */
function writtenBy(handle, actor, fn) {
  let doc = A.clone(handle.doc(), { actor: actor.repeat(16) })
  doc = A.change(doc, fn)
  return { fullDoc: () => doc }
}

/** A `settled` as a task's: resolves when told, rejects once the signal aborts first. */
function settledFor(signal, how) {
  let resolve
  const settled = new Promise((res, rej) => {
    resolve = res
    if (how === "resolved") res()
    if (how === "rejected") rej(new Error("the run stopped before it settled (yielded)"))
    const abort = () => rej(new Error(`the run stopped before it settled (${signal.reason})`))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
  settled.catch(() => {})
  return { settled, resolve }
}

function taskOf(repo, { run = "run-1", runs = null, settled = "resolved" } = {}) {
  const controller = new AbortController()
  const progress = []
  const s = settledFor(controller.signal, settled)
  const ctx = { repo, signal: controller.signal, run, taskUrl: "automerge:task", settled: s.settled, progress: (v) => progress.push(v), log: () => {} }
  return { ctx, controller, progress, resolve: s.resolve, runs: runs ?? [run] }
}

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

function burstOf(handle, task, { provider, tools = [], ...rest } = {}) {
  return runBurst(task.ctx, {
    session: handle.url,
    taskRuns: () => task.runs,
    getProvider: async () => provider ?? makeMock([[{ type: "text", delta: "Hi." }]]),
    buildToolset: async () => fakeToolset(tools),
    flushMs: 5,
    waitForNetwork: async () => {},
    ...rest,
  })
}

/** A model scripted turn by turn, where a turn may wait on a gate (or on the request's signal) part way. */
function scripted(...turns) {
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const turn = turns[requests.length - 1] ?? [{ type: "text", delta: "(again)" }]
      for (const event of turn) {
        if (typeof event === "function") {
          await event(request)
          continue
        }
        if (request.signal?.aborted) throw new DOMException("aborted", "AbortError")
        yield event
      }
      if (!turn.some((e) => e.type === "stop")) yield { type: "stop", reason: turn.some((e) => e.type === "call") ? "tool_use" : "end" }
    },
  }
}
/** A point in a scripted turn: says it was reached, then waits for `gate` or for the request's signal. */
function point() {
  let reached, open
  const at = new Promise((r) => (reached = r))
  const gate = new Promise((r) => (open = r))
  const step = (request) =>
    new Promise((resolve, reject) => {
      reached()
      gate.then(resolve)
      const abort = () => reject(new DOMException("aborted", "AbortError"))
      if (request?.signal?.aborted) abort()
      request?.signal?.addEventListener("abort", abort)
    })
  return { at, open, step }
}

/** What a request must never carry: a marked turn, a call with no result, a result with no call. */
function wellFormed(doc) {
  const request = toRequest(doc)
  const parts = request.messages.flatMap((m) => m.content)
  const calls = parts.filter((p) => p.type === "call").map((p) => p.id)
  const results = parts.filter((p) => p.type === "result").map((p) => p.callId)
  expect([...calls].sort()).toEqual([...results].sort())
  expect(new Set(results).size).toBe(results.length)
  return request
}
const texts = (doc) => doc.turns.flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text))

// ---------------------------------------------------------------- G at the start

describe("G: settled × signal × stop, before anything is written", () => {
  const cases = []
  for (const settled of ["pending", "resolved", "rejected"]) for (const reason of [null, "cancelled", "yielded", "stopping"]) for (const stop of [false, true]) cases.push([settled, reason, stop])

  it.each(cases)("settled %s, signal %s, stop %s", async (settled, reason, stop) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    if (stop) handle.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const before = heads(handle)
    const task = taskOf(repo, { settled })
    if (reason) task.controller.abort(reason)
    const provider = makeMock([[{ type: "text", delta: "Hi." }]])
    const running = burstOf(handle, task, { provider })
    if (settled === "pending") {
      await sleep(40)
      expect(heads(handle)).toEqual(before)
      expect(provider.requests).toHaveLength(0)
      task.resolve()
    }
    const result = await running
    const writes = settled !== "rejected" && !reason && !stop
    expect(heads(handle).join() !== before.join()).toBe(writes)
    expect(provider.requests.length).toBe(writes ? 1 : 0)
    if (writes) expect(result.outcome).toBe(OUTCOME.idle)
    else if (reason) expect(result.outcome).toBe(reason)
    else if (stop) expect(result.outcome).toBe(BURST.stopped)
    else expect(result.outcome).toBe("yielded")
  })

  it("settled pending, then the signal aborts: rejects, and nothing is written", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const before = heads(handle)
    const task = taskOf(repo, { settled: "pending" })
    const provider = makeMock([[{ type: "text", delta: "Hi." }]])
    const running = burstOf(handle, task, { provider })
    await sleep(20)
    task.controller.abort("yielded")
    expect((await running).outcome).toBe("yielded")
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("a stop merged in while settled is pending: nothing is written when it resolves", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const task = taskOf(repo, { settled: "pending" })
    const provider = makeMock([[{ type: "text", delta: "Hi." }]])
    const running = burstOf(handle, task, { provider })
    await sleep(20)
    handle.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const before = heads(handle)
    task.resolve()
    expect((await running).outcome).toBe(BURST.stopped)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- G mid-run

describe("G: what lands after an abort or a stop mid-run", () => {
  const ends = ["cancelled", "yielded", "stopping", "stop"]

  it.each(ends)("mid-reply, %s: only its own values", async (end) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const p = point()
    const provider = scripted([{ type: "text", delta: "Begun" }, p.step])
    const task = taskOf(repo)
    const running = burstOf(handle, task, { provider })
    await p.at
    await sleep(30)
    if (end === "stop") handle.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const at = plain(handle)
    if (end !== "stop") task.controller.abort(end)
    const result = await running
    const doc = plain(handle)
    expect(result.outcome).toBe(end === "stop" ? BURST.stopped : end)
    expect(doc.turns.length).toBe(at.turns.length)
    const reply = doc.turns.find((t) => t.role === "assistant" && texts({ turns: [t] }).includes("Begun"))
    // (1) its reply's mark off only on a cancel (a stop took it off itself); the text kept.
    expect(!!reply.streaming).toBe(end === "yielded" || end === "stopping")
    // (3) burst cleared at any end but yielded.
    expect(doc.burst).toEqual(end === "yielded" ? { run: "run-1" } : null)
    // Nothing else moved.
    const strip = (d) => ({ ...d, burst: null, turns: d.turns.map(({ streaming, ...t }) => t) })
    expect(strip(doc)).toEqual(strip(at))
    expect(provider.requests).toHaveLength(1)
  })

  it.each(ends)("mid-call, %s: the call's one change lands, and no other call runs", async (end) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    let reached, open
    const at = new Promise((r) => (reached = r))
    const gate = new Promise((r) => (open = r))
    const slow = tool("slow", { execute: async () => (reached(), await gate, "slow done") })
    const next = tool("next")
    const provider = makeMock([[{ type: "call", id: "c1", name: "slow", input: {} }, { type: "call", id: "c2", name: "next", input: {} }], [{ type: "text", delta: "never" }]])
    const task = taskOf(repo)
    const running = burstOf(handle, task, { provider, tools: [slow, next] })
    await at
    if (end === "stop") handle.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    else task.controller.abort(end)
    open()
    const result = await running
    const doc = plain(handle)
    expect(result.outcome).toBe(end === "stop" ? BURST.stopped : end)
    const results = doc.turns.flatMap((t) => t.blocks).filter((b) => b.type === "result")
    expect(results.map((r) => r.callId)).toEqual(["c1"])
    expect(findCall(doc, "c1").block.status).toBe(CALL.done)
    expect(findCall(doc, "c2").block.status).toBe(CALL.approved)
    expect(next.runs).toBe(0)
    expect(provider.requests).toHaveLength(1)
    expect(doc.burst).toEqual(end === "yielded" ? { run: "run-1" } : null)
  })

  // Reported, and declared by the builder: the guarded appender refused the
  // flush once aborted, so up to flushMs of text was lost. Fixed: the text
  // left in the buffer goes in with the mark's removal, in the run's own change.
  it("a cancel with text still in the appender's buffer keeps that text (G(1): a cancel loses no text)", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const p = point()
    const provider = scripted([{ type: "text", delta: "Begun" }, p.step])
    const task = taskOf(repo)
    const running = burstOf(handle, task, { provider, flushMs: 1000 })
    await p.at
    task.controller.abort("cancelled")
    expect((await running).outcome).toBe("cancelled")
    const doc = plain(handle)
    expect(doc.turns.at(-1).streaming).toBeUndefined()
    expect(texts(doc)).toContain("Begun")
  })
})

// ---------------------------------------------------------------- two asks cross

describe("two asks cross under one key: two tasks start on two copies", () => {
  it("both write burst, the merge keeps one, the other stands back at its next boundary; one reply and one batch doubled", async () => {
    const repoA = new Repo({ network: [] })
    const a = sessionIn(repoA)
    const { repo: repoB, handle: b } = copyOf(a)
    let inside = 0
    let open
    const gate = new Promise((r) => (open = r))
    const both = new Promise((r) => {
      const t = setInterval(() => inside >= 2 && (clearInterval(t), r()), 5)
    })
    const edit = () => tool("edit", { execute: async () => (inside++, await gate, "edited") })
    const ta = taskOf(repoA, { run: "task-a-run" })
    const tb = taskOf(repoB, { run: "task-b-run" })
    const pa = makeMock([[{ type: "text", delta: "A says." }, { type: "call", id: "ca", name: "edit", input: {} }], [{ type: "text", delta: "A done." }]])
    const pb = makeMock([[{ type: "text", delta: "B says." }, { type: "call", id: "cb", name: "edit", input: {} }], [{ type: "text", delta: "B done." }]])
    const ea = edit()
    const eb = edit()
    const ra = burstOf(a, ta, { provider: pa, tools: [ea] })
    const rb = burstOf(b, tb, { provider: pb, tools: [eb] })
    await both
    expect(plain(a).burst).toEqual({ run: "task-a-run" })
    expect(plain(b).burst).toEqual({ run: "task-b-run" })
    a.merge(b)
    b.merge(a)
    const kept = plain(a).burst.run
    expect(plain(b).burst.run).toBe(kept)
    open()
    const [resA, resB] = await Promise.all([ra, rb])
    a.merge(b)
    b.merge(a)
    const winner = kept === "task-a-run" ? resA : resB
    const loser = kept === "task-a-run" ? resB : resA
    expect(loser.outcome).toBe(BURST.held)
    expect(winner.outcome).toBe(OUTCOME.idle)
    const doc = plain(a)
    expect(doc).toEqual(plain(b))
    // Doubled: each first reply and each one-call batch; only the winner asked again.
    expect(ea.runs + eb.runs).toBe(2)
    expect(pa.requests.length + pb.requests.length).toBe(3)
    expect(doc.burst).toBe(null)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    wellFormed(doc)
    // Each call keeps its own real result in what is sent.
    const sent = toRequest(doc).messages.flatMap((m) => m.content).filter((p) => p.type === "result")
    expect(sent.map((r) => r.output).sort()).toEqual(["edited", "edited"])
    // Found by this checker, reported: the loser's result was written on a
    // copy that had not heard the winner's later turns, and the merge can
    // put that tool turn after the winner's last reply. The session then
    // reads as needing work, and the next ask pays for one more request.
    expect(needsWork(doc, (w) => w === "worker")).toBe(doc.turns.at(-1).role === "tool")
  })
})

// ---------------------------------------------------------------- C, the cut-off run

describe("C: run 1 cut off while run 2 of the same task takes over on another copy", () => {
  async function takeover({ mergeWhile }) {
    const repoA = new Repo({ network: [] })
    const a = sessionIn(repoA)
    const runs = ["run-1", "run-2"]
    const t1 = taskOf(repoA, { run: "run-1", runs })
    const streamPoint = point()
    let toolReached, toolOpen
    const toolAt = new Promise((r) => (toolReached = r))
    const toolGate = new Promise((r) => (toolOpen = r))
    const edit1 = tool("edit", { execute: async () => (toolReached(), await toolGate, "one edited") })
    const p1 = scripted([{ type: "text", delta: "One" }, streamPoint.step, { type: "text", delta: " more" }, { type: "call", id: "r1c", name: "edit", input: {} }], [{ type: "text", delta: "Run one done." }])
    const r1 = burstOf(a, t1, { provider: p1, tools: [edit1] })
    await streamPoint.at
    await sleep(30)
    // Run 2 takes the task, on a copy that heard run 1 up to here.
    const { repo: repoB, handle: b } = copyOf(a)
    expect(plain(b).burst).toEqual({ run: "run-1" })
    const t2 = taskOf(repoB, { run: "run-2", runs })
    const edit2 = tool("edit")
    const p2 = makeMock([[{ type: "text", delta: "Two" }, { type: "call", id: "r2c", name: "edit", input: {} }], [{ type: "text", delta: "Run two done." }]])
    const res2 = await burstOf(b, t2, { provider: p2, tools: [edit2] })
    expect(res2.outcome).toBe(OUTCOME.idle)
    expect(texts(plain(b))).not.toContain("One")
    // p2's first request carried no marked reply of run 1's.
    expect(JSON.stringify(p2.requests[0].messages)).not.toContain("One")
    if (mergeWhile === "streaming") {
      a.merge(b)
      streamPoint.open()
      toolOpen()
    } else if (mergeWhile === "calling") {
      streamPoint.open()
      await toolAt
      a.merge(b)
      toolOpen()
    } else {
      streamPoint.open()
      toolOpen()
    }
    const res1 = await r1
    a.merge(b)
    b.merge(a)
    return { a, b, res1, res2, p1, p2, edit1, edit2 }
  }

  it("merged while run 1 streams: its splices vanish with its reply, and it ends superseded", async () => {
    const { a, res1, p1, edit1 } = await takeover({ mergeWhile: "streaming" })
    expect(res1.outcome).toBe(OUTCOME.superseded)
    const doc = plain(a)
    expect(texts(doc).join("|")).not.toMatch(/One| more/)
    expect(edit1.runs).toBe(0)
    expect(p1.requests).toHaveLength(1)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    wellFormed(doc)
  })

  it("merged while run 1 runs its call: its result is not written (the call went with the reply), and at the boundary it carries on", async () => {
    const { a, res1, p1, edit1 } = await takeover({ mergeWhile: "calling" })
    expect(edit1.runs).toBe(1)
    expect(res1.outcome).toBe(OUTCOME.idle)
    const doc = plain(a)
    expect(texts(doc)).toContain("Run one done.")
    expect(texts(doc).join("|")).not.toMatch(/One\b| more/)
    expect(JSON.stringify(doc)).not.toContain("one edited")
    // What run 1 sent when it carried on, and what would be sent next.
    expect(p1.requests).toHaveLength(2)
    const second = p1.requests[1].messages.flatMap((m) => m.content)
    expect(second.filter((p) => p.type === "call").map((p) => p.id)).toEqual(["r2c"])
    expect(second.filter((p) => p.type === "result").map((p) => p.callId)).toEqual(["r2c"])
    expect(doc.burst).toBe(null)
    wellFormed(doc)
  })

  it("merged after both ended: run 1's result whose call vanished is not sent, nothing marked is", async () => {
    const { a, b, res1 } = await takeover({ mergeWhile: "after" })
    expect(res1.outcome).toBe(OUTCOME.idle)
    const doc = plain(a)
    expect(doc).toEqual(plain(b))
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    // Run 1's tool turn survives with a result whose call went with its dropped reply.
    expect(JSON.stringify(doc)).toContain("one edited")
    const request = wellFormed(doc)
    expect(JSON.stringify(request)).not.toContain("one edited")
    expect(doc.burst).toBe(null)
  })
})

// ---------------------------------------------------------------- retaken after a loss

describe("a run retaken after a loss", () => {
  it("rewrites burst at its first boundary and settles the lost run's marks: reply dropped, read released, write INTERRUPTED", async () => {
    const repo = new Repo({ network: [] })
    const lostReply = makeTurn("assistant", [textBlock("half")])
    lostReply.streaming = { runner: "run-1", generation: null }
    const handle = sessionIn(
      repo,
      [
        makeTurn("assistant", [
          { ...textBlock("Working.") },
        ]),
      ],
      { burst: { run: "run-1" } }
    )
    handle.change((d) => {
      const turn = d.turns.at(-1)
      turn.blocks.push({ type: "call", id: "w1", tool: "edit", input: {}, status: CALL.running, runner: "run-1", generation: null, where: "worker" })
      turn.blocks.push({ type: "call", id: "r1", tool: "read", input: {}, status: CALL.running, runner: "run-1", generation: null, where: "worker" })
      d.turns.push(lostReply)
    })
    const seen = []
    handle.on("change", ({ doc }) => seen.push(doc.burst?.run ?? null))
    const read = tool("read", { risk: "read" })
    const provider = makeMock([[{ type: "text", delta: "Going on." }]])
    const result = await burstOf(handle, taskOf(repo, { run: "run-2", runs: ["run-1", "run-2"] }), { provider, tools: [tool("edit"), read] })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(seen[0]).toBe("run-2")
    const doc = plain(handle)
    expect(texts(doc)).not.toContain("half")
    expect(findCall(doc, "w1").block.status).toBe(CALL.error)
    expect(findCall(doc, "r1").block).toMatchObject({ status: CALL.done, runner: "run-2" })
    expect(read.runs).toBe(1)
    wellFormed(doc)
  })
})

// ---------------------------------------------------------------- B

describe("B: the burst mark", () => {
  it("a foreign burst with marks present: held, writes nothing, settles nothing", async () => {
    const repo = new Repo({ network: [] })
    const reply = makeTurn("assistant", [textBlock("theirs")])
    reply.streaming = { runner: "their-run", generation: null }
    const handle = sessionIn(repo, [reply], { burst: { run: "their-run" } })
    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("me too")])))
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo), { provider })).outcome).toBe(BURST.held)
    expect(heads(handle)).toEqual(before)
    expect(provider.requests).toHaveLength(0)
  })

  it("burst null with marks present (and nothing else to do) is work: debris settled", async () => {
    const repo = new Repo({ network: [] })
    const reply = makeTurn("assistant", [textBlock("left")])
    reply.streaming = { runner: "gone-run", generation: null }
    const handle = sessionIn(repo, [makeTurn("assistant", [textBlock("Earlier.")]), reply])
    const provider = makeMock([[{ type: "text", delta: "Again." }]])
    const result = await burstOf(handle, taskOf(repo), { provider })
    expect(result.outcome).not.toBe(BURST.nothing)
    const doc = plain(handle)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    expect(texts(doc)).not.toContain("left")
  })
})

// ---------------------------------------------------------------- S

describe("S: a stop concurrent with the burst's last change, in both merge orders", () => {
  it.each(["00", "ff"])("stopper's actor %s: the merge holds the stop, and nothing is work", async (actor) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    // The stopper's copy has heard the person's message and nothing of the run.
    const stopper = writtenBy(handle, actor, (d) => stopSession(d, STOP.stopped, null, PERSON))
    const result = await burstOf(handle, taskOf(repo))
    expect(result.outcome).toBe(OUTCOME.idle)
    handle.merge(stopper)
    const doc = plain(handle)
    expect(stopOf(doc)?.kind).toBe(STOP.stopped)
    expect(needsWork(doc, (w) => w === "worker")).toBe(false)
    expect(texts(doc)).toContain("Hi.")
  })

  it.each(["00", "ff"])("a reply begun after the stopper's copy last heard, actor %s: it keeps its text and loses its mark (item 0 under a burst)", async (actor) => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const stopper = writtenBy(handle, actor, (d) => stopSession(d, STOP.stopped, null, PERSON))
    const p = point()
    const provider = scripted([{ type: "text", delta: "Begun here" }, p.step])
    const running = burstOf(handle, taskOf(repo), { provider })
    await p.at
    await sleep(30)
    handle.merge(stopper)
    expect((await running).outcome).toBe(BURST.stopped)
    const doc = plain(handle)
    expect(stopOf(doc)?.kind).toBe(STOP.stopped)
    const reply = doc.turns.find((t) => texts({ turns: [t] }).includes("Begun here"))
    expect(reply).toBeTruthy()
    expect(reply.streaming).toBeUndefined()
    expect(doc.burst).toBe(null)
    // Speaking carries on, and the reply is sent.
    handle.change((d) => speak(d, makeTurn("user", [textBlock("go on")])))
    expect(JSON.stringify(wellFormed(plain(handle)).messages)).toContain("Begun here")
  })

  it("a stop after the end: the notice stands, and no work until someone speaks", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    expect((await burstOf(handle, taskOf(repo))).outcome).toBe(OUTCOME.idle)
    // A person's stop on a session with nothing under way writes nothing; a workflow's does.
    handle.change((d) => stopSession(d, STOP.halted))
    const before = heads(handle)
    const provider = makeMock([])
    expect((await burstOf(handle, taskOf(repo, { run: "run-2" }), { provider })).outcome).toBe(BURST.stopped)
    expect(heads(handle)).toEqual(before)
  })
})

// ---------------------------------------------------------------- W

describe("W: a step session whose plan stops naming it mid-burst", () => {
  it("ends not-the-step at the next boundary: no request after; only its call's change and clearing burst", async () => {
    const repo = new Repo({ network: [] })
    const plan = repo.create()
    let handle
    plan.change((d) => {
      d.steps = [{ id: "s1", sessionUrl: null }]
    })
    handle = sessionIn(repo, [], { workflow: { planUrl: plan.url, stepId: "s1" } })
    plan.change((d) => {
      d.steps[0].sessionUrl = handle.url
    })
    const swap = tool("swap", {
      execute: async () => {
        plan.change((d) => {
          d.steps[0].sessionUrl = "automerge:another-session"
        })
        return "swapped"
      },
    })
    const provider = makeMock([[{ type: "call", id: "c1", name: "swap", input: {} }], [{ type: "text", delta: "never" }]])
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [swap] })
    expect(result.outcome).toBe(BURST.notTheStep)
    expect(provider.requests).toHaveLength(1)
    const doc = plain(handle)
    expect(findCall(doc, "c1").block.status).toBe(CALL.done)
    expect(doc.burst).toBe(null)
  })
})

// ---------------------------------------------------------------- a stale mark of its own task

describe("burst left naming an earlier run of its own task, with nothing else to do", () => {
  // Found by this checker, reported: the stale mark counted as work, and
  // once it was cleared the loop asked the model all the same, with the
  // session's last word its own reply. Fixed: the stale mark alone is
  // cleared at the burst's end, and the loop does not run.
  it("clears burst and asks the model nothing", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, [makeTurn("assistant", [textBlock("Done.")])], { burst: { run: "run-0" } })
    const provider = makeMock([[{ type: "text", delta: "Nothing to add." }]])
    const result = await burstOf(handle, taskOf(repo, { run: "run-1", runs: ["run-0", "run-1"] }), { provider })
    const doc = plain(handle)
    expect(doc.burst).toBe(null)
    expect(provider.requests).toHaveLength(0)
    expect(texts(doc)).toEqual(["hello", "Done."])
    expect(result.outcome).not.toBe(OUTCOME.error)
  })
})
