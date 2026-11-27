/**
 * ChatGPT plan adapter: OpenAI's Responses API, paid for by the person's
 * ChatGPT plan through Sign in with ChatGPT (providers/chatgpt-auth.js).
 *
 * The credential is an OAuth access token, not an API key: an hour long,
 * renewed by the page that asks for a run (runners/page.js askFor). A run
 * handed one that has run out stops for a fresh one (`renew` below) rather
 * than send a request that would be refused.
 *
 * What this route asks of a request (OpenAI's "preview limitations" for plan
 * usage), all of it honoured in buildBody:
 *
 *   - `store: false` and `stream: true` on every request, the whole history in
 *     `input`, and no `previous_response_id`;
 *   - no system-role items (the system prompt is a developer message), and none
 *     of temperature, top_p, max_output_tokens, truncation, metadata, user,
 *     safety_identifier or prompt_cache_retention;
 *   - function tools grouped in a namespace;
 *   - success only on `response.completed`.
 *
 * And what it uses of the API, to spend less of the plan:
 *
 *   - Each reply's own output items — the model's encrypted reasoning, and
 *     each message's `phase` — are kept on the turn (`carry`) and sent back
 *     exactly as they came. The model goes on thinking from where it was
 *     between tool calls instead of working it out again, and nothing it sent
 *     changes in the prefix the prompt cache matches.
 *   - The system prompt is the first input item (a developer message, which
 *     the prompt cache can reuse, where top-level `instructions` are billed
 *     afresh every time), and `prompt_cache_key` keeps a session's requests
 *     together. No explicit cache breakpoint: every model on the plan route
 *     refused one (probes/live-chatgpt.mjs, 2026-11-27), and that route
 *     reported no cached tokens at all.
 *   - Screenshots and PDFs a tool hands back go inside the tool's own output,
 *     not as a message after it.
 *
 * A feature the route turns down (`subscription_sharing_unsupported_capability`
 * naming it, or a 400 that names it) is dropped and the request sent again
 * once; the model is remembered for the rest of the process. The preview's
 * limits move, and a refused request costs nothing.
 */

import { Interruption } from "../net/network.js"
import { sseEvents, readBody, providerSays, watchdog, sleep, isRetryable, retryDelay, QUIET_MS } from "./http.js"

export const id = "chatgpt"
export const name = "ChatGPT plan"

/** The credential is a sign-in, not a pasted key (providers/keys.js). */
export const signIn = true

const API = "https://api.openai.com/v1"

/** Where a person sees and limits what Patchwork spends of their plan. */
export const USAGE_URL = "https://chatgpt.com/settings/usage"

/** The namespace every tool is offered under; the route takes function tools only inside one. */
export const NAMESPACE = "patchwork"

const NAMESPACE_DESCRIPTION = "Tools for working in Patchwork: the person's documents, the tools that open them, and the web."

/**
 * The model a session starts on, and each workflow tier's (workflow/plan.js).
 * OpenAI's own guidance: Sol for everyday agent work, Astra for the hardest,
 * Luna for volume. Any slug the account lists works.
 */
export const DEFAULT_MODEL = "gpt-6.2-sol"

export const TIER_MODELS = { deep: "gpt-6.2-astra", standard: "gpt-6.2-sol", fast: "gpt-6-luna" }

export const SUGGESTED_MODELS = [
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra" },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
]

/**
 * Features this adapter adds that a model or the route may turn down, each
 * with what names it in a refusal. Dropping one changes what is spent or
 * shown, never what the request means.
 */
export const OPTIONAL = {
  cacheKey: /^prompt_cache_key$/,
  streamOptions: /^stream_options(\.|$)/,
  include: /^include(\[|$)/,
  summary: /^reasoning\.summary$/,
  namespace: /^tools(\[\d+\](\.type)?)?$/,
  verbosity: /^text(\.verbosity)?$/,
  mode: /^reasoning\.mode$/,
}

// ---------------------------------------------------------------- outbound

/** What separates a turn's text parts when they become one input text (providers/openrouter.js PARTS). */
const PARTS = "\n\n"

/**
 * A reply's output items, kept to be sent back as they came: reasoning,
 * messages, and function calls — the kinds this adapter asks for. Null when
 * there is nothing a replay adds (no reasoning and no phase), so a turn
 * carries nothing it does not need.
 */
export function carryOf(items) {
  const kept = (items ?? []).filter((item) => item && ["reasoning", "message", "function_call"].includes(item.type))
  const worth = kept.some((item) => item.type === "reasoning" || (item.type === "message" && item.phase))
  return worth ? { items: kept } : null
}

/**
 * Is this carry the turn as the transcript holds it? Only then is it sent in
 * the turn's place: the same text, and the same calls in the same order. The
 * harness can drop what a reply said — a repeating model's calls, a call cut
 * off mid-arguments — and a carry that disagrees with the transcript would
 * tell the model it did what it did not.
 */
export function carryFits(carry, texts, calls) {
  const items = carry?.items
  if (!Array.isArray(items)) return false
  const said = items
    .filter((item) => item.type === "message")
    .flatMap((item) => (item.content ?? []).map((part) => (part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : "")))
    .join("")
  if (said !== texts.join("")) return false
  const carried = items.filter((item) => item.type === "function_call").map((item) => item.call_id)
  return carried.length === calls.length && carried.every((callId, i) => callId === calls[i].id)
}

/** A file as the Responses API takes it inline. */
function fileInput(file) {
  return { type: "input_file", filename: file.name ?? "document.pdf", file_data: file.data }
}

/**
 * Neutral messages -> Responses input items.
 *
 * One neutral turn can become several items: an assistant turn is its
 * messages and function calls (or its carry), and every result is a
 * `function_call_output` after it. A screenshot or PDF a tool handed over
 * goes inside that output.
 */
export function toInput(system, messages, { dropImages = false, namespaced = true } = {}) {
  const input = []
  if (system) input.push({ type: "message", role: "developer", content: [{ type: "input_text", text: system }] })

  for (const msg of messages) {
    const texts = []
    const calls = []
    const results = []
    const images = []
    const files = []
    for (const part of msg.content ?? []) {
      if (part.type === "text") texts.push(part.text)
      else if (part.type === "call") calls.push(part)
      else if (part.type === "result") results.push(part)
      else if (part.type === "image" && !dropImages) images.push(part.image)
      else if (part.type === "file" && part.data) files.push(part)
    }

    if (msg.role === "assistant" || calls.length) {
      const carry = msg.carry?.provider === id ? msg.carry.data : null
      if (carry && carryFits(carry, texts, calls)) {
        for (const item of carry.items) input.push(replayItem(item, namespaced))
      } else {
        const text = texts.join(PARTS)
        if (text) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] })
        for (const call of calls) input.push(functionCall(call, namespaced))
      }
    } else if (texts.length || images.length || files.length) {
      // The route refuses system-role items; a developer message is the same authority.
      const role = msg.role === "system" ? "developer" : "user"
      const content = []
      if (texts.length) content.push({ type: "input_text", text: texts.join(PARTS) })
      if (role === "user") {
        for (const url of images) content.push({ type: "input_image", image_url: url })
        for (const file of files) content.push(fileInput(file))
      }
      input.push({ type: "message", role, content })
    }

    for (const r of results) {
      const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
      const extras = []
      if (r.image && !dropImages) extras.push({ type: "input_image", image_url: r.image })
      if (r.file?.data) extras.push(fileInput(r.file))
      input.push({
        type: "function_call_output",
        call_id: r.callId,
        output: extras.length ? [{ type: "input_text", text }, ...extras] : text,
      })
    }
  }
  return input
}

function functionCall(call, namespaced) {
  const item = { type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.input ?? {}) }
  if (namespaced) item.namespace = NAMESPACE
  return item
}

/**
 * A carried item as it goes back: exactly as it came (OpenAI's own replay is
 * `input += response.output`; a message item's `status` is required on input).
 * Only a call's namespace goes when tools are sent without one.
 */
function replayItem(item, namespaced) {
  if (item.type === "function_call" && !namespaced && "namespace" in item) {
    const { namespace: _namespace, ...rest } = item
    return rest
  }
  return item
}

/** Neutral tool definitions -> one namespace of function tools (or the functions alone). */
export function toTools(tools = [], { namespaced = true } = {}) {
  if (!tools.length) return undefined
  const functions = tools.map((t) => ({
    type: "function",
    name: t.id,
    description: t.description ?? "",
    parameters: t.input_schema ?? { type: "object", properties: {} },
    // The tools' schemas are written with optional fields; strict mode would
    // make every one required and send nulls where the tools expect nothing.
    strict: false,
  }))
  return namespaced ? [{ type: "namespace", name: NAMESPACE, description: NAMESPACE_DESCRIPTION, tools: functions }] : functions
}

/**
 * The request body. `drop` is the set of OPTIONAL features not to send.
 *
 * Nothing from `params` the route refuses is sent (temperature, top_p,
 * maxTokens, …): those knobs are the session's for other providers and are
 * left where they are. What this route does take: the reasoning effort and
 * mode, `exclude` (no thinking streamed back), and `verbosity`.
 */
export function buildBody({ system, messages, tools, model, params = {}, dropImages = false, capabilities = null, cacheKey = null, drop = new Set() }) {
  const namespaced = !drop.has("namespace")
  const body = {
    model,
    input: toInput(system, messages, { dropImages, namespaced }),
    store: false,
    stream: true,
  }
  const t = toTools(tools, { namespaced })
  if (t) body.tools = t

  // The model's thinking, encrypted, comes back on every reasoning item; it is
  // what the carry replays. Asked for by name too, for models from before
  // stateless replies carried it by default.
  if (!drop.has("include")) body.include = ["reasoning.encrypted_content"]
  // Bandwidth only: the padding that hides token lengths on the wire.
  if (!drop.has("streamOptions")) body.stream_options = { include_obfuscation: false }
  if (cacheKey && !drop.has("cacheKey")) body.prompt_cache_key = cacheKey

  const reasoning = {}
  const chosen = params.reasoning ?? {}
  // An effort the model does not take is dropped, not sent (providers/openrouter.js).
  if (chosen.effort != null && (!Array.isArray(capabilities?.efforts) || !capabilities.efforts.length || capabilities.efforts.includes(chosen.effort))) {
    reasoning.effort = chosen.effort
  }
  if (chosen.mode != null && !drop.has("mode")) reasoning.mode = chosen.mode
  // The summary is what the transcript shows of the thinking; `exclude` asks for none.
  if (!chosen.exclude && !drop.has("summary")) reasoning.summary = "auto"
  if (Object.keys(reasoning).length) body.reasoning = reasoning

  if (params.verbosity != null && !drop.has("verbosity")) body.text = { verbosity: params.verbosity }
  return body
}

// ---------------------------------------------------------------- inbound

/** A refusal from the route, with what OpenAI said and what to do. */
export class ChatGPTError extends Error {
  constructor(message, { code = null, param = null, status = null } = {}) {
    super(message)
    this.name = "ChatGPTError"
    this.code = code
    this.param = param
    this.status = status
  }
}

const SIGN_IN_AGAIN = "Sign in to ChatGPT again in the agent's settings."

/**
 * What a refusal means, from its code (OpenAI's "errors and recovery"):
 * an Interruption when waiting will do, an error a person must act on
 * otherwise. `renew` marks the one a fresh sign-in token fixes.
 */
export function failure({ status = null, code = null, param = null, message = "" }) {
  const said = String(message ?? "").slice(0, 400)
  const tail = said ? ` OpenAI said: ${said}` : ""
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return new ChatGPTError(`Your ChatGPT plan's usage limit for Patchwork is reached. See or raise it at ${USAGE_URL}.`, { code, param, status })
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return new Interruption(`ChatGPT could not check this plan's usage just now (${code})`)
    case "subscription_sharing_user_not_eligible":
      return new ChatGPTError(`This ChatGPT account or workspace cannot use its plan in other apps.${tail}`, { code, param, status })
    case "subscription_sharing_invalid_user":
      return new ChatGPTError(`ChatGPT could not confirm this sign-in. ${SIGN_IN_AGAIN}${tail}`, { code, param, status })
    case "subscription_sharing_unsupported_capability":
      return new ChatGPTError(`ChatGPT's plan route does not take ${param ? `\`${param}\`` : "part of this request"}.${tail}`, { code, param, status })
    default:
      break
  }
  if (status === 401) return new ChatGPTError(`ChatGPT refused the sign-in (401). ${SIGN_IN_AGAIN}${tail}`, { code, param, status })
  if (status === 403) return new ChatGPTError(`ChatGPT refused this request (403${code ? `, ${code}` : ""}).${tail}`, { code, param, status })
  // Mid-stream, with no status: the model's own fault or a rate limit, both "not now".
  if (status == null && (code === "server_error" || code === "rate_limit_exceeded")) return new Interruption(`ChatGPT is not taking requests just now (${code})`)
  return new ChatGPTError(`ChatGPT${status ? ` ${status}` : ""}${code ? ` (${code})` : ""}:${said ? ` ${said}` : " the request failed"}`, { code, param, status })
}

/**
 * Which OPTIONAL feature a refusal names, if any: by its `param` alone, the
 * one field that names a part of the request exactly, never by its wording.
 * The namespace is dropped only when the refusal says it is namespaces that
 * are refused, since the route takes function tools only inside one.
 */
export function droppable({ code = null, param = null, message = "" } = {}, sent = new Set()) {
  if (typeof param !== "string" || !param) return null
  if (code && code !== "subscription_sharing_unsupported_capability" && !/unknown_parameter|unsupported_parameter|invalid_parameter|invalid_request|unsupported_value/.test(code)) return null
  for (const [feature, names] of Object.entries(OPTIONAL)) {
    if (!sent.has(feature) || !names.test(param)) continue
    if (feature === "namespace" && !/namespace/i.test(String(message ?? ""))) continue
    return feature
  }
  return null
}

/**
 * SSE payloads -> neutral events.
 *
 * Text and the reasoning summary stream as they come. A call is emitted
 * whole, from its `response.output_item.done`, once the reply has completed;
 * so is the carry (the items as they were done, which is where the encrypted
 * reasoning is whole). Only `response.completed` (or `incomplete`, which says
 * why it stopped) is an answer: a body that ends before one was cut off, and
 * is an interruption.
 */
export async function* decodeStream(chunks) {
  const done = new Map() // output_index -> item
  let usage = null
  let stopReason = "end"
  let finished = false
  let completed = false
  let summaryPart = null

  for await (const payload of sseEvents(chunks)) {
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) yield { type: "text", delta: event.delta }
        break
      case "response.refusal.delta":
        if (event.delta) yield { type: "text", delta: event.delta }
        break
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta": {
        // A new summary part starts a new paragraph.
        const part = `${event.item_id ?? ""}:${event.summary_index ?? event.content_index ?? 0}`
        if (summaryPart !== null && summaryPart !== part) yield { type: "reasoning", delta: "\n\n" }
        summaryPart = part
        if (event.delta) yield { type: "reasoning", delta: event.delta }
        break
      }
      case "response.output_item.done":
        if (event.item) done.set(event.output_index ?? done.size, event.item)
        break
      case "response.completed":
        finished = true
        completed = true
        usage = event.response?.usage ?? null
        // Items the reply lists that no `done` event brought (it should not happen).
        for (const [i, item] of (event.response?.output ?? []).entries()) if (!done.has(i)) done.set(i, item)
        break
      case "response.incomplete": {
        finished = true
        usage = event.response?.usage ?? null
        const reason = event.response?.incomplete_details?.reason ?? "incomplete"
        stopReason = reason === "max_output_tokens" ? "length" : reason
        break
      }
      case "response.failed": {
        const error = event.response?.error ?? {}
        throw failure({ code: error.code ?? null, param: error.param ?? null, message: error.message ?? "" })
      }
      case "error":
        throw failure({ code: event.code ?? null, param: event.param ?? null, message: event.message ?? "" })
      default:
        break
    }
  }

  if (!finished) throw new Interruption("The reply from ChatGPT ended before it was finished")

  const items = [...done.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  let calls = 0
  for (const item of items) {
    if (item.type !== "function_call") continue
    let input = {}
    let parseError = null
    try {
      input = item.arguments ? JSON.parse(item.arguments) : {}
    } catch (err) {
      parseError = String(err?.message ?? err)
    }
    calls++
    yield { type: "call", id: item.call_id, name: item.name, input, parseError, argsLength: item.arguments?.length ?? 0 }
  }
  if (calls && stopReason === "end") stopReason = "tool_use"

  // Kept only from a reply that completed: an incomplete one is not sent back whole.
  const carry = completed ? carryOf(items) : null
  if (carry) yield { type: "carry", data: carry }

  if (usage) {
    yield {
      type: "usage",
      in: usage.input_tokens ?? 0,
      out: usage.output_tokens ?? 0,
      cached: usage.input_tokens_details?.cached_tokens ?? 0,
      reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
      // Paid for by the plan: there is no price per request to report.
      cost: null,
    }
  }
  yield { type: "stop", reason: stopReason }
}

// ---------------------------------------------------------------- the request

/** When a sign-in token runs out, from its own `exp` claim; null when it cannot be read. */
export function expiresAt(token) {
  try {
    const payload = String(token).split(".")[1]
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")))
    return typeof json.exp === "number" ? json.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * The token out of a credential, and when it runs out: the page's own
 * reckoning when it handed one (`{ token, expiresAt }`, providers/keys.js
 * freshCredential), else the token's `exp`. The page renews a token with
 * less than ten minutes left by its clock, and a run gives one up with less
 * than a minute left by the same number, so a skewed clock cannot make the
 * two disagree and ask and renew in a loop.
 */
export function credentialOf(key) {
  if (key && typeof key === "object") {
    const token = typeof key.token === "string" ? key.token : null
    return { token, expiresAt: typeof key.expiresAt === "number" ? key.expiresAt : token ? expiresAt(token) : null }
  }
  return { token: typeof key === "string" && key ? key : null, expiresAt: typeof key === "string" ? expiresAt(key) : null }
}

/** How close to its end a token is not used: past this, a fresh one is asked for. */
export const RENEW_MARGIN_MS = 60_000

/** The interruption that ends a run so the page asks again with a fresh token (kernel/burst.js). */
export function renewal() {
  const err = new Interruption("The ChatGPT sign-in token ran out; waiting for a fresh one")
  err.renew = true
  return err
}

/** Features the route has turned down, per model, for the life of this process. */
const turnedDown = new Map()

/** Tests only. */
export function _resetTurnedDown() {
  turnedDown.clear()
}

/** Which OPTIONAL features a body sends. */
function sentFeatures(body) {
  const sent = new Set()
  if (body.prompt_cache_key) sent.add("cacheKey")
  if (body.stream_options) sent.add("streamOptions")
  if (body.include) sent.add("include")
  if (body.reasoning?.summary) sent.add("summary")
  if (body.reasoning?.mode) sent.add("mode")
  if (body.text?.verbosity) sent.add("verbosity")
  if (body.tools?.[0]?.type === "namespace") sent.add("namespace")
  return sent
}

/** A refusal's body, read for what the codes table needs. */
function readRefusal(status, detail) {
  try {
    const json = JSON.parse(detail)
    const error = json?.error && typeof json.error === "object" ? json.error : null
    return { status, code: error?.code ?? null, param: error?.param ?? null, message: error?.message ?? providerSays(detail) }
  } catch {
    return { status, code: null, param: null, message: providerSays(detail) }
  }
}

/** Statuses that say "not now": past the retries, an interruption (providers/openrouter.js NOT_NOW). */
const NOT_NOW = new Set([408, 429, 500, 502, 503, 504])

/**
 * Stream a reply, retrying what is worth retrying before the first byte
 * (providers/openrouter.js stream has the same contract). `key` is the
 * sign-in's access token, passed per call and never kept.
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
  quietMs = QUIET_MS,
  now = Date.now,
}) {
  const { token, expiresAt: exp } = credentialOf(key)
  if (!token) throw new ChatGPTError(`Not signed in to ChatGPT. ${SIGN_IN_AGAIN}`)

  let withImages = params?.images !== false
  const drop = new Set(turnedDown.get(model) ?? [])
  let body
  const render = () => {
    body = buildBody({ system, messages, tools, model, params, capabilities, cacheKey, dropImages: !withImages, drop })
    return JSON.stringify(body)
  }
  let text = render()
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return
    // A token about to run out is not sent: the run stops and asks for a new one.
    if (exp !== null && exp - now() < RENEW_MARGIN_MS) throw renewal()

    let response
    const dog = watchdog(signal, quietMs)
    try {
      response = await fetchImpl(`${API}/responses`, {
        method: "POST",
        signal: dog.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: text,
      })
    } catch (err) {
      dog.stop()
      if (signal?.aborted) throw err
      // Nothing asking again can mend: no relay in a browser, or the relay refusing (net/relay.js).
      if (err?.final) throw err
      const why = dog.fired() ? `no answer for ${quietMs / 1000} s` : String(err?.message ?? err)
      lastError = err?.interruption && !dog.fired() ? err : new Interruption(`Could not reach ChatGPT (${why})`, { cause: err })
      if (attempt === maxAttempts) throw lastError
      const delay = 500 * 2 ** (attempt - 1)
      onRetry?.({ attempt, delay, reason: why })
      await sleep(delay)
      continue
    }

    if (response.ok) {
      try {
        yield* decodeStream(readBody(response, dog, "ChatGPT"))
      } finally {
        dog.stop()
      }
      return
    }
    dog.stop()

    const detail = await response.text().catch(() => "")
    const refused = readRefusal(response.status, detail)

    // A token that ran out while waiting in line is a renewal, not a refusal.
    if (response.status === 401 && exp !== null && exp - now() < RENEW_MARGIN_MS) throw renewal()

    // A feature the route will not take: send the request again without it.
    const feature = response.status === 400 ? droppable(refused, sentFeatures(body)) : null
    if (feature) {
      drop.add(feature)
      turnedDown.set(model, new Set(drop))
      text = render()
      onRetry?.({ attempt, delay: 0, reason: `ChatGPT does not take ${feature} here; sending without it` })
      attempt-- // not an attempt at the request: a different request
      continue
    }

    // Images the model cannot take, or too large: without them (providers/openrouter.js).
    if (withImages && /image/i.test(`${refused.param ?? ""} ${refused.message}`) && response.status === 400) {
      withImages = false
      text = render()
      onRetry?.({ attempt, delay: 0, reason: "the model refused an image; retrying without images", imagesRejected: true })
      continue
    }

    lastError = failure(refused)
    // A limit reached is the person's to raise; asking again only spends their wait.
    if (refused.code === "subscription_sharing_usage_limit_exceeded") throw lastError
    if (!lastError.interruption && !isRetryable(response.status)) throw lastError
    if (attempt === maxAttempts) {
      if (lastError.interruption) throw lastError
      if (NOT_NOW.has(response.status)) {
        throw new Interruption(`ChatGPT is not taking requests just now (${response.status}${refused.message ? `: ${String(refused.message).slice(0, 200)}` : ""})`, { cause: lastError })
      }
      throw lastError
    }
    const delay = retryDelay(response, attempt)
    onRetry?.({ attempt, delay, status: response.status })
    await sleep(delay)
  }
  throw lastError ?? new ChatGPTError("ChatGPT: exhausted retries")
}

// ---------------------------------------------------------------- models

/**
 * The models this account may use, in the order OpenAI lists them. Needs the
 * sign-in: which models a plan has is the account's. Fields beyond the slug
 * and name are read where the catalogue gives them and left null where not.
 */
export async function models({ key, fetchImpl = fetch } = {}) {
  const { token } = credentialOf(key)
  if (!token) throw new ChatGPTError(`Not signed in to ChatGPT. ${SIGN_IN_AGAIN}`)
  const response = await fetchImpl(`${API}/models`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`ChatGPT models ${response.status}: ${providerSays(await response.text().catch(() => "")).slice(0, 200)}`)
  const body = await response.json()
  const list = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : []
  return list
    .filter((m) => m && (m.visibility == null || m.visibility === "list"))
    .map((m) => {
      const efforts = effortsOf(m)
      return {
        id: m.slug ?? m.id,
        label: m.display_name ?? m.name ?? m.slug ?? m.id,
        context: m.context_window ?? m.context_length ?? null,
        // The plan pays: no price per token.
        promptPerM: null,
        completionPerM: null,
        tools: m.supports_tools !== false,
        images: Array.isArray(m.input_modalities) ? m.input_modalities.includes("image") : true,
        defaults: {},
        supports: null,
        maxOutput: m.max_output_tokens ?? null,
        ...efforts,
      }
    })
    .filter((m) => typeof m.id === "string" && m.id)
}

/** Which effort levels a catalogue entry lists, under whichever name it uses. */
function effortsOf(m) {
  const raw = m.supported_reasoning_levels ?? m.supported_reasoning_efforts ?? m.reasoning?.supported_efforts ?? null
  // "ultra" is effort with automatic delegation to sub-agents, which the
  // plan route does not take (its preview limitations: no multi_agent).
  const efforts = Array.isArray(raw) ? raw.map((level) => (typeof level === "string" ? level : level?.effort)).filter((e) => typeof e === "string" && e !== "ultra") : []
  const defaultEffort = m.default_reasoning_level ?? m.default_reasoning_effort ?? m.reasoning?.default_effort ?? null
  return { efforts, defaultEffort: typeof defaultEffort === "string" ? defaultEffort : null }
}

/** One line for a picker. */
export function describeModel(model) {
  const parts = [model.label]
  if (model.context) parts.push(`${Math.round(model.context / 1000)}k ctx`)
  if (model.efforts?.length) parts.push(`effort ${model.efforts[0]}–${model.efforts[model.efforts.length - 1]}`)
  parts.push("on your plan")
  return parts.join(" · ")
}

/** The plan's models run at their own defaults; there are none to show. */
export function describeDefaults() {
  return ""
}

export default {
  id,
  name,
  signIn,
  stream,
  models,
  describeModel,
  describeDefaults,
  SUGGESTED_MODELS,
  DEFAULT_MODEL,
  TIER_MODELS,
  USAGE_URL,
}
