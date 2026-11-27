/**
 * ChatGPT from a browser: its plan route answers no page (no CORS on a real
 * reply), so a browser's run reaches it through the relay's lane
 * (net/relay.js laneFetch, fetch-relay/relay.js LANES). What goes to the
 * relay, what comes back, and what each failure becomes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { laneFetch, throughRelay, API_LANES, RelayNeeded } from "../net/relay.js"
import { isInterruption } from "../net/network.js"
import * as chatgpt from "./chatgpt.js"
import * as openrouter from "./openrouter.js"

const RELAY = { url: "https://relay.test", key: "rk" }
const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const TOKEN = `${b64({ alg: "RS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`
const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")
const REPLY = sse({ type: "response.output_text.delta", delta: "hi" }, { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 1 } } })

async function collect(iterable) {
  const out = []
  for await (const event of iterable) out.push(event)
  return out
}
const ask = (provider, opts = {}) =>
  collect(provider.stream({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [], model: "gpt-test", params: {}, key: TOKEN, maxAttempts: 2, ...opts }))

beforeEach(() => chatgpt._resetTurnedDown())

describe("laneFetch", () => {
  it("sends a lane's address to the relay's lane: method, body and token as they were, plus the relay's key", async () => {
    const send = vi.fn(async () => new Response("{}"))
    await laneFetch({ fetch: send, relay: () => RELAY })("https://api.openai.com/v1/responses", { method: "POST", body: "{}", headers: { authorization: "Bearer t", "content-type": "application/json" } })
    const [url, init] = send.mock.calls[0]
    expect(url).toBe("https://relay.test/openai/v1/responses")
    expect(init).toMatchObject({ method: "POST", body: "{}", headers: { authorization: "Bearer t", "content-type": "application/json", "x-relay-key": "rk" } })
  })

  it("leaves every other address alone: OpenRouter, and a site", async () => {
    const send = vi.fn(async () => new Response("{}"))
    const laned = laneFetch({ fetch: send, relay: () => RELAY })
    await laned("https://openrouter.ai/api/v1/chat/completions", { method: "POST" })
    await laned("https://maker.test/page")
    expect(send.mock.calls.map(([url]) => url)).toEqual(["https://openrouter.ai/api/v1/chat/completions", "https://maker.test/page"])
  })

  it("covers exactly the relay's lanes", () => {
    expect(Object.values(API_LANES)).toEqual(["/openai/v1/responses", "/openai/v1/models"])
  })
})

describe("ChatGPT through the relay", () => {
  it("streams a reply that came by the relay's lane", async () => {
    const send = vi.fn(async () => new Response(REPLY, { headers: { "content-type": "text/event-stream" } }))
    const events = await ask(throughRelay(chatgpt, RELAY), { fetchImpl: send })
    expect(send.mock.calls[0][0]).toBe("https://relay.test/openai/v1/responses")
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual(["hi"])
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" })
  })

  it("with no relay set, says so at once — not a network wait that never ends", async () => {
    const send = vi.fn()
    const err = await ask(throughRelay(chatgpt, null), { fetchImpl: send }).catch((e) => e)
    expect(err).toBeInstanceOf(RelayNeeded)
    expect(isInterruption(err)).toBe(false)
    expect(err.message).toMatch(/fetch relay/)
    expect(send).not.toHaveBeenCalled()
  })

  it("a relay that refuses (a wrong key) is an error naming the relay, never a sign-in to redo", async () => {
    const send = vi.fn(async () => new Response("missing or wrong x-relay-key", { status: 401, headers: { "x-relay-error": "missing or wrong x-relay-key" } }))
    const err = await ask(throughRelay(chatgpt, RELAY), { fetchImpl: send }).catch((e) => e)
    expect(isInterruption(err)).toBe(false)
    expect(err.message).toMatch(/relay refused.*x-relay-key/)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("a relay out of reach, or reporting OpenAI out of reach, is the network: an interruption that says which", async () => {
    const gone = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    const err = await ask(throughRelay(chatgpt, RELAY), { fetchImpl: gone }).catch((e) => e)
    expect(isInterruption(err)).toBe(true)
    expect(err.message).toMatch(/fetch relay could not be reached/)

    const far = vi.fn(async () => new Response("down", { status: 502, headers: { "x-relay-error": "connect timeout" } }))
    const err2 = await ask(throughRelay(chatgpt, RELAY), { fetchImpl: far }).catch((e) => e)
    expect(isInterruption(err2)).toBe(true)
    expect(err2.message).toMatch(/could not reach api\.openai\.com/)
  })

  it("an API refusal passed on by the relay is ChatGPT's own, read as before", async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }), { status: 429 }))
    const err = await ask(throughRelay(chatgpt, RELAY), { fetchImpl: send }).catch((e) => e)
    expect(err.message).toMatch(new RegExp(chatgpt.USAGE_URL.replace(/[.]/g, "\\.")))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("lists the plan's models by the relay's lane too", async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ models: [{ slug: "gpt-x", display_name: "X", visibility: "list" }] })))
    const listed = await throughRelay(chatgpt, RELAY).models({ key: TOKEN, fetchImpl: send })
    expect(send.mock.calls[0][0]).toBe("https://relay.test/openai/v1/models")
    expect(listed.map((m) => m.id)).toEqual(["gpt-x"])
  })

  it("leaves OpenRouter's requests where they went, relay or none", async () => {
    const send = vi.fn(async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }))
    await ask(throughRelay(openrouter, null), { fetchImpl: send, key: "sk-or-x" }).catch(() => {})
    expect(send.mock.calls[0][0]).toMatch(/^https:\/\/openrouter\.ai\//)
  })
})
