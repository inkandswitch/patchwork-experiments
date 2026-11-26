import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction, stringifyAutomergeUrl } from "@automerge/automerge-repo"
import { initPlan, PLAN, STEP, DEFAULT_TIER_MODELS, DEFAULT_STEP_BUDGETS, stepPrompt, stepBudget, WITHHELD, RESULT_IN_PROMPT } from "../workflow/plan.js"
import { workflowBudget, workflowStatus } from "../workflow/tools.js"
import { liftBudget } from "../session/usage.js"
import { WorkflowDriver, sessionOutcome, describeProgress, keptCounts, _resetDrivers } from "../workflow/driver.js"
import { scopedRepo } from "../kernel/scope.js"
import { KERNEL_TYPES, LEDGER_TYPE } from "../kernel/kernel-repo.js"
import { withLedger } from "../fixtures/ledger.js"
import { initSession, STATUS, CALL } from "../session/schema.js"
import { makeTurn, textBlock, noticeBlock } from "../session/blocks.js"
import { buildToolset } from "./toolset.js"
import { BUILTIN_TOOLS } from "./builtin.js"
import { WORKFLOW_TOOL_IDS } from "../fixtures/tool-ids.js"
import { statusOf } from "../session/status.js"
import { STOP } from "../session/status.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/**
 * A stand-in for asking for a step's work (runners/page.js askFor): it reads
 * the step it was given and answers, or fails, the way a burst would leave
 * the document. `stopWork` stands in for stopping its task on the queue.
 */
function fakeRunner(behaviour = {}) {
  const started = []
  const interrupted = []
  const ids = new Map()
  const startSession = async (handle) => {
    const doc = handle.doc()
    const id = doc.workflow?.stepId
    ids.set(handle.url, id)
    if (!started.includes(handle.url)) {
      started.push(handle.url)
      const act = behaviour[id] ?? "answer"
      if (act === "answer") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [textBlock(`result of ${id}`)]))
          d.usage = { in: 100, out: 10, turns: 1 }
        })
      } else if (act === "fail") {
        handle.change((d) => { d.turns.push(makeTurn("assistant", [noticeBlock(STOP.error, "it broke")])) })
      } else if (act === "ask") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "http_request", input: {}, status: CALL.pending }]))
        })
      } // "hang": leave it running
    }
    return { asked: true, outcome: "idle" }
  }
  const stopWork = (_repo, url) => {
    interrupted.push(ids.get(url))
    return Promise.resolve(true)
  }
  return { startSession, stopWork, started, interrupted }
}

async function setup(steps, { behaviour = {}, limits = {}, grants = {} } = {}) {
  const repo = new Repo({ network: [] })
  const orchestrator = repo.create({})
  orchestrator.change((d) => {
    initSession(d, { config: { model: "x", params: { maxTokens: 4000 } } })
    d.grants = grants
  })
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "W", goal: "G", subject: "automerge:subj", sessionUrl: orchestrator.url, limits, steps }))
  const runner = fakeRunner(behaviour)
  const news = []
  const notify = () => ({ notify: (render) => news.push(render()), close: () => {} })
  const make = () => new WorkflowDriver({ repo, handle: plan, startSession: runner.startSession, stopWork: runner.stopWork, notify, heartbeatMs: 1e9, confirmMs: 0 })
  return { repo, plan, orchestrator, runner, news, make }
}

/** Tick until nothing changes. */
async function settle(driver, rounds = 20) {
  for (let i = 0; i < rounds; i++) await driver.kick()
}

const drivers = []
const started = (driver) => { drivers.push(driver); driver.start(); return driver }
afterEach(() => { for (const d of drivers.splice(0)) d.stop(); _resetDrivers() })

describe("running a plan", () => {
  it("runs a chain in order, handing each step what the last one found", async () => {
    const { repo, plan, make } = await setup([step("a"), step("b", { after: ["a"] })])
    await settle(started(make()))

    const doc = plan.doc()
    expect(doc.steps.map((s) => s.status)).toEqual([STEP.done, STEP.done])
    expect(doc.steps.map((s) => s.result)).toEqual(["result of a", "result of b"])
    expect(doc.status).toBe(PLAN.done)
    const b = (await repo.find(doc.steps[1].sessionUrl)).doc()
    expect(b.turns[0].blocks[0].text).toContain("### Step a (a)\nresult of a")
  })

  it("gives each step its tier's model, its tools, and the orchestrator's grants", async () => {
    const { repo, plan, make } = await setup(
      [step("w", { tier: "deep", behaviour: "hang" }), step("h", { where: "host", tier: "standard" })],
      { behaviour: { w: "hang", h: "hang" }, grants: { "files@*": true } }
    )
    await settle(started(make()))
    const [w, h] = await Promise.all(plan.doc().steps.map(async (s) => (await repo.find(s.sessionUrl)).doc()))

    expect(w.config.model).toBe(DEFAULT_TIER_MODELS.deep)
    expect(h.config.model).toBe(DEFAULT_TIER_MODELS.standard)
    expect(w.config.params.maxTokens).toBe(4000)
    expect(w.tools).toEqual({ where: "worker" })
    expect(h.tools).toBeUndefined()
    expect(w.grants).toEqual({ "files@*": true })
    expect(w.subject).toBe("automerge:subj")
    expect(w.workflow).toEqual({ planUrl: plan.url, stepId: "w", orchestratorUrl: expect.any(String) })
    expect(w["@patchwork"]).toEqual({ type: "agent-session" })
  })

  it("never runs more at once than the limit", async () => {
    const { plan, make } = await setup([step("a"), step("b"), step("c")], { behaviour: { a: "hang", b: "hang", c: "hang" }, limits: { parallel: 2 } })
    await settle(started(make()))
    expect(plan.doc().steps.map((s) => s.status)).toEqual([STEP.running, STEP.running, STEP.pending])
  })

  it("a failure blocks what depends on it, and the rest still runs", async () => {
    const { plan, make } = await setup([step("a"), step("b", { after: ["a"] }), step("c")], { behaviour: { a: "fail" } })
    await settle(started(make()))
    const doc = plan.doc()
    expect(doc.steps.map((s) => s.status)).toEqual([STEP.failed, STEP.pending, STEP.done])
    expect(doc.steps[0].error).toMatch(/error/)
    expect(doc.status).toBe(PLAN.done) // settled: b can never run
  })

  it("adds up what the steps cost", async () => {
    const { plan, make } = await setup([step("a"), step("b")])
    await settle(started(make()))
    expect(plan.doc().usage).toEqual({ in: 200, out: 20 })
  })
})

describe("one plan, two tabs", () => {
  it("only the driver holding the plan starts steps: each step gets exactly one session", async () => {
    const { plan, runner, make } = await setup([step("a"), step("b"), step("c", { after: ["a", "b"] })])
    const first = started(make())
    const second = started(make())
    await Promise.all([settle(first), settle(second)])
    expect(plan.doc().steps.every((s) => s.status === STEP.done)).toBe(true)
    expect(runner.started).toHaveLength(3)
    expect(new Set(plan.doc().steps.map((s) => s.sessionUrl)).size).toBe(3)
  })
})

describe("after a reload", () => {
  it("a new driver picks the plan up: running steps get their runners back", async () => {
    const { plan, runner, make } = await setup([step("a")], { behaviour: { a: "hang" } })
    const before = started(make())
    await settle(before)
    before.stop()
    plan.change((d) => { d.lease.at = 0 }) // the old tab's lease has gone stale

    runner.started.length = 0
    await settle(started(make()))
    expect(runner.started).toEqual([plan.doc().steps[0].sessionUrl])
    expect(plan.doc().steps[0].status).toBe(STEP.running) // the same session, not a new one
  })
})

describe("stopping", () => {
  it("cancels what has not finished and interrupts what is running", async () => {
    const { plan, runner, make } = await setup([step("a"), step("b"), step("c", { after: ["a"] })], { behaviour: { b: "hang" } })
    const driver = started(make())
    await settle(driver)
    await driver.cancel()
    expect(plan.doc().steps.map((s) => s.status)).toEqual([STEP.done, STEP.cancelled, STEP.done])
    expect(runner.interrupted).toEqual(["b"])
    expect(plan.doc().status).toBe(PLAN.stopped)
  })
})

describe("telling the orchestrator", () => {
  it("reports each finished step once, and says when it is over", async () => {
    const { news, make } = await setup([step("a"), step("b", { after: ["a"] })])
    await settle(started(make()))
    const all = news.join("\n")
    expect(all.match(/## Done: Step a/g)).toHaveLength(1)
    expect(all.match(/## Done: Step b/g)).toHaveLength(1)
    expect(news.at(-1)).toMatch(/The workflow is over/)
  })

  it("describes a step waiting on a person as running, and says how to continue", () => {
    const text = describeProgress({ title: "W", status: PLAN.running, steps: [step("a", { status: STEP.done, result: "r" })] }, [])
    expect(text).toMatch(/1 done/)
    expect(text).toMatch(/workflow_add_steps/)
  })
})

describe("sessionOutcome", () => {
  const session = (over) => {
    const doc = {}
    initSession(doc, {})
    Object.assign(doc, over)
    return doc
  }
  it.each([
    ["just created", session({ turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["thinking", session({ burst: { run: "r" }, turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["waiting on a person", session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [{ type: "call", id: "c1", tool: "http_request", input: {}, status: CALL.pending }])] }), "running"],
    ["answered", session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("done it")])] }), "done"],
    ["broke", session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [noticeBlock(STOP.error, "it broke")])] }), "failed"],
  ])("%s → %s", (_name, doc, state) => {
    expect(sessionOutcome(doc).state).toBe(state)
  })

  it("the result is the last thing it said", () => {
    const doc = session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("first"), textBlock("second")])] })
    expect(sessionOutcome(doc).result).toBe("first\nsecond")
  })
})

describe("which tools a session gets", () => {
  const ids = async (doc) => (await buildToolset(doc, { skipPlugins: true })).tools.map((t) => t.id)

  it("no workflow tools unless the session's switch is on", async () => {
    expect(await ids({ config: {} })).not.toContain("workflow_start")
    expect(await ids({ config: { workflows: { enabled: true } } })).toEqual(expect.arrayContaining(WORKFLOW_TOOL_IDS))
  })

  it("a step never gets them, even with the switch on", async () => {
    expect(await ids({ config: { workflows: { enabled: true } }, workflow: { planUrl: "automerge:plan", stepId: "s" } })).not.toContain("workflow_start")
  })

  it("a worker step gets only tools that run without the page", async () => {
    const got = await ids({ config: {}, workflow: { planUrl: "automerge:plan", stepId: "s" }, tools: { where: "worker" } })
    expect(got.every((id) => BUILTIN_TOOLS.find((t) => t.id === id).where === "worker")).toBe(true)
    expect(got).toContain("doc_edit")
    expect(got).not.toContain("view_mount")
  })
})

// ------------------------------------------------------------ research steps

describe("filing what research steps kept", () => {
  /**
   * A plan whose ledger has `states.length` entries, entry i a finding when i
   * is odd and a source otherwise, each in one of four states: not filed;
   * filed (in the folder and marked); half filed (in the folder, not yet
   * marked, as a driver that lost the plan between its two writes leaves it);
   * or unwritten (made, and so in the ledger, but nothing written into it yet:
   * a fetch still under way, or one that crashed).
   */
  async function ledgerOf(states) {
    const repo = new Repo({ network: [] })
    const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Sources · W", docs: [] })
    const plan = repo.create({})
    plan.change((d) => initPlan(d, { title: "W", goal: "G", steps: [], sourcesFolderUrl: folder.url }))
    const ledger = withLedger(repo, plan)
    const scoped = scopedRepo(repo, ledger, { stepId: "r" })
    const links = []
    const unwritten = []
    const write = (made, i) => {
      made.change((d) => Object.assign(d, { name: `e${i}.md`, role: i % 2 ? "finding" : "extract", content: `entry ${i}` }))
      return { name: `e${i}.md`, type: "file", url: i % 2 ? made.url : stringifyAutomergeUrl({ documentId: made.documentId, heads: made.heads() }) }
    }
    for (const [i, state] of states.entries()) {
      const made = await scoped.create2()
      if (state === "unwritten") {
        unwritten.push(() => write(made, i))
        continue
      }
      const link = write(made, i)
      links.push(link)
      if (state !== "unfiled") folder.change((d) => { d.docs.push(link) })
      if (state === "filed") plan.change((d) => { d.sourcesFiled[made.documentId] = true })
    }
    const driver = new WorkflowDriver({ repo, handle: plan, startSession: async () => null, heartbeatMs: 1e9, confirmMs: 0 })
    drivers.push(driver)
    driver.hold()
    return { plan, ledger, folder, driver, links, unwritten }
  }

  const cases = []
  const grow = (prefix) => {
    cases.push([prefix.join(",") || "empty", prefix])
    if (prefix.length < 3) for (const state of ["unfiled", "filed", "half", "unwritten"]) grow([...prefix, state])
  }
  grow([])

  it.each(cases)("ledger %s: filing leaves the folder equal to what the ledger describes, and a second pass writes nothing", async (_name, states) => {
    const { plan, ledger, folder, driver, links, unwritten } = await ledgerOf(states)
    const asSet = (docs) => docs.map((d) => `${d.name} ${d.type} ${d.url}`).sort()
    const described = () => Object.entries(ledger.doc().sources).filter(([, e]) => e.what != null).map(([id]) => id).sort()
    const ledgerBefore = ledger.heads()
    await driver.fileSources()
    expect(asSet(folder.doc().docs)).toEqual(asSet(links))
    expect(Object.keys(plan.doc().sourcesFiled).sort()).toEqual(described())
    // The ledger is read, never written.
    expect(ledger.heads()).toEqual(ledgerBefore)

    const before = [plan.heads(), folder.heads()]
    await driver.fileSources()
    expect([plan.heads(), folder.heads()]).toEqual(before)

    // Once something is written into what was unwritten, the next pass files it.
    if (!unwritten.length) return
    const late = unwritten.map((describe) => describe())
    await driver.fileSources()
    expect(asSet(folder.doc().docs)).toEqual(asSet([...links, ...late]))
    expect(Object.keys(plan.doc().sourcesFiled).sort()).toEqual(Object.keys(ledger.doc().sources).sort())
  })

  // A document of a package's own datatype — a web-snapshot a research step
  // captured — is described by that type and filed as it, so the folder opens
  // it in its own view; a file is filed as a file.
  it.each([
    ["web-snapshot", { "@patchwork": { type: "web-snapshot" }, title: "Cells", source: "https://site.test/cells", text: "Cells" }, "web-snapshot", "Cells"],
    ["file", { "@patchwork": { type: "file" }, name: "cells.md", role: "extract", source: "https://site.test/cells", content: "Cells" }, "extract", "cells.md"],
    ["untyped", { name: "cells.md", role: "extract", content: "Cells" }, "extract", "cells.md"],
  ])("files a %s as its own datatype", async (type, value, what, name) => {
    const { ledger, folder, driver } = await ledgerOf([])
    const made = await scopedRepo(driver.repo, ledger, { stepId: "r" }).create2()
    made.change((d) => Object.assign(d, value))
    expect(ledger.doc().sources[made.documentId]).toMatchObject({ kind: "source", what, type: type === "untyped" ? "file" : type, name })
    await driver.fileSources()
    expect(folder.doc().docs).toEqual([{ name, type: type === "untyped" ? "file" : type, url: stringifyAutomergeUrl({ documentId: made.documentId, heads: made.heads() }) }])
  })

  // A search's results page is the record of how a step found what it read,
  // not a source a reviewer checks a claim against: kept, never filed.
  it("keeps a search's results page out of the folder, and does not try again", async () => {
    const { plan, ledger, folder, driver } = await ledgerOf([])
    const scoped = scopedRepo(driver.repo, ledger, { stepId: "r" })
    const search = await scoped.create2()
    search.change((d) => Object.assign(d, { "@patchwork": { type: "file" }, name: "Search: lfp cells.json", role: "extract", source: "https://search.brave.com/search?q=lfp", capture: { engine: "search" }, content: "results" }))
    const page = await scoped.create2()
    page.change((d) => Object.assign(d, { "@patchwork": { type: "file" }, name: "cells.pdf", role: "primary", source: "https://site.test/cells.pdf", capture: { engine: "raw" }, content: "%PDF" }))
    await driver.fileSources()
    expect(folder.doc().docs.map((entry) => entry.name)).toEqual(["cells.pdf"])
    expect(Object.keys(plan.doc().sourcesFiled).sort()).toEqual([search.documentId, page.documentId].sort())
  })

  // A ledger is a shared document, and its entries say what each is; none
  // is ever filed as a session or a plan, whatever its entry says.
  it.each(KERNEL_TYPES)("never files an entry as an %s", async (type) => {
    const { ledger, folder, driver } = await ledgerOf([])
    const made = await scopedRepo(driver.repo, ledger, { stepId: "r" }).create2()
    made.change((d) => Object.assign(d, { name: "x.md", role: "extract", content: "x" }))
    ledger.change((d) => { d.sources[made.documentId].type = type })
    await driver.fileSources()
    expect(folder.doc().docs.map((entry) => entry.type)).toEqual(["file"])
  })
})

describe("one ledger per plan", () => {
  const ledgers = (repo) => Object.values(repo.handles).filter((h) => h.doc()?.["@patchwork"]?.type === LEDGER_TYPE)

  // [the plan's steps] → how many ledgers there are once it has run. One for
  // any number of research steps, side by side or in order; none for a plan
  // with no research step.
  it.each([
    ["no research step", [step("a"), step("b", { after: ["a"] })], 0],
    ["one research step", [step("r", { access: "web" })], 1],
    ["two side by side", [step("r", { access: "web" }), step("s", { access: "web" })], 1],
    ["two in order, behind a full step", [step("a"), step("r", { access: "web", after: ["a"] }), step("s", { access: "web", after: ["r"] })], 1],
  ])("%s → %i", async (_name, steps, count) => {
    const { repo, plan, make } = await setup(steps)
    await settle(started(make()))
    expect(plan.doc().status).toBe(PLAN.done)
    expect(ledgers(repo)).toHaveLength(count)
    if (count) expect(plan.doc().ledgerUrl).toBe(ledgers(repo)[0].url)
    else expect(plan.doc().ledgerUrl).toBeNull()
    expect("sources" in plan.doc()).toBe(false)
    // Every research step's scope names the plan, and so reaches that ledger.
    for (const s of plan.doc().steps.filter((x) => x.access === "web")) {
      expect((await repo.find(s.sessionUrl)).doc().scope).toEqual({ kind: "web", planUrl: plan.url, stepId: s.id })
    }
  })

  it("two drivers on one plan open one ledger between them, however their ticks interleave", async () => {
    for (const order of [[0, 1], [1, 0], [0, 0, 1, 1], [1, 0, 1, 0]]) {
      const { repo, plan, make } = await setup([step("r", { access: "web" }), step("s", { access: "web", after: ["r"] })], { behaviour: { r: "hang" } })
      const pair = [make(), make()]
      drivers.push(...pair)
      for (const i of order) await pair[i].kick()
      for (const i of order) await pair[i].kick()
      expect(ledgers(repo), `order ${order}`).toHaveLength(1)
      expect(plan.doc().ledgerUrl).toBe(ledgers(repo)[0].url)
    }
  })

  it("a ledger change wakes the driver, and writes nothing to the plan but what it files", async () => {
    const { repo, plan, make } = await setup([step("r", { access: "web" })], { behaviour: { r: "hang" } })
    const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Sources · W", docs: [] })
    plan.change((d) => { d.sourcesFolderUrl = folder.url })
    const driver = started(make())
    await settle(driver)
    const ledger = await repo.find(plan.doc().ledgerUrl)
    const scoped = scopedRepo(repo, ledger, { stepId: "r" })
    const without = (doc, ...keys) => JSON.stringify({ ...doc, ...Object.fromEntries(keys.map((k) => [k, null])) })

    // Made, with nothing written into it yet: nothing to file, so no write.
    const made = await scoped.create2()
    const before = plan.heads()
    await settle(driver)
    expect(plan.heads()).toEqual(before)

    // Written: it wakes the driver by itself, which files it and marks it so.
    const planBefore = without(plan.doc(), "sourcesFiled")
    made.change((d) => Object.assign(d, { name: "page.md", role: "extract", content: "words" }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await driver.ticking
    expect(folder.doc().docs.map((e) => e.name)).toEqual(["page.md"])
    expect(Object.keys(plan.doc().sourcesFiled)).toEqual([made.documentId])
    expect(without(plan.doc(), "sourcesFiled")).toBe(planBefore)
  })
})

describe("a step's budget, wherever it is raised", () => {
  // [who raises it, and when] → the budget the session spends against, which
  // is the step's as every reader reads it: the plan's model and the
  // orchestrator's step table. The plan's own `budget` is what it started with.
  const fast = DEFAULT_STEP_BUDGETS.fast
  const CASES = {
    "never raised": { before: null, after: null, budget: fast, start: undefined },
    "by the orchestrator, before it starts": { before: (w) => workflowBudget.execute({ plan: w.plan.url, step: "a", add: 1, why: "big" }, { workflows: { repo: w.repo } }), after: null, budget: fast + 1, start: fast + 1 },
    "by the orchestrator, while it runs": { before: null, after: (w) => workflowBudget.execute({ plan: w.plan.url, step: "a", add: 2, why: "more" }, { workflows: { repo: w.repo } }), budget: fast + 2, start: undefined },
    "by a person, on its session": { before: null, after: async (w, session) => session.change((d) => liftBudget(d, 1)), budget: fast + 1, start: undefined },
  }

  it.each(Object.keys(CASES))("%s", async (name) => {
    const { before, after, budget, start } = CASES[name]
    const w = await setup([step("a")], { behaviour: { a: "hang" } })
    if (before) await before(w)
    await settle(started(w.make()))
    const session = await w.repo.find(w.plan.doc().steps[0].sessionUrl)
    if (after) await after(w, session)
    const planStep = w.plan.doc().steps[0]
    expect(session.doc().config.budget).toBe(budget)
    expect(stepBudget(planStep, session.doc())).toBe(budget)
    expect(planStep.budget).toBe(start)
    expect(await workflowStatus.execute({ plan: w.plan.url }, { workflows: { repo: w.repo } })).toContain(`$${budget.toFixed(2)} budget`)
  })
})

describe("a research step's scope", () => {
  // Each way its scope can be wrong once it is running → the step is
  // cancelled, saying why. Left alone, it runs on.
  const MUTATIONS = {
    untouched: () => {},
    removed: (d) => { delete d.scope },
    nulled: (d) => { d.scope = null },
    "kind changed": (d) => { d.scope.kind = "full" },
    "plan changed": (d) => { d.scope.planUrl = "automerge:2j9knZ5d4NNxLrYGsbBHuYXu3Twz" },
    "a ledger named": (d) => { d.scope.ledgerUrl = "automerge:2j9knZ5d4NNxLrYGsbBHuYXu3Twz" },
    "step changed": (d) => { d.scope.stepId = "other" },
    "a field added": (d) => { d.scope.extra = true },
  }

  it.each(Object.keys(MUTATIONS))("%s", async (name) => {
    const { repo, plan, make } = await setup([step("r", { access: "web" })], { behaviour: { r: "hang" } })
    const driver = started(make())
    await settle(driver)
    const session = await repo.find(plan.doc().steps[0].sessionUrl)
    session.change(MUTATIONS[name])
    await settle(driver)
    const after = plan.doc().steps[0]
    if (name === "untouched") {
      expect(after.status).toBe(STEP.running)
    } else {
      expect(after.status).toBe(STEP.cancelled)
      expect(after.error).toBe("its research scope was removed")
    }
  })
})

describe("what a step's first message hands it", () => {
  // [this step web?, the step it waits for web?] → is that step's result in
  // the prompt? The rule: a research step gets research results only.
  const cases = []
  for (const web of [false, true]) for (const depWeb of [false, true]) cases.push([web, depWeb, !(web && !depWeb)])

  it.each(cases)("step web %s, dependency web %s → result handed on %s", (web, depWeb, handed) => {
    const dep = { ...step("d", { ...(depWeb ? { access: "web" } : {}) }), status: STEP.done, result: "RESULT-of-d", sessionUrl: "automerge:dep-session" }
    const self = step("s", { after: ["d"], ...(web ? { access: "web" } : {}) })
    const text = stepPrompt({ title: "W", goal: "G", steps: [dep, self] }, self)
    expect(text.includes("RESULT-of-d")).toBe(handed)
    expect(text.includes(WITHHELD)).toBe(!handed)
    expect(text.includes("## Keeping things")).toBe(web)
  })

  it("never tells a research step where another session is, even when a result is cut", () => {
    const dep = { ...step("d", { access: "web" }), status: STEP.done, result: "x".repeat(RESULT_IN_PROMPT + 10), sessionUrl: "automerge:dep-session" }
    const self = step("s", { after: ["d"], access: "web" })
    expect(stepPrompt({ title: "W", goal: "G", steps: [dep, self] }, self)).not.toContain("automerge:")
    const full = step("f", { after: ["d"] })
    expect(stepPrompt({ title: "W", goal: "G", steps: [dep, full] }, full)).toContain("automerge:dep-session")
  })
})

describe("the news about research steps", () => {
  it("says what each kept, as the plan's ledger has it, and where to find it", () => {
    const ledger = {
      "@patchwork": { type: LEDGER_TYPE },
      sources: {
        a: { kind: "source", what: "extract", by: "r" },
        b: { kind: "source", what: "pdf", by: "r" },
        c: { kind: "finding", what: "finding", by: "r" },
        d: { kind: "source", what: "file", by: "other" },
        e: { kind: "source", what: null, by: "r" }, // made, not yet written: not counted
      },
    }
    const plan = {
      title: "W",
      status: PLAN.running,
      sourcesFolderUrl: "automerge:folder",
      ledgerUrl: "automerge:ledger",
      steps: [{ ...step("r", { access: "web" }), status: STEP.done, result: "found", sessionUrl: "automerge:s" }],
    }
    const text = describeProgress(plan, plan.steps, [], [], { ledger })
    expect(text).toContain("It kept 2 sources and 1 finding — Sources: automerge:folder")
    expect(text).toContain("The research steps have kept 3 sources and 1 finding — Sources: automerge:folder")
    expect(keptCounts(ledger)).toEqual({ sources: 3, findings: 1 })
    expect(keptCounts(ledger, "r")).toEqual({ sources: 2, findings: 1 })
    // Without its ledger, nothing is said to be kept.
    expect(describeProgress(plan, plan.steps)).toContain("It kept 0 sources and 0 findings")
    expect(keptCounts(null)).toEqual({ sources: 0, findings: 0 })
  })
})
