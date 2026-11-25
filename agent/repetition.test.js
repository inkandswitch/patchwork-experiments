import { describe, it, expect } from "vitest"
import { run, OUTCOME, REPEAT_WINDOW, repeatsItself } from "./kernel/loop.js"
import { memoryStore } from "./kernel/store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, STATUS, _resetIds } from "./session/schema.js"
import { claimLease } from "./session/lease.js"
import { makeTurn, textBlock } from "./session/blocks.js"

function toolset(tools = []) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: [], get: (id) => byId.get(id) ?? null }
}

const editTool = { id: "fs_edit", name: "Edit", where: "worker", risk: "write", execute: async () => "edited" }

function session() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "T", subject: "automerge:subject" })
  doc.turns = [makeTurn("user", [textBlock("fix the bug")])]
  doc.grants = { fs_edit: "always" }
  claimLease(doc, "local", Date.now())
  return memoryStore(doc)
}

const transcript = (store) =>
  store.doc().turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))

// The paragraph a real session emitted three times, give or take a word.
const LOOP =
  "Easiest reliable path: rewrite tool.js with fs_write (overwrite via url). But 506 lines to re-emit. " +
  "Alternative: compute the offset myself from the original content I authored. Counting characters manually is error-prone. " +
  "Best idea: Just rewrite tool.js with fs_write using `url` param. One call. Do it. Actually wait — "

/** Reasoning that goes round the same paragraph `times` times, a few words at a time. */
const circling = (times) => {
  const text = Array.from({ length: times }, (_, i) => `${LOOP}(${i % 2 ? "hmm" : "but"}) `).join("")
  return text.match(/.{1,40}/gs).map((delta) => ({ type: "reasoning", delta }))
}

/** A long, varied think: distinct sentences, no repeats. */
const varied = (sentences) =>
  Array.from({ length: sentences }, (_, i) => ({
    type: "reasoning",
    delta: `Step ${i}: consider option ${String.fromCharCode(65 + (i % 26))}${i} which differs from the others in detail ${i * 7}. `,
  }))

describe("repeatsItself", () => {
  it("is quiet on ordinary prose and on short text", () => {
    expect(repeatsItself("short")).toBe(false)
    const prose = varied(60).map((e) => e.delta).join("")
    expect(prose.length).toBeGreaterThan(REPEAT_WINDOW * 4)
    expect(repeatsItself(prose)).toBe(false)
  })

  it("fires when the last window of text already appeared earlier in the turn", () => {
    expect(repeatsItself(LOOP + LOOP)).toBe(true)
    expect(LOOP.length).toBeGreaterThan(REPEAT_WINDOW)
  })

  it("ignores runs of whitespace and padding, which repeat legitimately", () => {
    expect(repeatsItself(" ".repeat(600))).toBe(false)
    expect(repeatsItself(("| --- ".repeat(6) + "\n").repeat(20))).toBe(false)
  })

  it("can be turned off", () => {
    expect(repeatsItself(LOOP + LOOP, 0)).toBe(false)
  })
})

describe("a model that goes round in circles", () => {
  it("is stopped mid-turn and told to act, and then does", async () => {
    const store = session()
    const provider = makeMock([
      [...circling(4), { type: "call", id: "c1", name: "fs_edit", input: { path: "tool.js", edits: [{ op: "replace", find: "a", text: "b" }] } }],
      [{ type: "call", id: "c2", name: "fs_edit", input: { path: "tool.js", edits: [{ op: "replace", find: "a", text: "b" }] } }],
      [{ type: "text", delta: "Fixed." }],
    ])

    const events = []
    const result = await run({
      store,
      provider,
      toolset: toolset([editTool]),
      canRun: () => true,
      flushMs: 0,
      onEvent: (e) => events.push(e),
    })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(events.some((e) => e.type === "repeating")).toBe(true)

    const blocks = transcript(store)
    // The call queued behind the looping thought was never committed: the
    // stream was abandoned before it arrived.
    expect(blocks.filter((b) => b.type === "call")).toHaveLength(1)
    expect(blocks.find((b) => b.type === "call").id).toBe("c2")

    const nudge = blocks.find((b) => b.role === "user" && /repeating yourself/.test(b.text ?? ""))
    expect(nudge).toBeTruthy()
    expect(nudge.text).toMatch(/make the tool call now/)

    // What it did stream stays in the transcript: it is what happened.
    const thought = blocks.find((b) => b.type === "reasoning")
    expect(thought.text).toContain("Best idea")
    // …but the loop stopped it well short of the whole script.
    expect(thought.text.length).toBeLessThan(circling(4).reduce((n, e) => n + e.delta.length, 0))
  })

  it("gives up after the second loop, saying what to change", async () => {
    const store = session()
    const provider = makeMock([circling(4), circling(4), [{ type: "text", delta: "never reached" }]])

    const result = await run({ store, provider, toolset: toolset([editTool]), canRun: () => true, flushMs: 0 })

    expect(result.outcome).toBe(OUTCOME.repetition)
    expect(store.doc().status).toBe(STATUS.error)
    expect(provider.turnsUsed).toBe(2)
    const last = transcript(store).at(-1)
    expect(last.role).toBe("assistant")
    expect(last.text).toMatch(/kept repeating itself/)
    expect(last.text).toMatch(/repetition_penalty/)
  })

  it("leaves a long but varied think alone", async () => {
    const store = session()
    const provider = makeMock([
      [...varied(80), { type: "call", id: "c1", name: "fs_edit", input: { path: "t", edits: [{ op: "replace", find: "a", text: "b" }] } }],
      [{ type: "text", delta: "Done." }],
    ])
    const result = await run({ store, provider, toolset: toolset([editTool]), canRun: () => true, flushMs: 0 })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(transcript(store).some((b) => /repeating yourself/.test(b.text ?? ""))).toBe(false)
  })

  it("can be switched off per run", async () => {
    const store = session()
    const provider = makeMock([[...circling(4), { type: "text", delta: "ok" }]])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0, repeatWindow: 0 })
    expect(transcript(store).some((b) => /repeating yourself/.test(b.text ?? ""))).toBe(false)
  })
})

describe("what the loop knows about the model", () => {
  it("passes the model's capabilities to the provider with every request", async () => {
    const store = session()
    const provider = makeMock([[{ type: "text", delta: "hi" }]])
    const modelInfo = { id: "x/y", supports: ["temperature", "tools"], maxOutput: 4096, defaults: { temperature: 1 }, efforts: ["high"] }
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0, modelInfo })
    expect(provider.requests[0].capabilities).toEqual({ supports: ["temperature", "tools"], maxOutput: 4096, efforts: ["high"] })
  })

  it("sends no capabilities when it has no opinion", async () => {
    const store = session()
    const provider = makeMock([[{ type: "text", delta: "hi" }]])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })
    expect(provider.requests[0].capabilities).toBeNull()
  })

  it("does not ask for more output than the model can produce when recovering from a cut-off", async () => {
    const store = session()
    store.doc().config.params = { maxTokens: 8192 }
    const provider = makeMock([
      [{ type: "text", delta: "I will start by" }, { type: "stop", reason: "length" }],
      [{ type: "text", delta: "Done." }],
    ])
    await run({
      store,
      provider,
      toolset: toolset(),
      canRun: () => true,
      flushMs: 0,
      modelInfo: { id: "small/model", supports: null, maxOutput: 10000 },
    })
    expect(provider.requests[1].params.maxTokens).toBe(10000)
  })
})
