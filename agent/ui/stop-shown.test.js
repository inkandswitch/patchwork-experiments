/**
 * What a person sees of a Stop: a call approved under it, a call with two
 * results, two Stops pressed at once, and a long run that was stopped.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock, noticeBlock } from "../session/blocks.js"
import { stopSession, NOT_RUN, INTERRUPTED } from "../session/recovery.js"
import { findCall, findResult } from "../session/calls.js"
import { STOP } from "../session/status.js"
import { toRequest } from "../session/request.js"
import { memoryStore } from "../kernel/store.js"
import { say, decide } from "../kernel/loop.js"
import { renderTranscript } from "./transcript.js"
import { watchAttention } from "./attention.js"

beforeEach(() => _resetIds())

/** Made up: who pressed Stop. */
const PERSON = "automerge:person"

function session(turns) {
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("hello")]), ...turns]
  return doc
}

function render(doc) {
  const el = document.createElement("div")
  renderTranscript(el, doc, { open: new Set(), names: new Map() }, {})
  return el
}

const notRun = (el) => [...el.querySelectorAll(".agent-call")].filter((d) => d.dataset.status === "not-run").length

describe("a call approved under a Stop", () => {
  // Nothing on a call says when it was approved (SESSION.md, Stops), so one
  // approved after the Stop is closed with those approved before it, and is
  // shown so from the moment it is approved.
  it("shows 'Not run: stopped' at once, and the next message closes it not run", () => {
    const store = memoryStore(
      session([makeTurn("assistant", [callBlock("one", {}, { id: "c1", status: CALL.approved }), callBlock("two", {}, { id: "c2", status: CALL.pending })])])
    )
    store.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    expect(notRun(render(store.doc()))).toBe(1)
    decide(store, "c2", "once")
    expect(findCall(store.doc(), "c2").block.status).toBe(CALL.approved)
    const el = render(store.doc())
    expect(notRun(el)).toBe(2)
    expect(el.textContent).toContain("Not run: stopped")
    say(store, "go on")
    for (const id of ["c1", "c2"]) {
      expect(findCall(store.doc(), id).block.status).toBe(CALL.error)
      expect(String(findResult(store.doc(), id).block.output)).toBe(NOT_RUN)
    }
  })
})

describe("a call with two results", () => {
  // A message after a Stop closes a call "not run" while a run that had not
  // heard the Stop runs it (workflow/stop-elsewhere.test.js); a takeover's
  // INTERRUPTED meets the displaced run's real result the same way.
  const real = () => resultBlock("c1", "slow did it", { id: "r-real" })
  const PLACEHOLDERS = [
    ["NOT_RUN", () => resultBlock("c1", NOT_RUN, { id: "r-held", isError: true, placeholder: true })],
    ["INTERRUPTED", () => resultBlock("c1", INTERRUPTED, { id: "r-held", isError: true, placeholder: true })],
  ]
  const CASES = PLACEHOLDERS.flatMap(([name, held]) => [
    [name, "first", () => [held(), real()]],
    [name, "second", () => [real(), held()]],
  ])
  it.each(CASES)("a %s placeholder landing %s: the real one is shown and sent", (_name, _where, both) => {
    const [x, y] = both()
    const doc = session([makeTurn("assistant", [callBlock("slow", {}, { id: "c1", status: CALL.error })]), makeTurn("tool", [x]), makeTurn("tool", [y])])
    const sent = toRequest(doc).messages.flatMap((m) => m.content).filter((p) => p.type === "result").map((p) => p.output)
    expect(sent).toEqual(["slow did it"])
    const call = render(doc).querySelector(".agent-call")
    expect(call.textContent).toContain("slow did it")
    expect(call.textContent).not.toContain(NOT_RUN)
  })

  it("speak writes NOT_RUN as a placeholder", () => {
    const store = memoryStore(session([makeTurn("assistant", [callBlock("later", {}, { id: "c1", status: CALL.approved })])]))
    store.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    say(store, "go on")
    const block = findResult(store.doc(), "c1").block
    expect([String(block.output), block.placeholder]).toEqual([NOT_RUN, true])
  })
})

describe("two Stops pressed at once", () => {
  const stopped = () => makeTurn("assistant", [noticeBlock(STOP.stopped, "Stopped by a person.")], { author: PERSON })
  const shown = (el) => [...el.querySelectorAll('[data-role="notice"]')].map((n) => n.dataset.kind)

  it("are shown as one, with a late result between or not", () => {
    const call = makeTurn("assistant", [callBlock("slow", {}, { id: "c1", status: CALL.done })])
    expect(shown(render(session([call, stopped(), stopped()])))).toEqual([STOP.stopped])
    expect(shown(render(session([call, stopped(), makeTurn("tool", [resultBlock("c1", "late")]), stopped()])))).toEqual([STOP.stopped])
  })

  it("but a Stop after something said is shown again", () => {
    const el = render(session([stopped(), makeTurn("user", [textBlock("go on")]), makeTurn("assistant", [textBlock("Going.")]), stopped()]))
    expect(shown(el)).toEqual([STOP.stopped, STOP.stopped])
  })
})

describe("a long run that is stopped", () => {
  /** A session running since t = 0, watched for attention, ended at two minutes by `end`. */
  async function announced(end) {
    let t = 0
    const doc = session([makeTurn("assistant", [textBlock("Working on it")])])
    doc.burst = { run: "run-A" }
    const listeners = new Set()
    const handle = { url: "automerge:session", doc: () => doc, on: (_e, f) => listeners.add(f), off: (_e, f) => listeners.delete(f) }
    const watcher = watchAttention({ find: async () => handle }, () => ["automerge:session"], () => {}, { now: () => t })
    await new Promise((r) => setTimeout(r, 10))
    t = 120_000
    end(doc)
    for (const f of listeners) f()
    return watcher.snapshot().finished.map((item) => item.kind)
  }

  it.each([
    ["a person", STOP.stopped],
    ["its workflow", STOP.halted],
  ])("by %s is not announced as finished", async (_who, kind) => {
    expect(await announced((doc) => stopSession(doc, kind, null, PERSON))).toEqual([])
  })

  it("that ends on its own still is", async () => {
    expect(await announced((doc) => (doc.burst = null))).toEqual(["finished"])
  })
})
