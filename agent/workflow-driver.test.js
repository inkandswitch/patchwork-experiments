import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction, stringifyAutomergeUrl } from "@automerge/automerge-repo"
import { initPlan, PLAN, STEP, DEFAULT_TIER_MODELS, WORKFLOW_TOOL_IDS, stepPrompt, WITHHELD, RESULT_IN_PROMPT } from "./workflow/plan.js"
import { WorkflowDriver, sessionOutcome, describeProgress, keptCounts, _resetDrivers } from "./workflow/driver.js"
import { scopedRepo, KERNEL_TYPES } from "./scope.js"
import { initSession, makeTurn, textBlock, STATUS, CALL } from "./session.js"
import { buildToolset, BUILTIN_TOOLS } from "./tools/index.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: `Step ${id}`, prompt: `do ${id}`, why: "test", where: "worker", tier: "fast", after: [], ...over })

/**
 * A stand-in for running a step's session: it reads the step it was given and
 * answers, or fails, the way a real runner would leave the document.
 */
function fakeRunner(behaviour = {}) {
  const started = []
  const interrupted = []
  const startSession = async (handle) => {
    const doc = handle.doc()
    const id = doc.workflow?.stepId
    if (!started.includes(handle.url)) {
      started.push(handle.url)
      const act = behaviour[id] ?? "answer"
      if (act === "answer") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [textBlock(`result of ${id}`)]))
          d.status = STATUS.idle
          d.usage = { in: 100, out: 10, turns: 1 }
        })
      } else if (act === "fail") {
        handle.change((d) => { d.status = STATUS.error })
      } else if (act === "ask") {
        handle.change((d) => {
          d.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "http_request", input: {}, status: CALL.pending }]))
          d.status = STATUS.awaitingApproval
        })
      } // "hang": leave it running
    }
    return { runner: { interrupt: () => interrupted.push(id) }, listen: () => {} }
  }
  return { startSession, started, interrupted }
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
  const make = () => new WorkflowDriver({ repo, handle: plan, startSession: runner.startSession, notify, heartbeatMs: 1e9, confirmMs: 0, toolIds: { worker: ["doc_read", "doc_edit"] } })
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
      { behaviour: { w: "hang", h: "hang" }, grants: { "files@*": "session" } }
    )
    await settle(started(make()))
    const [w, h] = await Promise.all(plan.doc().steps.map(async (s) => (await repo.find(s.sessionUrl)).doc()))

    expect(w.config.model).toBe(DEFAULT_TIER_MODELS.deep)
    expect(h.config.model).toBe(DEFAULT_TIER_MODELS.standard)
    expect(w.config.params.maxTokens).toBe(4000)
    expect(w.tools).toEqual({ enabled: ["doc_read", "doc_edit"] })
    expect(h.tools).toEqual({ disabled: WORKFLOW_TOOL_IDS })
    expect(w.grants).toEqual({ "files@*": "session" })
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
    ["thinking", session({ status: STATUS.running, turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["waiting on a person", session({ status: STATUS.awaitingApproval, turns: [makeTurn("user", [textBlock("go")])] }), "running"],
    ["answered", session({ turns: [makeTurn("user", [textBlock("go")]), makeTurn("assistant", [textBlock("done it")])] }), "done"],
    ["broke", session({ status: STATUS.error }), "failed"],
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
    expect(await ids({ config: { workflows: { enabled: true } }, tools: { disabled: WORKFLOW_TOOL_IDS } })).not.toContain("workflow_start")
  })

  it("a worker step gets only tools that run without the page", async () => {
    const worker = BUILTIN_TOOLS.filter((t) => t.where === "worker" && !WORKFLOW_TOOL_IDS.includes(t.id)).map((t) => t.id)
    const got = await ids({ config: {}, tools: { enabled: worker } })
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
    const scoped = scopedRepo(repo, plan, { stepId: "r" })
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
    return { plan, folder, driver, links, unwritten }
  }

  const cases = []
  const grow = (prefix) => {
    cases.push([prefix.join(",") || "empty", prefix])
    if (prefix.length < 3) for (const state of ["unfiled", "filed", "half", "unwritten"]) grow([...prefix, state])
  }
  grow([])

  it.each(cases)("ledger %s: filing leaves the folder equal to what the ledger describes, and a second pass writes nothing", async (_name, states) => {
    const { plan, folder, driver, links, unwritten } = await ledgerOf(states)
    const asSet = (docs) => docs.map((d) => `${d.name} ${d.type} ${d.url}`).sort()
    const described = () => Object.entries(plan.doc().sources).filter(([, e]) => e.what != null).map(([id]) => id).sort()
    await driver.fileSources()
    expect(asSet(folder.doc().docs)).toEqual(asSet(links))
    expect(Object.keys(plan.doc().sourcesFiled).sort()).toEqual(described())

    const before = [plan.heads(), folder.heads()]
    await driver.fileSources()
    expect([plan.heads(), folder.heads()]).toEqual(before)

    // Once something is written into what was unwritten, the next pass files it.
    if (!unwritten.length) return
    const late = unwritten.map((describe) => describe())
    await driver.fileSources()
    expect(asSet(folder.doc().docs)).toEqual(asSet([...links, ...late]))
    expect(Object.keys(plan.doc().sourcesFiled).sort()).toEqual(Object.keys(plan.doc().sources).sort())
  })

  // A document of a package's own datatype — a web-snapshot a research step
  // captured — is described by that type and filed as it, so the folder opens
  // it in its own view; a file is filed as a file.
  it.each([
    ["web-snapshot", { "@patchwork": { type: "web-snapshot" }, title: "Cells", source: "https://site.test/cells", text: "Cells" }, "web-snapshot", "Cells"],
    ["file", { "@patchwork": { type: "file" }, name: "cells.md", role: "extract", source: "https://site.test/cells", content: "Cells" }, "extract", "cells.md"],
    ["untyped", { name: "cells.md", role: "extract", content: "Cells" }, "extract", "cells.md"],
  ])("files a %s as its own datatype", async (type, value, what, name) => {
    const { plan, folder, driver } = await ledgerOf([])
    const made = await scopedRepo(driver.repo, plan, { stepId: "r" }).create2()
    made.change((d) => Object.assign(d, value))
    expect(plan.doc().sources[made.documentId]).toMatchObject({ kind: "source", what, type: type === "untyped" ? "file" : type, name })
    await driver.fileSources()
    expect(folder.doc().docs).toEqual([{ name, type: type === "untyped" ? "file" : type, url: stringifyAutomergeUrl({ documentId: made.documentId, heads: made.heads() }) }])
  })

  // A search's results page is the record of how a step found what it read,
  // not a source a reviewer checks a claim against: kept, never filed.
  it("keeps a search's results page out of the folder, and does not try again", async () => {
    const { plan, folder, driver } = await ledgerOf([])
    const scoped = scopedRepo(driver.repo, plan, { stepId: "r" })
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
    const { plan, folder, driver } = await ledgerOf([])
    const made = await scopedRepo(driver.repo, plan, { stepId: "r" }).create2()
    made.change((d) => Object.assign(d, { name: "x.md", role: "extract", content: "x" }))
    plan.change((d) => { d.sources[made.documentId].type = type })
    await driver.fileSources()
    expect(folder.doc().docs.map((entry) => entry.type)).toEqual(["file"])
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
    "ledger changed": (d) => { d.scope.ledgerUrl = "automerge:2j9knZ5d4NNxLrYGsbBHuYXu3Twz" },
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
  it("says what each kept and where to find it", () => {
    const plan = {
      title: "W",
      status: PLAN.running,
      sourcesFolderUrl: "automerge:folder",
      sources: {
        a: { kind: "source", what: "extract", by: "r" },
        b: { kind: "source", what: "pdf", by: "r" },
        c: { kind: "finding", what: "finding", by: "r" },
        d: { kind: "source", what: "file", by: "other" },
        e: { kind: "source", what: null, by: "r" }, // made, not yet written: not counted
      },
      steps: [{ ...step("r", { access: "web" }), status: STEP.done, result: "found", sessionUrl: "automerge:s" }],
    }
    const text = describeProgress(plan, plan.steps)
    expect(text).toContain("It kept 2 sources and 1 finding — Sources: automerge:folder")
    expect(text).toContain("The research steps have kept 3 sources and 1 finding — Sources: automerge:folder")
    expect(keptCounts(plan)).toEqual({ sources: 3, findings: 1 })
    expect(keptCounts(plan, "r")).toEqual({ sources: 2, findings: 1 })
  })
})
