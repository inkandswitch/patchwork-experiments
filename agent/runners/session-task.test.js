/**
 * The session task (runners/session-task.js): one burst built from a task's
 * input, run on an in-memory Repo with the provider's requests answered here.
 * The task client its pool's registry gives is a stand-in whose rules read
 * runs and stops as the test says; the probes run it with the real one.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { splice } from "@automerge/automerge/slim"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { noteWrite } from "../knowledge/notes.js"
import { SYNC_SERVERS } from "../net/guard.js"
import { _holdClient } from "../host/import.js"
import { standIn } from "../fixtures/tasks-stand-in.js"
import sessionTask, { runFetch, rebased, runsOfTask } from "./session-task.js"

await initSubduction()

// A stop is what the client's isStop says it is: here, a record whose id says so.
_holdClient(standIn({ recordsOf: (task) => task?.runs ?? [], isStop: (record) => record.id.startsWith("stop-") }))

afterEach(() => vi.unstubAllGlobals())

const MODEL_KEY = "model-key-made-up-for-this-test"
const SEARCH_KEY = "search-key-made-up-for-this-test"
const STAND_IN = "http://stand-in.invalid/base"

function streamOf(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }),
      releaseLock() {},
    }),
  }
}
const frame = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`

/** The platform's fetch, answering the provider's requests with `pieces` and keeping each request. */
function provider(pieces) {
  const requests = []
  vi.stubGlobal("fetch", async (url, init) => {
    requests.push({ url: String(url), headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? "null") })
    return { ok: true, status: 200, headers: { get: () => null }, body: streamOf([...pieces.map((p) => frame({ content: p })), frame({}, "stop"), "data: [DONE]\n\n"]) }
  })
  return requests
}

async function world({ burst = null, runs = ["run-1"] } = {}) {
  _resetIds()
  const repo = new Repo({ network: [] })
  const root = repo.create({ title: "Root", docs: [], "@patchwork": { type: "folder" } })
  await noteWrite.execute({ name: "Boat names", content: "# Boat names\nThe sloop is called Kestrel.\n" }, { repo, rootFolderUrl: root.url, splice })
  const session = repo.create()
  session.change((d) => {
    initSession(d, {})
    d.config.model = "made/up-model"
    d.turns.push(makeTurn("user", [textBlock("hello")]))
    d.burst = burst
  })
  const input = {
    session: session.url,
    heads: [...session.heads()],
    account: { rootFolderUrl: root.url, sensitiveDocs: [] },
    catalogue: { tools: [], skills: [] },
    providerUrl: STAND_IN,
    keys: { model: MODEL_KEY, search: SEARCH_KEY, relay: null },
  }
  const task = repo.create({ importUrl: "data:text/javascript,", input, key: `agent:${session.url}`, runs: runs.map((id) => ({ id, pool: "pool-1", start: 0, ...(id === "run-1" ? {} : { status: "lost", end: 1 }) })) })
  const logs = []
  const ctx = { repo, signal: new AbortController().signal, run: "run-1", taskUrl: task.url, key: task.doc().key, settled: Promise.resolve(), progress: () => {}, log: (line) => logs.push(line) }
  return { repo, root, session, task, input, ctx, logs }
}

describe("the session task", () => {
  it("runs one burst from its input: the model key reaches the provider, the notes are read through the run's repo, the result is { outcome, heads, own }", async () => {
    const requests = provider(["Hello ", "there."])
    const { session, input, ctx } = await world()
    const before = Object.keys(ctx)
    const result = await sessionTask(input, ctx)

    expect(Object.keys(result).sort()).toEqual(["heads", "outcome", "own"])
    expect(result.outcome).toBe("idle")
    expect(result.heads).toEqual([...session.heads()])
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`${STAND_IN}/api/v1/chat/completions`)
    expect(requests[0].headers.authorization).toBe(`Bearer ${MODEL_KEY}`)
    expect(requests[0].body.model).toBe("made/up-model")
    expect(JSON.stringify(requests[0].body.messages[0])).toContain("The sloop is called Kestrel.")
    const doc = session.doc()
    expect(doc.turns.at(-1).blocks.map((b) => b.text).join("")).toBe("Hello there.")
    expect(doc.burst).toBe(null)

    // The keys are in the input and nowhere it wrote: not the session, not
    // the result, not the task's ctx.
    const written = JSON.stringify({ doc, result })
    for (const key of [MODEL_KEY, SEARCH_KEY]) expect(written).not.toContain(key)
    expect(Object.keys(ctx)).toEqual(before)
  })

  it("reads its task's runs from the task's document: a burst left by a lost run of its task is settled, one naming a run it does not list is held", async () => {
    const lost = await world({ burst: { run: "run-0" }, runs: ["run-0", "run-1"] })
    provider(["Again."])
    expect(await runsOfTask(lost.repo, lost.task.url)).toEqual(["run-0", "run-1"])
    expect((await sessionTask(lost.input, lost.ctx)).outcome).toBe("idle")
    expect(lost.session.doc().turns.at(-1).blocks.map((b) => b.text).join("")).toBe("Again.")

    const foreign = await world({ burst: { run: "run-elsewhere" } })
    const requests = provider(["never"])
    expect((await sessionTask(foreign.input, foreign.ctx)).outcome).toBe("held")
    expect(requests).toHaveLength(0)
    expect(foreign.session.doc().burst).toEqual({ run: "run-elsewhere" })
  })

  it("a stop in the task's document, as the client's rules tell it, is no run", async () => {
    const { repo, task } = await world()
    task.change((d) => d.runs.push({ id: "stop-1", status: "cancelled", start: 2, end: 2 }))
    expect(await runsOfTask(repo, task.url)).toEqual(["run-1"])
  })
})

describe("what a run fetches with", () => {
  it("in Node: nodeFetch, direct, every name resolved and checked, the sync servers refused", async () => {
    const { fetchImpl, direct } = await runFetch({ node: true })
    expect(direct).toBe(true)
    expect(fetchImpl.policy.dns).toBe(true)
    for (const server of SYNC_SERVERS) expect(fetchImpl.policy.deny).toContain(new URL(server.replace(/^ws/, "http")).origin)
  })

  it("in a browser's run worker: the browser's fetch, refusing this origin and the sync servers, direct only through a relay", async () => {
    const plain = await runFetch({ node: false })
    expect(plain.direct).toBe(false)
    expect(plain.fetchImpl.policy.dns).toBe(false)
    expect(plain.fetchImpl.policy.deny).toContain(globalThis.location.origin)
    for (const server of SYNC_SERVERS) expect(plain.fetchImpl.policy.deny).toContain(new URL(server.replace(/^ws/, "http")).origin)
    expect((await runFetch({ node: false, relay: { url: "https://relay.example", key: "r" } })).direct).toBe(true)
  })

  it("the provider's address is moved only when a stand-in is named", () => {
    const real = { id: "p", stream: () => "as it is" }
    expect(rebased(real, null)).toBe(real)
    let given = null
    const moved = rebased({ id: "p", stream: (request) => (given = request) }, "http://127.0.0.1:9/x/")
    moved.stream({ model: "m" })
    vi.stubGlobal("fetch", async (url) => url)
    return given.fetchImpl("https://openrouter.ai/api/v1/chat/completions?a=1").then((url) => expect(url).toBe("http://127.0.0.1:9/x/api/v1/chat/completions?a=1"))
  })
})
