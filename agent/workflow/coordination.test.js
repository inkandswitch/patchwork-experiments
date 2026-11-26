/**
 * Two pages, one plan, no lease.
 *
 * Each page has its own copy of every document (the plan and the step
 * sessions), and a change reaches the other page only when the test
 * delivers it, document by document. Each page's driver ticks only when the
 * test says (no timer, no change event), so every case is a finite order of
 * ticks and deliveries, and each order is run with both pages' actors either
 * way round, which decides which of two concurrent writes Automerge keeps.
 *
 * What holds:
 *   - two pages that begin one step in one crossing make two sessions; once
 *     merged, the plan names one on both copies, the other page asks only
 *     for that one, and nothing more is written (the other session's burst
 *     ends at its first boundary, `not-the-step`: kernel/burst.test.js);
 *     in order, one page begins it and the other makes nothing;
 *   - two pages reporting one finish in one crossing tell the orchestrator
 *     at most twice, and file the step once (one version); in order, once;
 *   - a page whose session copy lags a reopen never files the step with
 *     what the run before said: not when it has the halt and not the new
 *     instructions (waiting), and not when it has neither (its copy shows an
 *     earlier run, sessionOutcome `run`), whatever it has of the plan;
 *   - a request two pages read off a step's transcript in one crossing is
 *     one request: listed once, and decided once on either entry;
 *   - a plan an older version left with a `lease` is driven as any other;
 *   - after every case, once all is delivered, a tick on either page writes
 *     nothing.
 *
 * (Two pages with one session: a burst is a task's run, and two pools on
 * one task are kept apart by the task system's `settled`; two people's
 * bursts by the session's `burst` mark. kernel/burst.test.js and
 * kernel/burst-checked.test.js enumerate those crossings.)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as A from "@automerge/automerge"
import { WorkflowDriver, sessionOutcome, _resetDrivers } from "./driver.js"
import { initPlan, beginStep, finishStep, openRequests, requestOf, decideRequest, REQUEST_TOOL_ID, STEP, PLAN } from "./plan.js"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { STOP, stopOf } from "../session/status.js"

beforeEach(() => _resetIds())

/** Made up. */
const PLAN_URL = "automerge:2u5TfYvKq8rVpHcM3nWzLd4XbJ6"
const SESSION_A = "automerge:3hQx9TmRk2LpVw7NcY4dBf8GjZ5"
const SESSION_B = "automerge:4kWr7JpXn3MvQb2HtL9cFd6YsG8"

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/**
 * Two pages' copies of every document. `seed(url, fill)` puts a document on
 * both from one change; `create2` on a page makes one there only; `deliver`
 * merges one document's copy (or a snapshot of it) into the other page's.
 */
function world(actors) {
  const docs = new Map() // url -> [copy on page 0, copy on page 1]
  const actor = (i) => actors[i].repeat(16)
  let made = 0
  const handle = (i, url) => ({
    url,
    doc: () => docs.get(url)[i],
    change(fn) {
      const both = docs.get(url)
      both[i] = A.change(both[i], fn)
    },
    on() {},
    off() {},
  })
  const repo = (i) => ({
    async find(url) {
      const bare = String(url).split("#")[0]
      if (!docs.get(bare)?.[i]) throw new Error("unavailable")
      return handle(i, bare)
    },
    async create2() {
      const url = `automerge:page${i}doc${++made}`
      const both = [null, null]
      both[i] = A.init({ actor: actor(i) })
      docs.set(url, both)
      return handle(i, url)
    },
  })
  const seed = (url, fill) => {
    const base = A.change(A.init({ actor: "cc".repeat(16) }), fill)
    docs.set(url, [A.clone(base, { actor: actor(0) }), A.clone(base, { actor: actor(1) })])
  }
  const snapshot = (i, url) => A.clone(docs.get(url)[i])
  /** Page `from`'s copy of `url` (or `snap`, taken earlier) merged into page `to`'s. */
  const deliver = (from, to, url, snap = snapshot(from, url)) => {
    const both = docs.get(url)
    both[to] = both[to] ? A.merge(both[to], snap) : A.clone(snap, { actor: actor(to) })
  }
  const sync = () => {
    for (const url of [...docs.keys()]) {
      if (docs.get(url)[0]) deliver(0, 1, url)
      if (docs.get(url)[1]) deliver(1, 0, url)
    }
  }
  return { docs, repo, handle, seed, snapshot, deliver, sync }
}

/** A page: its driver over its own copies, what it asked for, and what it told the orchestrator. */
function page(w, i) {
  const asked = []
  const told = []
  const notify = () => ({ notify: (render) => { const text = render(); if (text) told.push(text) }, close() {} })
  const driver = new WorkflowDriver({
    repo: w.repo(i),
    handle: w.handle(i, PLAN_URL),
    startSession: async (handle) => {
      asked.push(handle.url)
      return { asked: true, outcome: "idle" }
    },
    stopWork: async () => false,
    notify,
    now: () => 1_000 + i,
    settleMs: 1e9,
  })
  return { driver, asked, told, tick: () => driver.kick(), plan: () => w.docs.get(PLAN_URL)[i] }
}

const drivers = []
afterEach(() => {
  for (const d of drivers.splice(0)) d.stop()
  _resetDrivers()
})

function pages(w) {
  const both = [page(w, 0), page(w, 1)]
  drivers.push(...both.map((p) => p.driver))
  return both
}

const stepOf = (plan, id) => plan.steps.find((s) => s.id === id)

/** After everything is delivered, a tick on either page writes nothing. */
async function quietOnceMet(w, [p0, p1]) {
  w.sync()
  await p0.tick()
  await p1.tick()
  w.sync()
  const before = [...w.docs.keys()].map((url) => w.docs.get(url).map((d) => (d ? A.getHeads(d).join() : null)))
  await p0.tick()
  await p1.tick()
  const after = [...w.docs.keys()].map((url) => w.docs.get(url).map((d) => (d ? A.getHeads(d).join() : null)))
  expect(after).toEqual(before)
  expect(A.getHeads(p0.plan())).toEqual(A.getHeads(p1.plan()))
}

const BOTH_WAYS = [["aa", "bb"], ["bb", "aa"]]

describe("two pages that begin one step", () => {
  const ORDERS = {
    "in one crossing": async (w, [p0, p1]) => {
      await p0.tick()
      await p1.tick()
    },
    "one after the other": async (w, [p0, p1]) => {
      await p0.tick()
      w.sync()
      await p1.tick()
    },
  }
  for (const actors of BOTH_WAYS) {
    for (const [order, run] of Object.entries(ORDERS)) {
      it(`${order} (actors ${actors.join(", ")}): the plan names one session on both copies, and only it is asked for once they meet`, async () => {
        const w = world(actors)
        w.seed(PLAN_URL, (d) => initPlan(d, { title: "W", goal: "G", steps: [step("a")] }))
        const ps = pages(w)
        await run(w, ps)
        const made = [...w.docs.keys()].filter((url) => url !== PLAN_URL)
        expect(made).toHaveLength(order === "in one crossing" ? 2 : 1)
        w.sync()
        const named = stepOf(ps[0].plan(), "a").sessionUrl
        expect(stepOf(ps[1].plan(), "a").sessionUrl).toBe(named)
        expect(made).toContain(named)
        expect(stepOf(ps[0].plan(), "a").status).toBe(STEP.running)
        // Once met, each page asks only for the session the plan names.
        for (const p of ps) p.asked.length = 0
        await ps[0].tick()
        await ps[1].tick()
        expect(new Set([...ps[0].asked, ...ps[1].asked])).toEqual(new Set([named]))
        await quietOnceMet(w, ps)
      })
    }
  }
})

describe("a plan an older version left with a lease", () => {
  it("is driven as any other, and the stale lease is neither read nor written", async () => {
    const w = world(["aa", "bb"])
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a")] })
      d.lease = { runner: "workflow-old", generation: 4, at: 1_000 }
      d.lastGeneration = 4
    })
    const ps = pages(w)
    await ps[1].tick()
    expect(stepOf(ps[1].plan(), "a").status).toBe(STEP.running)
    expect({ ...ps[1].plan().lease }).toEqual({ runner: "workflow-old", generation: 4, at: 1_000 })
    expect(ps[1].plan().lastGeneration).toBe(4)
    await quietOnceMet(w, ps)
  })
})

describe("a request two pages read in one crossing", () => {
  for (const actors of BOTH_WAYS) {
    it(`(actors ${actors.join(", ")}) is one request: listed once, told at most twice, decided once`, async () => {
      const w = world(actors)
      w.seed(PLAN_URL, (d) => {
        initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] })] })
        beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
      })
      w.seed(SESSION_A, (d) => {
        initSession(d, {})
        d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
        d.turns.push(makeTurn("user", [textBlock("do a")]))
        d.turns.push(makeTurn("assistant", [callBlock(REQUEST_TOOL_ID, { why: "b is wrong", reopen: ["b"] }, { id: "req1", status: CALL.done })]))
      })
      const ps = pages(w)
      await ps[0].tick()
      await ps[1].tick()
      w.sync()
      const plan = ps[0].plan()
      expect(plan.requests.filter((r) => r.id === "req1").length).toBeGreaterThanOrEqual(1)
      expect(openRequests(plan).map((r) => r.id)).toEqual(["req1"])
      const tellings = [...ps[0].told, ...ps[1].told].filter((t) => t.includes("## Request from step"))
      expect(tellings.length).toBeGreaterThanOrEqual(1)
      expect(tellings.length).toBeLessThanOrEqual(2)
      // Decided on page 0's copy, on whichever entry: decided on both pages once met.
      w.handle(0, PLAN_URL).change((d) => decideRequest(d, "req1", { status: "declined", decidedAt: 5, note: null }))
      w.sync()
      for (const p of ps) {
        expect(openRequests(p.plan())).toEqual([])
        expect(requestOf(p.plan(), "req1").status).toBe("declined")
      }
      await quietOnceMet(w, ps)
    })
  }

  it("requestOf and openRequests read two entries of one id as one, and a decision on either as its decision", () => {
    const open = { id: "r", status: "open" }
    expect(openRequests({ requests: [open, { ...open }] })).toHaveLength(1)
    expect(openRequests({ requests: [open, { id: "r", status: "accepted" }] })).toEqual([])
    expect(openRequests({ requests: [{ id: "r", status: "declined" }, open] })).toEqual([])
    expect(requestOf({ requests: [open, { id: "r", status: "accepted" }] }, "r").status).toBe("accepted")
    expect(requestOf({ requests: [] }, "r")).toBe(null)
  })
})

describe("two pages reporting one finish", () => {
  /** Step a running in SESSION_A, which has answered; on both pages. */
  function finished(actors) {
    const w = world(actors)
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a")] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
    })
    w.seed(SESSION_A, (d) => {
      initSession(d, {})
      d.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
      d.turns.push(makeTurn("user", [textBlock("do a")]))
      d.turns.push(makeTurn("assistant", [textBlock("result of a")]))
    })
    return w
  }

  for (const actors of BOTH_WAYS) {
    it(`in one crossing (actors ${actors.join(", ")}): told at most twice, filed once`, async () => {
      const w = finished(actors)
      const ps = pages(w)
      await ps[0].tick()
      await ps[1].tick()
      const tellings = () => [...ps[0].told, ...ps[1].told].filter((t) => t.includes("## Done: Step a"))
      expect(tellings().length).toBeGreaterThanOrEqual(1)
      expect(tellings().length).toBeLessThanOrEqual(2)
      w.sync()
      for (const p of ps) {
        const a = stepOf(p.plan(), "a")
        expect([a.status, a.version, a.result]).toEqual([STEP.done, 1, "result of a"])
        expect(p.plan().status).toBe(PLAN.done)
      }
      const count = tellings().length
      await quietOnceMet(w, ps)
      expect(tellings()).toHaveLength(count)
    })

    it(`one after the other (actors ${actors.join(", ")}): told once`, async () => {
      const w = finished(actors)
      const ps = pages(w)
      await ps[0].tick()
      w.sync()
      await ps[1].tick()
      expect([...ps[0].told, ...ps[1].told].filter((t) => t.includes("## Done: Step a"))).toHaveLength(1)
      await quietOnceMet(w, ps)
    })
  }
})

describe("a page whose session copy lags a reopen", () => {
  /**
   * Step a done in SESSION_A, and step b, built on it, either done too or
   * still running in SESSION_B (whose session has just answered, on both
   * copies, before either page filed it). Page 0 reopens a, with cascade.
   */
  async function reopened(actors, bState) {
    const w = world(actors)
    w.seed(PLAN_URL, (d) => {
      initPlan(d, { title: "W", goal: "G", steps: [step("a"), step("b", { after: ["a"] })] })
      beginStep(d, "a", { session: { url: SESSION_A, model: null }, now: 1 })
      finishStep(d, "a", { result: "old a", now: 2 })
      beginStep(d, "b", { session: { url: SESSION_B, model: null }, now: 3 })
      if (bState === "done") finishStep(d, "b", { result: "old b", now: 4 })
      // Told already, so the only news is what these cases make.
      d.told = { "finished:a:0": true, ...(bState === "done" ? { "finished:b:0": true } : {}) }
    })
    for (const [url, id] of [[SESSION_A, "a"], [SESSION_B, "b"]]) {
      w.seed(url, (d) => {
        initSession(d, {})
        d.workflow = { planUrl: PLAN_URL, stepId: id, orchestratorUrl: null, run: 0 }
        d.turns.push(makeTurn("user", [textBlock(`do ${id}`)]))
        d.turns.push(makeTurn("assistant", [textBlock(`old ${id}`)]))
      })
    }
    const ps = pages(w)
    // What page 1 may have of each document, as page 0 makes its changes.
    const plans = { before: w.snapshot(1, PLAN_URL) }
    const sessions = { a: { before: w.snapshot(1, SESSION_A) }, b: { before: w.snapshot(1, SESSION_B) } }
    await ps[0].driver.reopen(["a"], { note: "again", cascade: true })
    plans.after = w.snapshot(0, PLAN_URL)
    sessions.a.after = w.snapshot(0, SESSION_A)
    sessions.b.after = w.snapshot(0, SESSION_B)
    return { w, ps, plans, sessions }
  }

  it("page 0's own reopen: a carries on in its session, told its run; b is reopened and waits (halted, if it was running)", async () => {
    for (const bState of ["done", "running"]) {
      const { ps } = await reopened(["aa", "bb"], bState)
      const plan = ps[0].plan()
      expect(stepOf(plan, "a").status).toBe(STEP.running)
      expect(stepOf(plan, "b").status).toBe(STEP.pending)
      const a = await ps[0].driver.repo.find(SESSION_A)
      expect(a.doc().workflow.run).toBe(1)
      const b = await ps[0].driver.repo.find(SESSION_B)
      expect(stopOf(b.doc())?.kind ?? null).toBe(bState === "running" ? STOP.halted : null)
    }
  })

  // Every combination of what page 1 has heard, for each of b's states and
  // both ways round: page 1 ticks, and files nothing with an old result.
  const CASES = []
  for (const actors of BOTH_WAYS) {
    for (const bState of ["done", "running"]) {
      for (const plan of ["before", "after"]) {
        for (const a of ["before", "after"]) {
          for (const b of ["before", "after"]) {
            // Page 1 with b running, not having the reopen, and b's copy
            // without the halt: its finish crosses the reopen itself (the
            // accepted crossing, WORKFLOW.md), not a lag behind it.
            if (bState === "running" && plan === "before" && b === "before") continue
            CASES.push([actors.join(""), bState, plan, a, b])
          }
        }
      }
    }
  }

  it.each(CASES)("actors %s, b %s; page 1 has the plan %s the reopen, a's session %s, b's %s: it files nothing old", async (actors, bState, plan, a, b) => {
    const { w, ps, plans, sessions } = await reopened([actors.slice(0, 2), actors.slice(2)], bState)
    w.deliver(0, 1, PLAN_URL, plans[plan])
    w.deliver(0, 1, SESSION_A, sessions.a[a])
    w.deliver(0, 1, SESSION_B, sessions.b[b])
    const before = JSON.parse(JSON.stringify(ps[1].plan().steps))
    await ps[1].tick()
    const after = ps[1].plan().steps
    for (const id of ["a", "b"]) {
      const was = before.find((s) => s.id === id)
      const now = after.find((s) => s.id === id)
      // Nothing is filed done that was not done on this copy before the tick.
      if (was.status !== STEP.done) expect(now.status, id).not.toBe(STEP.done)
      if (now.status === STEP.done) expect(now.result, id).toBe(was.result)
    }
    expect(ps[1].told.join("\n")).not.toMatch(/## Done/)
    // Once all is delivered, the reopened step runs, and nothing more is written.
    w.sync()
    expect(stepOf(ps[1].plan(), "a").status).toBe(STEP.running)
    expect(stepOf(ps[1].plan(), "a").result).toBe(null)
    await quietOnceMet(w, ps)
  })

  it("sessionOutcome reads a copy that shows an earlier run than the plan's as running, whatever its last turn says", () => {
    const doc = {}
    initSession(doc, {})
    doc.workflow = { planUrl: PLAN_URL, stepId: "a", orchestratorUrl: null, run: 0 }
    doc.turns.push(makeTurn("user", [textBlock("do a")]), makeTurn("assistant", [textBlock("old a")]))
    expect(sessionOutcome(doc)).toEqual({ state: "done", result: "old a" })
    expect(sessionOutcome(doc, { run: 0 })).toEqual({ state: "done", result: "old a" })
    expect(sessionOutcome(doc, { run: 1 })).toEqual({ state: "running" })
    doc.workflow.run = 1
    expect(sessionOutcome(doc, { run: 1 })).toEqual({ state: "done", result: "old a" })
    delete doc.workflow
    expect(sessionOutcome(doc, { run: 0 }).state).toBe("done")
    expect(sessionOutcome(doc, { run: 1 }).state).toBe("running")
  })
})
