import { describe, it, expect } from "vitest"
import { stream, decodeStream, NOT_NOW } from "./openrouter.js"
import { isInterruption } from "../network.js"

const enc = new TextEncoder()

/** A body that sends `chunks`, then ends — or fails with `fail` instead of ending. */
function body(chunks, { fail = null, hang = false } = {}) {
  let i = 0
  return {
    getReader: () => ({
      read: () => {
        if (i < chunks.length) return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) })
        if (fail) return Promise.reject(fail)
        if (hang) return new Promise(() => {})
        return Promise.resolve({ done: true })
      },
      cancel: async () => {},
      releaseLock() {},
    }),
  }
}

const ok = (b) => ({ ok: true, status: 200, body: b })
const status = (n) => ({ ok: false, status: n, headers: { get: () => null }, text: async () => `status ${n}` })
const run = async (opts) => {
  const events = []
  for await (const e of stream({ system: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], model: "m", key: "k", ...opts })) events.push(e)
  return events
}
const thrown = (p) => p.then(() => null, (err) => err)

describe("what an interrupted model call throws", () => {
  it("no answer at all, past the retries: an interruption", async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      throw new TypeError("Failed to fetch")
    }
    const err = await thrown(run({ fetchImpl, maxAttempts: 2 }))
    expect(calls).toBe(2)
    expect(isInterruption(err)).toBe(true)
    expect(err.message).toMatch(/Could not reach OpenRouter \(Failed to fetch\)/)
  })

  it("every 'not now' status, past the retries: an interruption", async () => {
    for (const n of NOT_NOW) {
      const err = await thrown(run({ fetchImpl: async () => status(n), maxAttempts: 1 }))
      expect(isInterruption(err), String(n)).toBe(true)
    }
  })

  it("a 500 or a 4xx is an error, not an interruption: waiting would not change it", async () => {
    for (const n of [500, 400, 401, 402, 404]) {
      const err = await thrown(run({ fetchImpl: async () => status(n), maxAttempts: 1 }))
      expect(err, String(n)).toBeInstanceOf(Error)
      expect(isInterruption(err), String(n)).toBe(false)
    }
  })

  it("a connection dropped mid-reply: an interruption, after what had arrived", async () => {
    const fetchImpl = async () => ok(body(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'], { fail: new TypeError("network error") }))
    const events = []
    const err = await thrown(
      (async () => {
        for await (const e of stream({ system: "", messages: [], model: "m", key: "k", fetchImpl })) events.push(e)
      })()
    )
    expect(events).toEqual([{ type: "text", delta: "Hel" }])
    expect(isInterruption(err)).toBe(true)
    expect(err.message).toMatch(/dropped mid-reply/)
  })

  it("a body that closes with neither a finish reason nor [DONE]: an interruption", async () => {
    const fetchImpl = async () => ok(body(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n']))
    expect(isInterruption(await thrown(run({ fetchImpl })))).toBe(true)
  })

  it("a finished reply is not one, with or without [DONE]", async () => {
    const finish = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'
    expect((await run({ fetchImpl: async () => ok(body([finish])) })).at(-1)).toEqual({ type: "stop", reason: "stop" })
    expect((await run({ fetchImpl: async () => ok(body(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"])) })).at(-1)).toEqual({ type: "stop", reason: "end" })
  })

  it("a request that hangs with no answer is given up on after the quiet limit", async () => {
    const fetchImpl = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    const err = await thrown(run({ fetchImpl, maxAttempts: 1, quietMs: 20 }))
    expect(isInterruption(err)).toBe(true)
    expect(err.message).toMatch(/no answer for 0.02 s/)
  })

  it("a reply that goes quiet part-way is given up on too, and each chunk resets the limit", async () => {
    let signal
    const fetchImpl = async (_url, init) => {
      signal = init.signal
      const reader = body(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n'], { hang: true }).getReader()
      return ok({
        getReader: () => ({
          ...reader,
          read: () =>
            Promise.race([
              reader.read(),
              new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
            ]),
        }),
      })
    }
    const err = await thrown(run({ fetchImpl, quietMs: 30 }))
    expect(isInterruption(err)).toBe(true)
    expect(err.message).toMatch(/went quiet mid-reply/)
  })

  it("stopping the run is not an interruption: the caller's own abort comes back as it was", async () => {
    const controller = new AbortController()
    const fetchImpl = async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    }
    const err = await thrown(run({ fetchImpl, signal: controller.signal }))
    expect(isInterruption(err)).toBe(false)
  })

  it("decodeStream alone: a finish reason is enough to call a reply whole", async () => {
    async function* chunks() {
      yield 'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}\n\n'
    }
    const events = []
    for await (const e of decodeStream(chunks())) events.push(e)
    expect(events.at(-1)).toEqual({ type: "stop", reason: "length" })
  })
})
