/**
 * A call's moves: each is made from the states it names and from no other,
 * and a runner settles only a call that still carries its claim. Eight moves
 * by seven states, written out.
 */

import { describe, it, expect } from "vitest"
import { CALL } from "./schema.js"
import { callBlock } from "./blocks.js"
import { MOVES, move } from "./calls.js"

const STATES = Object.values(CALL)
const A = { runner: "tab-a", generation: 3 }
const B = { runner: "tab-b", generation: 4 }

/** A call in `status`, claimed by A if it has got as far as being claimed. */
const call = (status) => callBlock("a_tool", {}, { id: "c1", status, ...([CALL.running, CALL.done, CALL.error].includes(status) ? A : {}) })

describe("a call's moves", () => {
  it("are these, and end where they say", () => {
    expect(Object.fromEntries(Object.entries(MOVES).map(([name, step]) => [name, `${step.from.join("|")} → ${step.to}`]))).toEqual({
      approve: "pending → approved",
      deny: "pending → denied",
      claim: "approved → running",
      succeed: "running → done",
      fail: "running → error",
      release: "running → approved",
      abandon: "pending|asking|approved|running → error",
      answer: "asking → done",
    })
  })

  const cases = []
  for (const name of Object.keys(MOVES)) for (const from of STATES) cases.push([name, from, MOVES[name].from.includes(from)])

  it.each(cases)("%s from %s → made %s", (name, from, legal) => {
    const block = call(from)
    expect(move(block, name)).toBe(legal)
    expect(block.status).toBe(legal ? MOVES[name].to : from)
  })

  it("no move ends a call that has ended", () => {
    for (const ended of [CALL.done, CALL.error, CALL.denied]) {
      for (const name of Object.keys(MOVES)) expect(move(call(ended), name), `${name} from ${ended}`).toBe(false)
    }
  })

  it("a claim names the runner that made it", () => {
    const block = call(CALL.approved)
    expect(move(block, "claim", A)).toBe(true)
    expect([block.status, block.runner, block.generation]).toEqual([CALL.running, "tab-a", 3])
  })

  // Who may settle a claimed call: the claim it carries, or nobody in particular.
  it.each([
    ["succeed", A, true],
    ["succeed", B, false],
    ["succeed", { runner: "tab-a", generation: 4 }, false],
    ["fail", A, true],
    ["fail", B, false],
    ["release", A, true],
    ["release", B, false],
    ["release", null, true],
    ["abandon", null, true],
  ])("%s by %j → made %s", (name, by, made) => {
    const block = call(CALL.running)
    expect(move(block, name, by)).toBe(made)
    expect(block.status).toBe(made ? MOVES[name].to : CALL.running)
  })

  it("a call put back to run again is nobody's", () => {
    const block = call(CALL.running)
    move(block, "release", A)
    expect([block.status, block.runner, block.generation]).toEqual([CALL.approved, null, null])
  })

  it("a move that does not exist is a mistake, and no call at all is not", () => {
    expect(() => move(call(CALL.pending), "vanish")).toThrow(/No such move/)
    expect(move(null, "approve")).toBe(false)
  })
})
