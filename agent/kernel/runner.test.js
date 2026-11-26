import { describe, it, expect } from "vitest"
import { needsWork } from "./runner.js"
import { initSession, CALL } from "../session/schema.js"
import { makeTurn, textBlock, noticeBlock, callBlock, resultBlock } from "../session/blocks.js"
import { STOP } from "../session/status.js"
import { stopSession } from "../session/recovery.js"

/** A session someone has just spoken in: work for any runner that can take it. */
function spokenTo(change = () => {}) {
  const doc = {}
  initSession(doc, {})
  doc.turns.push(makeTurn("user", [textBlock("go")]))
  change(doc)
  return doc
}

describe("whether there is work for a run", () => {
  const worker = (where) => where === "worker"
  const hostCall = (d) => d.turns.push(makeTurn("assistant", [Object.assign(callBlock("look", {}, { id: "c1" }), { where: "host", status: CALL.approved })]))
  const answered = (d) => d.turns.push(makeTurn("assistant", [textBlock("done")]))
  const marked = (runner) => (d) => d.turns.push(Object.assign(makeTurn("assistant", [textBlock("half")]), { streaming: { runner } }))

  // Each row changes one thing from a session just spoken to, and it alone decides.
  it.each([
    ["a person spoke last", () => {}, {}, true],
    ["the agent spoke last", answered, {}, false],
    ["a call cleared to run needs a page, and a run cannot run one", hostCall, { canRun: worker }, false],
    ["a call cleared to run needs a page, and the asker can run one", hostCall, {}, true],
    ["a reply marked by the run `burst` names", (d) => { answered(d); marked("run-1")(d); d.burst = { run: "run-1" } }, {}, false],
    ["a reply marked by another run than `burst` names", (d) => { answered(d); marked("run-0")(d); d.burst = { run: "run-1" } }, {}, true],
    ["a reply marked while `burst` is null", (d) => { answered(d); marked("run-1")(d); d.burst = null }, {}, true],
    ["a reply marked by the holder it is asked about", (d) => { answered(d); marked("run-1")(d); d.burst = null }, { holder: "run-1" }, false],
    ["a lease an older version left, which nobody reads", (d) => { answered(d); d.lease = { runner: "tab", generation: 1, at: 0 } }, {}, false],
  ])("%s → %s", (_name, change, { canRun, holder }, work) => {
    const doc = spokenTo(change)
    expect(needsWork(doc, canRun, holder)).toBe(work)
  })
})

describe("whether there is work: a stop first", () => {
  /**
   * What a session can hold that is work for a runner, each alone. A call
   * claimed by a runner that is gone, a reply still marked by one, a call
   * cleared to run, results nobody took back to the model.
   */
  const WORK = [
    ["a call a dead runner left running", (d) => d.turns.push(makeTurn("assistant", [Object.assign(callBlock("poke", {}, { id: "c1" }), { status: CALL.running, runner: "gone" })]))],
    ["a reply a dead runner left marked", (d) => d.turns.push(Object.assign(makeTurn("assistant", [textBlock("half")]), { streaming: { runner: "gone" } }))],
    ["a call cleared to run", (d) => d.turns.push(makeTurn("assistant", [Object.assign(callBlock("look", {}, { id: "c1" }), { status: CALL.approved })]))],
    ["results not yet taken back", (d) => {
      d.turns.push(makeTurn("assistant", [Object.assign(callBlock("look", {}, { id: "c1" }), { status: CALL.done })]))
      d.turns.push(makeTurn("tool", [resultBlock("c1", "seen")]))
    }],
  ]
  const notice = (kind) => (d) => d.turns.push(makeTurn("assistant", [noticeBlock(kind, `stopped: ${kind}`)]))
  // The stop is written before the work's own turn and after it: a result
  // landing after a stop, or a mark a crossing run left, is still no work.
  const CASES = []
  for (const [what, add] of WORK) {
    CASES.push(["no stop", what, [add], true])
    for (const kind of Object.values(STOP)) {
      CASES.push([`a ${kind} stop after it`, what, [add, notice(kind)], false])
      CASES.push([`a ${kind} stop before it`, what, [notice(kind), add], false])
    }
  }
  it.each(CASES)("%s, with %s → work: %s", (_stop, _what, steps, work) => {
    const doc = spokenTo((d) => steps.forEach((step) => step(d)))
    expect(needsWork(doc)).toBe(work)
  })

  it.each(WORK)("a person's stop, written by stopSession over %s, leaves no work, and a message after it does", (_what, add) => {
    const doc = spokenTo(add)
    doc.burst = { run: "gone" }
    expect(stopSession(doc, STOP.stopped, null, "automerge:person")).toBe(true)
    expect([needsWork(doc), doc.burst, doc.turns.some((t) => t.streaming)]).toEqual([false, null, false])
    doc.turns.push(makeTurn("user", [textBlock("carry on")]))
    expect(needsWork(doc)).toBe(true)
  })
})
