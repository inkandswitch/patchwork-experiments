/**
 * A second checker's cases for the Stop fixes (a5dffec3), on two Automerge
 * copies as in stop-elsewhere.test.js, with the real SessionRunner and loop.
 *
 *   - a Stop and a message at once, the reply unseen by the stopper: its
 *     text is kept;
 *   - a call approved on one copy under a Stop, while the other copy speaks:
 *     the message closes what it saw, and the approval it did not see runs
 *     once, whichever way round the two merge; a call approved crossing the
 *     Stop is shown not run and closed by the next word, either way round;
 *   - a person's stop, then a message, then an error: the error is in force.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { stopSession, NOT_RUN } from "../session/recovery.js"
import { findCall } from "../session/calls.js"
import { STOP, stopOf } from "../session/status.js"
import { SessionRunner, needsWork } from "../kernel/runner.js"
import { say, decide } from "../kernel/loop.js"
import { toRequest } from "../session/request.js"

beforeEach(() => _resetIds())

/** Made up: who pressed Stop (as in stop-elsewhere.test.js). */
const PERSON = "automerge:2Lw7qGJgk2QJd8y3pFvPFRqhVmTd"

function copies(actors = ["aa", "bb"], turns = []) {
  const base = A.change(A.init({ actor: "cc".repeat(16) }), (d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]), ...turns)
  })
  const sides = actors.map((a) => ({ doc: A.clone(base, { actor: a.repeat(16) }), heard: () => {} }))
  const store = (i) => ({
    url: "automerge:session",
    doc: () => sides[i].doc,
    change(fn) {
      sides[i].doc = A.change(sides[i].doc, (d) => {
        fn(d)
      })
      sides[i].heard()
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
    sides[to].heard()
  }
  return { sides, stores: [store(0), store(1)], deliver }
}

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
function runnerOn(store, url, provider, tools = []) {
  return new SessionRunner({
    store,
    runnerUrl: url,
    buildToolset: async () => ({ tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null }),
    getProvider: async () => provider,
    canRun: () => true,
    confirmMs: 0,
  })
}

const flushed = () => new Promise((r) => setTimeout(r, 200))
const plain = (doc) => JSON.parse(JSON.stringify(doc))
const texts = (doc) => doc.turns.map((t) => [t.role, (t.blocks ?? []).map((b) => b.text ?? b.type).join("|"), !!t.streaming])

describe("item 1, a Stop and a message at once, the reply unseen by the stopper", () => {
  it("the reply's text is kept", async () => {
    const { sides, stores, deliver } = copies()
    let reached
    const at = new Promise((r) => (reached = r))
    let go
    const gate = new Promise((r) => (go = r))
    const m = model(async function* () {
      yield { type: "text", delta: "Unseen reply" }
      reached()
      await gate
      yield { type: "text", delta: " and more" }
      yield { type: "stop", reason: "stop" }
    }, says("Other thing."))
    const a = runnerOn(stores[0], "tab-A", m)
    sides[0].heard = () => a.tick()
    const run = a.tick()
    await at
    await flushed()
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    say(stores[1], "do something else")
    deliver(1, 0)
    go()
    // The message ended the stop before the run heard it: the reply is finished.
    expect((await run).outcome).toBe("idle")
    await a.tick()
    await vi.waitFor(() => expect(texts(sides[0].doc).at(-1)).toEqual(["assistant", "Other thing.", false]))
    expect(JSON.stringify(plain(sides[0].doc).turns)).toContain("Unseen reply")
    a.stop()
  })
})

describe("item 3 on two copies", () => {
  const calls = () => [makeTurn("assistant", [callBlock("one", {}, { id: "c1", status: CALL.approved }), callBlock("two", {}, { id: "c2", status: CALL.pending })])]
  const counted = (id) => {
    const tool = { id, risk: "edit", where: "worker", runs: 0, execute: async () => (tool.runs++, `${id} done`) }
    return tool
  }

  it.each([["aa", "bb"], ["bb", "aa"]])("approved on A under the Stop, while B speaks (actors %s, %s)", async (...actors) => {
    const { sides, stores, deliver } = copies(actors, calls())
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    decide(stores[0], "c2", "once")
    say(stores[1], "go on")
    deliver(1, 0)
    deliver(0, 1)
    const doc = plain(sides[0].doc)
    expect(plain(sides[1].doc).turns).toEqual(doc.turns)
    const status = ["c1", "c2"].map((id) => findCall(doc, id).block.status)
    const results = doc.turns.flatMap((t) => t.blocks).filter((b) => b.type === "result").map((b) => [b.callId, String(b.output) === NOT_RUN ? "NOT_RUN" : b.output])
    expect(results).toEqual([["c1", "NOT_RUN"]])
    // c2 was approved where B's speak could not see it: it stays approved, and runs once.
    expect(status).toEqual([CALL.error, CALL.approved])
    const one = counted("one")
    const two = counted("two")
    const r = runnerOn(stores[0], "tab-A", model(says("ok")), [one, two])
    await r.tick()
    expect([one.runs, two.runs]).toEqual([0, 1])
  })

  it.each([["aa", "bb"], ["bb", "aa"]])("approved on A crossing B's Stop (actors %s, %s): shown not run, closed by the next word", async (...actors) => {
    const { sides, stores, deliver } = copies(actors, calls())
    decide(stores[0], "c2", "once")
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    deliver(0, 1)
    for (const side of sides) {
      expect(stopOf(side.doc)?.kind).toBe(STOP.stopped)
      expect(needsWork(side.doc)).toBe(false)
      expect(findCall(side.doc, "c2").block.status).toBe(CALL.approved)
    }
    say(stores[0], "go on")
    deliver(0, 1)
    const doc = plain(sides[1].doc)
    expect(["c1", "c2"].map((id) => findCall(doc, id).block.status)).toEqual([CALL.error, CALL.error])
    const sent = toRequest(doc).messages.flatMap((x) => x.content).filter((p) => p.type === "result").map((p) => [p.callId, p.output === NOT_RUN])
    expect(sent).toEqual([["c1", true], ["c2", true]])
  })
})

describe("item 4: a stop, a message and a run's error", () => {
  it("an error after the person spoke is in force", () => {
    const doc = { turns: [makeTurn("user", [textBlock("hi")]), makeTurn("assistant", [{ type: "notice", kind: STOP.stopped, text: "Stopped" }]), makeTurn("user", [textBlock("go on")]), makeTurn("assistant", [{ type: "notice", kind: STOP.error, text: "boom" }])] }
    expect(stopOf(doc)?.kind).toBe(STOP.error)
  })
  it("a stop ended by a message, then a nudge, then an error: the error", () => {
    const doc = { turns: [makeTurn("assistant", [{ type: "notice", kind: STOP.stopped, text: "Stopped" }]), makeTurn("user", [textBlock("go on")]), makeTurn("user", [{ type: "notice", kind: "nudge", text: "(go on)" }]), makeTurn("assistant", [{ type: "notice", kind: STOP.error, text: "boom" }])] }
    expect(stopOf(doc)?.kind).toBe(STOP.error)
  })
})
