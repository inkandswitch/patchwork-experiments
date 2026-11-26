/**
 * A checker's cases of a failed ask (runners/ask.js, through runners/page.js
 * askFor and followWorkFor, as the session view uses them): it is said under
 * the composer in words without urls, and asked again on the next
 * change and when the network comes back, without looping. The asker is the
 * real askWork; the task client is a stand-in whose doWork rejects once and
 * then succeeds, or rejects for ever.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { askWork, forget, failedAskOf } from "../runners/ask.js"
import { askFor, followWorkFor, _reset } from "../runners/page.js"
import { sessionValue } from "./session-value.js"

await initSubduction()

const KEY = "patchwork-agent:key:openrouter"
/** Made up. */
const QUEUE = "automerge:3vQm8zKXyT1pRwNbHc4LdFsEaGj"

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

/**
 * A stand-in task client. `failing(n)` makes the next n doWork calls reject
 * (Infinity: for ever) with `why`; the rest succeed.
 */
function standIn({ why = `Invalid AutomergeUrl: 'null' while opening ${QUEUE}#4abc` } = {}) {
  let failures = 0
  const client = {
    doWork: vi.fn(async () => {
      if (failures > 0) {
        failures--
        throw new Error(why)
      }
      return { outcome: "idle" }
    }),
    watchWork: vi.fn(() => () => {}),
    stopWork: vi.fn(async () => true),
    ownQueue: vi.fn(async () => QUEUE),
    failing(n) {
      failures = n
    },
  }
  return client
}

function sessionIn(repo) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.burst = null
    d.turns.push(makeTurn("user", [textBlock("hello")]))
  })
  return handle
}

/** What the line under the composer says, from the doc and what followWorkFor told. */
const hintOf = (handle, told) => sessionValue(handle.doc(), { hasKey: true, work: told.view, askFailed: told.failed }).hint

/** Neither an automerge url nor a web address. */
const NO_URL = /automerge:|[a-z][a-z0-9+.-]*:\/\//i

let used = []
let client
beforeEach(() => {
  _resetIds()
  localStorage.clear()
  localStorage.setItem(KEY, "sk-made-up")
  client = standIn()
  _reset(askWork, { with: client })
})
afterEach(() => {
  for (const url of used) forget(url)
  used = []
  _reset()
})

/** A session followed as the session view follows it; `told` is what it was last told. */
function followed() {
  const repo = new Repo({ network: [] })
  const handle = sessionIn(repo)
  used.push(handle.url)
  const told = { view: null, failed: null, times: 0 }
  followWorkFor(repo, handle.url, (view, failed) => Object.assign(told, { view, failed, times: told.times + 1 }))
  return { repo, handle, told }
}

describe("rejects once, then succeeds", () => {
  it("said under the composer without urls; the next change asks again and it is no longer said", async () => {
    const { repo, handle, told } = followed()
    client.failing(1)
    const first = await askFor(repo, handle.url)
    expect(first.error).toBe(true)
    expect(client.doWork).toHaveBeenCalledTimes(1)
    expect(told.failed).toBe(failedAskOf(handle.url))
    expect(told.failed).toMatch(/^Invalid AutomergeUrl: 'null' while opening a document/)
    const hint = hintOf(handle, told)
    expect(hint).toMatch(/^The work could not be asked for: Invalid AutomergeUrl/)
    expect(hint).not.toMatch(NO_URL)
    expect(hint).not.toContain(QUEUE.slice("automerge:".length))

    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("again")])))
    expect(await askFor(repo, handle.url)).toEqual({ asked: true, outcome: "idle" })
    expect(client.doWork).toHaveBeenCalledTimes(2)
    expect(told.failed).toBe(null)
    expect(hintOf(handle, told)).not.toMatch(/could not be asked for/)
  })

  it("the network coming back asks again, and it is no longer said", async () => {
    const { repo, handle, told } = followed()
    client.failing(1)
    await askFor(repo, handle.url)
    expect(told.failed).not.toBe(null)
    globalThis.dispatchEvent(new Event("online"))
    await flush()
    expect(client.doWork).toHaveBeenCalledTimes(2)
    expect(told.failed).toBe(null)
  })
})

describe("rejects for ever", () => {
  it("asks once for each change and each time the network is back; never by itself", async () => {
    const { repo, handle, told } = followed()
    client.failing(Infinity)
    await askFor(repo, handle.url)
    await flush(100)
    expect(client.doWork).toHaveBeenCalledTimes(1)
    expect(told.failed).not.toBe(null)

    globalThis.dispatchEvent(new Event("online"))
    await flush(100)
    expect(client.doWork).toHaveBeenCalledTimes(2)

    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("again")])))
    await askFor(repo, handle.url)
    await flush(100)
    expect(client.doWork).toHaveBeenCalledTimes(3)

    // Left alone, nothing more.
    await flush(300)
    expect(client.doWork).toHaveBeenCalledTimes(3)
    expect(hintOf(handle, told)).toMatch(/^The work could not be asked for/)
    expect(hintOf(handle, told)).not.toMatch(NO_URL)
  })
})

describe("what the words leave in", () => {
  // The case: a failure whose message names a web address (a relay, a sync
  // server). It is taken out as a document url is (ask.js withoutUrls).
  it("a web address in the failure is not said under the composer", async () => {
    client = standIn({ why: "fetch failed: https://relay.example.invalid/v1/connect" })
    _reset(askWork, { with: client })
    const { repo, handle, told } = followed()
    client.failing(1)
    await askFor(repo, handle.url)
    expect(told.failed).not.toBe(null)
    expect(hintOf(handle, told)).not.toMatch(NO_URL)
  })
})

describe("a failure before the ask is counted", () => {
  // The case: askWork's own look at the session rejects (its count at these
  // heads is not yet taken). Nothing asks again by itself.
  it("does not ask again and again by itself", async () => {
    let finds = 0
    const repo = {
      find: async () => {
        finds++
        throw new Error("Document 4abc is unavailable")
      },
    }
    const url = "automerge:2Lh9xQpR7sWmTnVbYc3KdJfGeAz"
    used.push(url)
    const loose = standIn()
    await askWork(repo, url, { client: loose, onOnline: () => () => {} }).catch(() => {})
    await flush(400)
    expect(finds).toBe(1)
    expect(loose.doWork).not.toHaveBeenCalled()
  })
})
