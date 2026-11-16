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

/**
 * Models worth offering in the picker. Any OpenRouter slug works.
 *
 * OpenRouter's `~…-latest` aliases follow each family's newest release, so a
 * session started on one does not go stale when the next model ships.
 */
export const SUGGESTED_MODELS = [
  { id: "~anthropic/claude-opus-latest", label: "Claude Opus (latest)" },
  { id: "~anthropic/claude-sonnet-latest", label: "Claude Sonnet (latest)" },
  { id: "~anthropic/claude-haiku-latest", label: "Claude Haiku (latest)" },
  { id: "~google/gemini-pro-latest", label: "Gemini Pro (latest)" },
]

/** Claude caches only when asked (see buildBody). */
export function isClaude(model) {
  return /(^|[~/])anthropic\/|claude/i.test(String(model ?? ""))
}

/**
 * A stable, opaque key for a session: FNV-1a over its URL, as hex. Enough to
 * keep one session's requests together, and nothing that opens the document.
 */
export function sessionKey(url) {
  if (!url) return null
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const ch of String(url)) {
    const c = ch.codePointAt(0)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return `pw-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

/**
 * Every effort level OpenRouter's gateway knows, highest first. A model whose
 * catalogue entry says `supported_efforts: null` accepts all of them.
 */
export const ALL_EFFORTS = ["max", "xhigh", "high", "medium", "low", "minimal", "none"]

/**
 * Which effort levels a model takes, from its catalogue `reasoning` entry.
 *
 * The catalogue distinguishes three cases, and they must not be merged: no
 * `supported_efforts` at all means the model has no effort setting; `null`
 * means any level goes; a list is the levels it takes. "none" turns reasoning
 * off, which a model that must reason rejects.
 */
export function effortsOf(reasoning) {
  if (!reasoning || typeof reasoning !== "object" || !("supported_efforts" in reasoning)) {
    return { efforts: [], defaultEffort: null }
  }
  let efforts = Array.isArray(reasoning.supported_efforts) ? [...reasoning.supported_efforts] : [...ALL_EFFORTS]
  if (reasoning.mandatory) efforts = efforts.filter((effort) => effort !== "none")
  return { efforts, defaultEffort: reasoning.default_effort ?? null }
}

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

/**
 * Our parameter names against OpenRouter's. Both spellings are accepted in a
 * session's `config.params`, since people edit that document by hand.
 */
const KNOBS = [
  ["temperature", "temperature"],
  ["topP", "top_p"],
  ["topK", "top_k"],
  ["minP", "min_p"],
  ["repetitionPenalty", "repetition_penalty"],
  ["frequencyPenalty", "frequency_penalty"],
  ["presencePenalty", "presence_penalty"],
  ["seed", "seed"],
]

/**
 * `capabilities` is what the catalogue knows about this model, when it knows
 * anything: { supports: [param names] | null, maxOutput: number | null,
 * efforts: [levels] }.
 */
export function buildBody({ system, messages, tools, model, params = {}, dropImages = false, capabilities = null, cacheKey = null }) {
  const body = {
    model,
    messages: toOpenAIMessages(system, messages, { dropImages }),
    stream: true,
  }

  // Prompt caching. Every request re-sends the whole conversation, and in a
  // long session that is nearly all of the bill: one measured session spent
  // 1.2M input tokens against 19k output. Claude caches only when asked; the
  // top-level field lets the cache point advance with the conversation, so
  // each turn pays a tenth of the price for everything the last turn sent.
  // Other providers cache on their own. `session_id` keeps a session on one
  // provider so its cache is there to hit — and is a hash, not the session's
  // URL, which would hand OpenRouter a key to the document.
  if (params.cache !== false && isClaude(model)) body.cache_control = { type: "ephemeral" }
  if (cacheKey) body.session_id = cacheKey
  const t = toOpenAITools(tools)
  if (t) body.tools = t

  // Only what was chosen goes on the wire. A knob the session leaves unset is
  // not sent, so the model runs at the values its authors recommend and the
  // provider applies — which differ per model (Claude 1.0; MiMo 1.0 and top_p
  // 0.95, with a repetition penalty; others again) and which this file should
  // not have to know. A knob the catalogue says the model does not take is
  // dropped rather than sent, since some upstreams reject the whole request
  // over one.
  const supports = (name) => !Array.isArray(capabilities?.supports) || capabilities.supports.includes(name)
  for (const [ours, theirs] of KNOBS) {
    const value = params[ours] ?? params[theirs]
    if (value != null && supports(theirs)) body[theirs] = value
  }
  if (params.maxTokens != null) {
    // Asking for more than the model can produce is a 400 on some upstreams.
    const ceiling = capabilities?.maxOutput
    body.max_tokens = ceiling ? Math.min(params.maxTokens, ceiling) : params.maxTokens
  }

  // Reasoning models spend the SAME output budget on thinking as on the answer,
  // so a model that thinks for five thousand tokens can exhaust the turn before
  // it emits a single tool call — which looks exactly like an agent that wrote a
  // long plan and then did nothing. This is the lever that fixes that:
  //   { effort: "low" }      think less
  //   { max_tokens: 1024 }   think at most this much
  //   { exclude: true }      think, but do not stream it back
  if (params.reasoning != null && supports("reasoning")) {
    // An effort the model does not take is dropped, not sent: a session keeps
    // its effort when its model changes, and "max" on a model without it is a
    // rejected request. Without a catalogue entry there is nothing to check
    // against, so it goes as chosen.
    const reasoning = { ...params.reasoning }
    if (reasoning.effort != null && Array.isArray(capabilities?.efforts) && !capabilities.efforts.includes(reasoning.effort)) {
      delete reasoning.effort
    }
    if (Object.keys(reasoning).length) body.reasoning = reasoning
  }
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
      // What the request actually cost, in dollars (OpenRouter credits),
      // reported on every response; null when an upstream leaves it out.
      cost: typeof usage.cost === "number" ? usage.cost : null,
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
    // The loop may stop reading early — a model caught repeating itself, say.
    // Cancel so the connection closes rather than streaming tokens into a
    // generator nobody is iterating.
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
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
  capabilities = null,
  cacheKey = null,
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
  const render = () =>
    JSON.stringify(buildBody({ system, messages, tools, model, params, capabilities, cacheKey, dropImages: !withImages }))

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

    // An image too large for the provider — a side over 8000 pixels, or too many
    // bytes — fails the whole request in the same way, and kept failing on
    // every retry because the image was resent each time. Retry without images,
    // and say which ones were refused, so the session stops sending them.
    if (withImages && /image[\w.\s]*(dimension|exceed|too large|too big|max(imum)? allowed)/i.test(detail)) {
      withImages = false
      body = render()
      onRetry?.({ attempt, delay: 0, reason: "an image was too large for the model; retrying without images", imagesRejected: true })
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
      // What the model's authors recommend, which parameters it takes, and the
      // most it can emit in one turn. This is how the harness avoids hardcoding
      // per-model sampling: unset knobs are left to these defaults, set ones
      // are filtered against `supports`, and maxTokens is capped at `maxOutput`.
      defaults: pickDefaults(model.default_parameters),
      supports: Array.isArray(model.supported_parameters) ? model.supported_parameters : null,
      maxOutput: model.top_provider?.max_completion_tokens ?? null,
      // Which effort levels it takes, and which it uses when none is chosen.
      ...effortsOf(model.reasoning),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** The recommended sampling values the catalogue lists — numbers only; null means "no opinion". */
function pickDefaults(raw) {
  const out = {}
  for (const [name, value] of Object.entries(raw ?? {})) if (typeof value === "number") out[name] = value
  return out
}

/** "temperature 1 · top_p 0.95", or "" when the catalogue has no opinion. */
export function describeDefaults(model) {
  return Object.entries(model?.defaults ?? {})
    .map(([name, value]) => `${name} ${value}`)
    .join(" · ")
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

export default { id, name, stream, models, describeModel, describeDefaults, SUGGESTED_MODELS }
