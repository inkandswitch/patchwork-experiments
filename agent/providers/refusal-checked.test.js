/**
 * A checker's cases of a request OpenRouter refuses (providers/openrouter.js
 * stream, refusal), through a stand-in fetch: 401, 403, 429 and 500, each
 * with a JSON body and with one that is not JSON; and a 401 through a burst
 * on a real Automerge session, as the person reads it in the transcript.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { STOP, stopOf } from "../session/status.js"
import { runBurst } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"
import { stream } from "./openrouter.js"

await initSubduction()

const json = (status, message) => JSON.stringify({ error: { message, code: status } })
const KEY_WORDS = (status) => `OpenRouter refused the API key (${status}). Change it in this session's settings.`

/** A fetch that answers every request with `status` and `body`, counting them. */
function answering(status, body) {
  const f = vi.fn(async () => ({ ok: false, status, headers: { get: () => null }, text: async () => body }))
  return f
}

const refused = async (fetchImpl) => {
  try {
    for await (const _ of stream({ system: "", messages: [], model: "m", key: "made-up", fetchImpl })) {
      /* nothing streams */
    }
  } catch (err) {
    return err
  }
  return null
}

beforeEach(() => {
  _resetIds()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})
afterEach(() => vi.useRealTimers())

/** Run the refusal to its end, the provider's own retries waited out on the moved clock. */
async function refusalOf(status, body) {
  const fetchImpl = answering(status, body)
  const pending = refused(fetchImpl)
  await vi.advanceTimersByTimeAsync(60_000)
  return { err: await pending, tries: fetchImpl.mock.calls.length }
}

describe("401: the key refused, in words, with the provider's own after it", () => {
  it.each([
    [401, json(401, "User not found."), `${KEY_WORDS(401)} OpenRouter said: User not found.`],
    [401, "Unauthorized", `${KEY_WORDS(401)} OpenRouter said: Unauthorized`],
    [401, "", KEY_WORDS(401)],
  ])("%s with %j", async (status, body, says) => {
    const { err, tries } = await refusalOf(status, body)
    expect(err.message).toBe(says)
    expect(err.interruption).toBeFalsy()
    // Not asked again: a refused key stays refused.
    expect(tries).toBe(1)
    expect(err.message).not.toMatch(/"error"|"code"|[{}]/)
  })
})

describe("a 403 is not the key: it keeps its status and the provider's words", () => {
  it.each([
    [json(403, "Your chosen model requires moderation."), "OpenRouter 403: Your chosen model requires moderation."],
    ["<html><body>Forbidden</body></html>", "OpenRouter 403: <html><body>Forbidden</body></html>"],
  ])("403 with %j", async (body, says) => {
    const { err, tries } = await refusalOf(403, body)
    expect(err.message).toBe(says)
    expect(err.interruption).toBeFalsy()
    expect(tries).toBe(1)
  })
})

describe("other statuses keep their status, and the message is read out of JSON where there is one", () => {
  it("500 with JSON, after the provider's retries: its status and its message", async () => {
    const { err, tries } = await refusalOf(500, json(500, "Internal Server Error"))
    expect(err.message).toBe("OpenRouter 500: Internal Server Error")
    expect(err.interruption).toBeFalsy()
    expect(tries).toBe(4)
  })

  it("500 with a body that is not JSON: its status and the body as text", async () => {
    const { err } = await refusalOf(500, "upstream connect error")
    expect(err.message).toBe("OpenRouter 500: upstream connect error")
  })

  it("429 with JSON, after the provider's retries: a wait for the network, with the status; the provider's words on the cause", async () => {
    const { err, tries } = await refusalOf(429, json(429, "Rate limit exceeded: free-models-per-day."))
    expect(tries).toBe(4)
    expect(err.interruption).toBe(true)
    expect(err.message).toBe("OpenRouter is not taking requests just now (429: Rate limit exceeded: free-models-per-day.)")
    expect(err.cause.message).toBe("OpenRouter 429: Rate limit exceeded: free-models-per-day.")
  })

  it("429 with a body that is not JSON: the same, the body as text on the cause", async () => {
    const { err } = await refusalOf(429, "Too Many Requests")
    expect(err.message).toBe("OpenRouter is not taking requests just now (429: Too Many Requests)")
    expect(err.cause.message).toBe("OpenRouter 429: Too Many Requests")
  })
})

describe("a 401 in a burst, as the person reads it", () => {
  it("the session's error notice says the key was refused and where to change it, with no JSON; one request; the burst ends", async () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create()
    handle.change((d) => {
      initSession(d, {})
      d.burst = null
      d.turns.push(makeTurn("user", [textBlock("hello")]))
    })
    const fetchImpl = answering(401, json(401, "User not found."))
    const controller = new AbortController()
    const done = runBurst(
      { repo, signal: controller.signal, run: "run-1", taskUrl: "automerge:task", settled: Promise.resolve(), progress: () => {}, log: () => {} },
      {
        session: handle.url,
        taskRuns: () => ["run-1"],
        getProvider: async () => ({ stream: (request) => stream({ ...request, fetchImpl }) }),
        buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
        key: "made-up-key",
        flushMs: 5,
      }
    )
    await vi.advanceTimersByTimeAsync(1000)
    const result = await done
    expect(result.outcome).toBe(OUTCOME.error)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const doc = JSON.parse(JSON.stringify(handle.doc()))
    const stop = stopOf(doc)
    expect(stop.kind).toBe(STOP.error)
    expect(stop.text).toBe(`${KEY_WORDS(401)} OpenRouter said: User not found.`)
    expect(doc.turns.map((t) => t.role)).toEqual(["user", "assistant"])
    expect(doc.reconnecting ?? null).toBe(null)
    expect(doc.burst ?? null).toBe(null)
  })
})
