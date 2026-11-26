/**
 * A checker's test of step 5 on the production wiring: a plan of two steps,
 * the second with a page tool, runs to its end with only the workflow view
 * (ui/workflow-view.js) open in the page. No session view is mounted; the
 * view's driver (runners/page.js drivePlanHere) asks for the steps' work
 * with the real askWork, through a pool in this process that really runs
 * each burst (kernel/burst.js runBurst). Only the models are scripted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { WorkflowView } from "./workflow-view.js"
import { initPlan, PLAN } from "../workflow/plan.js"
import { _resetDrivers } from "../workflow/driver.js"
import { initSession, _resetIds } from "../session/schema.js"
import { runBurst } from "../kernel/burst.js"
import { AGENT } from "../assembly/agent.js"
import { catalogueTools } from "../assembly/plugins.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { setHostUrls } from "../host/urls.js"
import { askWork } from "../runners/ask.js"
import { _reset } from "../runners/page.js"

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
                plugins: async () => catalogueTools(input.catalogue),
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

const lastText = (handle) =>
  (handle.doc().turns.at(-1)?.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")

let pool
const cleanups = []
beforeEach(() => {
  _resetIds()
  document.body.replaceChildren()
  localStorage.clear()
  localStorage.setItem(KEY, "sk-test")
  localStorage.setItem("patchwork-tasks-pool-id", "pool-here")
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  if (pool) await pool.idle(5000)
  pool = null
  _resetDrivers()
  _reset()
  setHostUrls(null)
})

describe("a workflow with only its view open", () => {
  it("two steps run to the end, the second's page tool runs in this page, the orchestrator hears the end, and the plan holds no lease", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": join(process.cwd(), "fixtures", "plugins-page.js") })
    const repo = new Repo({ network: [] })
    const orchestrator = repo.create()
    orchestrator.change((d) => {
      initSession(d, {})
      d.config.workflows = { enabled: true, parallel: 2 }
    })
    const plan = repo.create()
    plan.change((d) =>
      initPlan(d, {
        title: "Two",
        goal: "Do a then b",
        sessionUrl: orchestrator.url,
        steps: [
          { id: "a", title: "A", prompt: "Say what a is.", where: "worker", tier: "fast", why: "words only", after: [] },
          { id: "b", title: "B", prompt: "Make a note about a.", where: "host", tier: "fast", why: "makes a document", after: ["a"] },
        ],
      })
    )
    const orchestratorModel = makeMock(Array.from({ length: 6 }, () => (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("The workflow is over") ? "All done." : "Noted." }]))
    const steps = {
      a: () => makeMock([[{ type: "text", delta: "a is the first letter" }]]),
      b: () => makeMock([[{ type: "call", id: "n1", name: "doc_create", input: { datatype: "note", title: "About a" } }], [{ type: "text", delta: "made the note" }]]),
    }
    const made = new Map()
    pool = makePool({
      repo,
      provider: async (input) => {
        if (input.session === orchestrator.url) return orchestratorModel
        if (!made.has(input.session)) made.set(input.session, steps[(await repo.find(input.session)).doc().workflow.stepId]())
        return made.get(input.session)
      },
    })
    _reset(askWork, { with: pool.client })

    const element = document.createElement("div")
    document.body.append(element)
    cleanups.push(WorkflowView(plan, element, { repo }))

    expect(await until(() => plan.doc().status === PLAN.done, 30_000)).toBe(true)
    expect(plan.doc().steps.map((s) => [s.status, s.result])).toEqual([
      ["done", "a is the first letter"],
      ["done", "made the note"],
    ])
    const b = await repo.find(plan.doc().steps[1].sessionUrl)
    expect(b.doc().made?.length).toBe(1)
    expect("lease" in plan.doc()).toBe(false)
    expect("lastGeneration" in plan.doc()).toBe(false)
    // Each step's session asked for no more than its work needed.
    const asksFor = (url) => pool.asks.filter((a) => a.input.session === url).length
    for (const s of plan.doc().steps) expect(asksFor(s.sessionUrl)).toBeLessThanOrEqual(3)
    expect(await until(() => lastText(orchestrator) === "All done.", 60_000)).toBe(true)
  }, 120_000)
})
