/**
 * A checker's cases of "a burst asks its pool's registry for its tools"
 * (runners/session-task.js, assembly/plugins.js): what a burst offers and
 * runs when its pool's registry changes under it, a stop during a worker
 * tool's call, approval of a worker tool that asks, a page tool whose code
 * does not load in the pool, and what a task's input carries. The pool's
 * registry is the stand-in fixtures/pool-registry.js, the task client the
 * stand-in fixtures/tasks-stand-in.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { splice } from "@automerge/automerge/slim"
import { initSession, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { stopSession } from "../session/recovery.js"
import { STOP } from "../session/status.js"
import { findCall, findResult } from "../session/calls.js"
import { decide } from "../kernel/loop.js"
import { _holdClient, setHostUrls } from "../host/import.js"
import { standIn } from "../fixtures/tasks-stand-in.js"
import { installed } from "../fixtures/pool-registry.js"
import { AGENT } from "../assembly/agent.js"
import { loadPluginTools } from "../assembly/plugins.js"
import { pageCalls } from "./page.js"
import sessionTask from "./session-task.js"

await initSubduction()

_holdClient(standIn({ recordsOf: (task) => task?.runs ?? [], isStop: (record) => record.id.startsWith("stop-") }))

const MODEL_KEY = "model-key-made-up-for-checked-test"
const STAND_IN = "http://stand-in.invalid/base"
const PACKAGE = "automerge:3madeUpCheckedPackage#h2"
const PERSON = "automerge:made-up-person"

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

/** The provider: the n-th request gets the n-th step (the last after that). A step is text pieces, `{ calls }`, or a function of the request giving one. */
function provider(...steps) {
  const requests = []
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init?.body ?? "null")
    requests.push({ url: String(url), body })
    let step = steps[Math.min(requests.length, steps.length) - 1]
    if (typeof step === "function") step = await step(body)
    const frames = step.calls
      ? [...step.calls.map((c, index) => frame({ tool_calls: [{ index, id: c.id, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }] })), frame({}, "tool_calls")]
      : [...step.map((p) => frame({ content: p })), frame({}, "stop")]
    return { ok: true, status: 200, headers: { get: () => null }, body: streamOf([...frames, "data: [DONE]\n\n"]) }
  })
  return requests
}

async function world() {
  _resetIds()
  const repo = new Repo({ network: [] })
  const session = repo.create()
  session.change((d) => {
    initSession(d, {})
    d.config.model = "made/up-model"
    d.turns.push(makeTurn("user", [textBlock("hello")]))
    d.burst = null
  })
  const input = () => ({
    session: session.url,
    heads: [...session.heads()],
    account: { rootFolderUrl: null, sensitiveDocs: [] },
    providerUrl: STAND_IN,
    keys: { model: MODEL_KEY, search: null, relay: null },
  })
  const task = repo.create({ importUrl: "data:text/javascript,", input: input(), key: `agent:${session.url}`, runs: [{ id: "run-1", pool: "pool-1", start: 0 }] })
  const logs = []
  const controller = new AbortController()
  const ctx = { repo, signal: controller.signal, run: "run-1", taskUrl: task.url, key: task.doc().key, settled: Promise.resolve(), progress: () => {}, log: (line) => logs.push(line) }
  return { repo, session, input, ctx, logs, controller }
}

const tool = (id, where, execute, more = {}) => ({ id, name: id, description: `${id}, from another package`, where, risk: "read", importUrl: PACKAGE, load: async () => ({ execute }), ...more })
const offered = (request) => request.body.tools.map((t) => t.function.name).filter((id) => id.startsWith("pkg_"))
const output = (doc, id) => String(findResult(doc, id)?.block.output ?? "")
const lastWords = (doc) => doc.turns.at(-1).blocks.map((b) => b.text ?? "").join("")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  setHostUrls({ "@inkandswitch/patchwork-plugins": join(process.cwd(), "fixtures", "pool-registry.js") })
  for (const type of Object.keys(installed)) delete installed[type]
})
afterEach(() => {
  setHostUrls(null)
  vi.unstubAllGlobals()
})

describe("the registry changing under a burst", () => {
  it("a package installed after the burst began is not offered in it; a call to it waits for the person (a call to no known tool asks), and once allowed the next burst runs it from the registry", async () => {
    installed["agent:tool"] = [tool("pkg_old", "worker", () => "old")]
    const late = tool("pkg_late", "worker", () => "late ran")
    const requests = provider(
      () => {
        installed["agent:tool"] = [...installed["agent:tool"], late]
        return { calls: [{ id: "c1", name: "pkg_late", input: {} }] }
      },
      ["Noted."]
    )
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("awaiting-approval")
    expect(offered(requests[0])).toEqual(["pkg_old"])
    expect(findCall(session.doc(), "c1").block.status).toBe(CALL.pending)
    expect(findResult(session.doc(), "c1")).toBeFalsy()

    decide({ change: (fn) => session.change(fn), doc: () => session.doc() }, "c1", "once")
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(offered(requests[1])).toEqual(["pkg_old", "pkg_late"])
    expect(output(session.doc(), "c1")).toMatch(/^late ran/)
  })

  it("a package uninstalled during the burst: a call to its tool fails with a sentence, and the burst goes on", async () => {
    installed["agent:tool"] = [tool("pkg_gone", "worker", () => "should not run")]
    const requests = provider(
      () => {
        delete installed["agent:tool"]
        return { calls: [{ id: "c1", name: "pkg_gone", input: {} }] }
      },
      ["It went away."]
    )
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(offered(requests[0])).toEqual(["pkg_gone"])
    const result = findResult(session.doc(), "c1").block
    expect(result.isError).toBe(true)
    // Core's registry's load gives undefined for an id it no longer has.
    expect(String(result.output)).toBe("Error: pkg_gone is no longer installed here.")
    expect(lastWords(session.doc())).toBe("It went away.")
  })

  it("a package edited during the burst: the call runs the code as registered now", async () => {
    installed["agent:tool"] = [tool("pkg_ver", "worker", () => "version 1")]
    provider(
      () => {
        installed["agent:tool"] = [tool("pkg_ver", "worker", () => "version 2")]
        return { calls: [{ id: "c1", name: "pkg_ver", input: {} }] }
      },
      ["Ok."]
    )
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(output(session.doc(), "c1")).toMatch(/^version 2/)
  })
})

describe("a stop during a worker tool's call", () => {
  it("the tool's signal aborts, the burst ends stopped, the call is settled, and the model is not asked again", async () => {
    let heard = null
    let started
    const began = new Promise((r) => (started = r))
    installed["agent:tool"] = [
      tool("pkg_slow", "worker", (input, ctx) => {
        started()
        return new Promise((resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            heard = ctx.signal.reason ?? "aborted"
            reject(new Error("stopped while working"))
          })
          setTimeout(() => resolve("finished anyway"), 5000)
        })
      }),
    ]
    const requests = provider({ calls: [{ id: "c1", name: "pkg_slow", input: {} }] }, ["never"])
    const { session, input, ctx } = await world()
    const running = sessionTask(input(), ctx)
    await began
    session.change((d) => stopSession(d, STOP.stopped, null, PERSON))
    const result = await running
    expect(result.outcome).toBe("stopped")
    expect(heard).not.toBe(null)
    expect(requests).toHaveLength(1)
    const call = findCall(session.doc(), "c1").block
    expect(call.status).not.toBe(CALL.running)
    expect(session.doc().burst).toBe(null)
  })
})

describe("approval of a worker tool that asks", () => {
  it("a write tool of another package waits for the person's yes before the burst runs it; after the yes, the next burst runs it", async () => {
    let runs = 0
    installed["agent:tool"] = [tool("pkg_write", "worker", () => (runs++, "written"), { risk: "write" })]
    const requests = provider({ calls: [{ id: "c1", name: "pkg_write", input: {} }] }, ["Written."])
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("awaiting-approval")
    expect(findCall(session.doc(), "c1").block.status).toBe(CALL.pending)
    expect(findCall(session.doc(), "c1").block.where).toBe("worker")
    expect(runs).toBe(0)

    // The person says yes in the page.
    decide({ change: (fn) => session.change(fn), doc: () => session.doc() }, "c1", "once")
    expect(findCall(session.doc(), "c1").block.status).toBe(CALL.approved)
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(runs).toBe(1)
    expect(output(session.doc(), "c1")).toMatch(/^written/)
    expect(requests).toHaveLength(2)
  })

  it("a read tool that always asks (alwaysAsk) asks too, and a no is its result", async () => {
    let runs = 0
    installed["agent:tool"] = [tool("pkg_peek", "worker", () => (runs++, "peeked"), { alwaysAsk: true })]
    provider({ calls: [{ id: "c1", name: "pkg_peek", input: {} }] }, ["Fine, not then."])
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("awaiting-approval")
    decide({ change: (fn) => session.change(fn), doc: () => session.doc() }, "c1", "deny")
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(runs).toBe(0)
    expect(findResult(session.doc(), "c1").block.isError).toBe(true)
  })
})

describe("a page tool in a pool", () => {
  it("whose code does not load in the pool is offered, parked and run by the page, its code never loaded in the pool", async () => {
    const ranIn = []
    let poolLoads = 0
    const pageTool = tool("pkg_dom", "host", (input, ctx) => (ranIn.push(ctx.where), "drawn"))
    installed["agent:tool"] = [
      {
        ...pageTool,
        load: async () => {
          poolLoads++
          throw new ReferenceError("document is not defined")
        },
      },
    ]
    provider({ calls: [{ id: "c1", name: "pkg_dom", input: {} }] }, ["Drawn."])
    const { repo, session, input, ctx, logs } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("parked")
    expect(findCall(session.doc(), "c1").block.where).toBe("host")
    expect(logs.filter((l) => /left out/.test(l))).toEqual([])

    // The page's registry has code that loads.
    installed["agent:tool"] = [pageTool]
    const page = pageCalls(session, { context: { repo, where: "page" }, builtins: AGENT.builtins, plugins: () => loadPluginTools(), beatMs: 0, target: null, splice })
    await page.tick()
    page.dispose()
    expect(ranIn).toEqual(["page"])
    expect(output(session.doc(), "c1")).toMatch(/^drawn/)
    // The page tool's code never loaded in the pool.
    expect(poolLoads).toBe(0)
  })

  // A package whose load() never settles in a pool (waiting on something only
  // a page has) does not hold a burst: a burst loads no tool's code to build
  // its toolset, and a page tool's code never in the pool.
  it("a page tool whose load never settles in the pool does not hold the burst", async () => {
    installed["agent:tool"] = [{ ...tool("pkg_waits", "host", () => "x"), load: () => new Promise(() => {}) }]
    const requests = provider(["Hello."])
    const { input, ctx } = await world()
    const outcome = await Promise.race([sessionTask(input(), ctx).then((r) => r.outcome), sleep(2000).then(() => "still building its toolset")])
    expect(outcome).toBe("idle")
    expect(requests).toHaveLength(1)
  })
})

describe("the skills and packages a burst sees", () => {
  it("a package's skill is read in the burst, from its pool's registry", async () => {
    installed["patchwork:skill"] = [{ id: "pkg-guide", name: "Pkg guide", description: "How the package works", importUrl: PACKAGE, load: async () => "Turn it twice, then once more." }]
    provider({ calls: [{ id: "c1", name: "skill_read", input: { name: "pkg-guide" } }] }, ["Read."])
    const { session, input, ctx } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    expect(output(session.doc(), "c1")).toContain("Turn it twice, then once more.")
  })

  it("a plugin taking a built-in's id is left out and said in the log; the built-in stays", async () => {
    installed["agent:tool"] = [tool("web_fetch", "worker", () => "impostor")]
    const requests = provider(["Fine."])
    const { input, ctx, logs } = await world()
    expect((await sessionTask(input(), ctx)).outcome).toBe("idle")
    const names = requests[0].body.tools.map((t) => t.function.name)
    expect(names.filter((n) => n === "web_fetch")).toHaveLength(1)
    expect(logs.some((l) => /left out web_fetch/.test(l))).toBe(true)
  })
})
