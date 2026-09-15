/**
 * OpenRouter adapter.
 *
 * Chosen as the first real provider for three reasons: it serves permissive
 * CORS so the browser can call it directly with no proxy, it reaches Claude
 * along with everything else through one interface, and having a single
 * OpenAI-shaped adapter that fronts many models is the cheapest possible proof
 * that the transcript really is provider-neutral.
 *
 * The translation boundary lives here and nowhere else. Session documents never
 * contain an OpenAI-shaped message; `toOpenAIMessages` builds them on the way
 * out and `decodeStream` turns the wire format back into neutral events.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

export const id = "openrouter"
export const name = "OpenRouter"

/** Models worth offering in the picker. Any OpenRouter slug works. */
export const SUGGESTED_MODELS = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1" },
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
]

// ---------------------------------------------------------------- outbound

/**
 * Neutral messages -> OpenAI chat messages.
 *
 * The shapes differ in a way worth naming: our transcript keeps a tool call and
 * its result as blocks inside turns, while OpenAI wants the call on an
 * assistant message and each result as its own `role: "tool"` message keyed by
 * id. So one neutral turn can fan out into several OpenAI messages.
 */
export function toOpenAIMessages(system, messages, { dropImages = false } = {}) {
  const out = []
  if (system) out.push({ role: "system", content: system })

  for (const msg of messages) {
    const text = []
    const calls = []
    const results = []

    for (const part of msg.content ?? []) {
      if (part.type === "text") text.push(part.text)
      else if (part.type === "call") calls.push(part)
      else if (part.type === "result") results.push(part)
    }

    if (msg.role === "assistant" || calls.length) {
      const assistant = { role: "assistant", content: text.join("") || null }
      if (calls.length) {
        assistant.tool_calls = calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }))
      }
      // An assistant message with neither text nor calls is not useful to send.
      if (assistant.content || assistant.tool_calls) out.push(assistant)
    } else if (text.length) {
      out.push({ role: msg.role === "system" ? "system" : "user", content: text.join("") })
    }

    for (const r of results) {
      out.push({
        role: "tool",
        tool_call_id: r.callId,
        content: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
      })

      // A tool message may only carry text, so a screenshot follows as its own
      // user message. This is the standard workaround and every vision model
      // reads it the same way — and a model that is not one rejects the whole
      // request, which is why this can be turned off.
      if (r.image && !dropImages) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: "Screenshot from the tool call above:" },
            { type: "image_url", image_url: { url: r.image } },
          ],
        })
      }
    }
  }

  return out
}

/** Neutral tool definitions -> OpenAI function schemas. */
export function toOpenAITools(tools = []) {
  if (!tools.length) return undefined
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.id,
      description: t.description ?? "",
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }))
}

export function buildBody({ system, messages, tools, model, params = {}, dropImages = false }) {
  const body = {
    model,
    messages: toOpenAIMessages(system, messages, { dropImages }),
    stream: true,
  }
  const t = toOpenAITools(tools)
  if (t) body.tools = t
  if (params.temperature != null) body.temperature = params.temperature
  if (params.maxTokens != null) body.max_tokens = params.maxTokens

  // Reasoning models spend the SAME output budget on thinking as on the answer,
  // so a model that thinks for five thousand tokens can exhaust the turn before
  // it emits a single tool call — which looks exactly like an agent that wrote a
  // long plan and then did nothing. This is the lever that fixes that:
  //   { effort: "low" }      think less
  //   { max_tokens: 1024 }   think at most this much
  //   { exclude: true }      think, but do not stream it back
  if (params.reasoning != null) body.reasoning = params.reasoning
  return body
}

// ---------------------------------------------------------------- inbound

/**
 * Split a text stream into SSE `data:` payloads.
 *
 * Takes an async iterable of strings so tests can feed it chunk boundaries in
 * the awkward places real networks produce them — mid-token, mid-JSON, and
 * between `\n` and `\n`.
 */
export async function* sseEvents(chunks) {
  let buffer = ""
  for await (const chunk of chunks) {
    buffer += chunk
    let index
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line || line.startsWith(":")) continue
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (payload === "[DONE]") return
      yield payload
    }
  }
  const tail = buffer.trim()
  if (tail.startsWith("data:")) {
    const payload = tail.slice(5).trim()
    if (payload && payload !== "[DONE]") yield payload
  }
}

/**
 * SSE payloads -> neutral events.
 *
 * Tool calls arrive spread across deltas: an id and name in one chunk, then
 * argument JSON a few characters at a time, keyed by `index`. They are
 * accumulated here and emitted as whole `call` events at the end of the
 * stream, so the loop never sees a half-parsed call.
 */
export async function* decodeStream(chunks) {
  const calls = new Map() // index -> { id, name, args }
  let stopReason = "end"
  let usage = null

  for await (const payload of sseEvents(chunks)) {
    let frame
    try {
      frame = JSON.parse(payload)
    } catch {
      continue // a keepalive or a truncated frame; nothing to do with it
    }

    if (frame.usage) usage = frame.usage

    const choice = frame.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}

    if (typeof delta.content === "string" && delta.content) {
      yield { type: "text", delta: delta.content }
    }

    // OpenRouter surfaces reasoning models' thinking on a side channel.
    const reasoning = delta.reasoning ?? delta.reasoning_content
    if (typeof reasoning === "string" && reasoning) {
      yield { type: "reasoning", delta: reasoning }
    }

    for (const tc of delta.tool_calls ?? []) {
      const key = tc.index ?? 0
      const acc = calls.get(key) ?? { id: null, name: "", args: "" }
      if (tc.id) acc.id = tc.id
      if (tc.function?.name) acc.name += tc.function.name
      if (tc.function?.arguments) acc.args += tc.function.arguments
      calls.set(key, acc)
    }

    if (choice.finish_reason) {
      stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason
    }
  }

  for (const [, acc] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let input = {}
    let parseError = null
    try {
      input = acc.args ? JSON.parse(acc.args) : {}
    } catch (err) {
      parseError = String(err?.message ?? err)
    }
    yield {
      type: "call",
      id: acc.id ?? `call_${acc.name}_${Math.random().toString(36).slice(2, 8)}`,
      name: acc.name,
      input,
      parseError,
    }
    stopReason = "tool_use"
  }

  if (usage) {
    yield {
      type: "usage",
      in: usage.prompt_tokens ?? 0,
      out: usage.completion_tokens ?? 0,
      cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
    }
  }

  yield { type: "stop", reason: stopReason }
}

/** Turn a fetch Response body into the async-iterable of strings decodeStream wants. */
async function* readBody(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock?.()
  }
}

/**
 * Stream a completion. Yields neutral events; throws on transport/auth errors.
 *
 * `key` is passed per call rather than held in module state so that nothing
 * here ever caches a credential.
 */
/** Is this worth trying again? Rate limits and server faults are; 4xx is not. */
function isRetryable(status) {
  return status === 429 || status === 408 || (status >= 500 && status < 600)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Stream a completion, retrying transient failures.
 *
 * Retries happen only *before* the first byte of the body. Once tokens are
 * flowing they have already been written into the document, and starting over
 * would duplicate them — so a mid-stream failure is surfaced rather than
 * retried, and the loop records it as an error the user can respond to.
 *
 * `key` is passed per call rather than held in module state, so nothing here
 * ever caches a credential.
 */
export async function* stream({
  system,
  messages,
  tools,
  model,
  params,
  key,
  signal,
  fetchImpl = fetch,
  maxAttempts = 4,
  onRetry = null,
}) {
  if (!key) throw new Error("No OpenRouter API key. Add one in the agent panel.")

  // Whether to include screenshots. Starts from what the caller believes and
  // is turned off for good the moment the provider says otherwise.
  let withImages = params?.images !== false
  const render = () => JSON.stringify(buildBody({ system, messages, tools, model, params, dropImages: !withImages }))

  let body = render()
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return

    let response
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://patchwork.inkandswitch.com",
          "X-Title": "Patchwork Agent",
        },
        body,
      })
    } catch (err) {
      // A network fault: worth one more go unless we are out of attempts.
      lastError = err
      if (attempt === maxAttempts || signal?.aborted) throw err
      const delay = 500 * 2 ** (attempt - 1)
      onRetry?.({ attempt, delay, reason: String(err?.message ?? err) })
      await sleep(delay)
      continue
    }

    if (response.ok) {
      yield* decodeStream(readBody(response))
      return
    }

    const detail = await response.text().catch(() => "")
    lastError = new Error(`OpenRouter ${response.status}: ${detail.slice(0, 400)}`)

    // A model that cannot read images rejects the ENTIRE request, so one
    // screenshot in the transcript kills every turn after it — permanently,
    // because the newest images are exactly the ones carried forward. Watched
    // happen: a view_mount attached a picture, the next request 404'd with
    // "No endpoints found that support image input", and the session could
    // only be rescued by a person noticing and saying so.
    //
    // Retry without them rather than failing. The catalogue says which models
    // take images, but it can be stale or unreachable, and this is the only
    // signal that is never wrong.
    if (withImages && /image input|image support|support image/i.test(detail)) {
      withImages = false
      body = render()
      onRetry?.({ attempt, delay: 0, reason: "this model cannot read images; retrying without them" })
      continue
    }

    if (!isRetryable(response.status) || attempt === maxAttempts) throw lastError

    // Honour Retry-After when the server sends one; it knows better than we do.
    const retryAfter = Number(response.headers?.get?.("retry-after"))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * 2 ** (attempt - 1)

    onRetry?.({ attempt, delay, status: response.status })
    await sleep(delay)
  }

  throw lastError ?? new Error("OpenRouter: exhausted retries")
}

/**
 * Every model OpenRouter offers.
 *
 * No key required — the catalogue is public — so the picker can be populated
 * before anyone has pasted a credential.
 */
export async function models({ key, fetchImpl = fetch } = {}) {
  const response = await fetchImpl("https://openrouter.ai/api/v1/models", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  })
  if (!response.ok) throw new Error(`OpenRouter models ${response.status}`)
  const body = await response.json()

  return (body.data ?? [])
    .map((model) => ({
      id: model.id,
      label: model.name ?? model.id,
      context: model.context_length ?? null,
      // Prices come back as strings in dollars per token; per-million is the
      // unit people actually think in.
      promptPerM: model.pricing?.prompt ? Number(model.pricing.prompt) * 1e6 : null,
      completionPerM: model.pricing?.completion ? Number(model.pricing.completion) * 1e6 : null,
      tools: (model.supported_parameters ?? []).includes("tools"),
      // Whether a screenshot can be sent at all. A model without this rejects
      // the WHOLE request with a 404, not just the image, so it is not an
      // optional nicety — see the note on stream().
      images: (model.architecture?.input_modalities ?? []).includes("image"),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** One line for a picker: what it is, how big, what it costs. */
export function describeModel(model) {
  const parts = [model.label]
  if (model.context) parts.push(`${Math.round(model.context / 1000)}k ctx`)
  if (model.promptPerM != null) {
    parts.push(model.promptPerM === 0 ? "free" : `$${model.promptPerM.toFixed(2)}/M in`)
  }
  if (!model.tools) parts.push("no tool use")
  if (model.images) parts.push("sees images")
  return parts.join(" · ")
}

export default { id, name, stream, models, describeModel, SUGGESTED_MODELS }
