/**
 * Recall restores the original in place instead of copying it.
 *
 * Seen in a real step: it read three files, lost them to shortening, recalled
 * them, lost the recalls, and recalled the recalls — the same files four to
 * seven times each.
 */
import { describe, it, expect } from "vitest"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock } from "../session/blocks.js"
import { toRequest, resultsToKeepWhole, pinResult } from "../session/request.js"
import { storeRecall } from "../kernel/loop.js"
import { memoryStore } from "../kernel/store.js"
import { sessionRecall, originalResult, RESTORE_LIMIT } from "./recall.js"

const big = (n, ch = "x") => ch.repeat(n)

/** A session whose first results have been shortened by later, larger ones. */
function session(sizes) {
  _resetIds()
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("go")])]
  sizes.forEach((size, i) => {
    doc.turns.push(makeTurn("assistant", [callBlock("fs_read", { path: `f${i}.js` }, { id: `c${i}` })]))
    doc.turns.push(makeTurn("tool", [resultBlock(`c${i}`, big(size, String.fromCharCode(97 + i)), { summary: `read f${i}.js` })]))
  })
  const store = memoryStore(doc)
  return { doc: () => store.doc(), store, ctx: { recall: storeRecall(store) } }
}

const sentWhole = (doc, callId) =>
  toRequest(doc).messages.flatMap((m) => m.content ?? []).find((p) => p.type === "result" && p.callId === callId)?.output

describe("recalling a shortened result", () => {
  // Nine reads of 20,000: the ninth tips the batch, and the first five are shortened.
  const SIZES = Array(9).fill(20000)

  it("restores it in full where it was, and it stays in full", async () => {
    const { doc, ctx } = session(SIZES)
    expect(sentWhole(doc(), "c0")).toMatch(/^\[Not re-sent in full/)

    const out = await sessionRecall.execute({ callId: "c0" }, ctx)
    expect(out).toMatch(/^Restored the result of fs_read \(call c0\) in full where it was above: 20000 characters/)
    expect(out.length).toBeLessThan(400) // a line, not a copy
    expect(sentWhole(doc(), "c0")).toBe(big(20000, "a"))
  })

  it("following a recall back to what it recalled", async () => {
    const { doc, store, ctx } = session(SIZES)
    // An older conversation recalled c0 the old way, as a copy.
    store.change((d) => {
      d.turns.push(makeTurn("assistant", [callBlock("session_recall", { callId: "c0" }, { id: "r1" })]))
      d.turns.push(makeTurn("tool", [resultBlock("r1", "fs_read returned this earlier … " + big(20000, "a"))]))
    })
    expect(originalResult(doc().turns, "r1")).toMatchObject({ callId: "c0", viaRecall: true })
    const out = await sessionRecall.execute({ callId: "r1" }, ctx)
    expect(out).toContain("fs_read (call c0), which r1 had recalled")
    expect(sentWhole(doc(), "c0")).toBe(big(20000, "a"))
  })

  it("says so, and changes nothing, when the result is already in full", async () => {
    const { doc, ctx } = session(SIZES)
    const out = await sessionRecall.execute({ callId: "c8" }, ctx)
    expect(out).toMatch(/already in full above/)
    expect(doc().pinSeq).toBeUndefined()
  })

  it("pages one too long to restore, as before", async () => {
    const { doc, ctx } = session([RESTORE_LIMIT + 1, ...SIZES])
    expect(resultsToKeepWhole(doc().turns.flatMap((t) => t.blocks.filter((b) => b.type === "result")), {}).size).toBeLessThan(10)
    const out = await sessionRecall.execute({ callId: "c0" }, ctx)
    expect(out).toContain(`characters 0–12000 of ${RESTORE_LIMIT + 1}`)
    expect(doc().pinSeq).toBeUndefined()
  })

  it("pages when asked to, even for a small one", async () => {
    const { ctx } = session(SIZES)
    const out = await sessionRecall.execute({ callId: "c0", offset: 100, limit: 50 }, ctx)
    expect(out).toContain("characters 100–150 of 20000")
  })
})

describe("pins", () => {
  it("are let go oldest first when they pass the budget, never the one just pinned", () => {
    const { doc, store } = session([30000, 30000, 30000])
    const ids = doc().turns.flatMap((t) => t.blocks.filter((b) => b.type === "result")).map((b) => b.id)
    let outcome
    store.change((d) => { outcome = pinResult(d, ids[0], { budget: 60000 }) })
    expect(outcome).toEqual({ pinned: true, released: [] })
    store.change((d) => { outcome = pinResult(d, ids[1], { budget: 60000 }) })
    expect(outcome.released).toEqual([])
    store.change((d) => { outcome = pinResult(d, ids[2], { budget: 60000 }) })
    expect(outcome.released).toEqual([ids[0]])
    const pinned = doc().turns.flatMap((t) => t.blocks.filter((b) => b.pinned)).map((b) => b.id)
    expect(pinned).toEqual([ids[1], ids[2]])
  })

  it("a pin larger than the budget on its own is still kept: it is what was just asked for", () => {
    const { doc, store } = session([30000])
    const id = doc().turns.at(-1).blocks[0].id
    let outcome
    store.change((d) => { outcome = pinResult(d, id, { budget: 10 }) })
    expect(outcome).toEqual({ pinned: true, released: [] })
  })
})
