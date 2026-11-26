/**
 * A page following a session it shows or drives (runners/page.js follow,
 * askFor, takeOverFor, stopFor): it asks for the session's work when its copy
 * shows some, with the person's keys, account and catalogue in the input; it
 * opens the session's watches, again whenever which watches it has changes,
 * and a wake asks; it is counted, and the last holder ends it. The asker and
 * the task client are stand-ins (`_reset`), so nothing here needs a queue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { STOP, stopOf } from "../session/status.js"
import { follow, askFor, takeOverFor, stopFor, followWorkFor, drivePlanHere, letGo, ASK_SETTLE_MS, _reset, _followers } from "./page.js"
import { forget, workKey } from "./ask.js"
import { getDriver, sessionHolder, _resetDrivers } from "../workflow/driver.js"
import { initPlan, beginStep, cancelStep, changePlan, STEP } from "../workflow/plan.js"

await initSubduction()

const KEY = "patchwork-agent:key:openrouter"

let asks
let client
beforeEach(() => {
  _resetIds()
  asks = []
  client = { doWork: async () => ({ outcome: "idle" }), watchWork: () => () => {}, stopWork: vi.fn(async () => true) }
  _reset(async (_repo, url, opts) => (asks.push({ url, opts }), { asked: true, outcome: "idle" }), { with: client })
  localStorage.clear()
  localStorage.setItem(KEY, "sk-test")
})
afterEach(() => {
  _resetDrivers()
  _reset()
})

function sessionIn(repo, turns = [makeTurn("user", [textBlock("hello")])], fields = {}) {
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(...turns)
    d.burst = null
    Object.assign(d, fields)
  })
  return handle
}

const settle = () => new Promise((r) => setTimeout(r, ASK_SETTLE_MS + 50))

describe("asking", () => {
  it("asks once its copy shows work a run can do, once the changes settle; not for a session the agent answered", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    const followed = follow(handle, { repo })
    await settle()
    expect(asks.map((a) => a.url)).toEqual([handle.url])
    handle.change((d) => d.turns.push(makeTurn("assistant", [textBlock("hi")])))
    await settle()
    expect(asks).toHaveLength(1)
    // A message is work again.
    handle.change((d) => d.turns.push(makeTurn("user", [textBlock("more")])))
    await settle()
    expect(asks).toHaveLength(2)
    followed.release()
  })

  it("puts the person's keys, the account and the catalogue in the input, and asks again the same way", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    localStorage.setItem("patchwork-agent:key:agentBraveSearch", "brave-test")
    await askFor(repo, handle.url)
    const { opts } = asks[0]
    expect(opts.keys).toEqual({ model: "sk-test", search: "brave-test", relay: null })
    expect(opts.account).toEqual({ rootFolderUrl: null, sensitiveDocs: [] })
    expect(opts.catalogue).toEqual({ tools: [], skills: [] })
    expect(opts.client).toBe(client)
    await opts.reask()
    expect(asks).toHaveLength(2)
  })

  it("asks nothing for a session with no key here, or of another version", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    localStorage.removeItem(KEY)
    expect(await askFor(repo, handle.url)).toMatchObject({ asked: false, why: "no key" })
    localStorage.setItem(KEY, "sk-test")
    const outdated = sessionIn(repo, [makeTurn("user", [textBlock("hi"), { type: "hologram" }])])
    expect(await askFor(repo, outdated.url)).toMatchObject({ asked: false })
    expect(asks).toEqual([])
  })

  it("an asker that throws is said, never thrown", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    _reset(async () => {
      throw new Error("The tasks package is not installed")
    })
    expect(await askFor(repo, handle.url)).toMatchObject({ asked: false, error: true, why: "The tasks package is not installed" })
  })
})

describe("watches", () => {
  /** A watch on `other`, as doc_watch in a burst writes it (tools/watch.js). */
  const watchOf = (other, path = []) => ({ url: other.url, path, match: null, label: null, heads: [...other.heads()], at: 1 })

  it("opens the session's watches, again when which it has changes, and a wake asks", async () => {
    const repo = new Repo({ network: [] })
    const other = repo.create()
    other.change((d) => {
      d.a = 0
      d.b = 0
    })
    const handle = sessionIn(repo, [makeTurn("user", [textBlock("watch")]), makeTurn("assistant", [textBlock("watching")])], { watches: {} })
    handle.change((d) => (d.watches.w1 = watchOf(other, ["a"])))
    const followed = follow(handle, { repo })
    await vi.waitFor(() => expect(followed.events.listening()).toBe(1))
    // Another watch written (by a burst): opened too.
    handle.change((d) => (d.watches.w2 = watchOf(other, ["b"])))
    await vi.waitFor(() => expect(followed.events.listening()).toBe(2))
    // Someone else edits what is watched: the session is woken, and the wake asks.
    asks.length = 0
    other.change((d) => (d.a = 1))
    await vi.waitFor(() => expect(handle.doc().turns.at(-1).role).toBe("user"), { timeout: 5000 })
    await vi.waitFor(() => expect(asks.length).toBeGreaterThan(0))
    followed.release()
    expect(followed.events.listening()).toBe(0)
  }, 10_000)
})

describe("holding", () => {
  it("is counted: a second holder shares it, and the last to let go ends it", () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, [])
    const first = follow(handle, { repo })
    const second = follow(handle, { repo })
    expect(first.events).toBe(second.events)
    first.release()
    first.release() // twice is once
    expect(_followers().has(handle.url)).toBe(true)
    second.release()
    expect(_followers().has(handle.url)).toBe(false)
  })
})

describe("Stop, Take over and the queue's view", () => {
  it("Take over clears `burst`, whoever it named, and asks with this page's keys", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, undefined, { burst: { run: "someone-elses" } })
    await takeOverFor(repo, handle.url)
    expect(handle.doc().burst).toBe(null)
    expect(asks.map((a) => a.opts.keys.model)).toEqual(["sk-test"])
  })

  it("Stop writes the person's notice, then stops the task under the key on their queue", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo, undefined, { burst: { run: "run-1" } })
    expect(await stopFor(repo, handle.url, { author: "automerge:person" })).toBe(true)
    expect(stopOf(handle.doc())?.kind).toBe(STOP.stopped)
    expect(handle.doc().burst).toBe(null)
    expect(client.stopWork).toHaveBeenCalledWith(repo, workKey(handle.url))
  })

  it("the view follows what the queue says of the key, and asks again with the keys when the task it followed ends", async () => {
    const repo = new Repo({ network: [] })
    const handle = sessionIn(repo)
    let say = null
    client.watchWork = (_repo, key, onChange) => {
      expect(key).toBe(workKey(handle.url))
      say = onChange
      return () => {}
    }
    const seen = []
    const off = followWorkFor(repo, handle.url, (view) => seen.push(view?.state ?? null))
    say({ state: "running", runs: [{ id: "r1", pool: "p", start: 1 }] })
    say({ state: "succeeded", runs: [{ id: "r1", pool: "p", start: 1, end: 2 }], result: { heads: null } })
    expect(seen).toEqual([null, "running", "succeeded"])
    await vi.waitFor(() => expect(asks.map((a) => a.opts.keys.model)).toEqual(["sk-test"]))
    off()
    forget(handle.url)
  })
})

describe("held by a workflow driver", () => {
  /** A plan whose step `a` runs in its own session, and an orchestrator. */
  function planIn(repo) {
    const orchestrator = sessionIn(repo, [makeTurn("assistant", [textBlock("started")])])
    // Its instructions not yet answered: the step runs.
    const step = sessionIn(repo, [makeTurn("user", [textBlock("do a")])])
    const plan = repo.create()
    plan.change((d) => {
      initPlan(d, { title: "t", goal: "g", sessionUrl: orchestrator.url, steps: [{ id: "a", title: "A", prompt: "do a", why: "w", where: "worker", tier: "fast", after: [] }] })
      beginStep(d, "a", { session: { url: step.url, model: null } })
    })
    return { orchestrator, step, plan }
  }
  const quiet = async () => ({ asked: false, why: "a test asks nothing" })
  const holdersOf = (url) => (_followers().get(url)?.disposed ? 0 : (_followers().get(url)?.holders ?? 0))

  it("holds one follow on a running step's session, however often it ticks; lets go when the step leaves running", async () => {
    const repo = new Repo({ network: [] })
    const { step, plan } = planIn(repo)
    const view = {}
    const driver = await drivePlanHere(plan.url, { repo, holder: view, startSession: quiet })
    for (let i = 0; i < 4; i++) await driver.kick()
    expect(holdersOf(step.url)).toBe(1)
    changePlan(plan, (d) => cancelStep(d, "a"))
    await driver.kick()
    expect(plan.doc().steps[0].status).toBe(STEP.cancelled)
    expect(_followers().has(step.url)).toBe(false)
    letGo(view)
    expect(getDriver(plan.url)).toBe(null)
  })

  it("stops when the last view that started or joined it lets go, and lets go of its follows", async () => {
    const repo = new Repo({ network: [] })
    const { step, plan } = planIn(repo)
    const [first, second] = [{}, {}]
    const driver = await drivePlanHere(plan.url, { repo, holder: first, startSession: quiet })
    expect(await drivePlanHere(plan.url, { repo, holder: second })).toBe(driver)
    await driver.kick()
    expect(holdersOf(step.url)).toBe(1)
    letGo(first)
    expect(getDriver(plan.url)).toBe(driver)
    expect(holdersOf(step.url)).toBe(1)
    letGo(second)
    expect(getDriver(plan.url)).toBe(null)
    expect(driver.stopped).toBe(true)
    expect(_followers().has(step.url)).toBe(false)
  })

  it("one a session's workflow tool started stops when this page stops following that session: the last to let go ends it", async () => {
    const repo = new Repo({ network: [] })
    const { orchestrator, step, plan } = planIn(repo)
    const shown = follow(orchestrator, { repo })
    // As workflow/tools.js drive() does in a page: held for the calling session.
    const driver = await drivePlanHere(plan.url, { repo, holder: sessionHolder(orchestrator.url), startSession: quiet })
    await driver.kick()
    expect(holdersOf(step.url)).toBe(1)
    shown.release()
    expect(getDriver(plan.url)).toBe(null)
    expect(_followers().has(step.url)).toBe(false)
    expect(_followers().has(orchestrator.url)).toBe(false)
  })
})
