/**
 * A checker's tests of askWork (runners/ask.js), written from the
 * specification's promise A, K and E before reading the author's tests: the
 * finite table, why it never loops, the input, Take over, own hashes.
 *
 * Real Automerge copies of a session, a stand-in task client, and a clock
 * the test moves by hand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction, encodeHeads } from "@automerge/automerge-repo"
import { initSession, CALL, WHERE, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { watchesWriter, handleStore } from "../kernel/store.js"
import { HEADS_WAIT_MS } from "../kernel/burst.js"
import { askWork, takeOver, forget, workKey, followWork, failedAskOf } from "./ask.js"

await initSubduction()

/** Made up, as the fixtures' are. */
const QUEUE = "automerge:4GUzmmRgHRZUW6hJb1amnppHyXJ"
const IMPORT = "automerge:DoFsmmQsY5BMsXFGgT8Xq57oiqC/agent/index.js"

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}
const headsOf = (handle) => [...handle.heads()]

/** A clock and its timers, moved only by `advance`. */
function clockOf() {
  let t = 0
  const timers = []
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const timer = { at: t + ms, fn }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      const i = timers.indexOf(timer)
      if (i >= 0) timers.splice(i, 1)
    },
    async advance(ms) {
      t += ms
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.fn()
      }
      await flush()
    },
    pending: () => timers.length,
  }
}

/**
 * A stand-in for the task client over one queue that keeps one task per key:
 * asking under a key whose task has not ended joins it (as the task system
 * does). `end(...)` ends the current task as its run would.
 */
function standIn() {
  let view = { state: "missing", runs: [], input: undefined, result: undefined, progress: null }
  const watchers = new Set()
  const tasks = [] // { request, resolve, reject, state }
  const client = {
    tasks,
    asks: [],
    doWork: vi.fn((repo, request) => {
      client.asks.push(request)
      const open = tasks.at(-1)
      if (open && !["succeeded", "failed", "cancelled"].includes(open.state)) return open.done
      const task = { request, state: "waiting" }
      task.done = new Promise((resolve, reject) => Object.assign(task, { resolve, reject }))
      task.done.catch(() => {})
      tasks.push(task)
      return task.done
    }),
    watchWork: vi.fn((repo, key, onChange) => {
      const w = { key, onChange }
      watchers.add(w)
      onChange(view)
      return () => watchers.delete(w)
    }),
    stopWork: vi.fn(async () => true),
    /** What every watcher hears now. */
    show(v) {
      view = { state: "missing", runs: [], input: undefined, result: undefined, progress: null, ...v }
      for (const w of watchers) w.onChange(view)
    },
    /** The current task is taken by run `run`. */
    start(run = "run-1") {
      const task = tasks.at(-1)
      task.state = "running"
      task.run = run
      client.show({ state: "running", input: task.request.input, runs: [{ id: run }] })
    },
    /** The current task ends: succeeded with `result`, or failed. */
    end({ state = "succeeded", result = null, error = null } = {}) {
      const task = tasks.at(-1)
      task.state = state
      client.show({ state, input: task.request.input, runs: [{ id: task.run ?? "run-1" }], result: state === "succeeded" ? result : undefined, error })
      if (state === "succeeded") task.resolve(result)
      else task.reject(new Error(error ?? "failed"))
    },
    watchers,
  }
  return client
}

/** Options for askWork with this client and clock; `online` holds the listeners. */
function optsOf(client, clock, online = []) {
  return {
    client,
    importUrl: IMPORT,
    account: { rootFolderUrl: null, sensitiveDocs: [QUEUE] },
    catalogue: { tools: [], skills: [] },
    keys: { model: "sk-made-up", search: null, relay: null },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onOnline: (fn) => {
      online.push(fn)
      return () => online.splice(online.indexOf(fn), 1)
    },
  }
}

const WORK = {
  // needsWork false: the model answered last.
  none: (d) => d.turns.push(makeTurn("user", [textBlock("hi")]), makeTurn("assistant", [textBlock("hello")])),
  // a person's message: work a worker can do.
  worker: (d) => d.turns.push(makeTurn("user", [textBlock("hi")])),
  // a call only a page can run.
  page: (d) => d.turns.push(makeTurn("user", [textBlock("hi")]), makeTurn("assistant", [callBlock("view_inspect", {}, { where: WHERE.host, status: CALL.approved, id: "h1" })])),
}

const BURST = {
  none: null,
  own: "run-1", // this asker's task's run: the watch lists it
  page: "b7a5c1f0-page-claim", // a page's claim (of this page, or any)
  foreign: "run-of-another-person", // a run the watch does not list
}

let used = []
beforeEach(() => _resetIds())
afterEach(() => {
  for (const url of used) forget(url)
  used = []
})

/**
 * One row: a session in the row's state, the asks so far made at its heads
 * under a view that allows them, then the row's view of the last task; then
 * one more askWork. Whether that one asked.
 */
async function row({ work, burst, last, asked }) {
  const repo = new Repo({ network: [] })
  const h = repo.create()
  h.change((d) => {
    initSession(d, {})
    d.burst = null
  })
  const before = headsOf(h) // heads the copy has moved past
  h.change((d) => {
    WORK[work](d)
    d.burst = BURST[burst] == null ? null : { run: BURST[burst] }
  })
  const now = headsOf(h)
  // Heads the copy lacks: another copy's write.
  let fork = A.clone(h.doc())
  fork = A.change(fork, (d) => {
    d.title = "elsewhere"
  })
  const lacking = encodeHeads(A.getHeads(fork))

  used.push(h.url)
  const clock = clockOf()
  const client = standIn()
  const opts = optsOf(client, clock)
  const listed = BURST[burst] && burst === "own" ? [{ id: BURST[burst] }] : []

  // The asks so far at these heads, under a view in which `burst` is the
  // asker's own and no task is known: where the rule allows asking at all.
  client.show({ state: "missing", runs: burst === "none" ? [] : [{ id: BURST[burst] }] })
  let made = 0
  for (let i = 0; i < asked; i++) {
    askWork(repo, h.url, opts)
    await flush()
  }
  made = client.asks.length
  // The tasks those asks made are forgotten by the stand-in: the row's view stands for the last one.
  client.tasks.length = 0

  const run = burst === "own" ? BURST.own : "run-1"
  const views = {
    none: { state: "missing", runs: listed },
    running: { state: "running", input: { heads: before }, runs: [{ id: run }] },
    equal: { state: "succeeded", input: { heads: before }, result: { outcome: "done", heads: now, own: [] }, runs: [{ id: run }] },
    behind: { state: "succeeded", input: { heads: before }, result: { outcome: "done", heads: lacking, own: [] }, runs: [{ id: run }] },
    ahead: { state: "succeeded", input: { heads: before }, result: { outcome: "done", heads: before, own: [] }, runs: [{ id: run }] },
    failed: { state: "failed", input: { heads: now }, error: "could not write", runs: [{ id: run }] },
  }
  client.show(views[last])
  const count = client.asks.length
  askWork(repo, h.url, opts)
  await flush()
  return { asked: client.asks.length > count, made }
}

/** The rule, as promise A says it, written here before reading ask.js's tests. */
function expected({ work, burst, last, asked }) {
  if (work !== "worker") return false // no work, or a page's
  if (burst === "page" || burst === "foreign") return false // stand back
  if (last === "running") return false // asking would only join it
  if (last === "equal" || last === "behind" || last === "failed") return false
  return asked < 2
}

const ROWS = []
for (const work of ["none", "worker", "page"])
  for (const burst of ["none", "own", "page", "foreign"])
    for (const last of ["none", "running", "equal", "behind", "ahead", "failed"])
      for (const asked of [0, 1, 2]) {
        // A run the watch lists, with no task known: cannot be.
        if (burst === "own" && last === "none") continue
        ROWS.push({ work, burst, last, asked })
      }

describe("askWork's rule, row by row (needsWork × burst × last task × asks so far)", () => {
  it(`has ${ROWS.length} rows`, () => {
    expect(ROWS).toHaveLength(207)
  })

  it.each(ROWS.map((r) => [`${r.work} · burst ${r.burst} · last ${r.last} · asked ${r.asked}`, r]))("%s", async (_, r) => {
    const { asked, made } = await row(r)
    // Asks so far can be made only where the session has work a run can do.
    expect(made).toBe(r.work === "worker" ? Math.min(r.asked, 2) : 0)
    expect(asked).toBe(expected({ ...r, asked: made }))
  })
})

describe("why it never loops", () => {
  it("behind: no ask while it waits; one judgment at HEADS_WAIT_MS, then it asks as if ahead, at most twice at these heads", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    let fork = A.change(A.clone(h.doc()), (d) => (d.title = "elsewhere"))
    const clock = clockOf()
    const client = standIn()
    const opts = optsOf(client, clock)
    askWork(repo, h.url, opts)
    await flush()
    client.start()
    client.end({ result: { outcome: "done", heads: encodeHeads(A.getHeads(fork)), own: [] } })
    await flush()
    expect(client.asks).toHaveLength(1)
    await clock.advance(HEADS_WAIT_MS - 1)
    expect(client.asks).toHaveLength(1)
    await clock.advance(1)
    expect(client.asks).toHaveLength(2)
    // That task too ends at heads this copy never gets: the copy's heads have
    // had their two asks, so nothing more until they change.
    client.start("run-2")
    fork = A.change(fork, (d) => (d.title = "again"))
    client.end({ result: { outcome: "nothing", heads: encodeHeads(A.getHeads(fork)), own: [] } })
    await flush()
    for (let i = 0; i < 5; i++) {
      await clock.advance(HEADS_WAIT_MS)
      askWork(repo, h.url, opts)
      await flush()
    }
    expect(client.asks).toHaveLength(2)
    expect(client.asks.every((a) => JSON.stringify(a.input.heads) === JSON.stringify(headsOf(h)))).toBe(true)
  })

  it("two askers on two copies with the same heads: one task, and nothing more once it ends at heads both have", async () => {
    const repoA = new Repo({ network: [] })
    const a = repoA.create()
    a.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    const repoB = new Repo({ network: [] })
    const b = repoB.import(A.save(a.doc()), { docId: a.documentId })
    used.push(a.url)
    // Two pages: two instances of the module.
    const first = await import("./ask.js")
    vi.resetModules()
    const second = await import("./ask.js")
    expect(second.askWork).not.toBe(first.askWork)

    const clock = clockOf()
    const client = standIn()
    const onlineA = []
    const onlineB = []
    first.askWork(repoA, a.url, optsOf(client, clock, onlineA))
    second.askWork(repoB, b.url, optsOf(client, clock, onlineB))
    await flush()
    expect(client.tasks).toHaveLength(1)
    client.start()
    // The run answers on a third copy; both copies get it.
    const run = new Repo({ network: [] }).import(A.save(a.doc()), { docId: a.documentId })
    run.change((d) => d.turns.push(makeTurn("assistant", [textBlock("hello")])))
    a.merge(run)
    b.merge(run)
    client.end({ result: { outcome: "done", heads: headsOf(run), own: [] } })
    await flush()
    for (let i = 0; i < 3; i++) {
      first.askWork(repoA, a.url, optsOf(client, clock, onlineA))
      second.askWork(repoB, b.url, optsOf(client, clock, onlineB))
      for (const fn of [...onlineA, ...onlineB]) fn()
      await clock.advance(HEADS_WAIT_MS)
    }
    expect(client.tasks).toHaveLength(1)
    second.forget(b.url)
  })

  it("a task that ends 'held' again and again asks nothing more; Take over asks once", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const clock = clockOf()
    const client = standIn()
    const online = []
    const opts = optsOf(client, clock, online)
    askWork(repo, h.url, opts)
    await flush()
    client.start()
    // Another person's burst lands before this run's first look: it is held, and writes nothing.
    h.change((d) => (d.burst = { run: BURST.foreign }))
    client.end({ result: { outcome: "held", heads: headsOf(h), own: [] } })
    await flush()
    for (let i = 0; i < 4; i++) {
      h.change((d) => d.turns.push(makeTurn("user", [textBlock(`more ${i}`)])))
      askWork(repo, h.url, opts)
      for (const fn of online) fn()
      await clock.advance(HEADS_WAIT_MS)
    }
    expect(client.tasks).toHaveLength(1)

    takeOver(repo, h.url, opts).catch(() => {})
    await flush()
    expect(h.doc().burst).toBe(null)
    expect(client.tasks).toHaveLength(2)
    expect(client.tasks[1].request.input.heads).toEqual(headsOf(h))
    // Pressed again while that task waits: it asks nothing more.
    takeOver(repo, h.url, opts)
    await flush()
    expect(client.tasks).toHaveLength(2)
  })

  it("a task that fails asks nothing at the heads it failed at, however often it is called or the network comes back", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const clock = clockOf()
    const client = standIn()
    const online = []
    const opts = optsOf(client, clock, online)
    const first = askWork(repo, h.url, opts)
    await flush()
    client.start()
    client.end({ state: "failed", error: `could not open ${QUEUE}#abc` })
    // A rejection is worded without urls.
    const err = await first.then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toMatch(/automerge:/)
    for (let i = 0; i < 4; i++) {
      expect((await askWork(repo, h.url, opts)).asked).toBe(false)
      for (const fn of online) fn()
      await clock.advance(HEADS_WAIT_MS)
    }
    expect(client.tasks).toHaveLength(1)
    // A new write asks again, once.
    h.change((d) => d.turns.push(makeTurn("user", [textBlock("again")])))
    askWork(repo, h.url, opts)
    await flush()
    expect(client.tasks).toHaveLength(2)
  })

  it("a session whose work only a page can do is never asked for", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.page(d)
    })
    used.push(h.url)
    const clock = clockOf()
    const client = standIn()
    const online = []
    const opts = optsOf(client, clock, online)
    for (let i = 0; i < 4; i++) {
      expect((await askWork(repo, h.url, opts)).asked).toBe(false)
      for (const fn of online) fn()
      await clock.advance(HEADS_WAIT_MS)
    }
    expect(client.asks).toHaveLength(0)
  })
})

describe("an ask that fails is said, and asked again when it can succeed", () => {
  /** The stand-in, with the person's own queue and the pools heard serving it, moved by hand. */
  function withPools(client) {
    const hearing = []
    client.ownQueue = vi.fn(async () => QUEUE)
    client.served = vi.fn((repo, queue, onChange, options) => {
      const h = { queue, onChange, options, stopped: false }
      hearing.push(h)
      return () => (h.stopped = true)
    })
    /** Every listener still hearing is told these pools. */
    client.hear = async (pools) => {
      for (const h of hearing.filter((x) => !x.stopped)) h.onChange(pools)
      await flush()
    }
    client.hearing = () => hearing.filter((x) => !x.stopped).length
    return client
  }

  /** The current task fails without being taken, as a run that cannot start would. */
  function failTask(client, why) {
    const task = client.tasks.at(-1)
    task.state = "failed"
    task.reject(new Error(why))
  }

  it("said in words without urls; a pool heard asks again, a change and the network as always, and nothing loops", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const clock = clockOf()
    const client = withPools(standIn())
    const online = []
    const opts = optsOf(client, clock, online)
    const said = []
    followWork(repo, h.url, (_view, failed) => said.push(failed), opts)
    expect(said).toEqual([null])

    // The way the reader found: a burst run in the page, whose first look fails.
    const fail = () =>
      client.doWork.mockImplementationOnce(async () => {
        throw new Error(`Invalid AutomergeUrl: 'null' while opening ${QUEUE}#abc`)
      })
    fail()
    await expect(askWork(repo, h.url, opts)).rejects.toThrow(/Invalid AutomergeUrl/)
    await flush()
    const words = failedAskOf(h.url)
    expect(words).toMatch(/^Invalid AutomergeUrl: 'null' while opening a document/)
    expect(words).not.toMatch(/automerge:|4GUzmm/)
    expect(said.at(-1)).toBe(words)
    // The person's own queue is listened to, as doWork hears it.
    expect(client.served).toHaveBeenCalledTimes(1)
    expect(client.served.mock.calls[0][1]).toBe(QUEUE)
    expect(client.served.mock.calls[0][3]).toEqual({ local: false })

    // Nobody heard: nothing asked.
    await client.hear([])
    expect(client.doWork).toHaveBeenCalledTimes(1)
    // A pool heard: asked again, the second ask at these heads; the failure is no longer said.
    await client.hear([{ pool: "pool-a", name: "", slots: 1, busy: 0, has: [] }])
    expect(client.doWork).toHaveBeenCalledTimes(2)
    expect(failedAskOf(h.url)).toBe(null)
    expect(said.at(-1)).toBe(null)
    expect(client.hearing()).toBe(0)

    // It fails again: said again, and a pool heard asks nothing more at these heads.
    failTask(client, "the pool's worker could not start")
    await flush()
    expect(failedAskOf(h.url)).toBe("the pool's worker could not start")
    await client.hear([{ pool: "pool-a", name: "", slots: 1, busy: 0, has: [] }])
    await client.hear([{ pool: "pool-b", name: "", slots: 1, busy: 0, has: [] }])
    expect(client.doWork).toHaveBeenCalledTimes(2)
    expect(failedAskOf(h.url)).toBe("the pool's worker could not start")

    // The network coming back asks again.
    for (const fn of online) fn()
    await flush()
    expect(client.doWork).toHaveBeenCalledTimes(3)
    expect(failedAskOf(h.url)).toBe(null)
    failTask(client, "still no worker")
    await flush()
    expect(failedAskOf(h.url)).toBe("still no worker")

    // A change to the session asks again.
    h.change((d) => d.turns.push(makeTurn("user", [textBlock("again")])))
    askWork(repo, h.url, opts).catch(() => {})
    await flush()
    expect(client.doWork).toHaveBeenCalledTimes(4)
    expect(failedAskOf(h.url)).toBe(null)
  })

  it("is no longer said once the copy shows no work", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const client = withPools(standIn())
    const opts = optsOf(client, clockOf())
    client.doWork.mockImplementationOnce(async () => {
      throw new Error("no pool")
    })
    await askWork(repo, h.url, opts).catch(() => {})
    expect(failedAskOf(h.url)).toBe("no pool")
    // Another device answered it.
    h.change((d) => d.turns.push(makeTurn("assistant", [textBlock("hello")])))
    expect((await askWork(repo, h.url, opts)).why).toBe("no work")
    expect(failedAskOf(h.url)).toBe(null)
    expect(client.hearing()).toBe(0)
  })
})

describe("what askWork asks with, and what it writes", () => {
  it("session and heads first, keys last; no signal; nothing in it or the session names the task or the queue; the session is not written", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const clock = clockOf()
    const client = standIn()
    const before = A.getAllChanges(h.doc()).length
    askWork(repo, `${h.url}#${headsOf(h).join("|")}`, optsOf(client, clock))
    await flush()
    expect(client.doWork).toHaveBeenCalledTimes(1)
    const [givenRepo, request, third] = client.doWork.mock.calls[0]
    expect(givenRepo).toBe(repo)
    expect(third).toBe(undefined) // no signal: a view that closes does not stop a burst
    expect(Object.keys(request).sort()).toEqual(["importUrl", "input", "key"])
    expect(request.key).toBe(workKey(h.url))
    expect(request.key).toBe(`agent:${h.url}`)
    expect(Object.keys(request.input)).toEqual(["session", "heads", "account", "catalogue", "keys"])
    expect(request.input.session).toBe(h.url)
    expect(request.input.heads).toEqual(headsOf(h))
    client.start()
    client.end({ result: { outcome: "done", heads: headsOf(h), own: [] } })
    await flush()
    expect(A.getAllChanges(h.doc()).length).toBe(before)
    const text = JSON.stringify(h.doc())
    expect(text).not.toMatch(/task|queue/i)
    expect(text).not.toContain(QUEUE)
  })

  it("a rejection's words carry no url, with heads or without", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const client = standIn()
    client.doWork = vi.fn(async () => {
      throw new Error(`${QUEUE} did not arrive in 4000 ms; ${QUEUE}#2ZpQ|3abc came back empty (${h.url})`)
    })
    const err = await askWork(repo, h.url, optsOf(client, clockOf())).then(
      () => null,
      (e) => e
    )
    expect(err.message).not.toMatch(/automerge:|4GUzmm|2ZpQ/)
  })
})

describe("own hashes", () => {
  it("hashes from a run's progress and from its result reach rememberOwn, under the url a restored watch asks with", async () => {
    const repo = new Repo({ network: [] })
    const h = repo.create()
    h.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(h.url)
    const client = standIn()
    askWork(repo, h.url, optsOf(client, clockOf()))
    await flush()
    client.start()
    client.show({ state: "running", runs: [{ id: "run-1" }], progress: { own: ["hash-from-progress"] } })
    client.end({ result: { outcome: "done", heads: headsOf(h), own: ["hash-from-progress", "hash-from-result"] } })
    await flush()
    // What restoreWatches is handed (kernel/store.js watchesWriter over the page's store).
    const watches = watchesWriter(handleStore(h))
    expect(watches.isOwn("hash-from-progress")).toBe(true)
    expect(watches.isOwn("hash-from-result")).toBe(true)
    expect(watches.isOwn("someone-elses")).toBe(false)
  })
})

describe("a burst's end and the asker, together (kernel/burst.js with askWork)", () => {
  /**
   * The author's first doubt. A person's message reaches the run's copy
   * after the loop's last look and before the burst ends (here, while it
   * reads its task's runs to clear `burst`). The session at the end still
   * needs work, so the result's heads are null, and the asker judges against
   * the heads it asked at: the message is asked for. Promise A: "every re-ask
   * needs a change the ended run did not see" — this is one.
   */
  it("a message that lands between the loop's last look and the burst's end is asked for", async () => {
    const { runBurst } = await import("../kernel/burst.js")
    const { makeMock } = await import("../fixtures/mock-provider.js")
    const { needsWork } = await import("../kernel/runner.js")
    const pageRepo = new Repo({ network: [] })
    const page = pageRepo.create()
    page.change((d) => {
      initSession(d, {})
      d.burst = null
      WORK.worker(d)
    })
    used.push(page.url)
    const runRepo = new Repo({ network: [] })
    const runCopy = runRepo.import(A.save(page.doc()), { docId: page.documentId })

    const clock = clockOf()
    const client = standIn()
    askWork(pageRepo, page.url, optsOf(client, clock))
    await flush()
    expect(client.tasks).toHaveLength(1)
    client.start("run-1")

    let spoke = false
    const settled = Promise.resolve()
    const result = await runBurst(
      { repo: runRepo, signal: new AbortController().signal, run: "run-1", taskUrl: null, settled, progress: () => {}, log: () => {} },
      {
        session: page.url,
        heads: client.tasks[0].request.input.heads,
        taskRuns: () => {
          const last = runCopy.doc().turns.at(-1)
          if (!spoke && last.role === "assistant" && !last.streaming) {
            // The loop is done; the person speaks, and the run's copy has it.
            spoke = true
            page.change((d) => d.turns.push(makeTurn("user", [textBlock("and one more thing")])))
            runCopy.merge(page)
          }
          return ["run-1"]
        },
        getProvider: async () => makeMock([[{ type: "text", delta: "Hello." }]]),
        buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
        flushMs: 1,
        waitForNetwork: async () => {},
      }
    )
    expect(spoke).toBe(true)
    page.merge(runCopy)
    client.end({ result })
    await flush()
    // The page's copy has work, and it is asked for.
    expect(needsWork(page.doc())).toBe(true)
    // Not awaited: an ask resolves only when its task ends.
    askWork(pageRepo, page.url, optsOf(client, clock))
    await flush()
    expect(client.tasks).toHaveLength(2)
  })
})
