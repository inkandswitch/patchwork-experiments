/**
 * A second checker's cases for the Stop fixes (a5dffec3), on what is shown
 * and sent: a call that never ran keeps its "not run"; where a call has two
 * placeholders, the transcript shows the one the model is sent.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock } from "../session/blocks.js"
import { NOT_RUN, INTERRUPTED } from "../session/recovery.js"
import { toRequest } from "../session/request.js"
import { renderTranscript } from "./transcript.js"

beforeEach(() => _resetIds())

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

const sent = (doc) => toRequest(doc).messages.flatMap((m) => m.content).filter((p) => p.type === "result").map((p) => p.output)
const notRun = (id) => resultBlock(id, NOT_RUN, { id: `nr-${id}`, isError: true, summary: "not run: stopped", placeholder: true })
const interrupted = (id) => resultBlock(id, INTERRUPTED, { id: `in-${id}`, isError: true, summary: "interrupted", placeholder: true })
const callTurn = (status) => makeTurn("assistant", [callBlock("slow", {}, { id: "c1", status })])

describe("a call that never ran", () => {
  it("closed by a message after a Stop and nothing else: the model is told and shown it was not run", () => {
    const doc = session([callTurn(CALL.error), makeTurn("tool", [notRun("c1")]), makeTurn("user", [textBlock("go on")])])
    expect(sent(doc)).toEqual([NOT_RUN])
    expect(render(doc).querySelector(".agent-call").textContent).toContain(NOT_RUN)
  })

  it("followed by a real result that says it was stopped before it did anything: that real result is what is sent and shown", () => {
    const stopped = resultBlock("c1", "Error: slow stopped", { id: "r-real", isError: true, summary: "slow stopped" })
    for (const both of [[notRun("c1"), stopped], [stopped, notRun("c1")]]) {
      const doc = session([callTurn(CALL.error), makeTurn("tool", [both[0]]), makeTurn("tool", [both[1]])])
      expect(sent(doc)).toEqual(["Error: slow stopped"])
      expect(render(doc).querySelector(".agent-call").textContent).toContain("Error: slow stopped")
    }
  })

  it.each([
    ["NOT_RUN first", () => [notRun("c1"), interrupted("c1")], NOT_RUN],
    ["INTERRUPTED first", () => [interrupted("c1"), notRun("c1")], INTERRUPTED],
  ])("two placeholders, %s: the first is sent, and the transcript shows the same", (_name, both, first) => {
    const [x, y] = both()
    const doc = session([callTurn(CALL.error), makeTurn("tool", [x]), makeTurn("tool", [y])])
    expect(sent(doc)).toEqual([first])
    const shown = render(doc).querySelector(".agent-call").textContent
    expect(shown).toContain(first)
    expect(shown).not.toContain(first === NOT_RUN ? INTERRUPTED : NOT_RUN)
  })
})

describe("a call run across a Stop and a message (stop-elsewhere D3)", () => {
  it("the call whose status ended `error` with a real result: its result is what is shown and sent", () => {
    const real = resultBlock("c1", "slow did it", { id: "r-real", summary: "did it" })
    const doc = session([callTurn(CALL.error), makeTurn("tool", [notRun("c1")]), makeTurn("tool", [real])])
    const call = render(doc).querySelector(".agent-call")
    expect(sent(doc)).toEqual(["slow did it"])
    expect(call.textContent).toContain("slow did it")
    // Its status register kept the abandon; it is styled by the result shown,
    // which says it did it.
    expect(call.dataset.status).toBe(CALL.done)
  })
})
