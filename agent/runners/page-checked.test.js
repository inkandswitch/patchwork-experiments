/**
 * A checker's tests of the parked-call runner (runners/page.js), on real
 * Automerge copies of a session that merge only when a test says so, with a
 * clock the test moves by hand: every beat waited is a promise the test
 * resolves. A burst (kernel/burst.js) with the real loop stands in for a
 * pool's run, and a stand-in task client for askWork (runners/ask.js).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, WHERE, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { stopSession, INTERRUPTED } from "../session/recovery.js"
import { findCall, results } from "../session/calls.js"
import { STOP, stopOf } from "../session/status.js"
import { toRequest } from "../session/request.js"
import { runBurst, BURST } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { viewInspect, getMount } from "../tools/checking.js"
import { pageCalls } from "./page.js"
import { askWork, takeOver, forget } from "./ask.js"

await initSubduction()

beforeEach(() => _resetIds())

const PERSON = "automerge:person"
const IMPORT = "automerge:DoFsmmQsY5BMsXFGgT8Xq57oiqC/agent/index.js"

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}
const plain = (handle) => JSON.parse(JSON.stringify(handle.doc()))
const changes = (handle) => A.getAllChanges(handle.doc()).length
const block = (handle, id) => JSON.parse(JSON.stringify(findCall(handle.doc(), id).block))
const resultsFor = (handle, id) => results(plain(handle)).filter((r) => r.callId === id)

/** A clock that moves only when told: `beat()` ends every wait begun so far. */
function clock() {
  let waiting = []
  return {
    wait: (ms) => new Promise((resolve) => waiting.push({ ms, resolve })),
    waits: () => waiting.map((w) => w.ms),
    async beat() {
      const now = waiting
      waiting = []
      for (const w of now) w.resolve()
      await flush()
    },
  }
}

function sessionIn(repo, blocks) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("look at it")]), makeTurn("assistant", blocks))
    d.burst = null
  })
  return handle
}
const hostCall = (tool, input, id) => callBlock(tool, input, { where: WHERE.host, status: CALL.approved, id })
const workerCall = (tool, input, id) => callBlock(tool, input, { where: WHERE.worker, status: CALL.approved, id })

function copyOf(handle) {
  const repo = new Repo({ network: [] })
  return repo.import(A.save(handle.doc()), { docId: handle.documentId })
}
/** Every copy merged with every other. */
const meet = (...hs) => {
  for (const a of hs) for (const b of hs) if (a !== b) a.merge(b)
}

function tool(id, { gate = null, answer = null, where = "host", execute = null } = {}) {
  const t = { id, name: id, where, risk: "edit", runs: 0, signals: [] }
  t.execute = async (input, ctx) => {
    t.runs++
    t.signals.push(ctx.signal)
    if (execute) return execute(input, ctx)
    if (gate) await Promise.race([gate, new Promise((r) => ctx.signal.addEventListener("abort", r, { once: true }))])
    return answer ?? `${id} done`
  }
  return t
}
function toolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}
function opened() {
  let open
  const gate = new Promise((r) => (open = r))
  return { gate, open }
}

/** A page running `handle`'s page calls; its ids are `${name}-1`, `${name}-2`, … */
function pageOf(handle, { tools, time, name, hasMount = () => false, context = {}, builtins = [] }) {
  const asked = []
  let n = 0
  const page = pageCalls(handle, {
    context: { repo: null, ...context },
    builtins,
    buildToolset: async () => toolset(tools),
    hasMount,
    ask: async () => asked.push(handle.doc().burst),
    wait: time.wait,
    newId: () => `${name}-${++n}`,
    target: null,
  })
  return { page, asked, name }
}

describe("pages crossing on one parked call", () => {
  it("three pages in one crossing: one runs it, and the two that lose have written nothing on the call", async () => {
    const repo = new Repo({ network: [] })
    const a = sessionIn(repo, [hostCall("doc_create", {}, "c1")])
    const b = copyOf(a)
    const c = copyOf(a)
    const time = clock()
    const shared = tool("doc_create")
    const pages = [pageOf(a, { tools: [shared], time, name: "a" }), pageOf(b, { tools: [shared], time, name: "b" }), pageOf(c, { tools: [shared], time, name: "c" })]
    const callBefore = block(a, "c1")
    for (const p of pages) p.page.tick()
    await flush()
    meet(a, b, c)
    const winner = a.doc().burst.run
    expect(b.doc().burst.run).toBe(winner)
    expect(c.doc().burst.run).toBe(winner)

    await time.beat()
    // Each loser's copy: the call as it was. Only the winner's holds a claim.
    const copies = { "a-1": a, "b-1": b, "c-1": c }
    for (const [id, h] of Object.entries(copies)) {
      if (id === winner) expect(block(h, "c1")).toMatchObject({ status: CALL.done, runner: winner })
      else expect(block(h, "c1")).toEqual(callBefore)
    }
    meet(a, b, c)
    await time.beat()
    meet(a, b, c)
    expect(shared.runs).toBe(1)
    for (const h of [a, b, c]) {
      expect(resultsFor(h, "c1")).toHaveLength(1)
      expect(h.doc().burst).toBe(null)
    }
    // The winner asked once; the losers, never.
    expect(pages.map((p) => p.asked.length).sort()).toEqual([0, 0, 1])
  })

  it("a crossing slower than a beat: both run it, two results merge, and the request sends one", async () => {
    const repo = new Repo({ network: [] })
    const a = sessionIn(repo, [hostCall("doc_create", {}, "c1")])
    const b = copyOf(a)
    const time = clock()
    const shared = tool("doc_create", { answer: "made it" })
    pageOf(a, { tools: [shared], time, name: "a" }).page.tick()
    pageOf(b, { tools: [shared], time, name: "b" }).page.tick()
    await flush()
    await time.beat() // neither heard the other within its beat
    expect(shared.runs).toBe(2)
    meet(a, b)
    expect(resultsFor(a, "c1")).toHaveLength(2)
    expect(a.doc().burst).toBe(null)
    expect(plain(a)).toEqual(plain(b))
    const request = toRequest(a.doc())
    const answers = request.messages.flatMap((m) => m.content).filter((p) => p.type === "result" && p.callId === "c1")
    expect(answers).toHaveLength(1)
  })
})

describe("a page and a burst crossing on `burst`", () => {
  // The session: a page call first, then a worker call, both cleared to run.
  // A burst asked now has work (the worker call), and parks at the page call.
  const both = () => [hostCall("doc_create", {}, "h1"), workerCall("doc_read", {}, "w1")]

  function burstOn(handle, repo, { run = "run-1", taskRuns }) {
    const worker = tool("doc_read", { where: "worker" })
    return {
      worker,
      result: runBurst(
        { repo, signal: new AbortController().signal, run, taskUrl: null, settled: Promise.resolve(), progress: () => {}, log: () => {} },
        {
          session: handle.url,
          taskRuns,
          getProvider: async () => makeMock([[{ type: "text", delta: "Hi." }]]),
          buildToolset: async () => toolset([worker]),
          flushMs: 1,
          waitForNetwork: async () => {},
        }
      ),
    }
  }

  it("the page's `burst` heard before the run's boundary: the run stands back, having written nothing", async () => {
    const repoA = new Repo({ network: [] })
    const a = sessionIn(repoA, both())
    const repoB = new Repo({ network: [] })
    const b = repoB.import(A.save(a.doc()), { docId: a.documentId })
    const time = clock()
    const host = tool("doc_create")
    pageOf(a, { tools: [host], time, name: "page" }).page.tick()
    await flush()
    const before = changes(b)
    let looks = 0
    const { result } = burstOn(b, repoB, {
      taskRuns: () => {
        // Its first look saw `burst` null; the page's write arrives before its boundary.
        if (++looks === 1) b.merge(a)
        return ["run-1"]
      },
    })
    const ended = await result
    expect(ended.outcome).toBe(BURST.held)
    expect(changes(b)).toBe(before + 1) // only the page's own write, merged in
    await time.beat()
    meet(a, b)
    expect(host.runs).toBe(1)
    expect(resultsFor(a, "h1")).toHaveLength(1)
    expect(block(a, "w1")).toMatchObject({ status: CALL.approved, runner: null })
  })

  it("in one crossing, both written before either hears the other: never both on the call, and the call runs once", async () => {
    const seen = new Set()
    for (let i = 0; i < 64 && seen.size < 2; i++) {
      _resetIds()
      const repoA = new Repo({ network: [] })
      const a = sessionIn(repoA, both())
      const repoB = new Repo({ network: [] })
      const b = repoB.import(A.save(a.doc()), { docId: a.documentId })
      const time = clock()
      const host = tool("doc_create")
      const { page } = pageOf(a, { tools: [host], time, name: "page" })
      page.tick()
      await flush()
      expect(a.doc().burst).toEqual({ run: "page-1" })
      let crossed = null
      const { result } = burstOn(b, repoB, {
        taskRuns: () => {
          // Once the run has written `burst` (its boundary), and parked: the two copies meet.
          if (!crossed && b.doc().burst?.run === "run-1") {
            meet(a, b)
            crossed = a.doc().burst.run
          }
          return ["run-1"]
        },
      })
      const ended = await result
      expect(crossed).not.toBe(null)
      seen.add(crossed)
      expect(ended.outcome).toBe(OUTCOME.parked)
      // The run never touched the page call.
      expect(block(b, "h1").runner).not.toBe("run-1")
      await time.beat()
      for (let round = 0; round < 4; round++) {
        meet(a, b)
        await time.beat()
      }
      meet(a, b)
      expect(host.runs).toBe(1)
      expect(resultsFor(a, "h1")).toHaveLength(1)
      expect(block(a, "h1")).toMatchObject({ status: CALL.done })
      expect(block(a, "h1").runner.startsWith("page-")).toBe(true)
      expect(a.doc().burst).toBe(null)
    }
    // Both ways the register can fall were seen.
    expect([...seen].sort()).toEqual(["page-1", "run-1"])
  })
})

describe("a stop", () => {
  it("in force: no `burst`, no claim, no call run, and no beat waited", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionIn(repo, [hostCall("doc_create", {}, "c1")])
    h.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const time = clock()
    const t = tool("doc_create")
    const before = changes(h)
    const { page, asked } = pageOf(h, { tools: [t], time, name: "a" })
    await page.tick()
    await flush()
    expect(changes(h)).toBe(before)
    expect(time.waits()).toEqual([])
    expect(t.runs).toBe(0)
    expect(asked).toEqual([])
  })

  it("landing while the tool runs: the signal aborts, the tool's own session write is refused, and the call has exactly one result", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionIn(repo, [hostCall("note_it", {}, "c1"), hostCall("note_it", {}, "c2")])
    const elsewhere = copyOf(h)
    const time = clock()
    const { gate, open } = opened()
    let wrote = null
    const t = tool("note_it", {
      execute: async (input, ctx) => {
        await gate // it does not heed its signal
        wrote = ctx.session.change((d) => (d.note = "written after the stop"))
        return "noted"
      },
    })
    t.needs = ["session.write"]
    const { asked } = (() => {
      const p = pageOf(h, { tools: [t], time, name: "a", builtins: [t] })
      p.page.tick()
      return p
    })()
    await flush()
    await time.beat()
    expect(block(h, "c1")).toMatchObject({ status: CALL.running, runner: "a-1" })
    elsewhere.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    h.merge(elsewhere)
    await flush()
    expect(t.signals[0].aborted).toBe(true)
    open()
    await flush()
    expect(wrote).toBe(false)
    expect(h.doc().note).toBe(undefined)
    expect(resultsFor(h, "c1")).toHaveLength(1)
    expect(block(h, "c1").status).toBe(CALL.done)
    expect(h.doc().burst).toBe(null)
    await time.beat()
    expect(time.waits()).toEqual([])
    expect(block(h, "c2")).toMatchObject({ status: CALL.approved, runner: null })
    expect(asked).toEqual([])
    meet(h, elsewhere)
    expect(stopOf(h.doc())).toBeTruthy()
    expect(resultsFor(h, "c1")).toHaveLength(1)
  })

  it("written on another copy in the same moment as the page's result change: one result, the stop holds, `burst` clear", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionIn(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
    const elsewhere = copyOf(h)
    const time = clock()
    const { gate, open } = opened()
    const t = tool("doc_create", { gate })
    pageOf(h, { tools: [t], time, name: "a" }).page.tick()
    await flush()
    await time.beat()
    elsewhere.merge(h)
    elsewhere.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    open()
    await flush()
    // The page wrote its result and took the next call's `burst` before it heard the stop.
    meet(h, elsewhere)
    await time.beat()
    meet(h, elsewhere)
    expect(stopOf(h.doc())).toBeTruthy()
    expect(resultsFor(h, "c1")).toHaveLength(1)
    expect(t.runs).toBe(1)
    expect(block(h, "c2")).toMatchObject({ status: CALL.approved, runner: null })
    expect(h.doc().burst).toBe(null)
  })
})

describe("pagehide, and a page that dies without it", () => {
  it("pagehide mid-call: INTERRUPTED, `burst` cleared, and another page then takes the next call", async () => {
    const repo = new Repo({ network: [] })
    const a = sessionIn(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
    const b = copyOf(a)
    const time = clock()
    const { gate } = opened()
    const ta = tool("doc_create", { gate })
    const tb = tool("doc_create")
    const pa = pageOf(a, { tools: [ta], time, name: "a" })
    const pb = pageOf(b, { tools: [tb], time, name: "b" })
    pa.page.tick()
    await flush()
    meet(a, b) // b hears a's `burst` before it looks
    pb.page.tick()
    await flush()
    await time.beat()
    expect(block(a, "c1")).toMatchObject({ status: CALL.running, runner: "a-1" })
    meet(a, b)
    expect(tb.runs).toBe(0)
    pa.page.pagehide()
    expect(block(a, "c1").status).toBe(CALL.error)
    expect(resultsFor(a, "c1")[0]).toMatchObject({ output: INTERRUPTED, placeholder: true })
    expect(a.doc().burst).toBe(null)
    meet(a, b) // b's page hears it, and takes c2
    await flush()
    expect(b.doc().burst).toEqual({ run: "b-1" })
    await time.beat()
    expect(tb.runs).toBe(1)
    expect(block(b, "c2")).toMatchObject({ status: CALL.done, runner: "b-1" })
    expect(resultsFor(b, "c1")).toHaveLength(1)
    expect(pb.asked).toHaveLength(1)
    expect(ta.runs).toBe(1)
  })

  /** Page a claims c1 and its tab is discarded mid-call; copy b has heard all of it. */
  async function deadPage() {
    const repo = new Repo({ network: [] })
    const a = sessionIn(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
    const repoB = new Repo({ network: [] })
    const b = repoB.import(A.save(a.doc()), { docId: a.documentId })
    const time = clock()
    const { gate } = opened()
    pageOf(a, { tools: [tool("doc_create", { gate })], time, name: "a" }).page.tick()
    await flush()
    await time.beat()
    // Page a's tab is discarded here: nothing more from it, ever.
    meet(a, b)
    const asks = []
    const client = {
      doWork: vi.fn((r, request) => (asks.push(request), new Promise(() => {}))),
      watchWork: (r, key, onChange) => (onChange({ state: "missing", runs: [] }), () => {}),
      stopWork: async () => false,
    }
    const opts = { client, importUrl: IMPORT, onOnline: () => () => {} }
    return { b, repoB, time, asks, opts }
  }

  it("a page that dies mid-call without pagehide leaves `burst`: no other page and no asker takes it; Take over clears it and asks once", async () => {
    const { b, repoB, time, asks, opts } = await deadPage()
    const tb = tool("doc_create")
    const pb = pageOf(b, { tools: [tb], time, name: "b" })
    pb.page.tick()
    await flush()
    for (let i = 0; i < 3; i++) await time.beat()
    expect(tb.runs).toBe(0)
    expect(b.doc().burst).toEqual({ run: "a-1" })
    // An asker stands back under it, however often it is called.
    for (let i = 0; i < 3; i++) expect((await askWork(repoB, b.url, opts)).asked).toBe(false)
    expect(asks).toHaveLength(0)
    pb.page.dispose()

    takeOver(repoB, b.url, opts)
    await flush()
    expect(b.doc().burst).toBe(null)
    expect(asks).toHaveLength(1)
    expect(asks[0].input.heads).toEqual([...b.heads()])
    // The dead page's call is debris now, for the burst Take over asked for.
    expect(block(b, "c1")).toMatchObject({ status: CALL.running, runner: "a-1" })
    takeOver(repoB, b.url, opts)
    await flush()
    forget(b.url)
  })

  /**
   * The author's third doubt, shown. Take over pressed in a page that shows
   * the session (where the button is) with a page call behind the dead one:
   * the page hears `burst` go null and writes its own claim at once, before
   * Take over's askWork looks, so that ask stands back under the page's
   * claim, and the page runs c2 while c1 is still debris. needsWork settles
   * debris before anything else; pageCall does not look at debris. The
   * session recovers (the page asks once c2 is done), but Take over itself
   * did not ask.
   */
  it.fails("Take over in a page that shows the session asks once, ahead of the page's next call", async () => {
    const { b, repoB, time, asks, opts } = await deadPage()
    const tb = tool("doc_create")
    pageOf(b, { tools: [tb], time, name: "b" }).page.tick()
    await flush()
    takeOver(repoB, b.url, opts)
    await flush()
    expect(asks).toHaveLength(1)
    expect(b.doc().burst).toBe(null)
    await time.beat()
    expect(tb.runs).toBe(0)
    forget(b.url)
  })
})

describe("mounts", () => {
  it("with the page that has the mount gone, another answers 'No mount' one beat later than it would otherwise take a call, not before", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionIn(repo, [hostCall("view_inspect", { mountId: "mount_gone" }, "c1")])
    const time = clock()
    const before = changes(h)
    pageOf(h, { tools: [viewInspect], time, name: "b", context: { getMount } }).page.tick()
    await flush()
    // The extra beat: nothing written.
    expect(changes(h)).toBe(before)
    expect(time.waits()).toEqual([2000])
    await time.beat()
    // Then as any call: `burst`, and a beat.
    expect(h.doc().burst).toEqual({ run: "b-1" })
    expect(block(h, "c1")).toMatchObject({ status: CALL.approved, runner: null })
    await time.beat()
    const [result] = resultsFor(h, "c1")
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/No mount/)
  })

  it("the page that has the mount takes it even when the other page saw the call first", async () => {
    const repo = new Repo({ network: [] })
    const a = sessionIn(repo, [hostCall("view_inspect", { mountId: "m1" }, "c1")])
    const b = copyOf(a)
    const time = clock()
    const shared = tool("view_inspect")
    // b looks first, and starts its extra beat.
    pageOf(b, { tools: [shared], time, name: "b" }).page.tick()
    await flush()
    pageOf(a, { tools: [shared], time, name: "a", hasMount: (id) => id === "m1" }).page.tick()
    await flush()
    meet(a, b)
    await time.beat() // b's extra beat ends, a's beat ends: a claims, b sees a's `burst`
    meet(a, b)
    await time.beat()
    meet(a, b)
    expect(shared.runs).toBe(1)
    expect(block(b, "c1")).toMatchObject({ status: CALL.done, runner: "a-1" })
  })
})
