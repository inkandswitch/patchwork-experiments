/**
 * A whole workflow, with real sessions and real runners; only the model is
 * scripted.
 *
 * The orchestrator calls workflow_start through the ordinary loop. Its steps
 * become sessions, each run by a SessionRunner on the step's own scripted
 * model; the third step waits for the first two and is handed what they found;
 * and when it is all over the orchestrator is woken with the results.
 */
import { describe, it, expect, afterEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner } from "../kernel/runner.js"
import { handleStore } from "../kernel/store.js"
import { createEvents } from "../kernel/events.js"
import { buildToolset } from "./toolset.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, STATUS } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { PLAN, STEP, DEFAULT_TIER_MODELS } from "../workflow/plan.js"
import { _resetDrivers } from "../workflow/driver.js"
import { guardedFetch } from "../net/guard.js"
import { BUILTIN_TOOLS } from "./builtin.js"
import { statusOf } from "../session/status.js"

await initSubduction()

const STEPS = [
  { id: "read-a", title: "Read A", prompt: "Read document A and list its problems.", where: "worker", tier: "fast", why: "reading only" },
  { id: "read-b", title: "Read B", prompt: "Read document B and list its problems.", where: "worker", tier: "fast", why: "reading only" },
  { id: "judge", title: "Judge", prompt: "Decide which problems matter.", where: "worker", tier: "deep", why: "judgement", after: ["read-a", "read-b"] },
]

/** Run a session on a scripted model: it answers from what its first message says. */
function runSession(handle, { provider, toolset = { tools: [], schemas: [], get: () => null }, ctx = {} }) {
  const store = handleStore(handle, A.splice)
  const runner = new SessionRunner({
    builtins: BUILTIN_TOOLS,
    store,
    ctx: { ...ctx, sessionUrl: handle.url },
    buildToolset: async (doc) => (typeof toolset === "function" ? toolset(doc) : toolset),
    getProvider: async () => provider,
    getKey: () => "test",
    canRun: () => true,
  })
  handle.on("change", () => runner.tick())
  runner.start()
  return { runner, store }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(25)
  }
  return false
}

const runners = []
afterEach(() => {
  for (const r of runners.splice(0)) r.stop()
  _resetDrivers()
})

describe("a workflow, end to end", () => {
  it("runs the steps as sessions in dependency order and wakes the orchestrator with the results", async () => {
    const repo = new Repo({ network: [] })

    // Each step's session gets a model that answers from its prompt; the judge
    // can only answer well if it was handed both readers' findings.
    const models = {}
    const stepSession = async (handle) => {
      const prompt = String(handle.doc().turns[0].blocks[0].text)
      const id = handle.doc().workflow.stepId
      models[id] = handle.doc().config.model
      const answer =
        id === "judge"
          ? `Judged: ${prompt.includes("A has a stale cache") && prompt.includes("B leaks a handle") ? "both matter" : "missing input"}`
          : id === "read-a" ? "A has a stale cache" : "B leaks a handle"
      // With the repo: a runner checks a step's session against its plan.
      const { runner } = runSession(handle, { provider: makeMock([[{ type: "text", delta: answer }]]), ctx: { repo } })
      runners.push(runner)
      return { runner, listen: () => {} }
    }

    // The orchestrator: starts the workflow, says so, and on being woken sums up.
    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { subject: "automerge:subject", config: { workflows: { enabled: true, parallel: 2 } } })
      d.turns.push(makeTurn("user", [textBlock("review A and B")]))
    })
    // After starting, it answers every wake; it may be woken more than once as
    // steps finish at different times, and only the last carries the end.
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "workflow_start", input: { title: "Review", goal: "Find what matters", steps: STEPS } }, { type: "stop", reason: "tool_use" }],
      [{ type: "text", delta: "Started; I will report back." }],
      ...Array.from({ length: 6 }, () => (request) => [
        { type: "text", delta: JSON.stringify(request.messages).includes("The workflow is over") ? "Both problems matter." : "Noted." },
      ]),
    ])
    const store = handleStore(orchestrator, A.splice)
    const events = createEvents(store, { policy: { settleMs: 10, maxDelayMs: 50, minGapMs: 0 } })
    const { runner } = runSession(orchestrator, {
      provider,
      toolset: (doc) => buildToolset(doc, { skipPlugins: true }),
      ctx: { repo, subject: "automerge:subject", events, startStepSession: stepSession },
    })
    runners.push(runner)

    // It ends its turn while the workflow runs...
    const made = () => orchestrator.doc().made?.find((m) => m.kind === "agent-workflow")
    expect(await until(() => made())).toBe(true)
    const planHandle = await repo.find(made().url)

    // ...the steps run, the judge after both readers, with what they found...
    expect(await until(() => planHandle.doc().status === PLAN.done)).toBe(true)
    const plan = planHandle.doc()
    expect(plan.steps.map((s) => s.status)).toEqual([STEP.done, STEP.done, STEP.done])
    expect(plan.steps[2].result).toBe("Judged: both matter")
    expect(plan.steps[2].startedAt).toBeGreaterThanOrEqual(Math.max(plan.steps[0].finishedAt, plan.steps[1].finishedAt))
    expect(models).toEqual({ "read-a": DEFAULT_TIER_MODELS.fast, "read-b": DEFAULT_TIER_MODELS.fast, judge: DEFAULT_TIER_MODELS.deep })

    // ...and the orchestrator is woken with the results and answers.
    const sawTheEnd = () => provider.requests.some((r) => JSON.stringify(r.messages).includes("The workflow is over"))
    expect(await until(() => sawTheEnd() && statusOf(orchestrator.doc()) === STATUS.idle)).toBe(true)
    const woke = provider.requests.slice(2).map((r) => JSON.stringify(r.messages)).join("\n")
    expect(woke).toContain("Judged: both matter")
    expect(await until(() => orchestrator.doc().turns.at(-1)?.blocks?.map((b) => b.text).join("") === "Both problems matter.")).toBe(true)
    const last = orchestrator.doc().turns.at(-1)
    expect(last.blocks.map((b) => b.text).join("")).toBe("Both problems matter.")

    // Every document the workflow made says what it is: Patchwork opens a
    // document by its type, and an untyped one is a dead end.
    const untyped = Object.values(repo.handles)
      .filter((h) => h.isReady?.() !== false && h.doc())
      .filter((h) => typeof h.doc()["@patchwork"]?.type !== "string")
      .map((h) => h.url)
    expect(untyped).toEqual([])
    events.stop()
  }, 20000)

  it("research steps keep what they fetch and what they learn, file it for the person, and read each other's", async () => {
    const repo = new Repo({ network: [] })
    const PAGE = "https://web.test/packs"
    const PAGE_TEXT = "Title: Pack options\n\n# Pack options\nLFP cells, 280 Ah"
    // The web, through a guard: a reader that answers every page the same way.
    const fetchImpl = guardedFetch({
      fetch: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/plain" : null) },
        arrayBuffer: async () => new TextEncoder().encode(PAGE_TEXT).buffer,
        text: async () => PAGE_TEXT,
      }),
      deny: ["https://patchwork.test"],
    })
    const keptUrl = (request) => JSON.stringify(request.messages).match(/automerge:[1-9A-HJ-NP-Za-km-z]+/)?.[0]

    const scripts = {
      // Fetches a page, writes down what it learned citing it, and reports.
      gather: () => makeMock([
        [{ type: "call", id: "f", name: "web_fetch", input: { url: PAGE } }],
        (request) => [{ type: "call", id: "w", name: "finding_write", input: { title: "Cells", text: "280 Ah LFP cells are the option.", cites: [keptUrl(request)] } }],
        [{ type: "text", delta: "Found the cells." }],
      ]),
      // Reads what the first step kept, without fetching anything.
      check: () => makeMock([
        [{ type: "call", id: "l", name: "source_list", input: { find: "280 Ah" } }],
        (request) => [{ type: "text", delta: JSON.stringify(request.messages).includes("appears in 2 of 2 kept sources") ? "Both kept things mention it." : "Could not see them." }],
      ]),
    }
    const stepSession = async (handle) => {
      const id = handle.doc().workflow.stepId
      const { runner } = runSession(handle, { provider: scripts[id](), ctx: { repo, fetchImpl, reader: "https://reader.test/" } })
      runners.push(runner)
      return { runner, listen: () => {} }
    }

    const orchestrator = repo.create({})
    orchestrator.change((d) => {
      initSession(d, { config: { workflows: { enabled: true } } })
      d.turns.push(makeTurn("user", [textBlock("find pack options")]))
    })
    const steps = [
      { id: "gather", title: "Gather", prompt: "Find pack options.", where: "worker", tier: "fast", why: "reading", access: "web" },
      { id: "check", title: "Check", prompt: "Check what was found.", where: "worker", tier: "fast", why: "reading", access: "web", after: ["gather"] },
    ]
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "workflow_start", input: { title: "Packs", goal: "Choose a pack", steps } }],
      ...Array.from({ length: 6 }, () => [{ type: "text", delta: "Noted." }]),
    ])
    const events = createEvents(handleStore(orchestrator, A.splice), { policy: { settleMs: 10, maxDelayMs: 50, minGapMs: 0 } })
    const { runner } = runSession(orchestrator, {
      provider,
      toolset: (doc) => buildToolset(doc, { skipPlugins: true }),
      ctx: { repo, events, startStepSession: stepSession },
    })
    runners.push(runner)

    const made = () => orchestrator.doc().made?.find((m) => m.kind === "agent-workflow")
    expect(await until(() => made())).toBe(true)
    const plan = await repo.find(made().url)
    expect(await until(() => plan.doc().status === PLAN.done)).toBe(true)
    expect(plan.doc().steps.map((s) => s.result)).toEqual(["Found the cells.", "Both kept things mention it."])

    // The plan's ledger, its one document of what research steps kept, has
    // the page and the finding, both the first step's...
    expect("sources" in plan.doc()).toBe(false)
    expect(Object.values(repo.handles).filter((h) => h.doc()?.["@patchwork"]?.type === "agent-ledger").map((h) => h.url)).toEqual([plan.doc().ledgerUrl])
    const ledger = Object.values((await repo.find(plan.doc().ledgerUrl)).doc().sources)
    expect(ledger.map((e) => [e.kind, e.what, e.by]).sort()).toEqual([["finding", "finding", "gather"], ["source", "extract", "gather"]])
    const finding = (await repo.find(ledger.find((e) => e.kind === "finding").url)).doc()
    expect(finding.cites).toEqual([ledger.find((e) => e.kind === "source").url])
    expect({ ...finding.by }).toEqual({ stepId: "gather" })
    // ...and they are filed in the Sources folder for the person.
    expect(await until(async () => (await repo.find(plan.doc().sourcesFolderUrl)).doc().docs.length === 2)).toBe(true)
    events.stop()
  }, 20000)

  it("refuses to start when the session's switch is off", async () => {
    const repo = new Repo({ network: [] })
    const session = repo.create({})
    session.change((d) => initSession(d, { config: { workflows: { enabled: false } } }))
    const { workflowStart } = await import("../workflow/tools.js")
    await expect(workflowStart.execute({ title: "T", goal: "G", steps: STEPS }, { session: { url: session.url, doc: () => session.doc() }, workflows: { repo } })).rejects.toThrow(/switched off/)
  })

  it("refuses a plan that cannot run, saying why", async () => {
    const repo = new Repo({ network: [] })
    const session = repo.create({})
    session.change((d) => initSession(d, { config: { workflows: { enabled: true } } }))
    const { workflowStart } = await import("../workflow/tools.js")
    const circular = [STEPS[0], { ...STEPS[1], after: ["judge"] }, STEPS[2]]
    await expect(workflowStart.execute({ title: "T", goal: "G", steps: circular }, { session: { url: session.url, doc: () => session.doc() }, workflows: { repo } })).rejects.toThrow(/in a circle/)
  })
})
