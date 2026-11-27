/**
 * A checker's tests of step 4, the switch, on the production wiring: the
 * session view (ui/session-view.js) in happy-dom, runners/page.js's follower
 * and askFor, and runners/ask.js askWork, handed a task client that really
 * runs a burst (kernel/burst.js runBurst) in this process, standing in for a
 * pool. Only the model is scripted. The fixture's imitation of askWork
 * (fixtures/burst.js `ask`) is not used here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join } from "node:path"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { AgentTool } from "./session-view.js"
import { sessionValue } from "./session-value.js"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { STOP, stopOf, statusOf } from "../session/status.js"
import { findCall, findResult } from "../session/calls.js"
import { runBurst } from "../kernel/burst.js"
import { needsWork } from "../kernel/runner.js"
import { AGENT } from "../assembly/agent.js"
import { loadPluginTools } from "../assembly/plugins.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { setHostUrls } from "../host/urls.js"
import { asInterruption } from "../net/network.js"
import { askWork } from "../runners/ask.js"
import { _reset, askFor, stopFor, takeOverFor, retireEarlier } from "../runners/page.js"
import { handleStore } from "../kernel/store.js"
import { standIn } from "../fixtures/tasks-stand-in.js"

const handleStoreOf = (handle) => handleStore(handle, A.splice)

await initSubduction()

const KEY = "patchwork-agent:key:openrouter"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(check, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(20)
  }
  return false
}

/**
 * A pool in this process: doWork runs one burst per task, a task under way
 * is asked for once, watchWork says what a task system's watch says (state,
 * runs, progress, result), and stopWork cancels the run, as the queue does.
 * `repo` is the pool's Repo; `provider(input)` the model a run gets.
 */
function makePool({ repo, provider, poolId = "pool-here", waitForNetwork = undefined }) {
  const tasks = new Map()
  const watchers = new Map()
  let n = 0
  const viewOf = (key) => {
    const t = tasks.get(key)
    if (!t) return { key, state: "missing", runs: [], input: null, result: null, progress: null }
    return { key, state: t.state, runs: t.runs.map((r) => ({ ...r })), input: t.input, result: t.result, progress: t.progress }
  }
  const tell = (key) => {
    const view = viewOf(key)
    for (const fn of [...(watchers.get(key) ?? [])]) fn(view)
  }
  const pool = {
    tasks,
    asks: [],
    runs: [],
    errors: [],
    client: {
      doWork(_pageRepo, { key, input }) {
        const was = tasks.get(key)
        if (was?.state === "running") return was.promise
        pool.asks.push({ key, input })
        const run = `${poolId}:run-${++n}`
        pool.runs.push(run)
        const controller = new AbortController()
        const task = { state: "running", runs: [{ id: run, pool: poolId, start: Date.now(), end: null }], input, result: null, progress: null, controller }
        tasks.set(key, task)
        tell(key)
        task.promise = (async () => {
          let result
          try {
            result = await runBurst(
              { repo, signal: controller.signal, run, taskUrl: `automerge:task${n}`, settled: Promise.resolve(), progress: (p) => ((task.progress = p), tell(key)), log: () => {} },
              {
                session: input.session,
                heads: input.heads,
                taskRuns: () => task.runs.map((r) => r.id),
                getProvider: async () => provider(input),
                key: input.keys?.model ?? null,
                context: {
                  splice: A.splice,
                  rootFolderUrl: input.account?.rootFolderUrl ?? null,
                  sensitiveDocs: input.account?.sensitiveDocs ?? [],
                  fetchImpl: async () => new Response("<p>a page</p>", { headers: { "content-type": "text/html" } }),
                },
                builtins: AGENT.builtins,
                plugins: () => loadPluginTools(),
                sections: [],
                afterCall: [],
                system: "test",
                splice: A.splice,
                flushMs: 5,
                waitForNetwork,
              }
            )
          } catch (err) {
            pool.errors.push(err)
            task.state = "failed"
            task.runs[0].end = Date.now()
            tell(key)
            throw err
          }
          task.runs[0].end = Date.now()
          task.result = result
          task.state = controller.signal.reason === "cancelled" ? "cancelled" : "succeeded"
          tell(key)
          if (task.state === "cancelled") throw new Error("The task was cancelled")
          return result
        })()
        task.promise.catch(() => {})
        return task.promise
      },
      watchWork(_repo, key, fn) {
        if (!watchers.has(key)) watchers.set(key, new Set())
        watchers.get(key).add(fn)
        fn(viewOf(key))
        return () => watchers.get(key)?.delete(fn)
      },
      async stopWork(_repo, key) {
        const t = tasks.get(key)
        if (t?.state !== "running") return false
        t.controller.abort("cancelled")
        return true
      },
      ownQueue: async () => null,
    },
    /** Wait until no task is under way. */
    async idle(ms = 10_000) {
      return until(() => [...tasks.values()].every((t) => t.state !== "running"), ms)
    },
  }
  return pool
}

function sessionIn(repo, turns = [], fields = {}) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(...turns)
    Object.assign(d, fields)
  })
  return handle
}

const mounted = []
function mount(repo, handle) {
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = AgentTool(handle, element, { repo })
  mounted.push(cleanup)
  return { element, cleanup, hint: () => element.querySelector(".agent-hint").textContent, button: (label) => [...element.querySelectorAll("button")].find((b) => b.textContent === label) }
}

async function send(view, text) {
  view.element.querySelector("textarea").value = text
  view.element.querySelector(".agent-composer button[data-variant='primary']").click()
}

const lastText = (handle) =>
  (handle.doc().turns.at(-1)?.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")

let pool
beforeEach(() => {
  _resetIds()
  document.body.replaceChildren()
  localStorage.clear()
  localStorage.setItem(KEY, "sk-test")
  localStorage.setItem("patchwork-tasks-pool-id", "pool-here")
})
afterEach(async () => {
  for (const cleanup of mounted.splice(0)) cleanup()
  if (pool) await pool.idle(5000)
  pool = null
  _reset()
  setHostUrls(null)
})

/** The page asks with the real askWork and this pool's client. */
function wire(repo, provider, opts = {}) {
  pool = makePool({ repo, provider, ...opts })
  _reset(askWork, { with: standIn(pool.client) })
  return pool
}

describe("the session view on the real asker, with a pool in this process", () => {
  it("a message is answered, by one burst", async () => {
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "hello back" }]]))
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "hello")
    expect(await until(() => lastText(handle) === "hello back" && statusOf(handle.doc()) === STATUS.idle)).toBe(true)
    await pool.idle()
    await sleep(400)
    expect(pool.asks).toHaveLength(1)
    expect(handle.doc().burst).toBe(null)
    expect(pool.asks[0].input.keys.model).toBe("sk-test")
  })

  it("an approval in the view starts a burst that runs the call", async () => {
    const repo = new Repo({ network: [] })
    // One provider for every burst, so the script goes on from where it was.
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "web_fetch", input: { url: "https://example.org/a" } }],
      [{ type: "text", delta: "fetched it" }],
    ])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "fetch it")
    expect(await until(() => statusOf(handle.doc()) === STATUS.awaitingApproval)).toBe(true)
    await pool.idle()
    expect(handle.doc().burst).toBe(null)
    const allow = await until(() => view.button("Allow once"))
    expect(allow).toBe(true)
    view.button("Allow once").click()
    expect(await until(() => lastText(handle) === "fetched it")).toBe(true)
    expect(findCall(handle.doc(), "c1").block.status).toBe(CALL.done)
    expect(pool.asks.length).toBe(2)
  })

  it("an answer to the agent's question starts a burst", async () => {
    const repo = new Repo({ network: [] })
    const provider = makeMock([
      [{ type: "call", id: "q1", name: "ask_user", input: { question: "Which colour?", options: ["Blue", "Green"] } }],
      (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("Blue") ? "blue it is" : "no answer seen" }],
    ])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "pick")
    expect(await until(() => statusOf(handle.doc()) === STATUS.awaitingAnswer)).toBe(true)
    await pool.idle()
    expect(await until(() => view.button("Blue"))).toBe(true)
    view.button("Blue").click()
    expect(await until(() => lastText(handle) === "blue it is")).toBe(true)
  })

  it("a lifted budget carries the session on", async () => {
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "carried on" }]]))
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [{ type: "notice", kind: STOP.budget, text: "Out of budget", data: { spent: 1, limit: 1 } }])], {})
    handle.change((d) => {
      d.config.budget = 1
      d.usage.cost = 1
    })
    const view = mount(repo, handle)
    expect(await until(() => [...view.element.querySelectorAll("button")].find((b) => /^Give /.test(b.textContent)))).toBe(true)
    ;[...view.element.querySelectorAll("button")].find((b) => /^Give /.test(b.textContent)).click()
    expect(await until(() => lastText(handle) === "carried on")).toBe(true)
  })

  it("Stop while a reply streams: the notice holds, the text is kept unmarked, and a message carries on", async () => {
    const repo = new Repo({ network: [] })
    const words = Array.from({ length: 40 }, (_, i) => ({ type: "text", delta: `w${i} ` }))
    const provider = makeMock([words, [{ type: "text", delta: "carrying on" }]], { delayMs: 40 })
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "talk")
    expect(await until(() => /w3 /.test(lastText(handle)))).toBe(true)
    expect(await until(() => view.button("Stop")?.style.display === "")).toBe(true)
    view.button("Stop").click()
    expect(await until(() => stopOf(handle.doc())?.kind === STOP.stopped)).toBe(true)
    await pool.idle()
    const doc = handle.doc()
    expect(doc.burst).toBe(null)
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    const reply = doc.turns.find((t) => t.role === "assistant" && t.blocks.some((b) => b.type === "text"))
    expect(reply.blocks.find((b) => b.type === "text").text).toMatch(/^w0 w1 w2 w3 /)
    await sleep(500)
    expect(provider.requests).toHaveLength(1)
    await send(view, "go on")
    expect(await until(() => lastText(handle) === "carrying on")).toBe(true)
  })

  it("Stop during a tool call stays stopped, and nothing runs until someone speaks", async () => {
    const repo = new Repo({ network: [] })
    let release
    const slow = new Promise((r) => (release = r))
    const target = repo.create({ n: 0 })
    const provider = makeMock([
      [{ type: "call", id: "e1", name: "doc_edit", input: { url: target.url, ops: [{ op: "set", path: ["n"], value: 1 }] } }],
      [{ type: "text", delta: "should not be asked" }],
    ])
    // The model's second request waits on the test: the stop lands between call and reply.
    const gated = { ...provider, stream: async function* (request) { if (provider.requests.length >= 1) await slow; yield* provider.stream(request) } }
    wire(repo, () => gated)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "edit")
    expect(await until(() => findCall(handle.doc(), "e1")?.block.status === CALL.done)).toBe(true)
    view.button("Stop").click()
    expect(await until(() => stopOf(handle.doc())?.kind === STOP.stopped)).toBe(true)
    release()
    await pool.idle()
    await sleep(500)
    expect(stopOf(handle.doc())?.kind).toBe(STOP.stopped)
    expect(needsWork(handle.doc())).toBe(false)
    expect(lastText(handle)).not.toBe("should not be asked")
  })
})

describe("a stop from another copy", () => {
  it("a Stop written on a second copy, merged in, stops the burst on the first; then a message carries on", async () => {
    const repo = new Repo({ network: [] })
    const words = Array.from({ length: 60 }, (_, i) => ({ type: "text", delta: `w${i} ` }))
    const provider = makeMock([words, [{ type: "text", delta: "after the stop" }]], { delayMs: 30 })
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "talk")
    expect(await until(() => /w3 /.test(lastText(handle)))).toBe(true)
    // Device B: its own copy, its own Stop.
    const other = new Repo({ network: [] })
    const copy = other.import(A.save(handle.doc()), { docId: handle.documentId })
    await stopFor(other, copy.url, { author: "automerge:personB" })
    expect(stopOf(copy.doc())?.kind).toBe(STOP.stopped)
    handle.merge(copy)
    expect(await pool.idle()).toBe(true)
    expect(stopOf(handle.doc())?.kind).toBe(STOP.stopped)
    expect(handle.doc().burst).toBe(null)
    expect(provider.requests).toHaveLength(1)
    await send(view, "go on")
    expect(await until(() => lastText(handle) === "after the stop")).toBe(true)
  })
})

describe("marks nobody will release", () => {
  // Found by the step 4 checker (a claim showed "Running <tool> in another
  // page" with no Take over); fixed: a claim not held here offers it.
  it("Take over is offered for a page that died mid-call (its claim in `burst`, its call running), as the specification names", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("make a note")]))
    const call = callBlock("doc_create", { datatype: "note" }, { id: "p1", status: CALL.running, where: "host" })
    call.runner = "claim-dead"
    doc.turns.push(makeTurn("assistant", [call]))
    doc.burst = { run: "claim-dead" }
    // The queue has said something (the page's claim is no task's run).
    const v = sessionValue(doc, { hasKey: true, keysSettled: true, work: { state: "missing", runs: [] }, pool: "pool-here", pageTool: null, waiting: [] })
    expect(v.canStop).toBe(true)
    expect(v.canTakeOver).toBe(true)
  })

  it("Take over after a run nobody hears: cleared, asked, and the work done", async () => {
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "taken over" }]]))
    const reply = makeTurn("assistant", [textBlock("half")])
    reply.streaming = { runner: "run-gone" }
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("hi")]), reply], { burst: { run: "run-gone" } })
    const view = mount(repo, handle)
    await sleep(500)
    expect(pool.asks).toHaveLength(0)
    expect(await until(() => view.button("Take over")?.style.display === "")).toBe(true)
    view.button("Take over").click()
    expect(await until(() => lastText(handle) === "taken over")).toBe(true)
    expect(handle.doc().turns.some((t) => t.streaming)).toBe(false)
    expect(handle.doc().burst).toBe(null)
  })
})

describe("page and plugin tools", () => {
  const pluginsFile = join(process.cwd(), "fixtures", "plugins-page.js")

  it("a built-in page tool parks, the open view runs it, and asks again", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    const repo = new Repo({ network: [] })
    const provider = makeMock([[{ type: "call", id: "d1", name: "doc_create", input: { datatype: "note", title: "N" } }], [{ type: "text", delta: "made it" }]])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "make a note")
    expect(await until(() => lastText(handle) === "made it", 15_000)).toBe(true)
    const result = findResult(handle.doc(), "d1")?.block
    expect(result).toBeTruthy()
    expect(result.isError).toBe(false)
    expect(handle.doc().made?.length).toBe(1)
    expect(pool.asks.length).toBe(2)
  }, 20_000)

  it("a plugin tool declared for a page parks in the pool, and the open view runs its code", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    const { ran } = await import("../fixtures/plugins-page.js")
    ran.length = 0
    const repo = new Repo({ network: [] })
    const provider = makeMock([[{ type: "call", id: "f1", name: "fake_echo", input: { text: "hi" } }], (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("echoed hi in a page") ? "echo heard" : "no echo" }]])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "echo")
    expect(await until(() => lastText(handle) === "echo heard", 15_000)).toBe(true)
    expect(findCall(handle.doc(), "f1").block.where).toBe("host")
    expect(ran).toEqual(["hi"])
  }, 20_000)
})

describe("an old session document", () => {
  it("one written by yesterday's code (a lease, lastGeneration, marks with generations) runs, and nothing reads the stale fields", async () => {
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "fresh answer" }]]))
    const reply = makeTurn("assistant", [textBlock("half of an old reply")])
    reply.streaming = { runner: "tab-old", generation: 3 }
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("hi")]), reply], { lease: { runner: "tab-old", generation: 3, at: Date.now() }, lastGeneration: 3 })
    handle.change((d) => {
      delete d.burst
    })
    expect(statusOf(handle.doc())).toBe(STATUS.idle)
    mount(repo, handle)
    expect(await until(() => lastText(handle) === "fresh answer")).toBe(true)
    const doc = handle.doc()
    expect(doc.turns.some((t) => t.streaming)).toBe(false)
    // Old fields are left as they were: nothing writes them.
    expect(doc.lease).toEqual({ runner: "tab-old", generation: 3, at: expect.any(Number) })
    expect(doc.lastGeneration).toBe(3)
    expect(doc.burst).toBe(null)
  })
})

describe("offline", () => {
  it("with no way to the provider a burst says it waits for the network and carries on when it is back; nothing is a failure", async () => {
    const repo = new Repo({ network: [] })
    let online = false
    let back
    const backAgain = new Promise((r) => (back = r))
    const inner = makeMock([[{ type: "text", delta: "back online" }]])
    const provider = {
      ...inner,
      stream: async function* (request) {
        if (!online) throw asInterruption(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENETUNREACH" } }), "Could not reach the model")
        yield* inner.stream(request)
      },
    }
    wire(repo, () => provider, { waitForNetwork: () => backAgain })
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "hello")
    expect(await until(() => statusOf(handle.doc()) === STATUS.reconnecting)).toBe(true)
    expect(view.hint()).toMatch(/^Waiting for the network; carries on when it is back/)
    // Stop and Take over are written on the page's own copy all the same.
    expect(view.button("Stop").style.display).toBe("")
    online = true
    back()
    expect(await until(() => lastText(handle) === "back online")).toBe(true)
    expect(handle.doc().reconnecting ?? null).toBe(null)
    expect(handle.doc().turns.some((t) => t.blocks.some((b) => b.type === "notice" && b.kind === STOP.error))).toBe(false)
  }, 20_000)
})

describe("a workflow on the real asker", () => {
  const pluginsFile = join(process.cwd(), "fixtures", "plugins-page.js")

  /** Each session's model: the orchestrator's script, and each step's by its id. */
  function models(repo, orchestrator, steps) {
    const made = new Map()
    return async (input) => {
      if (input.session === orchestrator.provider.session) return orchestrator.provider
      if (!made.has(input.session)) {
        const id = (await repo.find(input.session)).doc().workflow.stepId
        made.set(input.session, steps[id]())
      }
      return made.get(input.session)
    }
  }

  it("a plan of two steps runs to its end, a step's page tool runs with only the orchestrator's view open, and the orchestrator hears the end", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    const repo = new Repo({ network: [] })
    const STEPS = [
      { id: "a", title: "A", prompt: "Say what a is.", where: "worker", tier: "fast", why: "words only" },
      { id: "b", title: "B", prompt: "Make a note about a.", where: "host", tier: "fast", why: "makes a document", after: ["a"] },
    ]
    const orchestrator = sessionIn(repo, [], {})
    orchestrator.change((d) => (d.config.workflows = { enabled: true, parallel: 2 }))
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "workflow_start", input: { title: "Two", goal: "Do a then b", steps: STEPS } }],
      [{ type: "text", delta: "Started." }],
      ...Array.from({ length: 6 }, () => (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("The workflow is over") ? "All done." : "Noted." }]),
    ])
    provider.session = orchestrator.url
    const steps = {
      a: () => makeMock([[{ type: "text", delta: "a is the first letter" }]]),
      b: () => makeMock([[{ type: "call", id: "n1", name: "doc_create", input: { datatype: "note", title: "About a" } }], [{ type: "text", delta: "made the note" }]]),
    }
    wire(repo, models(repo, { provider }, steps))
    const view = mount(repo, orchestrator)
    await send(view, "do a then b")
    const made = () => orchestrator.doc().made?.find((m) => m.kind === "agent-workflow")
    expect(await until(() => made(), 15_000)).toBe(true)
    const plan = await repo.find(made().url)
    expect(await until(() => plan.doc().status === "done", 20_000)).toBe(true)
    expect(plan.doc().steps.map((s) => [s.status, s.result])).toEqual([
      ["done", "a is the first letter"],
      ["done", "made the note"],
    ])
    const b = await repo.find(plan.doc().steps[1].sessionUrl)
    expect(b.doc().made?.length).toBe(1)
    // Wakes are at least MIN_GAP_MS (30 s) apart: the first may be a step's news, the end the next.
    expect(await until(() => lastText(orchestrator) === "All done.", 45_000)).toBe(true)
  }, 90_000)

  it("a person's Stop on a step pauses it and is told once; a message carries it on; a reopen runs it again; the plan holds no lease", async () => {
    const repo = new Repo({ network: [] })
    const STEPS = [{ id: "a", title: "A", prompt: "Say what a is, at length.", where: "worker", tier: "fast", why: "words only" }]
    const orchestrator = sessionIn(repo, [], {})
    orchestrator.change((d) => (d.config.workflows = { enabled: true, parallel: 2 }))
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "workflow_start", input: { title: "One", goal: "Do a", steps: STEPS } }],
      ...Array.from({ length: 8 }, () => [{ type: "text", delta: "Noted." }]),
    ])
    provider.session = orchestrator.url
    const words = Array.from({ length: 80 }, (_, i) => ({ type: "text", delta: `a${i} ` }))
    const steps = { a: () => makeMock([words, [{ type: "text", delta: "a, carried on" }], [{ type: "text", delta: "a, again" }]], { delayMs: 25 }) }
    wire(repo, models(repo, { provider }, steps))
    const view = mount(repo, orchestrator)
    await send(view, "do a")
    const made = () => orchestrator.doc().made?.find((m) => m.kind === "agent-workflow")
    expect(await until(() => made(), 15_000)).toBe(true)
    const plan = await repo.find(made().url)
    expect(await until(() => plan.doc().steps[0].sessionUrl, 10_000)).toBe(true)
    const a = await repo.find(plan.doc().steps[0].sessionUrl)
    expect(await until(() => /a3 /.test(lastText(a)), 10_000)).toBe(true)
    // This page drives the plan and holds nothing on it (step 5).
    expect("lease" in plan.doc()).toBe(false)

    // A person stops the step from its own view.
    await stopFor(repo, a.url, { author: "automerge:person" })
    await pool.idle()
    await sleep(1500)
    expect(stopOf(a.doc())?.kind).toBe(STOP.stopped)
    expect(plan.doc().steps[0].status).toBe("running")
    const told = () => Object.keys(plan.doc().told ?? {}).filter((k) => k.startsWith("stopped:a:"))
    expect(await until(() => told().length === 1, 5000)).toBe(true)
    await sleep(1000)
    expect(told()).toHaveLength(1)

    // A message carries it on, and the step finishes.
    const { say } = await import("../kernel/loop.js")
    say(handleStoreOf(a), "carry on please")
    await askFor(repo, a.url)
    expect(await until(() => plan.doc().steps[0].status === "done", 20_000)).toBe(true)
    expect(plan.doc().steps[0].result).toBe("a, carried on")

    // A reopen runs it again.
    const { getDriver } = await import("../workflow/driver.js")
    await getDriver(plan.url).reopen(["a"], { note: "once more", by: "person" })
    expect(await until(() => plan.doc().steps[0].status === "done" && plan.doc().steps[0].result === "a, again", 20_000)).toBe(true)
  }, 90_000)
})

describe("watches, end to end", () => {
  it("a watch a burst writes is opened by the page; the agent's own edit does not wake it; a person's does, and the wake asks", async () => {
    const repo = new Repo({ network: [] })
    const target = repo.create({ n: 0 })
    const provider = makeMock([
      [{ type: "call", id: "w1", name: "doc_watch", input: { url: target.url, path: ["n"] } }],
      [{ type: "call", id: "e1", name: "doc_edit", input: { url: target.url, ops: [{ op: "set", path: ["n"], value: 1 }] } }],
      [{ type: "text", delta: "watching" }],
      (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("/n") ? "saw n change" : "woken blind" }],
    ])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "watch n")
    expect(await until(() => lastText(handle) === "watching")).toBe(true)
    await pool.idle()
    expect(Object.keys(handle.doc().watches ?? {})).toHaveLength(1)
    // Its own edit, n = 1, wakes nothing: a wake would settle in 2 s.
    await sleep(3500)
    expect(provider.requests).toHaveLength(3)
    expect(pool.asks).toHaveLength(1)
    // A person edits what is watched.
    target.change((d) => (d.n = 2))
    expect(await until(() => lastText(handle) === "saw n change", 15_000)).toBe(true)
    expect(pool.asks).toHaveLength(2)
  }, 30_000)
})

describe("two people, two copies that merge only when the test says", () => {
  /** A second page: its own instances of the view, the follower and the asker (as another device has). */
  async function secondPage() {
    const saved = globalThis.__patchworkAgentFollowers
    delete globalThis.__patchworkAgentFollowers
    vi.resetModules()
    const page = await import("../runners/page.js")
    const ask = await import("../runners/ask.js")
    const sessionView = await import("./session-view.js")
    globalThis.__patchworkAgentFollowers = saved
    return { page, ask, AgentTool: sessionView.AgentTool }
  }

  it("while one person's burst runs, the other's view stands back, asks nothing, and offers Stop and Take over", async () => {
    const repoA = new Repo({ network: [] })
    const words = Array.from({ length: 60 }, (_, i) => ({ type: "text", delta: `w${i} ` }))
    const providerA = makeMock([words], { delayMs: 30 })
    wire(repoA, () => providerA)
    const handleA = sessionIn(repoA)
    const viewA = mount(repoA, handleA)

    const B = await secondPage()
    const repoB = new Repo({ network: [] })
    const handleB = repoB.import(A.save(handleA.doc()), { docId: handleA.documentId })
    const providerB = makeMock([[{ type: "text", delta: "B's reply" }]])
    const poolB = makePool({ repo: repoB, provider: () => providerB, poolId: "pool-b" })
    B.page._reset(B.ask.askWork, { with: standIn(poolB.client) })
    const elementB = document.createElement("div")
    document.body.append(elementB)
    const cleanupB = B.AgentTool(handleB, elementB, { repo: repoB })
    try {
      await send(viewA, "talk")
      expect(await until(() => /w3 /.test(lastText(handleA)))).toBe(true)
      handleB.merge(handleA)
      expect(handleB.doc().burst?.run).toBe(pool.runs[0])
      await sleep(800)
      expect(poolB.asks).toHaveLength(0)
      const hintB = elementB.querySelector(".agent-hint").textContent
      const buttonB = (label) => [...elementB.querySelectorAll("button")].find((b) => b.textContent === label)
      expect(hintB).toBe("Someone else's work is under way here, or work that stopped without saying")
      expect(buttonB("Stop").style.display).toBe("")
      expect(buttonB("Take over").style.display).toBe("")
      // B speaks while A's burst runs: written on B's copy, asked for by nobody on B's side.
      elementB.querySelector("textarea").value = "and me"
      elementB.querySelector(".agent-composer button[data-variant='primary']").click()
      await sleep(600)
      expect(poolB.asks).toHaveLength(0)
      // Merged into A's copy, A's burst answers it (ruling 3.1).
      handleA.merge(handleB)
      await pool.idle(15_000)
      expect(poolB.asks).toHaveLength(0)
      expect(providerA.requests.length).toBeGreaterThanOrEqual(1)
    } finally {
      cleanupB()
      B.page._reset()
    }
  }, 30_000)

  it("both speak at once on their own copies: two bursts start, and once merged the session settles with at most one reply doubled", async () => {
    const repoA = new Repo({ network: [] })
    const providerA = makeMock([[{ type: "text", delta: "from A" }], ...Array.from({ length: 20 }, (_, i) => [{ type: "text", delta: `A again ${i}` }])], { delayMs: 20 })
    wire(repoA, () => providerA)
    const handleA = sessionIn(repoA)
    const viewA = mount(repoA, handleA)

    const B = await secondPage()
    const repoB = new Repo({ network: [] })
    const handleB = repoB.import(A.save(handleA.doc()), { docId: handleA.documentId })
    const providerB = makeMock([[{ type: "text", delta: "from B" }], ...Array.from({ length: 20 }, (_, i) => [{ type: "text", delta: `B again ${i}` }])], { delayMs: 20 })
    const poolB = makePool({ repo: repoB, provider: () => providerB, poolId: "pool-b" })
    B.page._reset(B.ask.askWork, { with: standIn(poolB.client) })
    const elementB = document.createElement("div")
    document.body.append(elementB)
    const cleanupB = B.AgentTool(handleB, elementB, { repo: repoB })
    try {
      await send(viewA, "hello from A")
      elementB.querySelector("textarea").value = "hello from B"
      elementB.querySelector(".agent-composer button[data-variant='primary']").click()
      await until(() => pool.asks.length && poolB.asks.length)
      // Merged both ways, several times, while they run.
      for (let i = 0; i < 20; i++) {
        handleA.merge(handleB)
        handleB.merge(handleA)
        await sleep(50)
      }
      await pool.idle(15_000)
      await poolB.idle(15_000)
      for (let i = 0; i < 10; i++) {
        handleA.merge(handleB)
        handleB.merge(handleA)
        await sleep(100)
      }
      await pool.idle(15_000)
      await poolB.idle(15_000)
      handleA.merge(handleB)
      const doc = handleA.doc()
      expect(doc.burst).toBe(null)
      expect(doc.turns.some((t) => t.streaming)).toBe(false)
      expect(needsWork(doc)).toBe(false)
      const replies = doc.turns.filter((t) => t.role === "assistant").length
      expect(replies).toBeLessThanOrEqual(3)
      expect(providerA.requests.length + providerB.requests.length).toBeLessThanOrEqual(3)
    } finally {
      cleanupB()
      B.page._reset()
    }
  }, 60_000)
})

describe("copies", () => {
  it("a copy of a session with a burst under way starts clean: no mark of the original's run, its marks debris for its first burst", async () => {
    const { AgentSessionDatatype } = await import("../session/datatype.js")
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "answered in the copy" }]]))
    const reply = makeTurn("assistant", [textBlock("half of the original's")])
    reply.streaming = { runner: "run-original" }
    const original = sessionIn(repo, [makeTurn("user", [textBlock("hi")]), reply], { burst: { run: "run-original" } })
    const copy = repo.clone(original)
    copy.change((d) => AgentSessionDatatype.markCopy(d))
    expect(copy.doc().burst).toBe(null)
    expect(statusOf(copy.doc())).toBe(STATUS.idle)
    expect(needsWork(copy.doc())).toBe(true)
    mount(repo, copy)
    expect(await until(() => lastText(copy) === "answered in the copy")).toBe(true)
    expect(copy.doc().turns.some((t) => t.streaming)).toBe(false)
    // The original is left as it was.
    expect(original.doc().burst).toEqual({ run: "run-original" })
  })

  it("a side thread of a step whose burst is under way starts clean, and its question is answered", async () => {
    const { askAside } = await import("../workflow/aside.js")
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([[{ type: "text", delta: "aside answered" }]]))
    const reply = makeTurn("assistant", [textBlock("step working")])
    reply.streaming = { runner: "run-step" }
    const step = sessionIn(repo, [makeTurn("user", [textBlock("do the step")]), reply], { burst: { run: "run-step" }, workflow: { planUrl: "automerge:2NotARealPlanXXXXXXXXXXXXXXX", stepId: "s", orchestratorUrl: null } })
    const url = await askAside(repo, step, "what are you doing?")
    const aside = await repo.find(url)
    expect(aside.doc().burst).toBe(null)
    mount(repo, aside)
    expect(await until(() => lastText(aside) === "aside answered")).toBe(true)
    expect(aside.doc().turns.some((t) => t.streaming)).toBe(false)
  })
})

describe("offline, what a person can still do", () => {
  it("Stop while the burst waits for the network stops it on the page's own copy; a message after the network is back carries on", async () => {
    const repo = new Repo({ network: [] })
    let online = false
    const inner = makeMock([[{ type: "text", delta: "back, and answering" }]])
    const provider = {
      ...inner,
      stream: async function* (request) {
        if (!online) throw asInterruption(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENETUNREACH" } }), "Could not reach the model")
        yield* inner.stream(request)
      },
    }
    // The network wait lasts until its signal: only a stop ends it here.
    wire(repo, () => provider, { waitForNetwork: (_attempt, signal) => new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })) })
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    await send(view, "hello")
    expect(await until(() => statusOf(handle.doc()) === STATUS.reconnecting)).toBe(true)
    view.button("Stop").click()
    expect(await until(() => stopOf(handle.doc())?.kind === STOP.stopped)).toBe(true)
    expect(await pool.idle(5000)).toBe(true)
    expect(handle.doc().reconnecting ?? null).toBe(null)
    expect(handle.doc().burst).toBe(null)
    online = true
    await send(view, "now?")
    expect(await until(() => lastText(handle) === "back, and answering")).toBe(true)
  }, 20_000)
})

describe("after the fixes (cd5cb96c), rechecked", () => {
  const pluginsFile = join(process.cwd(), "fixtures", "plugins-page.js")

  it("a page that died mid-call: the view offers Take over, a click answers the call INTERRUPTED, and the session carries on", async () => {
    const repo = new Repo({ network: [] })
    wire(repo, () => makeMock([(request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("interrupted") ? "carried on after the interruption" : "carried on, unaware" }]]))
    const call = callBlock("doc_create", { datatype: "note" }, { id: "p1", status: CALL.running, where: "host" })
    call.runner = "claim-dead"
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("make a note")]), makeTurn("assistant", [call])], { burst: { run: "claim-dead" } })
    const view = mount(repo, handle)
    expect(await until(() => view.button("Take over")?.style.display === "")).toBe(true)
    expect(view.hint()).toBe("Running doc_create in another page")
    expect(pool.asks).toHaveLength(0)
    view.button("Take over").click()
    expect(await until(() => lastText(handle).startsWith("carried on"), 15_000)).toBe(true)
    const result = findResult(handle.doc(), "p1")?.block
    expect(result?.isError).toBe(true)
    expect(result?.summary).toBe("interrupted")
    expect(lastText(handle)).toBe("carried on after the interruption")
    expect(findCall(handle.doc(), "p1").block.status).toBe(CALL.error)
    expect(await pool.idle(5000)).toBe(true)
    expect(handle.doc().burst).toBe(null)
    expect(pool.asks).toHaveLength(1)
  }, 20_000)

  // Found by the recheck (pre-existing since a32d38c4), fixed in step 5's
  // first commit: while this page takes a parked call it writes its claim id
  // into `burst` and waits a beat (runners/page.js BEAT_MS, 2 s) before it
  // claims the call. For that beat `burst` names neither a run the queue
  // lists nor a running call's claim, so it read as someone else's, on this
  // page too. The view now knows the claim its own follower holds
  // (follow `claim()`, ui/session-value.js `pageClaim`).
  it("while this page takes a parked call, its own view does not call that someone else's work", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    const repo = new Repo({ network: [] })
    const provider = makeMock([[{ type: "call", id: "d1", name: "doc_create", input: { datatype: "note", title: "N" } }], [{ type: "text", delta: "made it" }]])
    wire(repo, () => provider)
    const handle = sessionIn(repo)
    const view = mount(repo, handle)
    const seen = new Set()
    const offered = []
    const sample = setInterval(() => {
      seen.add(view.hint())
      if (view.button("Take over")?.style.display === "") offered.push(view.hint())
    }, 20)
    try {
      await send(view, "make a note")
      expect(await until(() => lastText(handle) === "made it", 15_000)).toBe(true)
    } finally {
      clearInterval(sample)
    }
    expect([...seen]).not.toContain("Someone else's work is under way here, or work that stopped without saying")
    expect(offered).toEqual([])
  }, 20_000)

  // Found by the recheck (from the fix), fixed in step 5's first commit
  // (retireEarlier calls release() first): an older version's SessionRunner
  // stopped while it holds its lease finishes the reply it is streaming, cut
  // off and unmarked (its loop's "stopped on purpose" path), and that is no
  // work for today's code, so the person's message is left with half an
  // answer. Its own registry gave a session up first on the way out
  // (registry.js releaseAll: release(), then stop()), which leaves the reply
  // marked, debris for the next burst. Shown against the old code itself in
  // the checker's scratch script (old-runner-retire.mjs); here, the order.
  it("an older version's runner is given up (release) before it is stopped, so a reply it was streaming stays debris", () => {
    const calls = []
    const scope = { __patchworkAgentRunners: new Map([["automerge:made-up-1", { runner: { release: () => calls.push("release"), stop: () => calls.push("stop"), retire: () => calls.push("retire") }, dispose: () => calls.push("dispose") }]]) }
    retireEarlier(scope)
    expect(calls.indexOf("release")).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf("release")).toBeLessThan(calls.indexOf("stop"))
  })
})
