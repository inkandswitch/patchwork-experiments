/**
 * A checker's matrix of refused requests through the real stream() over a
 * stand-in fetch: each status with a JSON, a plain-text, an HTML and an empty
 * body: the error's message, whether braces or raw JSON reach a person, whether
 * a "not now" status is an interruption that retries; and, for those, the line
 * under the composer (ui/session-value.js) while a burst waits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { stream, NOT_NOW } from "../providers/openrouter.js"
import { sessionValue } from "./session-value.js"
import { runBurst } from "../kernel/burst.js"
import { OUTCOME } from "../kernel/loop.js"

await initSubduction()

const SAID = "Rate limit exceeded: free-models-per-day."
const BODIES = {
  json: (status) => JSON.stringify({ error: { message: SAID, code: status } }),
  text: () => SAID,
  html: () => "<html><head><title>Oops</title></head><body><h1>Gateway trouble</h1></body></html>",
  empty: () => "",
}
const STATUSES = [401, 403, 408, 429, 500, 502, 503, 504, 529]

beforeEach(() => {
  _resetIds()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})
afterEach(() => vi.useRealTimers())

const answering = (status, body) => vi.fn(async () => ({ ok: false, status, headers: { get: () => null }, text: async () => body }))

async function refusalOf(status, body) {
  const fetchImpl = answering(status, body)
  const pending = (async () => {
    try {
      for await (const _ of stream({ system: "", messages: [], model: "m", key: "made-up", fetchImpl })) {
        /* nothing streams */
      }
    } catch (err) {
      return err
    }
    return null
  })()
  await vi.advanceTimersByTimeAsync(60_000)
  return { err: await pending, tries: fetchImpl.mock.calls.length }
}

describe("every status with every body", () => {
  for (const status of STATUSES) {
    for (const [kind, make] of Object.entries(BODIES)) {
      it(`${status} with a ${kind} body`, async () => {
        const body = make(status)
        const { err, tries } = await refusalOf(status, body)
        const m = err.message
        expect(m).not.toMatch(/[{}]|"error"|"code"/)
        const notNow = NOT_NOW.has(status)
        expect(!!err.interruption).toBe(notNow)
        expect(tries).toBe(status === 401 || status === 403 ? 1 : 4)
        const said = kind === "json" || kind === "text" ? SAID : kind === "html" ? body : ""
        if (status === 401) {
          expect(m.startsWith("OpenRouter refused the API key (401)")).toBe(true)
          expect(m.endsWith(said ? ` OpenRouter said: ${said}` : "settings.")).toBe(true)
        } else if (notNow) {
          expect(m).toBe(`OpenRouter is not taking requests just now (${status}${said ? `: ${said}` : ""})`)
        } else {
          expect(m).toBe(`OpenRouter ${status}: ${said}`)
          expect(m).not.toMatch(/API key/)
        }
        if (status === 403) expect(m).not.toMatch(/refused the API key|Change it/)
      })
    }
  }
  it("403 with a key message keeps its status and is not said as the key", async () => {
    const { err } = await refusalOf(403, JSON.stringify({ error: { message: "Invalid API key", code: 403 } }))
    expect(err.message).toBe("OpenRouter 403: Invalid API key")
  })
  it("a long body is capped", async () => {
    const { err } = await refusalOf(429, "x".repeat(5000))
    expect(err.message.length).toBeLessThan(500)
  })
})

describe("a not-now status in a burst: the burst waits, the line says it, and it carries on", () => {
  for (const status of [...NOT_NOW].sort()) {
    for (const [kind, make] of Object.entries(BODIES)) {
      it(`${status} with a ${kind} body`, async () => {
        const repo = new Repo({ network: [] })
        const handle = repo.create()
        handle.change((d) => {
          initSession(d, {})
          d.burst = null
          d.turns.push(makeTurn("user", [textBlock("hello")]))
        })
        const local = { hasKey: true, pool: "pool-here", work: { state: "running", runs: [{ id: "run-1", pool: "pool-here", start: 1 }] } }
        const hints = []
        handle.on("change", ({ doc }) => hints.push(sessionValue(doc, local).hint))
        let ok = false
        const frames = [`data: ${JSON.stringify({ choices: [{ delta: { content: "Back." }, finish_reason: null }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n"]
        const enc = new TextEncoder()
        const fetchImpl = vi.fn(async () => {
          if (!ok) return { ok: false, status, headers: { get: () => null }, text: async () => make(status) }
          let i = 0
          return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }), cancel: async () => {}, releaseLock() {} }) } }
        })
        const controller = new AbortController()
        const done = runBurst(
          { repo, signal: controller.signal, run: "run-1", taskUrl: "automerge:task", settled: Promise.resolve(), progress: () => {}, log: () => {} },
          { session: handle.url, taskRuns: () => ["run-1"], getProvider: async () => ({ stream: (r) => stream({ ...r, fetchImpl }) }), buildToolset: async () => ({ tools: [], schemas: [], get: () => null }), key: "made-up-key", flushMs: 5 }
        )
        // Two refused tries of the burst: 4 fetches each.
        await vi.advanceTimersByTimeAsync(3550)
        await vi.advanceTimersByTimeAsync(2050)
        await vi.advanceTimersByTimeAsync(3550)
        expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(8)
        const doc = handle.doc()
        expect(doc.reconnecting).toBeTruthy()
        const said = kind === "json" || kind === "text" ? SAID : kind === "html" ? make(status) : ""
        const line = sessionValue(doc, local).hint
        expect(line).toBe(`Waiting for the network; carries on when it is back (OpenRouter is not taking requests just now (${status}${said ? `: ${said}` : ""}))`)
        expect(line).not.toMatch(/[{}]/)
        expect(doc.turns.length).toBe(1)
        ok = true
        await vi.advanceTimersByTimeAsync(30_000)
        const result = await done
        expect(result.outcome).not.toBe(OUTCOME.error)
        const d2 = JSON.parse(JSON.stringify(handle.doc()))
        expect(d2.reconnecting ?? null).toBe(null)
        expect(d2.turns.map((t) => t.role)).toEqual(["user", "assistant"])
      })
    }
  }
})
