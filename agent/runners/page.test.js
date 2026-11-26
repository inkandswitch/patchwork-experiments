/**
 * The parked-call runner (runners/page.js) on real Automerge copies of a
 * session that merge only when a test says, with a clock the test moves by
 * hand: every beat waited is a promise the test resolves.
 */
import { describe, it, expect, beforeEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, WHERE, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { stopSession } from "../session/recovery.js"
import { findCall, results } from "../session/calls.js"
import { STOP } from "../session/status.js"
import { INTERRUPTED } from "../session/recovery.js"
import { viewInspect, getMount } from "../tools/checking.js"
import { pageCalls, pageCall } from "./page.js"

await initSubduction()

beforeEach(() => _resetIds())

/** Made up, as the fixtures' are. */
const MADE = "automerge:DoFsmmQsY5BMsXFGgT8Xq57oiqC"
const PERSON = "automerge:person"

/** Let every promise and handler that is ready run; no time passes. */
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}

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

/** A session whose assistant turn holds `calls`, each cleared to run. */
function sessionWith(repo, calls) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("look at it")]), makeTurn("assistant", calls))
    d.burst = null
  })
  return handle
}
const hostCall = (tool, input = {}, id = undefined) => callBlock(tool, input, { where: WHERE.host, status: CALL.approved, ...(id ? { id } : {}) })

/** A copy of `handle` in another Repo: merged only by the test. */
function copyOf(handle) {
  const repo = new Repo({ network: [] })
  return repo.import(A.save(handle.doc()), { docId: handle.documentId })
}
const meet = (a, b) => {
  a.merge(b)
  b.merge(a)
}
const plain = (handle) => JSON.parse(JSON.stringify(handle.doc()))
const changes = (handle) => A.getAllChanges(handle.doc()).length

/** A stand-in tool; `gate`, when given, holds its call until opened, or until its signal aborts. */
function tool(id, { gate = null, answer = null } = {}) {
  const t = { id, name: id, where: "host", risk: "edit", runs: 0, signals: [] }
  t.execute = async (input, ctx) => {
    t.runs++
    t.signals.push(ctx.signal)
    if (gate) await Promise.race([gate, new Promise((r) => ctx.signal.addEventListener("abort", r, { once: true }))])
    return answer ?? `${id} done`
  }
  return t
}
function toolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: [], get: (id) => byId.get(id) ?? null }
}
function opened() {
  let open
  const gate = new Promise((r) => (open = r))
  return { gate, open }
}

/** A page running `handle`'s page calls with `tools`, on `time`. */
function pageOf(handle, { tools, time, id, hasMount = () => false, context = {} }) {
  const asked = []
  const page = pageCalls(handle, {
    context: { repo: null, ...context },
    buildToolset: async () => toolset(tools),
    hasMount,
    ask: async () => asked.push(handle.doc().burst),
    wait: time.wait,
    newId: () => id,
    target: null,
  })
  return { page, asked }
}

describe("a page's parked calls", () => {
  it("two pages in one crossing run a parked call once; the losing page wrote nothing on the call", async () => {
    const repoA = new Repo({ network: [] })
    const a = sessionWith(repoA, [hostCall("doc_create", {}, "c1")])
    const b = copyOf(a)
    const time = clock()
    const shared = tool("doc_create", { answer: { text: "made", doc: { url: MADE, name: "Made" } } })
    const pa = pageOf(a, { tools: [shared], time, id: "page-a" })
    const pb = pageOf(b, { tools: [shared], time, id: "page-b" })
    pa.page.tick()
    pb.page.tick()
    await flush()
    expect(a.doc().burst).toEqual({ run: "page-a" })
    expect(b.doc().burst).toEqual({ run: "page-b" })

    meet(a, b)
    const winner = a.doc().burst.run
    expect(b.doc().burst.run).toBe(winner)
    const [won, lost] = winner === "page-a" ? [a, b] : [b, a]
    const lostBefore = plain(lost)

    await time.beat()
    // The loser, not yet merged with the winner's work, has written nothing since.
    expect(plain(lost)).toEqual(lostBefore)
    expect(findCall(lost.doc(), "c1").block.status).toBe(CALL.approved)
    expect(findCall(lost.doc(), "c1").block.runner).toBe(null)

    meet(a, b)
    for (const h of [a, b]) {
      const call = findCall(h.doc(), "c1").block
      expect(call.status).toBe(CALL.done)
      expect(call.runner).toBe(winner)
      expect(results(h.doc()).filter((r) => r.callId === "c1")).toHaveLength(1)
      expect(h.doc().made.map((m) => m.url)).toEqual([MADE])
      expect(h.doc().burst).toBe(null)
    }
    expect(shared.runs).toBe(1)
    // Only the page that ran it asks, once, after it let go of `burst`.
    const [askedWon, askedLost] = won === a ? [pa.asked, pb.asked] : [pb.asked, pa.asked]
    expect(askedWon).toEqual([null])
    expect(askedLost).toEqual([])
  })

  it("the result change is written once: the move, the result, `made` and `burst` cleared together", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
    const time = clock()
    const { gate, open } = opened()
    const t = tool("doc_create", { gate, answer: { text: "made", doc: { url: MADE } } })
    pageOf(h, { tools: [t], time, id: "page-a" }).page.tick()
    await flush()
    await time.beat()
    expect(findCall(h.doc(), "c1").block).toMatchObject({ status: CALL.running, runner: "page-a" })
    expect(h.doc().burst).toEqual({ run: "page-a" })
    const before = changes(h)

    open()
    await flush()
    expect(changes(h)).toBe(before + 1)
    expect(findCall(h.doc(), "c1").block.status).toBe(CALL.done)
    expect(results(h.doc()).map((r) => r.callId)).toEqual(["c1"])
    expect(h.doc().made.map((m) => m.url)).toEqual([MADE])
    expect(h.doc().burst).toBe(null)
  })

  it("takes the next page call the same way, a beat each, then asks once", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionWith(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
    const time = clock()
    const t = tool("doc_create")
    const { page, asked } = pageOf(h, { tools: [t], time, id: "page-a" })
    page.tick()
    await flush()
    await time.beat()
    expect(t.runs).toBe(1)
    expect(asked).toEqual([])
    expect(h.doc().burst).toEqual({ run: "page-a" }) // its second claim, waiting its beat
    expect(findCall(h.doc(), "c2").block.status).toBe(CALL.approved)
    await time.beat()
    expect(t.runs).toBe(2)
    expect(results(h.doc()).map((r) => r.callId)).toEqual(["c1", "c2"])
    expect(asked).toEqual([null])
  })

  it("leaves a call a run would make first, a session with `burst` set, and one waiting on a person", async () => {
    const repo = new Repo({ network: [] })
    const worker = callBlock("doc_read", {}, { status: CALL.approved, id: "w1" })
    const h = sessionWith(repo, [worker, hostCall("doc_create", {}, "c1")])
    expect(pageCall(h.doc())).toBe(null)
    const other = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
    other.change((d) => (d.burst = { run: "run-1" }))
    expect(pageCall(other.doc())).toBe(null)
    // A session waiting on a person's yes waits whole, as needsWork says.
    const asking = sessionWith(repo, [hostCall("doc_create", {}, "c1"), callBlock("doc_delete", {}, { status: CALL.pending, id: "p1" })])
    expect(pageCall(asking.doc())).toBe(null)
    const time = clock()
    for (const s of [h, other, asking]) {
      const before = changes(s)
      pageOf(s, { tools: [tool("doc_create")], time, id: "page-a" }).page.tick()
      await flush()
      expect(changes(s)).toBe(before)
      expect(time.waits()).toEqual([])
    }
  })

  describe("under a stop", () => {
    it("a stop in force: nothing is written at all", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
      h.change((d) => stopSession(d, STOP.stopped, null, PERSON))
      const before = changes(h)
      const time = clock()
      pageOf(h, { tools: [tool("doc_create")], time, id: "page-a" }).page.tick()
      await flush()
      expect(changes(h)).toBe(before)
    })

    it("a stop merged in during the beat: no claim, and its own `burst` cleared", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
      const elsewhere = copyOf(h)
      const time = clock()
      const t = tool("doc_create")
      const { asked } = (() => {
        const p = pageOf(h, { tools: [t], time, id: "page-a" })
        p.page.tick()
        return p
      })()
      await flush()
      expect(h.doc().burst).toEqual({ run: "page-a" })
      elsewhere.change((d) => stopSession(d, STOP.stopped, null, PERSON))
      h.merge(elsewhere)
      await time.beat()
      expect(t.runs).toBe(0)
      expect(findCall(h.doc(), "c1").block).toMatchObject({ status: CALL.approved, runner: null })
      expect(h.doc().burst).toBe(null)
      expect(asked).toEqual([])
    })

    it("a stop during the call: the tool's signal aborts, its result still lands once, and the next call is not claimed", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
      const time = clock()
      const { gate } = opened() // never opened: only the abort ends the call
      const t = tool("doc_create", { gate })
      pageOf(h, { tools: [t], time, id: "page-a" }).page.tick()
      await flush()
      await time.beat()
      expect(t.runs).toBe(1)
      h.change((d) => stopSession(d, STOP.stopped, null, PERSON))
      await flush()
      expect(t.signals[0].aborted).toBe(true)
      expect(findCall(h.doc(), "c1").block.status).toBe(CALL.done)
      expect(results(h.doc()).map((r) => r.callId)).toEqual(["c1"])
      expect(h.doc().burst).toBe(null)
      await time.beat()
      expect(time.waits()).toEqual([])
      expect(t.runs).toBe(1)
      expect(findCall(h.doc(), "c2").block).toMatchObject({ status: CALL.approved, runner: null })
    })
  })

  describe("mounts", () => {
    it("the page with the mount takes it at once; the other waits a beat, sees `burst`, and leaves it", async () => {
      const repoA = new Repo({ network: [] })
      const a = sessionWith(repoA, [hostCall("view_inspect", { mountId: "m1" }, "c1")])
      const b = copyOf(a)
      const time = clock()
      const shared = tool("view_inspect")
      const pa = pageOf(a, { tools: [shared], time, id: "page-a", hasMount: (id) => id === "m1" })
      const pb = pageOf(b, { tools: [shared], time, id: "page-b" })
      pa.page.tick()
      pb.page.tick()
      await flush()
      expect(a.doc().burst).toEqual({ run: "page-a" })
      expect(b.doc().burst).toBe(null) // waiting its extra beat, having written nothing
      meet(a, b)
      await time.beat()
      meet(a, b)
      await time.beat()
      expect(shared.runs).toBe(1)
      expect(findCall(b.doc(), "c1").block).toMatchObject({ status: CALL.done, runner: "page-a" })
      expect(pb.asked).toEqual([])
    })

    it("with no page that has it, a page takes it a beat late and the tool answers that there is no mount", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("view_inspect", { mountId: "mount_gone" }, "c1")])
      const time = clock()
      // The real view tool and the page's real mounts map.
      pageOf(h, { tools: [viewInspect], time, id: "page-b", context: { getMount } }).page.tick()
      await flush()
      expect(h.doc().burst).toBe(null)
      await time.beat()
      expect(h.doc().burst).toEqual({ run: "page-b" })
      await time.beat()
      const result = results(plain(h)).find((r) => r.callId === "c1")
      expect(result.isError).toBe(true)
      expect(result.output).toMatch(/^Error: No mount 'mount_gone'/)
      expect(h.doc().burst).toBe(null)
    })
  })

  describe("pagehide", () => {
    it("during the call: abandoned INTERRUPTED and `burst` cleared in one change, and nothing written after", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
      const time = clock()
      const { gate, open } = opened()
      const t = tool("doc_create", { gate })
      const { page, asked } = pageOf(h, { tools: [t], time, id: "page-a" })
      page.tick()
      await flush()
      await time.beat()
      const before = changes(h)
      page.pagehide()
      expect(changes(h)).toBe(before + 1)
      expect(findCall(h.doc(), "c1").block.status).toBe(CALL.error)
      const [result] = results(plain(h))
      expect(result).toMatchObject({ callId: "c1", output: INTERRUPTED, placeholder: true })
      expect(h.doc().burst).toBe(null)
      expect(t.signals[0].aborted).toBe(true)

      open()
      await time.beat()
      expect(changes(h)).toBe(before + 1)
      expect(t.runs).toBe(1)
      expect(asked).toEqual([])
    })

    it("during the beat: `burst` cleared, the call untouched", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
      const time = clock()
      const t = tool("doc_create")
      const { page } = pageOf(h, { tools: [t], time, id: "page-a" })
      page.tick()
      await flush()
      page.pagehide()
      expect(h.doc().burst).toBe(null)
      expect(findCall(h.doc(), "c1").block).toMatchObject({ status: CALL.approved, runner: null })
      const before = changes(h)
      await time.beat()
      expect(changes(h)).toBe(before)
      expect(t.runs).toBe(0)
    })

    it("after another page took `burst`: it writes nothing", async () => {
      const repo = new Repo({ network: [] })
      const h = sessionWith(repo, [hostCall("doc_create", {}, "c1")])
      const time = clock()
      const { page } = pageOf(h, { tools: [tool("doc_create")], time, id: "page-a" })
      page.tick()
      await flush()
      h.change((d) => (d.burst = { run: "page-b" }))
      const before = changes(h)
      page.pagehide()
      expect(changes(h)).toBe(before)
      expect(h.doc().burst).toEqual({ run: "page-b" })
    })
  })

  it("dispose takes nothing more, but a call under way still writes its result and lets go of `burst`", async () => {
    const repo = new Repo({ network: [] })
    const h = sessionWith(repo, [hostCall("doc_create", {}, "c1"), hostCall("doc_create", {}, "c2")])
    const time = clock()
    const { gate, open } = opened()
    const t = tool("doc_create", { gate })
    const { page } = pageOf(h, { tools: [t], time, id: "page-a" })
    page.tick()
    await flush()
    await time.beat()
    page.dispose()
    open()
    await flush()
    expect(findCall(h.doc(), "c1").block.status).toBe(CALL.done)
    expect(h.doc().burst).toBe(null)
    expect(findCall(h.doc(), "c2").block.status).toBe(CALL.approved)
    expect(time.waits()).toEqual([])
  })
})
