import { describe, it, expect } from "vitest"
import {
  toRequest,
  resultsToKeepWhole,
  taperedResult,
  initSession,
  makeTurn,
  textBlock,
  callBlock,
  resultBlock,
  TAPER_ABOVE,
  RESULTS_HIGH,
  RESULTS_LOW,
  _resetIds,
} from "./session.js"
import { sessionRecall } from "./tools/recall.js"

const big = (n) => "x".repeat(n)

/** A session of call/result pairs, oldest first. */
function sessionOf(results) {
  _resetIds()
  const doc = {}
  initSession(doc, {})
  doc.turns = [makeTurn("user", [textBlock("go")])]
  results.forEach(({ output, ...rest }, i) => {
    const id = `c${i}`
    doc.turns.push(makeTurn("assistant", [callBlock("fs_read", { path: `f${i}.js` }, { id })]))
    doc.turns.push(makeTurn("tool", [resultBlock(id, output, { summary: `read f${i}.js`, ...rest })]))
  })
  return doc
}

const allResults = (doc) => doc.turns.flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "result"))
const outputsSent = (doc) =>
  toRequest(doc, { system: "" })
    .messages.flatMap((m) => m.content ?? [])
    .filter((p) => p.type === "result")
    .map((p) => p.output)

describe("which results still travel in full", () => {
  it("never touches a small one", () => {
    // Dropping a short result saves nothing and costs the model context it can
    // use, however old it is.
    const doc = sessionOf(Array.from({ length: 50 }, () => ({ output: big(100) })))
    const kept = resultsToKeepWhole(allResults(doc), {})
    expect(kept.size).toBe(50)
  })

  it("keeps large results whole until they pass the high mark, then shortens the oldest in one batch", () => {
    const doc = sessionOf(Array.from({ length: 10 }, () => ({ output: big(20000) })))
    const results = allResults(doc)
    // 20,000 each: whole up to 8 of them (160,000); the 9th tips it over, and
    // the oldest go until what is whole is under 80,000 — the newest 4.
    for (let n = 1; n <= 8; n++) expect(resultsToKeepWhole(results.slice(0, n), {}).size).toBe(n)
    expect([...resultsToKeepWhole(results.slice(0, 9), {})]).toEqual(results.slice(5, 9).map((r) => r.id))
    expect([...resultsToKeepWhole(results, {})]).toEqual(results.slice(5, 10).map((r) => r.id))
  })

  it("spends the marks on large results only", () => {
    // A thousand tiny results must not crowd out a big recent one.
    const doc = sessionOf([
      { output: big(150000) },
      ...Array.from({ length: 100 }, () => ({ output: big(200) })),
      { output: big(30000) },
    ])
    const results = allResults(doc)
    const kept = resultsToKeepWhole(results, {})
    expect(kept.has(results.at(-1).id)).toBe(true)
    expect(kept.has(results[0].id)).toBe(false)
    expect([...kept]).toHaveLength(101) // the newest big one plus every small one
  })

  it("never shortens the result just added, however large", () => {
    const doc = sessionOf([{ output: big(500000) }, { output: big(500000) }])
    const results = allResults(doc)
    expect([...resultsToKeepWhole(results.slice(0, 1), {})]).toEqual([results[0].id])
    expect([...resultsToKeepWhole(results, {})]).toEqual([results[1].id])
  })

  it("never shortens a pinned result", () => {
    const doc = sessionOf(Array.from({ length: 12 }, () => ({ output: big(20000) })))
    const results = allResults(doc)
    results[0].pinned = true // what session_recall sets when the agent asks for it back
    expect(resultsToKeepWhole(results, {}).has(results[0].id)).toBe(true)
  })

  it("is configurable, and can be turned off", () => {
    const doc = sessionOf(Array.from({ length: 10 }, () => ({ output: big(20000) })))
    const results = allResults(doc)
    // Marks 100,000 / 50,000: the 6th tips it (120,000) down to 40,000; the 10th
    // tips it again, down to the newest two.
    expect(resultsToKeepWhole(results, { resultsHigh: 100000, resultsLow: 50000 }).size).toBe(2)
    expect(resultsToKeepWhole(results, { taperAbove: Number.MAX_SAFE_INTEGER }).size).toBe(10)
  })

  it("uses defaults that are actually the defaults", () => {
    expect(TAPER_ABOVE).toBe(2000)
    expect(RESULTS_HIGH).toBe(160000)
    expect(RESULTS_LOW).toBe(80000)
  })
})

/**
 * The rules, over every sequence of result sizes up to length 7 from a small
 * alphabet, with small marks (above 2, high 10, low 5): a result is small (1),
 * large (3) or larger than the high mark on its own (12).
 */
describe("batching, over every small transcript", () => {
  const config = { taperAbove: 2, resultsHigh: 10, resultsLow: 5 }
  const SIZES = [1, 3, 12]
  function* sequences(n) {
    if (n === 0) { yield []; return }
    for (const rest of sequences(n - 1)) for (const s of SIZES) yield [...rest, s]
  }
  const blocks = (sizes) => sizes.map((n, i) => ({ id: `r${i}`, output: "x".repeat(n) }))
  const shortened = (results) => {
    const kept = resultsToKeepWhole(results, config)
    return new Set(results.filter((r) => !kept.has(r.id)).map((r) => r.id))
  }

  it("holds every rule for every sequence", () => {
    let count = 0
    for (let n = 1; n <= 7; n++) {
      for (const sizes of sequences(n)) {
        const results = blocks(sizes)
        for (let k = 1; k <= results.length; k++) {
          const before = shortened(results.slice(0, k - 1))
          const after = shortened(results.slice(0, k))
          const newest = results[k - 1]
          // Once shortened, always shortened: each prefix's choice is in the next.
          for (const id of before) expect(after.has(id)).toBe(true)
          // Small results and the newest one always travel whole.
          for (const r of results.slice(0, k)) if (r.output.length <= 2) expect(after.has(r.id)).toBe(false)
          expect(after.has(newest.id)).toBe(false)
          // What stays whole (large) is within the high mark, unless it is the newest alone.
          const wholeLarge = results.slice(0, k).filter((r) => r.output.length > 2 && !after.has(r.id))
          const wholeChars = wholeLarge.reduce((sum, r) => sum + r.output.length, 0)
          expect(wholeChars <= 10 || wholeLarge.length === 1).toBe(true)
          // In batches: when anything new is shortened, what stays whole drops to the low mark (or to the newest alone).
          if (after.size > before.size) expect(wholeChars <= 5 || wholeLarge.length === 1).toBe(true)
          count++
        }
      }
    }
    expect(count).toBe([1, 2, 3, 4, 5, 6, 7].reduce((sum, n) => sum + n * 3 ** n, 0))
  })
})

describe("what replaces an elided result", () => {
  it("says what the call was, that this is an elision, and how to get it back", () => {
    const text = taperedResult({
      callId: "c12",
      output: big(16336),
      summary: "read src/pages/DotsPlayground.tsx · 880 lines",
    })
    expect(text).toContain("Not re-sent in full")
    expect(text).toContain("read src/pages/DotsPlayground.tsx · 880 lines")
    expect(text).toContain("16336 characters elided")
    // Two routes, and the difference is the point: one is free and returns what
    // this call said, the other does the work again and returns what is true now.
    expect(text).toContain("session_recall")
    expect(text).toContain("make the call again for the current state")
  })

  it("names source_read on the kept source, which reads any part of it", () => {
    const text = taperedResult({
      callId: "c3",
      output: big(9000),
      summary: "fetched adjointlabs.com · 8.8 kB",
      doc: { url: "automerge:saved1", kind: "source" },
    })
    expect(text).toContain('The content is kept at automerge:saved1: read it with source_read {source:"automerge:saved1", offset:0}, or search it with find.')
    // The other two routes are still offered, in the same words.
    expect(text).toContain("session_recall with callId c3 ")
  })

  it("only points at a document a call made that is not a kept source", () => {
    const text = taperedResult({
      output: big(9000),
      summary: "wrote 3 files",
      doc: { url: "automerge:pkg", kind: "file" },
    })
    expect(text).toContain("It made automerge:pkg.")
    expect(text).not.toContain("source_read")
  })

  it("still says something useful for a result with no summary", () => {
    expect(taperedResult({ output: big(5000) })).toContain("an earlier tool result")
  })
})

describe("the request that comes out", () => {
  it("cuts the weight without dropping any result", () => {
    const doc = sessionOf(Array.from({ length: 10 }, () => ({ output: big(20000) })))
    const sent = outputsSent(doc)

    expect(sent).toHaveLength(10) // every call still has an answer
    // One batch at the 9th (180,000 > 160,000) down to the newest four; the 10th joins them.
    expect(sent.filter((o) => o.startsWith("[Not re-sent"))).toHaveLength(5)
    expect(JSON.stringify(sent).length).toBeLessThan(0.55 * 10 * 20000)
  })

  it("leaves every call paired with a result, which is a protocol requirement", () => {
    const doc = sessionOf(Array.from({ length: 6 }, () => ({ output: big(20000) })))
    const parts = toRequest(doc, { system: "" }).messages.flatMap((m) => m.content ?? [])
    const calls = parts.filter((p) => p.type === "call").map((p) => p.id)
    const answers = parts.filter((p) => p.type === "result").map((p) => p.callId)
    expect(answers.sort()).toEqual(calls.sort())
  })

  it("keeps the call's own arguments beside the stand-in, so it can be repeated", () => {
    // This is why the stand-in does not need to restate the arguments: the call
    // that produced it is right there in the message before.
    const doc = sessionOf(Array.from({ length: 6 }, () => ({ output: big(20000) })))
    const parts = toRequest(doc, { system: "" }).messages.flatMap((m) => m.content ?? [])
    const firstCall = parts.find((p) => p.type === "call")
    expect(firstCall.input).toEqual({ path: "f0.js" })
  })

  it("does not change a short session at all", () => {
    const doc = sessionOf([{ output: "small" }, { output: "also small" }])
    expect(outputsSent(doc)).toEqual(["small", "also small"])
  })

  it("keeps an elided failure marked as a failure", () => {
    const doc = sessionOf([
      { output: big(30000), isError: true },
      ...Array.from({ length: 5 }, () => ({ output: big(30000) })),
    ])
    const parts = toRequest(doc, { system: "" })
      .messages.flatMap((m) => m.content ?? [])
      .filter((p) => p.type === "result")
    expect(parts[0].output).toContain("Not re-sent in full")
    expect(parts[0].isError).toBe(true)
  })

  it("taper and the screenshot rule do not fight", () => {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("go")])]
    for (let i = 0; i < 6; i++) {
      doc.turns.push(makeTurn("assistant", [callBlock("view_mount", {}, { id: `c${i}` })]))
      doc.turns.push(
        makeTurn("tool", [
          resultBlock(`c${i}`, big(30000), { summary: `mount ${i}`, image: "data:image/jpeg;base64,AAA" }),
        ])
      )
    }
    const parts = toRequest(doc, { system: "" })
      .messages.flatMap((m) => m.content ?? [])
      .filter((p) => p.type === "result")

    // Oldest: text elided AND image dropped, each said once.
    expect(parts[0].output).toContain("Not re-sent in full")
    expect(parts[0].output).toContain("screenshot from earlier")
    expect(parts[0].image).toBeUndefined()
    // Newest: both intact.
    expect(parts.at(-1).image).toBeTruthy()
    expect(parts.at(-1).output).not.toContain("Not re-sent")
  })
})

describe("getting an elided result back", () => {
  function sessionWith(output, { summary = "read big.js" } = {}) {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns = [
      makeTurn("user", [textBlock("go")]),
      makeTurn("assistant", [callBlock("fs_read", { path: "big.js" }, { id: "c1" })]),
      makeTurn("tool", [resultBlock("c1", output, { summary })]),
    ]
    const repo = { async find() { return { doc: () => doc } } }
    return { doc, ctx: { repo, sessionUrl: "automerge:session" } }
  }

  it("returns exactly what the call said, without running anything", async () => {
    const { ctx } = sessionWith("the original contents")
    const out = await sessionRecall.execute({ callId: "c1" }, ctx)
    expect(out).toContain("the original contents")
    expect(out).toContain("fs_read returned this earlier (call c1)")
  })

  it("marks it as history rather than letting it pass for fresh", async () => {
    // A stale value served as a current one is worse than no value: the model
    // asks what a document says now and is handed what it said an hour ago.
    const { ctx } = sessionWith("old contents")
    const out = await sessionRecall.execute({ callId: "c1" }, ctx)
    expect(out).toContain("what it said at the time, not the current state")
  })

  it("pages through a long one and says how much is left", async () => {
    const { ctx } = sessionWith("y".repeat(30000))
    const out = await sessionRecall.execute({ callId: "c1", offset: 0, limit: 100 }, ctx)
    expect(out).toContain("characters 0–100 of 30000")
    expect(out).toContain("29900 remaining; recall again with offset: 100")

    const end = await sessionRecall.execute({ callId: "c1", offset: 29950 }, ctx)
    expect(end).toContain("characters 29950–30000 of 30000")
    expect(end).not.toContain("remaining")
  })

  it("lists what it could have recalled when the id is wrong", async () => {
    const { ctx } = sessionWith("contents")
    await expect(sessionRecall.execute({ callId: "c99" }, ctx)).rejects.toThrow(
      /No result for call 'c99'.*Calls with results: c1/s
    )
  })

  it("says plainly when the runner cannot see the conversation", async () => {
    await expect(sessionRecall.execute({ callId: "c1" }, { repo: {} })).rejects.toThrow(/cannot reach the conversation/)
  })

  it("closes the loop: what the stand-in points at is what comes back", async () => {
    const original = "z".repeat(9000)
    const { doc, ctx } = sessionWith(original)
    const result = doc.turns.at(-1).blocks[0]

    const standIn = taperedResult(result)
    const id = standIn.match(/callId (\S+?) /)[1]
    const recalled = await sessionRecall.execute({ callId: id }, ctx)

    expect(recalled).toContain(original)
  })
})
