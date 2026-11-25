import { describe, it, expect } from "vitest"
import { turnFor } from "./runner.js"
import { initSession, SCHEMA_VERSION } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"

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
    ["another runner holds it, and is live", { held: "other" }, { live: () => true }, {}],
  ])("not when %s", (name, session, self, expected) => {
    const doc = spokenTo((d) => {
      if (session.answered) d.turns.push(makeTurn("assistant", [textBlock("done")]))
      if (session.hostCall) d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "look", input: {}, where: "host", status: "approved", runner: null, generation: null }]))
      if (session.unknown) d.turns.push(makeTurn("user", [{ type: "hologram", id: "h1" }]))
      if (session.version) d.schemaVersion = session.version
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
