import { describe, it, expect } from "vitest"
import { run, OUTCOME, MAX_OUTPUT_TOKENS } from "../kernel/loop.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { buildBody } from "./openrouter.js"
import { initSession, STATUS, _resetIds } from "../session/schema.js"
import { claimLease } from "../session/lease.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { settled } from "../fixtures/session.js"

function toolset(tools = []) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: [], get: (id) => byId.get(id) ?? null }
}

const editTool = { id: "doc_edit", name: "Edit", where: "worker", risk: "write", execute: async () => "edited" }

function session() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "T", subject: "automerge:subject" })
  doc.turns = [makeTurn("user", [textBlock("do the thing")])]
  claimLease(doc, "local", Date.now())
  return memoryStore(doc)
}

/** A turn that runs out of output budget partway through. */
const cutOff = (text) => [
  { type: "text", delta: text },
  { type: "stop", reason: "length" },
]

const transcript = (store) =>
  store
    .doc()
    .turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))

describe("a model that runs out of output budget", () => {
  it("does not present a cut-off turn as a finished one", async () => {
    // What a person saw before this: an agent that wrote a long plan and then
    // did none of it, with nothing anywhere saying it had been cut off.
    const store = session()
    const provider = makeMock([
      cutOff("Here is my plan:\n1. Read the document\n2. Then I will"),
      [{ type: "call", id: "c1", name: "doc_edit", input: { url: "automerge:subject" } }],
      [{ type: "text", delta: "Done." }],
    ])

    const result = await run({ store, provider, toolset: toolset([editTool]), canRun: () => true, flushMs: 0 })

    expect(result.outcome).not.toBe(OUTCOME.idle)
    expect(transcript(store).some((b) => b.type === "call" && b.tool === "doc_edit")).toBe(true)
  })

  it("tells the model to carry on rather than restate the plan", async () => {
    const store = session()
    const provider = makeMock([cutOff("I will start by"), [{ type: "text", delta: "Done." }]])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    const nudge = transcript(store).find((b) => b.role === "user" && /cut off/i.test(b.text ?? ""))
    expect(nudge).toBeTruthy()
    expect(nudge.text).toMatch(/Continue from where you stopped/)
    expect(nudge.text).toMatch(/Do not restate the plan/)
  })

  it("asks for more room than the attempt that ran out", async () => {
    const store = session()
    store.doc().config.params = { maxTokens: 8192 }
    const provider = makeMock([cutOff("thinking…"), [{ type: "text", delta: "Done." }]])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    expect(provider.requests[0].params.maxTokens).toBe(8192)
    expect(provider.requests[1].params.maxTokens).toBe(16384)
  })

  it("does not raise the budget without limit", async () => {
    const store = session()
    store.doc().config.params = { maxTokens: MAX_OUTPUT_TOKENS }
    const provider = makeMock([cutOff("a"), cutOff("b"), [{ type: "text", delta: "Done." }]])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    for (const request of provider.requests) {
      expect(request.params.maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS)
    }
  })

  it("gives up after a bounded number of tries, and says what to change", async () => {
    // A model whose thinking never fits would otherwise truncate forever.
    const store = session()
    const provider = makeMock([cutOff("a"), cutOff("b"), cutOff("c"), cutOff("d"), cutOff("e")])

    const result = await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    expect(result.outcome).toBe(OUTCOME.truncated)
    expect(settled(store.doc())).toBe(STATUS.error)

    const explanation = transcript(store).at(-1).text
    expect(explanation).toMatch(/Cut off by the model's output limit/)
    expect(explanation).toMatch(/params\.maxTokens/)
    expect(explanation).toMatch(/params\.reasoning/)
  })

  it("honours a caller's limit on how many times it retries", async () => {
    const store = session()
    const provider = makeMock([cutOff("a"), cutOff("b"), cutOff("c")])
    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0, maxTruncations: 0 })

    expect(provider.turnsUsed).toBe(1)
  })

  it("reports each cut-off so a watcher can see it happening", async () => {
    const events = []
    const store = session()
    const provider = makeMock([cutOff("a"), [{ type: "text", delta: "Done." }]])
    await run({
      store,
      provider,
      toolset: toolset(),
      canRun: () => true,
      flushMs: 0,
      onEvent: (e) => events.push(e),
    })
    expect(events.filter((e) => e.type === "truncated")).toHaveLength(1)
  })

  it("leaves an ordinary finish alone", async () => {
    const store = session()
    const provider = makeMock([[{ type: "text", delta: "Done." }]])
    const result = await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(transcript(store).some((b) => /cut off/i.test(b.text ?? ""))).toBe(false)
  })
})

describe("controlling how much a model thinks", () => {
  const base = { system: "", messages: [], model: "z-ai/glm-4.6" }

  it("passes a reasoning budget through to the provider", () => {
    expect(buildBody({ ...base, params: { reasoning: { max_tokens: 1024 } } }).reasoning).toEqual({
      max_tokens: 1024,
    })
    expect(buildBody({ ...base, params: { reasoning: { effort: "low" } } }).reasoning).toEqual({ effort: "low" })
  })

  it("sends nothing when no budget is set, so a model keeps its own default", () => {
    expect(buildBody({ ...base, params: {} })).not.toHaveProperty("reasoning")
  })

  it("still sends the output budget beside it", () => {
    const body = buildBody({ ...base, params: { maxTokens: 16384, reasoning: { effort: "low" } } })
    expect(body.max_tokens).toBe(16384)
    expect(body.reasoning).toEqual({ effort: "low" })
  })
})

describe("a tool call cut off mid-arguments", () => {
  // The failure a 120-token budget produced against a real model: the call
  // block starts, so finish_reason is `tool_calls` and not `length`, but the
  // JSON arguments never finish. It used to be committed with `{}` and the tool
  // failed with something irrelevant — "Pass at least one op" for an edit whose
  // ops never arrived.
  const halfCall = [
    { type: "text", delta: "I'll edit it." },
    { type: "call", id: "c1", name: "doc_edit", input: {}, parseError: "Unexpected end of JSON input" },
    { type: "stop", reason: "tool_use" },
  ]

  it("does not run a call whose arguments never arrived", async () => {
    const store = session()
    let ran = 0
    const tool = { ...editTool, execute: async () => { ran++; return "edited" } }
    const provider = makeMock([halfCall, [{ type: "text", delta: "Done." }]])

    await run({ store, provider, toolset: toolset([tool]), canRun: () => true, flushMs: 0 })

    expect(ran).toBe(0)
    expect(transcript(store).some((b) => b.type === "call")).toBe(false)
  })

  it("asks for the call again, and for smaller arguments", async () => {
    const store = session()
    const provider = makeMock([halfCall, [{ type: "text", delta: "Done." }]])
    await run({ store, provider, toolset: toolset([editTool]), canRun: () => true, flushMs: 0 })

    const nudge = transcript(store).find((b) => b.role === "user" && /cut off/i.test(b.text ?? ""))
    expect(nudge.text).toMatch(/doc_edit call was cut off/)
    expect(nudge.text).toMatch(/keep the arguments small/)
  })

  it("keeps the text the model did manage to write", async () => {
    const store = session()
    const provider = makeMock([halfCall, [{ type: "text", delta: "Done." }]])
    await run({ store, provider, toolset: toolset([editTool]), canRun: () => true, flushMs: 0 })
    expect(transcript(store).some((b) => b.text === "I'll edit it.")).toBe(true)
  })

  it("says where it was cut off, so a watcher can tell the two apart", async () => {
    const events = []
    const store = session()
    await run({
      store,
      provider: makeMock([halfCall, [{ type: "text", delta: "Done." }]]),
      toolset: toolset([editTool]),
      canRun: () => true,
      flushMs: 0,
      onEvent: (e) => events.push(e),
    })
    expect(events.find((e) => e.type === "truncated").where).toBe("tool-arguments")
  })

  it("commits a well-formed call as normal", async () => {
    const store = session()
    let ran = 0
    // risk "read", so it runs without an approval standing between the call
    // and the assertion — this is about parsing, not about grants.
    const tool = { id: "doc_read", name: "Read", where: "worker", risk: "read", execute: async () => { ran++; return "{}" } }
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: { url: "automerge:subject" } }],
      [{ type: "text", delta: "Done." }],
    ])
    await run({ store, provider, toolset: toolset([tool]), canRun: () => true, flushMs: 0 })
    expect(ran).toBe(1)
    expect(transcript(store).some((b) => b.type === "call" && b.tool === "doc_read")).toBe(true)
  })
})

describe("a turn that dies before it says anything", () => {
  it("leaves no empty assistant turn behind", async () => {
    // streamTurn appends its turn before the first token arrives, so a request
    // that throws used to leave an empty one in the document — two of them sit
    // in a real session, rendering as nothing and telling nobody anything.
    const store = session()
    const provider = {
      id: "boom",
      name: "Boom",
      requests: [],
      async *stream() {
        throw new Error("OpenRouter 404: No endpoints found that support image input")
      },
    }

    await run({ store, provider, toolset: toolset(), canRun: () => true, flushMs: 0 })

    const empties = store.doc().turns.filter((t) => t.role === "assistant" && (t.blocks ?? []).length === 0)
    expect(empties).toHaveLength(0)
    expect(transcript(store).at(-1).text).toMatch(/support image input/)
  })
})
