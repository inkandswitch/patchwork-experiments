import { describe, it, expect } from "vitest"
import { turnFor, needsWork } from "./runner.js"
import { initSession, SCHEMA_VERSION, CALL } from "../session/schema.js"
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

const me = { runnerUrl: "me", canRun: () => true }
const lease = (runner) => ({ runner, generation: 1, at: 0 })

describe("whether a runner takes a session now", () => {
  it("takes one that has work, when nothing stands in the way", () => {
    expect(turnFor(spokenTo(), me)).toEqual({ take: true, ours: false })
    expect(turnFor(spokenTo((d) => { d.lease = lease("me") }), me)).toEqual({ take: true, ours: true })
  })

  // Each row changes one thing from the session above, and it alone decides.
  it.each([
    ["it is retiring", {}, { retired: true }, {}],
    ["it has no key", {}, { hasKey: false }, {}],
    ["there is no work: the agent spoke last", { answered: true }, {}, {}],
    ["the work is for a tier it cannot run", { hostCall: true }, { canRun: (where) => where === "worker" }, {}],
    ["it is backing off for the network", {}, { backingOff: true }, { wait: true }],
    ["a block is of a kind it cannot read", { unknown: true }, {}, { outdated: { unknown: ["hologram"] } }],
    ["the session is in another version's shape", { version: SCHEMA_VERSION + 1 }, {}, { outdated: { schemaVersion: SCHEMA_VERSION + 1 } }],
    ["the session is from before versions were stamped", { version: null }, {}, { outdated: { schemaVersion: 1 } }],
    ["another runner holds it, and is live", { held: "other" }, { live: () => true }, {}],
  ])("not when %s", (name, session, self, expected) => {
    const doc = spokenTo((d) => {
      if (session.answered) d.turns.push(makeTurn("assistant", [textBlock("done")]))
      if (session.hostCall) d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "look", input: {}, where: "host", status: "approved", runner: null, generation: null }]))
      if (session.unknown) d.turns.push(makeTurn("user", [{ type: "hologram", id: "h1" }]))
      if (session.version) d.schemaVersion = session.version
      if (session.version === null) delete d.schemaVersion
      if (session.held) d.lease = lease(session.held)
    })
    expect(turnFor(doc, { ...me, ...self })).toEqual(expected)
  })

  it("takes one whose holder has gone quiet", () => {
    const doc = spokenTo((d) => { d.lease = lease("other") })
    expect(turnFor(doc, { ...me, live: () => false })).toEqual({ take: true, ours: false })
  })

  it("in that order: a runner with nothing to do says nothing of versions, and one backing off does not give up its place", () => {
    const outdated = spokenTo((d) => { d.schemaVersion = SCHEMA_VERSION + 1 })
    expect(turnFor(outdated, { ...me, hasKey: false })).toEqual({})
    expect(turnFor(outdated, { ...me, backingOff: true })).toEqual({ wait: true })
    const heldAndOutdated = spokenTo((d) => { d.schemaVersion = SCHEMA_VERSION + 1; d.lease = lease("other") })
    expect(turnFor(heldAndOutdated, { ...me, live: () => true })).toEqual({ outdated: { schemaVersion: SCHEMA_VERSION + 1 } })
  })
})

describe("whether there is work: a stop first", () => {
  /**
   * What a session can hold that is work for a runner, each alone. A call
   * claimed by a runner that is gone, a reply still marked by one, a call
   * cleared to run, results nobody took back to the model.
   */
  const WORK = [
    ["a call a dead runner left running", (d) => d.turns.push(makeTurn("assistant", [Object.assign(callBlock("poke", {}, { id: "c1" }), { status: CALL.running, runner: "gone", generation: 1 })]))],
    ["a reply a dead runner left marked", (d) => d.turns.push(Object.assign(makeTurn("assistant", [textBlock("half")]), { streaming: { runner: "gone", generation: 1 } }))],
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
    doc.lease = { runner: "gone", generation: 1, at: 0 }
    expect(stopSession(doc, STOP.stopped, null, "automerge:person")).toBe(true)
    expect([needsWork(doc), doc.lease, doc.turns.some((t) => t.streaming)]).toEqual([false, null, false])
    doc.turns.push(makeTurn("user", [textBlock("carry on")]))
    expect(needsWork(doc)).toBe(true)
  })
})
