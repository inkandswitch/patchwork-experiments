/**
 * Asking for a session's work (runners/ask.js), with a stand-in task client
 * whose watch says what the test says, on real Automerge sessions.
 */
import { describe, it, expect, afterEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, CALL, WHERE, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { STOP, stopOf } from "../session/status.js"
import { isOwn } from "../kernel/own-changes.js"
import { HEADS_WAIT_MS } from "../kernel/burst.js"
import { askWork, takeOver, stop, forget, workKey, followWork, failedAskOf } from "./ask.js"

await initSubduction()

/** Made up, as the fixtures' are. */
const IMPORT = "automerge:4GUzmmRgHRZUW6hJb1amnppHyXJ/index.js"
const QUEUE = "automerge:DoFsmmQsY5BMsXFGgT8Xq57oiqC"

const followed = []
afterEach(() => {
  for (const url of followed.splice(0)) forget(url)
})

/** What the Tasks package's doWork rejects with when the task ended cancelled (its CANCELLED). */
const CANCELLED = "The task was cancelled"

const MISSING = { state: "missing", runs: [], input: undefined, result: undefined, progress: null }

/** A task client that asks nothing of a queue: its watch says what `show` says, and doWork records. */
function standIn(view = MISSING) {
  let now = view
  const listeners = new Set()
  const asks = []
  const ends = []
  return {
    asks,
    client: {
      CANCELLED,
      doWork: (...args) => {
        asks.push(args)
        return new Promise((resolve, reject) => ends.push({ resolve, reject }))
      },
      watchWork: (repo, key, onChange) => {
        listeners.add(onChange)
        onChange(now)
        return () => listeners.delete(onChange)
      },
      stopWork: async (...args) => (asks.push(["stop", ...args]), true),
    },
    show(next) {
      now = next
      for (const l of listeners) l(next)
    },
    end: (i, result) => ends[i].resolve(result),
    fail: (i, err) => ends[i].reject(err),
  }
}

function session(repo, fn = () => {}) {
  _resetIds()
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]))
    d.burst = null
    fn(d)
  })
  followed.push(handle.url)
  return handle
}
const heads = (handle) => [...handle.heads()]
const optsOf = (client, more = {}) => ({ client, importUrl: IMPORT, onOnline: () => () => {}, ...more })
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
}

describe("the one rule, as a finite table", () => {
  const WORK = [true, false]
  const BURST = ["none", "own", "foreign", "page"]
  const LAST = ["none", "running", "equal", "behind", "ahead"]
  const ASKED = [0, 1, 2]
  const rows = WORK.flatMap((work) => BURST.flatMap((burst) => LAST.flatMap((last) => ASKED.map((asked) => [work, burst, last, asked]))))

  // What the table says, written out: work; a burst that is none or a run
  // the watch lists (so not under a missing task); a last task that has
  // ended behind the copy, or none; and fewer than two asks at these heads.
  const expected = (work, burst, last, asked) => {
    const listed = burst === "own" && last !== "none"
    const standBack = burst === "foreign" || burst === "page" || (burst === "own" && !listed)
    return work && !standBack && (last === "none" || last === "ahead") && asked < 2
  }

  it("has 120 rows", () => expect(rows).toHaveLength(120))

  it.each(rows)("needsWork %s, burst %s, last task %s, asked %i before", async (work, burst, last, asked) => {
    const repo = new Repo({ network: [] })
    const h = session(repo, (d) => {
      if (!work) d.turns.push(makeTurn("assistant", [textBlock("done")]))
      if (burst === "own" || burst === "foreign") d.burst = { run: "run-1" }
      if (burst === "page") d.burst = { run: "page-x" }
    })
    const before = heads(h)
    h.change((d) => (d.title = "later")) // changes no work, moves the heads
    const now = heads(h)
    const other = repo.import(A.save(h.doc()))
    other.change((d) => (d.title = "elsewhere"))
    const unseen = heads(other)

    const runs = burst === "own" ? [{ id: "run-1" }] : [{ id: "run-2" }]
    const ended = (theirs) => ({ state: "succeeded", runs, input: { heads: before }, result: { outcome: "nothing", heads: theirs, own: [] }, progress: null })
    const views = {
      none: MISSING,
      running: { state: "running", runs, input: { heads: before }, result: undefined, progress: null },
      equal: ended(now),
      behind: ended(unseen),
      ahead: ended(before),
    }

    // Asks so far at these heads, made under a view that asks wherever the
    // copy allows it: a burst none, or one the view lists.
    const s = standIn(burst === "none" ? MISSING : { state: "succeeded", runs: [{ id: "run-1" }], input: { heads: before }, result: { heads: before } })
    const opts = optsOf(s.client)
    const reachable = work && burst !== "page"
    for (let i = 0; i < asked && reachable; i++) askWork(repo, h.url, opts)
    await flush()
    expect(s.asks).toHaveLength(reachable ? asked : 0)

    s.show(views[last])
    const answer = await Promise.race([askWork(repo, h.url, opts), flush().then(() => ({ asked: true }))])
    const asks = s.asks.length - (reachable ? asked : 0)
    expect(asks).toBe(expected(work, burst, last, asked) ? 1 : 0)
    if (!asks) expect(answer.asked).toBe(false)
  })
})

describe("askWork", () => {
  it("asks under agent:<session> with the input in its order, keys last, and no signal; resolves the task's outcome", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    const asking = askWork(repo, h.url, optsOf(s.client, { account: { rootFolderUrl: null, sensitiveDocs: [] }, catalogue: { tools: [], skills: [] }, keys: { model: "k", search: null, relay: null } }))
    await flush()
    expect(s.asks).toHaveLength(1)
    const [repoGiven, request, options] = s.asks[0]
    expect(repoGiven).toBe(repo)
    expect(options).toBe(undefined)
    expect(request.key).toBe(`agent:${h.url}`)
    expect(request.key).toBe(workKey(`${h.url}#somewhere`))
    expect(request.importUrl).toBe(IMPORT)
    expect(Object.keys(request.input)).toEqual(["session", "heads", "account", "catalogue", "keys"])
    expect(request.input.session).toBe(h.url)
    expect(request.input.heads).toEqual(heads(h))
    expect(JSON.stringify(h.doc())).not.toContain("agent:")
    s.end(0, { outcome: "idle", heads: heads(h), own: [] })
    expect(await asking).toEqual({ asked: true, outcome: "idle" })
  })

  it("a call that needs a page is not a run's work", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo, (d) => d.turns.push(makeTurn("assistant", [callBlock("doc_create", {}, { where: WHERE.host, status: CALL.approved })])))
    const s = standIn()
    expect(await askWork(repo, h.url, optsOf(s.client))).toMatchObject({ asked: false })
    expect(s.asks).toHaveLength(0)
  })

  it("at most twice at one copy's heads; a change, or the network coming back, asks again", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    let online = null
    const opts = optsOf(s.client, { onOnline: (fn) => ((online = fn), () => {}) })
    for (let i = 0; i < 4; i++) askWork(repo, h.url, opts)
    await flush()
    expect(s.asks).toHaveLength(2)
    online()
    await flush()
    expect(s.asks).toHaveLength(3)
    h.change((d) => d.turns.push(makeTurn("user", [textBlock("and this")])))
    askWork(repo, h.url, opts)
    askWork(repo, h.url, opts)
    askWork(repo, h.url, opts)
    await flush()
    expect(s.asks).toHaveLength(5)
  })

  it("when the task it followed ends with heads the copy has passed, it asks by itself; at the copy's heads, it does not", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const at = heads(h)
    const s = standIn({ state: "running", runs: [{ id: "run-1" }], input: { heads: at } })
    askWork(repo, h.url, optsOf(s.client))
    await flush()
    expect(s.asks).toHaveLength(0)
    s.show({ state: "succeeded", runs: [{ id: "run-1" }], input: { heads: at }, result: { outcome: "idle", heads: at, own: [] } })
    await flush()
    expect(s.asks).toHaveLength(0)

    // Again, with a message written while the run ran that it never saw.
    s.show({ state: "running", runs: [{ id: "run-2" }], input: { heads: at } })
    h.change((d) => d.turns.push(makeTurn("user", [textBlock("also")])))
    s.show({ state: "succeeded", runs: [{ id: "run-2" }], input: { heads: at }, result: { outcome: "idle", heads: at, own: [] } })
    await flush()
    expect(s.asks).toHaveLength(1)
    expect(s.asks[0][1].input.heads).toEqual(heads(h))
  })

  it("waits for a task's writes the copy lacks, at most HEADS_WAIT_MS, then asks", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const other = repo.import(A.save(h.doc()))
    other.change((d) => (d.title = "the run's"))
    let t = 0
    const timers = []
    const s = standIn({ state: "succeeded", runs: [], input: { heads: heads(h) }, result: { heads: heads(other) } })
    const opts = optsOf(s.client, { now: () => t, setTimeout: (fn, ms) => timers.push({ fn, at: t + ms }), clearTimeout: () => {} })
    await askWork(repo, h.url, opts)
    expect(s.asks).toHaveLength(0)
    t = HEADS_WAIT_MS - 1
    await askWork(repo, h.url, opts)
    expect(s.asks).toHaveLength(0)
    expect(timers.map((x) => x.at)).toEqual([HEADS_WAIT_MS])
    t = HEADS_WAIT_MS
    timers[0].fn()
    await flush()
    expect(s.asks).toHaveLength(1)
  })

  it("stands back under a burst the watch does not list; Take over clears it and asks, its marks now debris", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo, (d) => {
      d.burst = { run: "run-9" }
      d.turns.push(makeTurn("assistant", [textBlock("half a reply")]))
      d.turns[d.turns.length - 1].streaming = { runner: "run-9" }
      d.turns.push(makeTurn("user", [textBlock("and another thing")]))
    })
    const s = standIn({ state: "running", runs: [{ id: "run-1" }], input: { heads: heads(h) } })
    expect(await askWork(repo, h.url, optsOf(s.client))).toEqual({ asked: false, why: "someone else's work is under way" })
    s.show(MISSING)
    expect(await askWork(repo, h.url, optsOf(s.client))).toMatchObject({ asked: false })
    takeOver(repo, h.url, optsOf(s.client))
    await flush()
    expect(h.doc().burst).toBe(null)
    expect(s.asks).toHaveLength(1)
  })

  it("feeds the hashes a run reports as its own to rememberOwn, from its progress and its result", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo, (d) => d.turns.push(makeTurn("assistant", [textBlock("done")])))
    const s = standIn()
    await askWork(repo, h.url, optsOf(s.client))
    s.show({ state: "running", runs: [{ id: "run-1" }], progress: { own: ["aa11"] } })
    expect(isOwn(h.url, "aa11")).toBe(true)
    s.show({ state: "succeeded", runs: [{ id: "run-1" }], result: { outcome: "idle", heads: heads(h), own: ["aa11", "bb22"] } })
    expect(isOwn(h.url, "bb22")).toBe(true)
    expect(isOwn(h.url, "cc33")).toBe(false)
  })

  it("words a rejection without urls", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    const asking = askWork(repo, h.url, optsOf(s.client))
    await flush()
    s.fail(0, new Error(`No pool serves ${QUEUE}#3kq9 for ${h.url}`))
    const err = await asking.catch((e) => e)
    expect(err.message).toBe("No pool serves a document for a document")
  })

  it("Stop: the notice in the session, then stopWork under the key", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    expect(await stop(repo, h.url, { client: s.client, author: "automerge:person" })).toBe(true)
    expect(stopOf(h.doc())?.kind).toBe(STOP.stopped)
    expect(s.asks).toEqual([["stop", repo, `agent:${h.url}`]])
  })
})

// Seen live: after a Stop, the next message first said "The work could not be
// asked for: The task was cancelled. …" before it worked.
describe("a task that ended cancelled is not an ask that failed", () => {
  it("Stop while the ask waits: nothing is said, and the next message asks as any message does", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    const told = []
    const unfollow = followWork(repo, h.url, (view, failed) => told.push(failed), { client: s.client })
    const asking = askWork(repo, h.url, optsOf(s.client))
    await flush()
    expect(s.asks).toHaveLength(1)
    await stop(repo, h.url, { client: s.client, author: "automerge:person" })
    s.show({ state: "cancelled", runs: [{ id: "run-1", end: 2 }], input: { heads: s.asks[0][1].input.heads } })
    s.fail(0, new Error(`${CANCELLED}.`))
    expect(await asking).toEqual({ asked: true, outcome: "cancelled" })
    expect(failedAskOf(h.url)).toBe(null)

    h.change((d) => d.turns.push(makeTurn("user", [textBlock("go on")])))
    askWork(repo, h.url, optsOf(s.client))
    await flush()
    expect(s.asks.filter((a) => a[0] !== "stop")).toHaveLength(2)
    expect(told.every((failed) => failed == null)).toBe(true)
    unfollow()
  })

  it("any other rejection is still said", async () => {
    const repo = new Repo({ network: [] })
    const h = session(repo)
    const s = standIn()
    const asking = askWork(repo, h.url, optsOf(s.client))
    await flush()
    s.fail(0, new Error("The task failed"))
    expect((await asking.catch((e) => e)).message).toBe("The task failed")
    expect(failedAskOf(h.url)).toBe("The task failed")
  })
})
