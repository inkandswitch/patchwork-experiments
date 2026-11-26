/**
 * A checker's tests of step 5: the workflow driver with no plan lease.
 *
 * Two and three pages drive one plan, each over its own Automerge copy of the
 * plan and of every step session. A change reaches another page only when
 * the test delivers it (`deliver`, `sync`); each copy fires its own change
 * listeners, as a DocHandle does, so a driver that is started ticks on them
 * (with fake timers where a case needs its settle delay to run). Step
 * sessions are run by real bursts (kernel/burst.js runBurst) in this
 * process, each reading its own page's copies, with a `settled` the test
 * resolves: that is the beat. Only the model is a stand-in, counting every
 * request it is sent.
 *
 * Every url here is made up.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { WorkflowDriver, _resetDrivers } from "./driver.js"
import { initPlan, beginStep, finishStep, reopenSteps, resumePlan, changePlan, newStep, runAgain, STEP, PLAN, attempt } from "./plan.js"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { runBurst, BURST } from "../kernel/burst.js"
import { needsWork } from "../kernel/runner.js"

beforeEach(() => _resetIds())

/** Made up. */
const PLAN_URL = "automerge:4vQ8mXr2TnLp6WcZ9hJd3KbY7sF"
const SESSION_A = "automerge:2gHn5RkW8pXz3VmQ7cLd9TbJ4yE"

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })
const stepOf = (plan, id) => plan.steps.find((s) => s.id === id)
const heads = (doc) => (doc ? A.getHeads(doc).join(",") : null)

/**
 * `n` pages' copies of every document. Each copy fires its own listeners on
 * a change made there or delivered to it.
 */
function world(actors) {
  const n = actors.length
  const docs = new Map() // url -> [copy on page i]
  const listeners = new Map() // `${i} ${url}` -> Set<fn>
  const actor = (i) => actors[i].repeat(16)
  let made = 0
  const fire = (i, url) => {
    for (const fn of [...(listeners.get(`${i} ${url}`) ?? [])]) fn({ doc: docs.get(url)[i] })
  }
  const handle = (i, url) => ({
    url,
    doc: () => docs.get(url)?.[i],
    heads: () => A.getHeads(docs.get(url)[i]),
    change(fn) {
      const all = docs.get(url)
      const before = heads(all[i])
      all[i] = A.change(all[i], fn)
      if (heads(all[i]) !== before) fire(i, url)
    },
    on(event, fn) {
      if (event !== "change") return
      const key = `${i} ${url}`
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key).add(fn)
    },
    off(event, fn) {
      listeners.get(`${i} ${url}`)?.delete(fn)
    },
  })
  const hooks = [] // (i, url) => void, run when page i finds url
  const repo = (i) => ({
    async find(url) {
      const bare = String(url).split("#")[0]
      for (const hook of hooks) hook(i, bare)
      if (!docs.get(bare)?.[i]) throw new Error("unavailable")
      return handle(i, bare)
    },
    async create2() {
      const url = `automerge:page${i}doc${++made}`
      const all = Array(n).fill(null)
      all[i] = A.init({ actor: actor(i) })
      docs.set(url, all)
      return handle(i, url)
    },
  })
  const seed = (url, fill) => {
    const base = A.change(A.init({ actor: "ee".repeat(16) }), fill)
    docs.set(url, actors.map((_, i) => A.clone(base, { actor: actor(i) })))
  }
  const snapshot = (i, url) => A.clone(docs.get(url)[i])
  const deliver = (from, to, url, snap = snapshot(from, url)) => {
    const all = docs.get(url)
    const before = heads(all[to])
    all[to] = all[to] ? A.merge(all[to], snap) : A.clone(snap, { actor: actor(to) })
    if (heads(all[to]) !== before) fire(to, url)
  }
  const sync = () => {
    for (const url of [...docs.keys()]) {
      for (let from = 0; from < n; from++) for (let to = 0; to < n; to++) if (from !== to && docs.get(url)[from]) deliver(from, to, url)
    }
  }
  const allHeads = () => [...docs.keys()].sort().map((url) => [url, docs.get(url).map(heads)])
  return { n, docs, repo, handle, seed, snapshot, deliver, sync, hooks, allHeads }
}

/** A model that answers every request with `text`, counting them. */
function model(text = "the answer") {
  const requests = []
  return {
    id: "mock",
    name: "Mock",
    requests,
    async *stream(request) {
      requests.push(request)
      yield { type: "text", delta: text }
      yield { type: "stop", reason: "end" }
    },
  }
}

const emptyToolset = { tools: [], schemas: [], get: () => null }

/**
 * A page: its driver over its own copies. With `provider`, asking for a
 * step's work runs a real burst on this page's copies (one at a time per
 * session, only when the copy shows work, at most once per version), whose
 * `settled` is `beat()`; otherwise asking only records the ask.
 */
function page(w, i, { provider = null, beat = () => Promise.resolve(), now = () => 1_000 + i, settleMs = 1e9 } = {}) {
  const asked = []
  const told = []
  const bursts = []
  const going = new Map()
  const askedAt = new Map()
  let runs = 0
  const startSession = async (handle) => {
    asked.push(handle.url)
    if (!provider) return { asked: true, outcome: "idle" }
    const doc = handle.doc()
    if (going.has(handle.url) || !needsWork(doc) || askedAt.get(handle.url) === heads(doc)) return { asked: false }
    askedAt.set(handle.url, heads(doc))
    const run = `run-p${i}-${++runs}`
    const result = runBurst(
      { repo: w.repo(i), signal: new AbortController().signal, run, taskUrl: "automerge:task", settled: beat(), progress: () => {}, log: () => {} },
      { session: handle.url, taskRuns: () => [run], getProvider: async () => provider, buildToolset: async () => emptyToolset, splice: A.splice, flushMs: 0, waitForNetwork: async () => {} }
    ).finally(() => going.delete(handle.url))
    going.set(handle.url, result)
    bursts.push({ url: handle.url, result })
    return { asked: true, outcome: "idle" }
  }
  const notify = () => ({ notify: (render) => { const text = render(); if (text) told.push(text) }, close() {} })
  const driver = new WorkflowDriver({ repo: w.repo(i), handle: w.handle(i, PLAN_URL), startSession, stopWork: async () => false, notify, now, settleMs })
  return { i, driver, asked, told, bursts, tick: () => driver.kick(), plan: () => w.docs.get(PLAN_URL)[i], idle: () => Promise.allSettled(bursts.map((b) => b.result)) }
}

const live = []
afterEach(() => {
  for (const d of live.splice(0)) d.stop()
  _resetDrivers()
  vi.useRealTimers()
})
function pages(w, opts = {}) {
  const ps = Array.from({ length: w.n }, (_, i) => page(w, i, typeof opts === "function" ? opts(i) : opts))
  live.push(...ps.map((p) => p.driver))
  return ps
}

function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

const BOTH_WAYS = [["aa", "bb"], ["bb", "aa"]]

// ---------------------------------------------------------------- begin, with real bursts

describe("two pages that begin one step in one crossing, with real bursts", () => {
  for (const actors of BOTH_WAYS) {
    it(`(actors ${actors}) merged within the beat: the plan names one session everywhere, the other burst ends not-the-step having written nothing, and the model is asked once`, async () => {
      const w = world(actors)
      w.seed(PLAN_URL, (d) => initPlan(d, { title: "W", goal: "G", steps: [step("a")] }))
      const provider = model("result of a")
      const beat = deferred()
      const ps = pages(w, { provider, beat: () => beat.promise })
      await ps[0].tick()
      await ps[1].tick()
      const made = [...w.docs.keys()].filter((u) => u !== PLAN_URL)
      expect(made).toHaveLength(2)
      expect(ps.map((p) => p.bursts.length)).toEqual([1, 1])
      // Both bursts are waiting for their beat; the merge comes within it.
      const before = Object.fromEntries(made.map((u) => [u, w.docs.get(u).map(heads)]))
      w.sync()
      beat.resolve()
      const results = await Promise.all(ps.map((p) => p.bursts[0].result))
      const named = stepOf(ps[0].plan(), "a").sessionUrl
      expect(stepOf(ps[1].plan(), "a").sessionUrl).toBe(named)
      const loser = made.find((u) => u !== named)
      const outcomes = Object.fromEntries(ps.map((p, k) => [p.bursts[0].url, results[k].outcome]))
      expect(outcomes[loser]).toBe(BURST.notTheStep)
      // The losing session was not written by its burst, on any page.
      const loserPage = Number(loser.match(/page(\d)/)[1])
      expect(heads(w.docs.get(loser)[loserPage])).toBe(before[loser][loserPage])
      expect(provider.requests).toHaveLength(1)
      // Once all is delivered, the step is filed from the one session the plan names.
      w.sync()
      for (const p of ps) await p.tick()
      w.sync()
      for (const p of ps) await p.tick()
      w.sync()
      for (const p of ps) {
        const a = stepOf(p.plan(), "a")
        expect([a.status, a.sessionUrl, a.result]).toEqual([STEP.done, named, "result of a"])
        expect(p.plan().status).toBe(PLAN.done)
      }
      await Promise.all(ps.map((p) => p.idle()))
      expect(provider.requests).toHaveLength(1)
    })

    it(`(actors ${actors}) merged slower than a beat: both bursts pay once, as accepted; the plan still names one, and is filed with its session's answer`, async () => {
      const w = world(actors)
      w.seed(PLAN_URL, (d) => initPlan(d, { title: "W", goal: "G", steps: [step("a")] }))
      const provider = model("result of a")
      const ps = pages(w, { provider })
      await ps[0].tick()
      await ps[1].tick()
      await Promise.all(ps.map((p) => p.idle()))
      expect(provider.requests).toHaveLength(2)
      w.sync()
      for (const p of ps) await p.tick()
      w.sync()
      const named = stepOf(ps[0].plan(), "a").sessionUrl
      for (const p of ps) expect([stepOf(p.plan(), "a").status, stepOf(p.plan(), "a").sessionUrl]).toEqual([STEP.done, named])
      await Promise.all(ps.map((p) => p.idle()))
      expect(provider.requests).toHaveLength(2)
    })
  }
})

// ---------------------------------------------------------------- report

describe("pages reporting one finish in one crossing", () => {
  function finished(actors) {
    const w = world(actors)
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] })] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
    })
    w.seed(SESSION_A, (d) => {
      initSession(d, {})
      d.burst = null
      d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
      d.turns.push(makeTurn("user", [textBlock("do a")]))
      d.turns.push(makeTurn("assistant", [textBlock("result of a")]))
      d.usage = { in: 10, out: 5, turns: 1, cost: 0.25 }
    })
    return w
  }

  for (const actors of [["aa", "bb"], ["bb", "aa"], ["aa", "bb", "cc"], ["cc", "bb", "aa"]]) {
    it(`${actors.length} pages (actors ${actors}): each tells at most once; after the merge the plan is right on every copy and nothing is told again`, async () => {
      const w = finished(actors)
      const ps = pages(w)
      for (const p of ps) await p.tick()
      const tellings = () => ps.flatMap((p) => p.told).filter((t) => t.includes("## Done: Step a"))
      for (const p of ps) expect(p.told.filter((t) => t.includes("## Done: Step a")).length).toBeLessThanOrEqual(1)
      const count = tellings().length
      expect(count).toBeLessThanOrEqual(ps.length)
      w.sync()
      for (const p of ps) {
        const a = stepOf(p.plan(), "a")
        expect([a.status, a.version, a.result]).toEqual([STEP.done, 1, "result of a"])
        expect(stepOf(p.plan(), "b").sessionUrl).toBeTruthy() // b was begun (in as many sessions as pages; the plan names one)
        expect(p.plan().usage.cost).toBe(0.25)
      }
      expect(new Set(ps.map((p) => stepOf(p.plan(), "b").sessionUrl)).size).toBe(1)
      for (let k = 0; k < 3; k++) {
        for (const p of ps) await p.tick()
        w.sync()
      }
      expect(tellings()).toHaveLength(count)
    })
  }
})

// ---------------------------------------------------------------- lagging copies

describe("a page whose copies lag a reopen", () => {
  /**
   * Step a running in SESSION_A, which has answered (run 0), on every page.
   * Page 0 files it, the orchestrator reopens it, and page 0 carries it on
   * (its session told run 1). Returns what page 1 might have of each.
   */
  async function reopenedOnPage0(actors) {
    const w = world(actors)
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a")] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
    })
    w.seed(SESSION_A, (d) => {
      initSession(d, {})
      d.burst = null
      d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
      d.turns.push(makeTurn("user", [textBlock("do a")]))
      d.turns.push(makeTurn("assistant", [textBlock("old a")]))
    })
    const ps = pages(w)
    await ps[0].tick()
    expect(stepOf(ps[0].plan(), "a").status).toBe(STEP.done)
    await ps[0].driver.reopen(["a"], { note: "again" })
    const a = stepOf(ps[0].plan(), "a")
    expect([a.status, attempt(a)]).toEqual([STEP.running, 1])
    return { w, ps }
  }

  for (const actors of BOTH_WAYS) {
    // Defect, kept as it.fails: decide() is made on the plan as the tick read
    // it, and finishStep checks only that the step is running, not that it
    // is still the run the session was judged for (sessionOutcome `run`).
    it.fails(`(actors ${actors}) the plan reaching page 1 while its tick reads the step's session: a is not filed with the run before's answer`, async () => {
      const { w, ps } = await reopenedOnPage0(actors)
      // Page 1 has the session as the run before left it, and the plan as it
      // was before page 0 filed it; the plan arrives while page 1 is reading.
      let delivered = false
      w.hooks.push((i, url) => {
        if (i === 1 && url === SESSION_A && !delivered) {
          delivered = true
          w.deliver(0, 1, PLAN_URL)
        }
      })
      await ps[1].tick()
      expect(delivered).toBe(true)
      const a = stepOf(ps[1].plan(), "a")
      expect([a.status, a.result]).toEqual([STEP.running, null])
      // What it costs once merged: page 1's write is the later, so every copy
      // keeps it, and run 1's answer is never filed (finish moves only from running).
      w.sync()
      for (const p of ps) expect(stepOf(p.plan(), "a").status).toBe(STEP.running)
    })

    it(`(actors ${actors}) page 1 having heard neither page 0's finish nor the reopen (the crossing WORKFLOW.md accepts): after the merge the reopen holds`, async () => {
      const { w, ps } = await reopenedOnPage0(actors)
      await ps[1].tick()
      expect(stepOf(ps[1].plan(), "a").status).toBe(STEP.done)
      w.sync()
      for (const p of ps) {
        const a = stepOf(p.plan(), "a")
        expect([a.status, a.result, attempt(a)]).toEqual([STEP.running, null, 1])
      }
    })
  }

  for (const actors of BOTH_WAYS) {
    // Defect, kept as it.fails: pausePlan checks only "running and not
    // paused" inside its change, not that the budget is still spent.
    it.fails(`(actors ${actors}) a resume reaching page 1 while its tick reads: the plan is not paused again under a lifted cap`, async () => {
      const w = world(actors)
      w.seed(PLAN_URL, (d) => {
        initPlan(d, { title: "W", goal: "G", limits: { cost: 1 }, steps: [step("a"), step("b", { after: ["a"] })] })
        beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
        finishStep(d, "a", { result: "a", now: 2 })
        d.usage = { in: 10, out: 5, cost: 2 }
        d.told = { "finished:a:0": true }
      })
      w.seed(SESSION_A, (d) => {
        initSession(d, {})
        d.burst = null
        d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
        d.turns.push(makeTurn("user", [textBlock("do a")]), makeTurn("assistant", [textBlock("a")]))
        d.usage = { in: 10, out: 5, cost: 2 }
      })
      const ps = pages(w)
      // Page 0 pauses it, and the person resumes it there with $5 more.
      await ps[0].tick()
      expect(ps[0].plan().paused?.reason).toBe("budget")
      w.handle(0, PLAN_URL).change((d) => resumePlan(d, 5, 3))
      expect(ps[0].plan().paused).toBe(null)
      // Page 1 ticks on its copy from before the pause; the resumed plan arrives as it reads.
      let delivered = false
      w.hooks.push((i, url) => {
        if (i === 1 && url === SESSION_A && !delivered) {
          delivered = true
          w.deliver(0, 1, PLAN_URL)
        }
      })
      await ps[1].tick()
      expect(delivered).toBe(true)
      expect(ps[1].plan().paused ?? null).toBe(null)
    })
  }
})

// ---------------------------------------------------------------- a page that goes away

describe("a page that goes away in the middle of perform", () => {
  // Defect, kept as it.fails: continueStep speaks into the session whatever
  // it holds; it is neither recomputed nor set only if unset, though the
  // session's `workflow.run` already says this run's instructions are there.
  it.fails("having spoken a reopened step's instructions but not begun it in the plan: the next page carries it on without saying them twice", async () => {
    const w = world(["aa", "bb"])
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a")] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
      finishStep(d, "a", { result: "old a", now: 2 })
      d.told = { "finished:a:0": true }
    })
    w.seed(SESSION_A, (d) => {
      initSession(d, {})
      d.burst = null
      d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
      d.turns.push(makeTurn("user", [textBlock("do a")]), makeTurn("assistant", [textBlock("old a")]))
    })
    const ps = pages(w)
    // The orchestrator's reopen, written on page 0.
    w.handle(0, PLAN_URL).change((d) => reopenSteps(d, ["a"], { note: "again", now: 3 }))
    // Page 0's tick dies after continueStep's session change, before its plan write.
    ps[0].driver.write = () => false
    await ps[0].tick()
    ps[0].driver.stop()
    const spoken = (doc) => doc.turns.filter((t) => t.role === "user" && t.blocks.some((b) => b.type === "text" && /again/.test(b.text))).length
    expect(spoken(w.docs.get(SESSION_A)[0])).toBe(1)
    expect(stepOf(ps[0].plan(), "a").status).toBe(STEP.pending)
    // Page 1 gets what page 0 left, and ticks.
    w.sync()
    await ps[1].tick()
    expect(stepOf(ps[1].plan(), "a").status).toBe(STEP.running)
    expect(spoken(w.docs.get(SESSION_A)[1])).toBe(1)
  })

  it("having made a step's session but not named it: the next page begins it in a session of its own, and the first is never asked for", async () => {
    const w = world(["aa", "bb"])
    w.seed(PLAN_URL, (d) => initPlan(d, { title: "W", goal: "G", steps: [step("a")] }))
    const ps = pages(w)
    ps[0].driver.write = () => false
    await ps[0].tick()
    ps[0].driver.stop()
    const orphan = [...w.docs.keys()].find((u) => u !== PLAN_URL)
    expect(stepOf(ps[0].plan(), "a").sessionUrl ?? null).toBe(null)
    w.sync()
    await ps[1].tick()
    const named = stepOf(ps[1].plan(), "a").sessionUrl
    expect(named).toBeTruthy()
    expect(named).not.toBe(orphan)
    expect([...ps[0].asked, ...ps[1].asked]).not.toContain(orphan)
  })

  it("having filed a step but not told it: the next page tells it, once", async () => {
    const w = world(["aa", "bb"])
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a")] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
    })
    w.seed(SESSION_A, (d) => {
      initSession(d, {})
      d.burst = null
      d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
      d.turns.push(makeTurn("user", [textBlock("do a")]), makeTurn("assistant", [textBlock("result of a")]))
    })
    const ps = pages(w)
    ps[0].driver.notify = null // gone before it reported
    await ps[0].tick()
    ps[0].driver.stop()
    expect(stepOf(ps[0].plan(), "a").status).toBe(STEP.done)
    w.sync()
    await ps[1].tick()
    await ps[1].tick()
    expect(ps[1].told.filter((t) => t.includes("## Done: Step a"))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- acting from either page

describe("acting on a plan from either page", () => {
  /** a done, b running in SESSION_A's sibling (made by page 0), on both pages. */
  async function running(actors) {
    const w = world(actors)
    w.seed(PLAN_URL, (d) => initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b")] }))
    const ps = pages(w)
    await ps[0].tick()
    w.sync()
    await ps[1].tick()
    expect(ps[1].plan().steps.map((s) => s.status)).toEqual([STEP.running, STEP.running])
    return { w, ps }
  }

  for (const actors of BOTH_WAYS) {
    it(`(actors ${actors}) the page that did not begin the steps stops the plan; both copies agree, its sessions are halted, and nothing more is written`, async () => {
      const { w, ps } = await running(actors)
      await ps[1].driver.cancel()
      w.sync()
      for (const p of ps) {
        expect(p.plan().status).toBe(PLAN.stopped)
        expect(p.plan().steps.map((s) => s.status)).toEqual([STEP.cancelled, STEP.cancelled])
      }
      for (const p of ps) await p.tick()
      w.sync()
      const before = w.allHeads()
      for (const p of ps) await p.tick()
      expect(w.allHeads()).toEqual(before)
    })

    it(`(actors ${actors}) the other page adds a step and lifts the budget: one page begins it, once`, async () => {
      const { w, ps } = await running(actors)
      w.handle(1, PLAN_URL).change((d) => {
        d.steps.push(newStep(step("c")))
        d.limits.cost = 50
        runAgain(d)
      })
      await ps[1].tick()
      w.sync()
      await ps[0].tick()
      w.sync()
      for (const p of ps) {
        expect(stepOf(p.plan(), "c").status).toBe(STEP.running)
        expect(p.plan().limits.cost).toBe(50)
      }
      const sessions = [...w.docs.keys()].filter((u) => u !== PLAN_URL)
      expect(sessions).toHaveLength(3)
    })
  }
})

// ---------------------------------------------------------------- quiet

describe("no write without a change: three pages, an hour", () => {
  async function hour(w, ps) {
    for (const p of ps) p.driver.start()
    // Let them settle: ticks on changes, deliveries between.
    for (let k = 0; k < 10; k++) {
      await vi.advanceTimersByTimeAsync(1_000)
      w.sync()
    }
    const before = w.allHeads()
    for (let k = 0; k < 60; k++) {
      await vi.advanceTimersByTimeAsync(60_000)
      w.sync()
    }
    return { before, after: w.allHeads() }
  }

  for (const shape of ["running", "done"]) {
    it(`a ${shape} plan an older version left with a lease and lastGeneration gains no change, on any copy`, async () => {
      vi.useFakeTimers()
      const w = world(["aa", "bb", "cc"])
      w.seed(PLAN_URL, (d) => {
        initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] })] })
        d.lease = { runner: "workflow-old", generation: 7, at: 1 }
        d.lastGeneration = 7
        beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
        if (shape === "done") finishStep(d, "a", { result: "r", now: 2 })
      })
      w.seed(SESSION_A, (d) => {
        initSession(d, {})
        d.burst = null
        d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
        d.turns.push(makeTurn("user", [textBlock("do a")]))
        // Running: it waits on a person's yes. Done: it answered.
        if (shape === "running") d.turns.push(makeTurn("assistant", [callBlock("web_fetch", {}, { id: "c1", status: CALL.pending })]))
        else d.turns.push(makeTurn("assistant", [textBlock("r")]))
      })
      let t = 10_000
      const ps = pages(w, (i) => ({ now: () => (t += 7 + i), settleMs: 150 }))
      const { before, after } = await hour(w, ps)
      expect(after).toEqual(before)
      for (const p of ps) {
        expect({ ...p.plan().lease }).toEqual({ runner: "workflow-old", generation: 7, at: 1 })
        expect(p.plan().lastGeneration).toBe(7)
      }
      if (shape === "done") for (const p of ps) expect(stepOf(p.plan(), "b").status).not.toBe(STEP.pending)
    })
  }
})
