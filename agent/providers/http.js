/**
 * What every streaming provider does on the wire, whatever its format: split
 * server-sent events, read a body with a watchdog on it, and say what a
 * refusal said. A provider file (openrouter.js, chatgpt.js) keeps only its
 * own translation.
 */

import { Interruption } from "../net/network.js"

/**
 * Split a text stream into SSE `data:` payloads.
 *
 * Takes an async iterable of strings so tests can feed it chunk boundaries in
 * the awkward places real networks produce them — mid-token, mid-JSON, and
 * between `\n` and `\n`. `event:` lines are ignored: every format used here
 * repeats the event's type inside its JSON.
 */
export async function* sseEvents(chunks, seen = {}) {
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
      if (payload === "[DONE]") {
        seen.done = true
        return
      }
      yield payload
    }
  }
  const tail = buffer.trim()
  if (tail.startsWith("data:")) {
    const payload = tail.slice(5).trim()
    if (payload === "[DONE]") seen.done = true
    else if (payload) yield payload
  }
}

/**
 * Turn a fetch Response body into the async-iterable of strings a decoder
 * wants. Every chunk tells the watchdog the connection is alive; a read that
 * fails is the connection lost, which is an interruption (net/network.js) — or
 * the person stopping the run, which the loop tells apart by its signal.
 */
export async function* readBody(response, dog = null, who = "the provider") {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      let chunk
      try {
        chunk = await reader.read()
      } catch (err) {
        throw new Interruption(
          dog?.fired() ? `${who} went quiet mid-reply for ${dog.ms / 1000} s` : `The connection to ${who} dropped mid-reply`,
          { cause: err }
        )
      }
      if (chunk.done) break
      dog?.kick()
      yield decoder.decode(chunk.value, { stream: true })
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
 * What the provider said in an answer that was not ok, as plain text: the
 * message out of its JSON (`{ error: { message } }`, `{ error }`,
 * `{ message }` or `{ detail }`), or the body as it came when there is none
 * to read out.
 */
export function providerSays(detail) {
  const text = String(detail ?? "").trim()
  try {
    const json = JSON.parse(text)
    const said = [json?.error?.message, json?.error, json?.message, json?.detail].find((x) => typeof x === "string" && x.trim())
    if (said) return said.trim()
  } catch {
    /* not JSON: the body is what it said */
  }
  return text
}

/**
 * How long a connection may go without a byte before it is taken as lost. A
 * dropped link often leaves a request hanging rather than failing; both
 * providers send keep-alives or progress events while a model thinks, so a
 * live one is never this quiet.
 */
export const QUIET_MS = 120_000

/** An abort signal that also fires after `ms` without a `kick()`, following `signal`. */
export function watchdog(signal, ms) {
  const controller = new AbortController()
  let fired = false
  let timer = null
  const forward = () => controller.abort(signal.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener?.("abort", forward, { once: true })
  const dog = {
    ms,
    signal: controller.signal,
    fired: () => fired,
    kick() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fired = true
        controller.abort(new Error(`no answer for ${ms / 1000} s`))
      }, ms)
    },
    stop() {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", forward)
    },
  }
  dog.kick()
  return dog
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Statuses worth asking again for: rate limits and server faults; any other 4xx is not. */
export function isRetryable(status) {
  return status === 429 || status === 408 || (status >= 500 && status < 600)
}

/**
 * How long to wait before asking again: what the server's Retry-After says
 * when it says one (it knows better), else 0.5 s doubling.
 */
export function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"))
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1)
}
