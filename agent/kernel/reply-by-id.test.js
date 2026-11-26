/**
 * A reply found by its id: a Stop's notice that merges in BEFORE a reply the
 * stopper had not seen (the stopper wrote more than the runner has heard)
 * moves the reply along the list, and the run still takes its own mark off
 * and keeps its text. On two Automerge copies, with a real burst (fixtures/burst.js).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { stopSession } from "../session/recovery.js"
import { STOP, stopOf } from "../session/status.js"
import { burstRunner } from "../fixtures/burst.js"
import { say } from "./loop.js"

beforeEach(() => _resetIds())

/** Made up: who pressed Stop. */
const PERSON = "automerge:person"

function copies(actors = ["aa", "bb"], turns = []) {
  const base = A.change(A.init({ actor: "cc".repeat(16) }), (d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]), ...turns)
  })
  const sides = actors.map((a) => ({ doc: A.clone(base, { actor: a.repeat(16) }), listeners: new Set() }))
  const heard = (i) => {
    for (const fn of [...sides[i].listeners]) fn(sides[i].doc)
  }
  const store = (i) => ({
    url: "automerge:session",
    doc: () => sides[i].doc,
    change(fn) {
      sides[i].doc = A.change(sides[i].doc, (d) => {
        fn(d)
      })
      heard(i)
    },
    onChange(fn) {
      sides[i].listeners.add(fn)
      return () => sides[i].listeners.delete(fn)
    },
    appendText(path, delta) {
      if (!delta) return
      this.change((d) => {
        let node = d
        for (let k = 0; k < path.length - 1; k++) node = node[path[k]]
        const key = path[path.length - 1]
        node[key] = (node[key] ?? "") + delta
      })
    },
  })
  const deliver = (from, to) => {
    sides[to].doc = A.merge(sides[to].doc, A.clone(sides[from].doc))
    heard(to)
  }
  return { sides, stores: [store(0), store(1)], deliver }
}

function model(...replies) {
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const reply = replies[requests.length - 1] ?? says("(asked again)")
      yield* reply(request)
    },
  }
}
const says = (text) =>
  async function* () {
    yield { type: "text", delta: text }
    yield { type: "stop", reason: "stop" }
  }
const hangs = (text, reached) =>
  async function* (request) {
    yield { type: "text", delta: text }
    reached()
    await new Promise((_, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"))
      if (request.signal?.aborted) abort()
      request.signal?.addEventListener("abort", abort)
    })
  }

function runnerOn(store, url, provider, tools = []) {
  return burstRunner({
    store,
    runnerUrl: url,
    buildToolset: async () => ({ tools, schemas: [], get: (id) => tools.find((t) => t.id === id) ?? null }),
    getProvider: async () => provider,
    canRun: () => true,
  })
}

const flushed = () => new Promise((r) => setTimeout(r, 200))
const plain = (doc) => JSON.parse(JSON.stringify(doc))
const texts = (doc) => doc.turns.map((t) => [t.role, (t.blocks ?? []).map((b) => b.text ?? b.type).join("|"), !!t.streaming])
const pad = (d) => {
  d.pad = []
  for (let i = 0; i < 500; i++) d.pad.push(i)
}

describe("item 1 with the Stop's notice merged before the reply", () => {
  // B writes much A has not seen, so B's notice sorts before A's reply where
  // both were pushed after the same turn.
  it.each([["aa", "bb"], ["bb", "aa"]])("actors %s, %s: the reply loses its mark and keeps its text", async (...actors) => {
    const { sides, stores, deliver } = copies(actors)
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Begun on A", reached), says("Going on."))
    const a = runnerOn(stores[0], "tab-A", m)
    stores[1].change(pad)
    const run = a.tick()
    await at
    await flushed()
    // B has not seen A's mark or reply; it sees the user's word, so the Stop is said.
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    expect((await run).outcome).toBe("stopped")
    deliver(0, 1)
    const doc = plain(sides[0].doc)
    expect(stopOf(doc)?.kind).toBe(STOP.stopped)
    const mark = doc.turns.find((t) => t.blocks.some((b) => String(b.text).includes("Begun on A")))?.streaming ?? null
    say(stores[1], "go on")
    deliver(1, 0)
    // Speaking is a write of work, and asks: the next burst.
    await a.tick()
    await vi.waitFor(() => expect(texts(sides[0].doc).at(-1)).toEqual(["assistant", "Going on.", false]))
    expect(mark).toBe(null)
    expect(JSON.stringify(plain(sides[0].doc).turns)).toContain("Begun on A")
    a.stop()
  })

  it("text still buffered when the Stop is heard lands in the reply, not in the notice", async () => {
    const { sides, stores, deliver } = copies(["aa", "bb"])
    let reached
    const at = new Promise((r) => (reached = r))
    const m = model(hangs("Buffered", reached))
    const a = runnerOn(stores[0], "tab-A", m)
    stores[1].change(pad)
    const run = a.tick()
    await at
    // no flush wait: "Buffered" is still in the appender
    stores[1].change((d) => stopSession(d, STOP.stopped, null, PERSON))
    deliver(1, 0)
    await run
    const doc = plain(sides[0].doc)
    const notice = doc.turns.find((t) => t.blocks.some((b) => b.kind === STOP.stopped))
    expect(notice.blocks[0].text).toBe("Stopped by a person.")
    a.stop()
  })
})
