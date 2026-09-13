import { describe, it, expect } from "vitest"
import { toOpenAIMessages, toOpenAITools, buildBody, sseEvents, decodeStream } from "./openrouter.js"

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
    const wire = frame({ tool_calls: [{ index: 0, id: "a", function: { name: "t", arguments: "{not json" } }] })
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
      `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\n`
    const usage = (await collect(decodeStream(chunked(wire)))).find((e) => e.type === "usage")
    expect(usage).toMatchObject({ in: 10, out: 3 })
  })

  it("always ends with exactly one stop event", async () => {
    const wire = frame({ content: "a" }) + frame({}, "stop")
    const events = await collect(decodeStream(chunked(wire)))
    expect(events.filter((e) => e.type === "stop")).toHaveLength(1)
    expect(events.at(-1).type).toBe("stop")
  })
})
