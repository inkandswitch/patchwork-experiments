/**
 * A checker's tests of a burst going round again (kernel/burst.js, after
 * the fix for a message written while it runs) and of reads that ask in a
 * burst (`sensitiveReads`): what goes round, what stays bounded, and what
 * still runs without asking.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { findCall } from "../session/calls.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { runBurst } from "./burst.js"
import { OUTCOME } from "./loop.js"

await initSubduction()

beforeEach(() => _resetIds())

const plain = (handle) => JSON.parse(JSON.stringify(handle.doc()))
const heads = (handle) => [...handle.heads()]

function fakeToolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}
const tool = (id, opts = {}) => {
  const t = { id, name: id, where: "worker", risk: "edit", runs: 0, ...opts }
  t.execute = async () => (t.runs++, `${id} done`)
  return t
}

function sessionIn(repo) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]))
    d.burst = null
  })
  return handle
}

function taskOf(repo, run = "run-1") {
  const controller = new AbortController()
  return { ctx: { repo, signal: controller.signal, run, taskUrl: "automerge:task", settled: Promise.resolve(), progress: () => {}, log: () => {} }, runs: [run] }
}

function burstOf(handle, task, { provider, tools = [], ...rest }) {
  return runBurst(task.ctx, {
    session: handle.url,
    taskRuns: () => task.runs,
    getProvider: async () => provider,
    buildToolset: async () => fakeToolset(tools),
    flushMs: 5,
    waitForNetwork: async () => {},
    ...rest,
  })
}

/** A message from the person, written while the model is being asked. */
const say = (handle, words) => handle.change((d) => d.turns.push(makeTurn("user", [textBlock(words)])))
const userTexts = (request) => JSON.stringify(request?.messages ?? request)

describe("a burst going round again", () => {
  it("answers a message written during each of two replies, in one burst, and ends at its heads", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([
      () => (say(handle, "first aside"), [{ type: "text", delta: "One." }]),
      () => (say(handle, "second aside"), [{ type: "text", delta: "Two." }]),
      [{ type: "text", delta: "Three." }],
    ])
    const result = await burstOf(handle, taskOf(repo), { provider })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(provider.requests).toHaveLength(3)
    expect(userTexts(provider.requests[2])).toContain("second aside")
    const doc = plain(handle)
    expect(doc.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"])
    expect(doc.burst).toBe(null)
    expect(result.heads).toEqual(heads(handle))
  })

  it("stays bounded when the round after a message is silent: ends 'silent', not round and round", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([() => (say(handle, "an aside"), [{ type: "text", delta: "One." }]), [], []])
    const result = await burstOf(handle, taskOf(repo), { provider })
    expect(result.outcome).toBe(OUTCOME.silent)
    expect(provider.requests).toHaveLength(3)
    expect(plain(handle).burst).toBe(null)
  })

  it("does not go round again for a message when the round ended waiting on a person", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const provider = makeMock([() => (say(handle, "an aside"), [{ type: "call", id: "c1", name: "http_post", input: { url: "https://example.com" } }])])
    const post = tool("http_post", { risk: "write" })
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [post] })
    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(provider.requests).toHaveLength(1)
    expect(post.runs).toBe(0)
  })
})

describe("reads in a burst (sensitiveReads)", () => {
  const readOf = (url, name = "doc_read", risk = "read") => ({ provider: makeMock([[{ type: "call", id: "c1", name, input: { url } }], [{ type: "text", delta: "Read." }]]), t: tool(name, { risk }) })

  it("a read of an ordinary document runs without asking, though the burst has sensitive documents", async () => {
    const repo = new Repo({ network: [] })
    const queue = repo.create({ jobs: {} })
    const ordinary = repo.create({ title: "ordinary" })
    const handle = sessionIn(repo)
    const { provider, t } = readOf(ordinary.url)
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [t], context: { sensitiveDocs: [queue.url] } })
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(t.runs).toBe(1)
    expect(findCall(plain(handle), "c1").block.status).toBe(CALL.done)
  })

  it("a read of the account (in sensitiveDocs) asks, as the own queue does", async () => {
    const repo = new Repo({ network: [] })
    const account = repo.create({ name: "a person" })
    const handle = sessionIn(repo)
    const { provider, t } = readOf(account.url)
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [t], context: { sensitiveDocs: [account.url] } })
    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(t.runs).toBe(0)
  })

  it("a self call (doc_watch) on the own queue asks too", async () => {
    const repo = new Repo({ network: [] })
    const queue = repo.create({ jobs: {} })
    const handle = sessionIn(repo)
    const { provider, t } = readOf(queue.url, "doc_watch", "self")
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [t], context: { sensitiveDocs: [queue.url] } })
    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(findCall(plain(handle), "c1").block.status).toBe(CALL.pending)
    expect(t.runs).toBe(0)
  })

  it("a read of the own queue named with a path after its id asks", async () => {
    const repo = new Repo({ network: [] })
    const queue = repo.create({ jobs: {} })
    const handle = sessionIn(repo)
    const { provider, t } = readOf(`${queue.url}/jobs`)
    const result = await burstOf(handle, taskOf(repo), { provider, tools: [t], context: { sensitiveDocs: [queue.url] } })
    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(t.runs).toBe(0)
  })
})
