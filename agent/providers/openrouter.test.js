import { describe, it, expect } from "vitest"
import { toOpenAIMessages, toOpenAITools, buildBody, sseEvents, decodeStream, stream, models, describeModel, describeDefaults, effortsOf, ALL_EFFORTS, providerSays, refusal } from "./openrouter.js"
import { DEFAULT_CONFIG } from "../session/schema.js"

/** A ReadableStream of SSE chunks, the shape `response.body` actually has. */
function streamOf(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }),
      releaseLock() {},
    }),
  }
}

/** Feed a string to an async-iterable in fixed-size pieces, like a real socket. */
async function* chunked(text, size = 7) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size)
}

const collect = async (iterable) => {
  const out = []
  for await (const item of iterable) out.push(item)
  return out
}

describe("toOpenAIMessages", () => {
  it("keeps a turn's text parts apart, so a URL never runs into the words after it", () => {
    const note = "[Workspace when this message was sent]\nFocused: \"board\" — automerge:xaDNcJdLK5n9ia6BqPQebwR4xnU"
    const [user] = toOpenAIMessages(null, [{ role: "user", content: [{ type: "text", text: note }, { type: "text", text: "okay, the board" }] }])
    expect(user.content).toBe(`${note}\n\nokay, the board`)
    expect(user.content.match(/automerge:[1-9A-HJ-NP-Za-km-z]+/)[0]).toBe("automerge:xaDNcJdLK5n9ia6BqPQebwR4xnU")
    const [withImage] = toOpenAIMessages(null, [{ role: "user", content: [{ type: "text", text: note }, { type: "text", text: "okay" }, { type: "image", image: "data:image/png;base64,AA" }] }])
    expect(withImage.content[0].text).toBe(`${note}\n\nokay`)
  })

  it("puts the system prompt first", () => {
    const out = toOpenAIMessages("be terse", [])
    expect(out[0]).toEqual({ role: "system", content: "be terse" })
  })

  it("maps a plain exchange", () => {
    const out = toOpenAIMessages("", [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ])
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })

  it("moves a tool call onto the assistant message and its result into its own message", () => {
    const out = toOpenAIMessages("", [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me look" },
          { type: "call", id: "c1", name: "doc_read", input: { url: "automerge:x" } },
        ],
      },
      { role: "tool", content: [{ type: "result", callId: "c1", output: "contents" }] },
    ])

    expect(out[0].role).toBe("assistant")
    expect(out[0].content).toBe("let me look")
    expect(out[0].tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "doc_read", arguments: '{"url":"automerge:x"}' } },
    ])
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "contents" })
  })

  it("sends a tool-only assistant turn with null content, not an empty string", () => {
    const out = toOpenAIMessages("", [
      { role: "assistant", content: [{ type: "call", id: "c1", name: "t", input: {} }] },
    ])
    expect(out[0].content).toBeNull()
    expect(out[0].tool_calls).toHaveLength(1)
  })

  it("stringifies a non-string tool result", () => {
    const out = toOpenAIMessages("", [
      { role: "tool", content: [{ type: "result", callId: "c1", output: { ok: true } }] },
    ])
    expect(out[0].content).toBe('{"ok":true}')
  })

  it("drops an assistant turn with nothing in it", () => {
    expect(toOpenAIMessages("", [{ role: "assistant", content: [] }])).toEqual([])
  })
})

describe("toOpenAITools", () => {
  it("is undefined when there are no tools, so the key is omitted", () => {
    expect(toOpenAITools([])).toBeUndefined()
  })

  it("wraps each tool as a function schema", () => {
    const out = toOpenAITools([
      { id: "doc_read", description: "read it", input_schema: { type: "object", properties: { url: {} } } },
    ])
    expect(out).toEqual([
      {
        type: "function",
        function: { name: "doc_read", description: "read it", parameters: { type: "object", properties: { url: {} } } },
      },
    ])
  })
})

describe("buildBody", () => {
  it("always streams and only includes params that were set", () => {
    const body = buildBody({ system: "s", messages: [], tools: [], model: "m", params: {} })
    expect(body.stream).toBe(true)
    expect(body.model).toBe("m")
    expect("temperature" in body).toBe(false)
    expect("max_tokens" in body).toBe(false)
  })

  it("sends only the knobs the session set, so an unset one is the model's own default", () => {
    // The harness used to send temperature 0 for every model. That is tuned
    // for one family and is exactly what sends open-weight reasoning models
    // into verbatim thinking loops; nothing here should know which is which.
    const body = buildBody({ messages: [], model: "m", params: { maxTokens: 100 } })
    expect("temperature" in body).toBe(false)
    expect("top_p" in body).toBe(false)
    expect(body.max_tokens).toBe(100)
  })

  it("accepts both spellings of a knob, since people edit config.params by hand", () => {
    const camel = buildBody({ messages: [], model: "m", params: { topP: 0.9, repetitionPenalty: 1.05 } })
    const snake = buildBody({ messages: [], model: "m", params: { top_p: 0.9, repetition_penalty: 1.05 } })
    expect(camel.top_p).toBe(0.9)
    expect(camel.repetition_penalty).toBe(1.05)
    expect(snake).toEqual(camel)
  })

  it("drops a knob the catalogue says this model does not take", () => {
    const body = buildBody({
      messages: [],
      model: "m",
      params: { temperature: 0.7, repetitionPenalty: 1.05, reasoning: { effort: "low" } },
      capabilities: { supports: ["temperature", "tools"], maxOutput: null },
    })
    expect(body.temperature).toBe(0.7)
    expect("repetition_penalty" in body).toBe(false)
    expect("reasoning" in body).toBe(false)
  })

  it("sends every set knob when the catalogue has no opinion", () => {
    const body = buildBody({ messages: [], model: "m", params: { temperature: 0.7, reasoning: { effort: "low" } }, capabilities: { supports: null } })
    expect(body.temperature).toBe(0.7)
    expect(body.reasoning).toEqual({ effort: "low" })
  })

  it("caps max_tokens at what the model can produce", () => {
    const body = buildBody({ messages: [], model: "m", params: { maxTokens: 8192 }, capabilities: { supports: null, maxOutput: 4096 } })
    expect(body.max_tokens).toBe(4096)
    const roomy = buildBody({ messages: [], model: "m", params: { maxTokens: 8192 }, capabilities: { supports: null, maxOutput: 131072 } })
    expect(roomy.max_tokens).toBe(8192)
  })

  it("passes temperature 0 through rather than treating it as absent", () => {
    const body = buildBody({ messages: [], model: "m", params: { temperature: 0, maxTokens: 100 } })
    expect(body.temperature).toBe(0)
    expect(body.max_tokens).toBe(100)
  })
})

describe("sseEvents", () => {
  it("extracts data payloads across arbitrary chunk boundaries", async () => {
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n'
    expect(await collect(sseEvents(chunked(text, 3)))).toEqual(['{"a":1}', '{"b":2}'])
  })

  it("ignores comments and blank lines", async () => {
    const text = ': keepalive\n\ndata: {"a":1}\n\n'
    expect(await collect(sseEvents(chunked(text, 5)))).toEqual(['{"a":1}'])
  })

  it("stops at [DONE] and ignores anything after it", async () => {
    const text = 'data: {"a":1}\ndata: [DONE]\ndata: {"b":2}\n'
    expect(await collect(sseEvents(chunked(text, 4)))).toEqual(['{"a":1}'])
  })

  it("emits a trailing payload that arrived without a newline", async () => {
    expect(await collect(sseEvents(chunked('data: {"a":1}', 100)))).toEqual(['{"a":1}'])
  })
})

const frame = (delta, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`

describe("decodeStream", () => {
  it("yields text deltas and a stop", async () => {
    const wire = frame({ content: "Hel" }) + frame({ content: "lo" }) + frame({}, "stop") + "data: [DONE]\n\n"
    const events = await collect(decodeStream(chunked(wire)))
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "stop", reason: "stop" },
    ])
  })

  it("surfaces reasoning on its own channel", async () => {
    const wire = frame({ reasoning: "thinking" }) + frame({ content: "answer" }, "stop")
    const events = await collect(decodeStream(chunked(wire)))
    expect(events).toContainEqual({ type: "reasoning", delta: "thinking" })
    expect(events).toContainEqual({ type: "text", delta: "answer" })
  })

  it("reassembles a tool call split across many deltas", async () => {
    const wire =
      frame({ tool_calls: [{ index: 0, id: "call_1", function: { name: "doc_", arguments: "" } }] }) +
      frame({ tool_calls: [{ index: 0, function: { name: "read", arguments: '{"ur' } }] }) +
      frame({ tool_calls: [{ index: 0, function: { arguments: 'l":"x"}' } }] }) +
      frame({}, "tool_calls") +
      "data: [DONE]\n\n"

    const events = await collect(decodeStream(chunked(wire, 11)))
    const call = events.find((e) => e.type === "call")
    expect(call).toMatchObject({ id: "call_1", name: "doc_read", input: { url: "x" } })
    expect(call.parseError).toBeNull()
    expect(events.at(-1)).toEqual({ type: "stop", reason: "tool_use" })
  })

  it("keeps parallel tool calls separate and in index order", async () => {
    const wire =
      frame({
        tool_calls: [
          { index: 0, id: "a", function: { name: "one", arguments: "{}" } },
          { index: 1, id: "b", function: { name: "two", arguments: "{}" } },
        ],
      }) + frame({}, "tool_calls")

    const calls = (await collect(decodeStream(chunked(wire)))).filter((e) => e.type === "call")
    expect(calls.map((c) => c.name)).toEqual(["one", "two"])
  })

  it("reports malformed argument JSON instead of throwing", async () => {
    const wire = frame({ tool_calls: [{ index: 0, id: "a", function: { name: "t", arguments: "{not json" } }] }, "length")
    const call = (await collect(decodeStream(chunked(wire)))).find((e) => e.type === "call")
    expect(call.input).toEqual({})
    expect(call.parseError).toBeTruthy()
  })

  it("skips a frame that is not valid JSON", async () => {
    const wire = "data: <html>oops</html>\n\n" + frame({ content: "ok" }, "stop")
    const events = await collect(decodeStream(chunked(wire)))
    expect(events).toContainEqual({ type: "text", delta: "ok" })
  })

  it("reports usage when the provider sends it", async () => {
    const wire =
      frame({ content: "hi" }, "stop") +
      `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.0123 } })}\n\n`
    const usage = (await collect(decodeStream(chunked(wire)))).find((e) => e.type === "usage")
    // The cost is what OpenRouter charged, in dollars, reported on every response.
    expect(usage).toMatchObject({ in: 10, out: 3, cost: 0.0123 })
  })

  it("always ends with exactly one stop event", async () => {
    const wire = frame({ content: "a" }) + frame({}, "stop")
    const events = await collect(decodeStream(chunked(wire)))
    expect(events.filter((e) => e.type === "stop")).toHaveLength(1)
    expect(events.at(-1).type).toBe("stop")
  })
})

describe("a model that cannot read images", () => {
  // Watched in a real session: view_mount attached a screenshot, the next
  // request 404'd with "No endpoints found that support image input", and every
  // turn after it failed the same way — permanently, because the images carried
  // forward are the newest ones. A person had to notice and say so.
  const withImage = [
    { role: "user", content: [{ type: "text", text: "look" }] },
    { role: "tool", content: [{ type: "result", callId: "c1", output: "mounted", image: "data:image/jpeg;base64,AAA" }] },
  ]

  it("sends the screenshot by default", () => {
    const body = buildBody({ system: "", messages: withImage, model: "m" })
    expect(JSON.stringify(body)).toContain("image_url")
  })

  it("leaves it out when asked to", () => {
    const body = buildBody({ system: "", messages: withImage, model: "m", dropImages: true })
    expect(JSON.stringify(body)).not.toContain("image_url")
    // …and keeps the tool result itself, which is the part that carries meaning.
    expect(JSON.stringify(body)).toContain("mounted")
  })

  it("retries without images when the provider refuses them", async () => {
    const bodies = []
    const fetchImpl = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      if (bodies.length === 1) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ error: { message: "No endpoints found that support image input", code: 404 } }),
        }
      }
      return {
        ok: true,
        status: 200,
        body: streamOf(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]),
      }
    }

    const events = []
    const retries = []
    for await (const event of stream({
      system: "",
      messages: withImage,
      model: "m",
      key: "k",
      fetchImpl,
      onRetry: (info) => retries.push(info),
    })) {
      events.push(event)
    }

    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[0])).toContain("image_url")
    expect(JSON.stringify(bodies[1])).not.toContain("image_url")
    expect(events.some((e) => e.type === "text" && e.delta === "hi")).toBe(true)
    expect(retries[0].reason).toMatch(/cannot read images/)
  })

  it("does not strip images for an unrelated failure", async () => {
    const bodies = []
    const fetchImpl = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      if (bodies.length === 1) {
        return { ok: false, status: 429, headers: { get: () => null }, text: async () => "rate limited" }
      }
      return { ok: true, status: 200, body: streamOf(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]) }
    }
    for await (const _ of stream({ system: "", messages: withImage, model: "m", key: "k", fetchImpl })) { void _ }
    expect(JSON.stringify(bodies[1])).toContain("image_url")
  })

  it("reports which models can see, so one can be chosen on purpose", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "seeing/one", name: "One", architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools"] },
          { id: "blind/two", name: "Two", architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"] },
        ],
      }),
    })
    const list = await models({ key: "k", fetchImpl })
    expect(list.find((m) => m.id === "seeing/one").images).toBe(true)
    expect(list.find((m) => m.id === "blind/two").images).toBe(false)
    expect(describeModel(list.find((m) => m.id === "seeing/one"))).toContain("sees images")
  })
  it("carries each model's recommended defaults, accepted parameters and output ceiling", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "xiaomi/mimo",
            name: "MiMo",
            default_parameters: { temperature: 1, top_p: 0.95, frequency_penalty: 0, top_k: null },
            supported_parameters: ["temperature", "top_p", "repetition_penalty", "tools", "reasoning"],
            top_provider: { max_completion_tokens: 131072 },
          },
          { id: "terse/one", name: "Terse" },
        ],
      }),
    })
    const list = await models({ key: "k", fetchImpl })
    const mimo = list.find((m) => m.id === "xiaomi/mimo")
    expect(mimo.defaults).toEqual({ temperature: 1, top_p: 0.95, frequency_penalty: 0 }) // nulls are "no opinion"
    expect(mimo.supports).toContain("repetition_penalty")
    expect(mimo.maxOutput).toBe(131072)
    expect(describeDefaults(mimo)).toBe("temperature 1 · top_p 0.95 · frequency_penalty 0")

    const terse = list.find((m) => m.id === "terse/one")
    expect(terse.defaults).toEqual({})
    expect(terse.supports).toBeNull()
    expect(terse.maxOutput).toBeNull()
    expect(describeDefaults(terse)).toBe("")
  })
})

describe("effort", () => {
  it("reads the three cases the catalogue distinguishes", () => {
    expect(effortsOf(undefined)).toEqual({ efforts: [], defaultEffort: null }) // no reasoning at all
    expect(effortsOf({ mandatory: false })).toEqual({ efforts: [], defaultEffort: null }) // reasons, but no effort setting
    expect(effortsOf({ supported_efforts: null }).efforts).toEqual(ALL_EFFORTS) // any level
    expect(effortsOf({ supported_efforts: ["high", "low"], default_effort: "high" })).toEqual({ efforts: ["high", "low"], defaultEffort: "high" })
  })

  it("never offers 'none' to a model that must reason", () => {
    expect(effortsOf({ supported_efforts: null, mandatory: true }).efforts).not.toContain("none")
    expect(effortsOf({ supported_efforts: ["high", "none"], mandatory: true }).efforts).toEqual(["high"])
  })

  it("sends an effort the model takes", () => {
    const body = buildBody({ messages: [], model: "m", params: { reasoning: { effort: "max" } }, capabilities: { supports: ["reasoning"], efforts: ["max", "high"] } })
    expect(body.reasoning).toEqual({ effort: "max" })
  })

  it("drops one it does not, keeping the rest of the reasoning settings", () => {
    const capabilities = { supports: ["reasoning"], efforts: ["high", "low"] }
    expect("reasoning" in buildBody({ messages: [], model: "m", params: { reasoning: { effort: "max" } }, capabilities })).toBe(false)
    expect(buildBody({ messages: [], model: "m", params: { reasoning: { effort: "max", exclude: true } }, capabilities }).reasoning).toEqual({ exclude: true })
  })

  it("sends it as chosen when the catalogue has no entry", () => {
    expect(buildBody({ messages: [], model: "m", params: { reasoning: { effort: "max" } } }).reasoning).toEqual({ effort: "max" })
  })

  it("defaults new sessions to the latest Opus", () => {
    expect(DEFAULT_CONFIG.model).toBe("~anthropic/claude-opus-latest")
  })
})

describe("a refused request, in words", () => {
  // What OpenRouter answered a made-up key with, on the deployed site.
  const NOT_FOUND = JSON.stringify({ error: { message: "User not found.", code: 401 } })

  it.each([
    [NOT_FOUND, "User not found."],
    [JSON.stringify({ error: "no auth credentials found" }), "no auth credentials found"],
    [JSON.stringify({ message: "upstream timed out" }), "upstream timed out"],
    [JSON.stringify({ error: { code: 500 } }), JSON.stringify({ error: { code: 500 } })],
    ["Bad Gateway", "Bad Gateway"],
    ["", ""],
  ])("the provider's own words out of %s", (detail, said) => {
    expect(providerSays(detail)).toBe(said)
  })

  it.each([401, 403])("%s: the API key refused, where to change it, then what the provider said", (status) => {
    expect(refusal(status, NOT_FOUND)).toBe(`OpenRouter refused the API key (${status}). Change it in this session's settings. OpenRouter said: User not found.`)
    expect(refusal(status, "")).toBe(`OpenRouter refused the API key (${status}). Change it in this session's settings.`)
  })

  it("any other status keeps it, and the message is read out of the JSON", () => {
    expect(refusal(404, JSON.stringify({ error: { message: "No endpoints found for this model", code: 404 } }))).toBe("OpenRouter 404: No endpoints found for this model")
    expect(refusal(500, "upstream")).toBe("OpenRouter 500: upstream")
  })

  it("stream throws it, with no JSON in what is said", async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => NOT_FOUND })
    const err = await collect(stream({ system: "", messages: [], model: "m", key: "made-up", fetchImpl })).catch((e) => e)
    expect(err.message).toBe("OpenRouter refused the API key (401). Change it in this session's settings. OpenRouter said: User not found.")
    expect(err.message).not.toMatch(/[{}"]/)
  })
})
