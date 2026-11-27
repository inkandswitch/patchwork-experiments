/**
 * The ChatGPT plan adapter against OpenAI's Responses API as its documents
 * describe it: what goes out, what comes back, and what a refusal becomes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  credentialOf,
  buildBody,
  toInput,
  toTools,
  carryOf,
  carryFits,
  decodeStream,
  stream,
  models,
  failure,
  droppable,
  expiresAt,
  NAMESPACE,
  USAGE_URL,
  _resetTurnedDown,
} from "./chatgpt.js"
import { isInterruption } from "../net/network.js"

const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const tokenFor = (secondsLeft) => `${b64({ alg: "RS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + secondsLeft })}.c2ln`

const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`)
async function* chunks(parts) {
  for (const part of parts) yield part
}
async function collect(iterable) {
  const out = []
  for await (const event of iterable) out.push(event)
  return out
}

const TOOLS = [{ id: "doc_read", description: "Read a document.", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }]

const REASONING = { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "Look first." }], encrypted_content: "gAAAA-sealed" }
const COMMENTARY = { id: "msg_1", type: "message", role: "assistant", phase: "commentary", status: "completed", content: [{ type: "output_text", text: "Reading it.", annotations: [] }] }
const CALL = { id: "fc_1", type: "function_call", call_id: "call_a", name: "doc_read", namespace: NAMESPACE, arguments: '{"url":"automerge:made-up"}', status: "completed" }

beforeEach(() => _resetTurnedDown())

describe("the request", () => {
  it("sends the system prompt as the first input, a developer message with a cache breakpoint at its end", () => {
    const body = buildBody({ system: "Be useful.", messages: [], model: "m" })
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Be useful.", prompt_cache_breakpoint: { mode: "explicit" } }],
    })
    expect("instructions" in body).toBe(false)
  })

  it("is stateless and streamed, and sends none of what the plan route refuses", () => {
    const params = { temperature: 0.2, topP: 0.9, maxTokens: 16000, seed: 1, reasoning: { effort: "high", max_tokens: 100 } }
    const body = buildBody({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], model: "m", params, cacheKey: "k1" })
    expect([body.store, body.stream]).toEqual([false, true])
    for (const refused of ["temperature", "top_p", "max_output_tokens", "truncation", "metadata", "user", "safety_identifier", "prompt_cache_retention", "previous_response_id", "background", "conversation"]) {
      expect(refused in body).toBe(false)
    }
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" })
    expect(body.prompt_cache_key).toBe("k1")
    expect(body.include).toEqual(["reasoning.encrypted_content"])
    expect(body.stream_options).toEqual({ include_obfuscation: false })
  })

  it("drops an effort the model does not take, sends mode and verbosity when chosen, and no summary when thinking is excluded", () => {
    const capabilities = { efforts: ["low", "medium"] }
    expect(buildBody({ messages: [], model: "m", params: { reasoning: { effort: "max" } }, capabilities }).reasoning).toEqual({ summary: "auto" })
    expect(buildBody({ messages: [], model: "m", params: { reasoning: { effort: "low", mode: "pro", exclude: true }, verbosity: "low" }, capabilities })).toMatchObject({
      reasoning: { effort: "low", mode: "pro" },
      text: { verbosity: "low" },
    })
    expect(buildBody({ messages: [], model: "m", params: { reasoning: { exclude: true } } }).reasoning).toBeUndefined()
  })

  it("offers the tools in one namespace, not strict, so their optional fields stay optional", () => {
    expect(toTools(TOOLS)).toEqual([
      {
        type: "namespace",
        name: NAMESPACE,
        description: expect.any(String),
        tools: [{ type: "function", name: "doc_read", description: "Read a document.", parameters: TOOLS[0].input_schema, strict: false }],
      },
    ])
    expect(toTools(TOOLS, { namespaced: false })[0]).toMatchObject({ type: "function", name: "doc_read" })
    expect(toTools([])).toBeUndefined()
  })

  it("turns a person's words, images and PDFs into one user message, and a system turn into a developer one", () => {
    const input = toInput("", [
      { role: "user", content: [{ type: "text", text: "look" }, { type: "text", text: "here" }, { type: "image", image: "data:image/png;base64,AA" }, { type: "file", name: "a.pdf", data: "data:application/pdf;base64,JV" }] },
      { role: "system", content: [{ type: "text", text: "note" }] },
    ])
    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "look\n\nhere" },
          { type: "input_image", image_url: "data:image/png;base64,AA" },
          { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,JV" },
        ],
      },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "note" }] },
    ])
  })

  it("rebuilds a turn with no carry as its message and namespaced calls, and puts a tool's picture inside its output", () => {
    const input = toInput("", [
      { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "call", id: "call_a", name: "doc_read", input: { url: "automerge:made-up" } }] },
      { role: "tool", content: [{ type: "result", callId: "call_a", output: "it says hi", image: "data:image/png;base64,AA" }] },
    ])
    expect(input).toEqual([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Reading." }] },
      { type: "function_call", call_id: "call_a", name: "doc_read", arguments: '{"url":"automerge:made-up"}', namespace: NAMESPACE },
      { type: "function_call_output", call_id: "call_a", output: [{ type: "input_text", text: "it says hi" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
    ])
    // Without images, the output is the text alone.
    expect(toInput("", [{ role: "tool", content: [{ type: "result", callId: "c", output: "x", image: "data:," }] }], { dropImages: true })).toEqual([{ type: "function_call_output", call_id: "c", output: "x" }])
  })

  it("sends a turn's carry in its place, as it came less its status, when it is the turn the transcript holds", () => {
    const carry = { provider: "chatgpt", data: { items: [REASONING, COMMENTARY, CALL] } }
    const turn = { role: "assistant", carry, content: [{ type: "text", text: "Reading it." }, { type: "call", id: "call_a", name: "doc_read", input: { url: "automerge:made-up" } }] }
    const input = toInput("", [turn])
    expect(input).toEqual([REASONING, { ...COMMENTARY, status: undefined }, { ...CALL, status: undefined }].map(({ status, ...rest }) => rest))
    expect(input[0].encrypted_content).toBe("gAAAA-sealed")
    expect(input[1].phase).toBe("commentary")
  })

  it("does not send a carry that disagrees with the transcript, nor another provider's", () => {
    const carry = { provider: "chatgpt", data: { items: [REASONING, COMMENTARY, CALL] } }
    const fallback = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Reading it." }] }]
    // The harness dropped the call (a repeating model, say): the carry would claim it.
    expect(toInput("", [{ role: "assistant", carry, content: [{ type: "text", text: "Reading it." }] }])).toEqual(fallback)
    // Someone else's.
    expect(toInput("", [{ role: "assistant", carry: { ...carry, provider: "openrouter" }, content: [{ type: "text", text: "Reading it." }] }])).toEqual(fallback)
    expect(carryFits(carry.data, ["Reading it.", "more"], [])).toBe(false)
  })

  it("keeps a carry only when it adds something: reasoning, or a phase", () => {
    expect(carryOf([COMMENTARY, CALL])).toEqual({ items: [COMMENTARY, CALL] })
    expect(carryOf([REASONING, { type: "web_search_call", id: "ws" }])).toEqual({ items: [REASONING] })
    const { phase, ...plain } = COMMENTARY
    expect(carryOf([plain, CALL])).toBeNull()
  })
})

describe("the reply", () => {
  it("streams text and the reasoning summary, then the calls, the carry, the usage and why it stopped", async () => {
    const events = await collect(
      decodeStream(
        chunks([
          ...sse(
            { type: "response.created", response: { id: "resp_1" } },
            { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Look " },
            { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "first." },
            { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Then read." },
            { type: "response.output_item.done", output_index: 0, item: REASONING },
            { type: "response.output_text.delta", item_id: "msg_1", delta: "Reading it." },
            { type: "response.output_item.done", output_index: 1, item: COMMENTARY },
            { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"url"' },
            { type: "response.output_item.done", output_index: 2, item: CALL }
          ),
          // A frame split across chunks.
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":1024},',
          '"output_tokens":90,"output_tokens_details":{"reasoning_tokens":40}}}}\n\n',
        ])
      )
    )
    expect(events).toEqual([
      { type: "reasoning", delta: "Look " },
      { type: "reasoning", delta: "first." },
      { type: "reasoning", delta: "\n\n" },
      { type: "reasoning", delta: "Then read." },
      { type: "text", delta: "Reading it." },
      { type: "call", id: "call_a", name: "doc_read", input: { url: "automerge:made-up" }, parseError: null, argsLength: CALL.arguments.length },
      { type: "carry", data: { items: [REASONING, COMMENTARY, CALL] } },
      { type: "usage", in: 1200, out: 90, cached: 1024, reasoning: 40, cost: null },
      { type: "stop", reason: "tool_use" },
    ])
  })

  it("says a reply cut off by its output limit is a length stop, and keeps no carry of it", async () => {
    const events = await collect(
      decodeStream(
        chunks(
          sse(
            { type: "response.output_item.done", output_index: 0, item: REASONING },
            { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 1, output_tokens: 2 } } }
          )
        )
      )
    )
    expect(events.map((e) => e.type)).toEqual(["usage", "stop"])
    expect(events.at(-1)).toEqual({ type: "stop", reason: "length" })
  })

  it("is an interruption when the body ends before the reply was finished", async () => {
    await expect(collect(decodeStream(chunks(sse({ type: "response.output_text.delta", delta: "Hal" }))))).rejects.toSatisfy(isInterruption)
  })

  it("turns a failure mid-reply into what it means: a limit to raise, or a wait", async () => {
    const limit = collect(decodeStream(chunks(sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } }))))
    await expect(limit).rejects.toThrow(USAGE_URL)
    await expect(limit).rejects.not.toSatisfy(isInterruption)
    const later = collect(decodeStream(chunks(sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable", message: "later" } } }))))
    await expect(later).rejects.toSatisfy(isInterruption)
    const error = collect(decodeStream(chunks(sse({ type: "error", code: "server_error", message: "boom" }))))
    await expect(error).rejects.toSatisfy(isInterruption)
  })
})

describe("refusals", () => {
  it("are said as what a person can do", () => {
    expect(failure({ status: 403, code: "subscription_sharing_user_not_eligible", message: "no" }).message).toMatch(/cannot use its plan/)
    expect(failure({ status: 401, code: "subscription_sharing_invalid_user" }).message).toMatch(/Sign in to ChatGPT again/)
    expect(failure({ status: 401 }).message).toMatch(/Sign in to ChatGPT again/)
    expect(isInterruption(failure({ status: 503, code: "subscription_sharing_user_unavailable" }))).toBe(true)
    expect(failure({ status: 400, code: "subscription_sharing_unsupported_capability", param: "tools[0]" }).message).toMatch(/`tools\[0\]`/)
  })

  it("name a feature to drop only when it was sent and the refusal is about a parameter", () => {
    const sent = new Set(["breakpoint", "summary"])
    expect(droppable({ code: "subscription_sharing_unsupported_capability", param: "input[0].content[0].prompt_cache_breakpoint" }, sent)).toBe("breakpoint")
    expect(droppable({ code: "unsupported_parameter", param: "reasoning.summary", message: "" }, sent)).toBe("summary")
    expect(droppable({ code: "unsupported_parameter", param: "stream_options" }, sent)).toBeNull()
    expect(droppable({ code: "subscription_sharing_usage_limit_exceeded", param: "prompt_cache_breakpoint" }, sent)).toBeNull()
  })
})

describe("streaming a request", () => {
  const ok = (events) => new Response(sse(...events).join(""), { status: 200, headers: { "content-type": "text/event-stream" } })
  const DONE = [{ type: "response.output_text.delta", delta: "hi" }, { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 1 } } }]
  const refuse = (status, error) => new Response(JSON.stringify({ error }), { status })
  const run = (opts) => collect(stream({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: TOOLS, model: "gpt-test", params: {}, key: tokenFor(3600), ...opts }))

  it("posts to the Responses endpoint with the token as bearer", async () => {
    const fetchImpl = vi.fn(async () => ok(DONE))
    const events = await run({ fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.openai.com/v1/responses")
    expect(init.headers.authorization).toMatch(/^Bearer /)
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-test", store: false, stream: true })
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" })
  })

  it("does not send a token about to run out: the run stops for a fresh one", async () => {
    const fetchImpl = vi.fn()
    const err = await run({ fetchImpl, key: tokenFor(30) }).catch((e) => e)
    expect([isInterruption(err), err.renew, fetchImpl.mock.calls.length]).toEqual([true, true, 0])
  })

  it("judges a token's end by the page's reckoning when handed one, not the token's own clock", async () => {
    // The token says it has an hour; the page, whose clock the run shares, says thirty seconds.
    const fetchImpl = vi.fn()
    const err = await run({ fetchImpl, key: { token: tokenFor(3600), expiresAt: Date.now() + 30_000 } }).catch((e) => e)
    expect([err.renew, fetchImpl.mock.calls.length]).toEqual([true, 0])
    // And the other way about: the token's own clock says it is spent, the page gave it ten minutes.
    const ok2 = vi.fn(async () => ok(DONE))
    const spent = tokenFor(-100)
    await run({ fetchImpl: ok2, key: { token: spent, expiresAt: Date.now() + 600_000 } })
    expect(ok2).toHaveBeenCalledTimes(1)
    expect(ok2.mock.calls[0][1].headers.authorization).toBe(`Bearer ${spent}`)
  })

  it("is not renewed on a 401 while the token still has time: that is a sign-in to redo", async () => {
    const fetchImpl = vi.fn(async () => refuse(401, { message: "revoked" }))
    const err = await run({ fetchImpl, key: { token: tokenFor(3600), expiresAt: Date.now() + 3600_000 } }).catch((e) => e)
    expect([isInterruption(err), err.message]).toEqual([false, expect.stringMatching(/Sign in to ChatGPT again/)])
  })

  it("asks for a fresh token when one ran out while the request waited", async () => {
    let now = Date.now()
    const fetchImpl = vi.fn(async () => {
      now += 3600_000
      return refuse(401, { message: "expired" })
    })
    const err = await run({ fetchImpl, now: () => now }).catch((e) => e)
    expect([isInterruption(err), err.renew]).toEqual([true, true])
  })

  it("drops a feature the route turns down, sends again at once, and remembers it for the model", async () => {
    const bodies = []
    const fetchImpl = vi.fn(async (url, init) => {
      bodies.push(JSON.parse(init.body))
      if (bodies.length === 1) return refuse(400, { code: "subscription_sharing_unsupported_capability", param: "tools[0].type", message: "namespace tools are not supported" })
      return ok(DONE)
    })
    const onRetry = vi.fn()
    await run({ fetchImpl, onRetry })
    expect(bodies[0].tools[0].type).toBe("namespace")
    expect(bodies[1].tools[0]).toMatchObject({ type: "function", name: "doc_read" })
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delay: 0 }))
    await run({ fetchImpl })
    expect(bodies[2].tools[0].type).toBe("function")
  })

  it("sends again without images when the model refuses one", async () => {
    const bodies = []
    const fetchImpl = vi.fn(async (url, init) => {
      bodies.push(JSON.parse(init.body))
      return bodies.length === 1 ? refuse(400, { message: "Invalid image: too large", param: "input[1].content[1].image_url" }) : ok(DONE)
    })
    const onRetry = vi.fn()
    const messages = [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", image: "data:image/png;base64,AA" }] }]
    await run({ fetchImpl, onRetry, messages })
    expect(JSON.stringify(bodies[1])).not.toMatch(/input_image/)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ imagesRejected: true }))
  })

  it("does not ask again past a usage limit, and waits out a busy route", async () => {
    const limited = vi.fn(async () => refuse(429, { code: "subscription_sharing_usage_limit_exceeded", message: "limit" }))
    const err = await run({ fetchImpl: limited }).catch((e) => e)
    expect([limited.mock.calls.length, isInterruption(err), err.message.includes(USAGE_URL)]).toEqual([1, false, true])

    vi.useFakeTimers()
    try {
      const busy = vi.fn(async () => new Response('{"detail":"busy"}', { status: 503 }))
      const pending = run({ fetchImpl: busy }).catch((e) => e)
      await vi.runAllTimersAsync()
      const waited = await pending
      expect([busy.mock.calls.length, isInterruption(waited)]).toEqual([4, true])
    } finally {
      vi.useRealTimers()
    }
  })

  it("needs a sign-in", async () => {
    await expect(run({ key: null })).rejects.toThrow(/Not signed in to ChatGPT/)
  })
})

describe("the model list", () => {
  it("lists what the account may use, in OpenAI's order, from either shape of answer", async () => {
    const answer = {
      models: [
        { slug: "gpt-6.2-sol", display_name: "GPT-6.2 Sol", visibility: "list", context_window: 400000, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], default_reasoning_level: "medium" },
        { slug: "internal", display_name: "Hidden", visibility: "hide" },
        { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list" },
      ],
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }))
    const listed = await models({ key: "t", fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/models")
    expect(listed.map((m) => m.id)).toEqual(["gpt-6.2-sol", "gpt-6-luna"])
    expect(listed[0]).toMatchObject({ label: "GPT-6.2 Sol", context: 400000, efforts: ["low", "medium", "high"], defaultEffort: "medium", tools: true, promptPerM: null })

    const standard = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-x", object: "model" }] }), { status: 200 }))
    expect((await models({ key: "t", fetchImpl: standard })).map((m) => m.id)).toEqual(["gpt-x"])
  })
})

describe("a credential", () => {
  it("is a token alone, or a token with the page's expiry", () => {
    const token = tokenFor(100)
    expect(credentialOf({ token, expiresAt: 5 })).toEqual({ token, expiresAt: 5 })
    expect(credentialOf(token).token).toBe(token)
    expect(credentialOf(null)).toEqual({ token: null, expiresAt: null })
  })
})

describe("a token's expiry", () => {
  it("is read from its own claim, and null when it has none", () => {
    const at = expiresAt(tokenFor(100))
    expect(Math.abs(at - (Date.now() + 100_000))).toBeLessThan(2000)
    expect(expiresAt("not-a-jwt")).toBeNull()
  })
})
