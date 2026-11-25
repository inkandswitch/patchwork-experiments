/**
 * Which tools a session placed somewhere gets, and where each call runs
 * (kernel/placement.js).
 *
 * The rule: a session's toolset is filtered by what each tool declared,
 * built-in or plugin alike — a worker step gets every tool declared "worker"
 * and none declared "host", a step on the page gets everything, a research
 * step gets its research built-ins and the plugins that declare `scoped:
 * true` on a worker. Checked over every kind of plugin a registry can hold,
 * from a tab's registry and from the SharedWorker's catalogue, where a plugin
 * whose code will not load is listed but runs in a tab.
 */
import { describe, it, expect } from "vitest"
import { buildToolset } from "./assembly/toolset.js"
import { loadPluginTools } from "./assembly/plugins.js"
import { BUILTIN_TOOLS } from "./assembly/builtin.js"
import { initPlan } from "./workflow/plan.js"
import { createPluginCatalogue } from "./runners/worker-plugins.js"
import { callNeeds, declaredWhere, fitsPlacement } from "./kernel/placement.js"
import { checkStepTools, namedIn, stepToolIds } from "./workflow/step-tools.js"
import { SessionRunner } from "./kernel/runner.js"
import { memoryStore } from "./kernel/store.js"
import { initSession } from "./session/schema.js"
import { makeTurn, textBlock } from "./session/blocks.js"
import { findCall } from "./session/calls.js"
import { makeMock } from "./providers/mock.js"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SCOPED_TOOL_IDS, WORKFLOW_TOOL_IDS, STEP_TOOL_IDS, researchToolset, FULL_TOOLS } from "./fixtures/tool-ids.js"

await initSubduction()
const repo = new Repo({ network: [] })
const plan = repo.create({})
plan.change((d) => initPlan(d, { title: "P", goal: "G", steps: [{ id: "s", title: "S", prompt: "p", why: "w", where: "worker", tier: "fast" }] }))

/** Every kind of plugin, by what it declares. */
const PLUGINS = [
  { id: "repo_tool", where: "worker", risk: "read" },
  { id: "page_tool", where: "host", risk: "read" },
  { id: "bare_tool", risk: "read" }, // no `where`: a worker tool
  { id: "scoped_tool", where: "worker", scoped: true, risk: "read" },
  { id: "scoped_page_tool", where: "host", scoped: true, risk: "read" },
]
const declared = (id) => PLUGINS.find((p) => p.id === id).where ?? "worker"

/** A tab's registry holding them. */
const registryOf = (entries) => ({
  all: () => entries,
  load: async (id) => ({ ...entries.find((e) => e.id === id), module: { execute: () => `ran ${id}` } }),
})

/** The SharedWorker's catalogue holding them; `broken` ids fail to load there. */
function catalogueOf(entries, broken = []) {
  const catalogue = createPluginCatalogue({
    importPlugin: async (d) => {
      if (broken.includes(d.id)) throw new Error(`Failed to resolve module specifier "@x/y"`)
      return { execute: () => `ran ${d.id} in the worker` }
    },
  })
  catalogue.set(entries.map((e) => ({ ...e, importUrl: `https://p.example/${e.id}/index.js` })))
  return catalogue
}

const ids = (toolset) => toolset.tools.map((t) => t.id)
const stepDoc = (tools) => ({ config: {}, workflow: { planUrl: "automerge:plan", stepId: "s" }, tools })
const WORKER_STEP = stepDoc({ where: "worker" })
const HOST_STEP = stepDoc(undefined)

/** The rule, written out over the built-ins and the plugins present. */
function expected(placement, present) {
  const builtins = FULL_TOOLS.filter((t) => !WORKFLOW_TOOL_IDS.includes(t.id))
    .filter((t) => placement !== "worker" || t.where === "worker")
    .map((t) => t.id)
  const plugins = present.filter((id) => placement !== "worker" || declared(id) === "worker")
  return [...builtins, ...plugins]
}

describe("the toolset a step gets", () => {
  const sources = [
    ["a tab's registry", async (entries) => () => loadPluginTools({ registry: registryOf(entries) })],
    ["the worker's catalogue", async (entries) => () => catalogueOf(entries).tools()],
    ["the worker's catalogue, nothing loading", async (entries) => () => catalogueOf(entries, entries.map((e) => e.id)).tools()],
  ]
  const presences = [["no plugins", []], ["one worker plugin", ["repo_tool"]], ["one page-only plugin", ["page_tool"]], ["every kind", PLUGINS.map((p) => p.id)]]

  for (const [source, make] of sources) {
    for (const [presence, present] of presences) {
      for (const [placement, doc] of [["worker", WORKER_STEP], ["host", HOST_STEP]]) {
        it(`on the ${placement}, ${presence}, from ${source}`, async () => {
          const plugins = await make(PLUGINS.filter((p) => present.includes(p.id)))
          const toolset = await buildToolset(doc, { plugins })
          expect(ids(toolset)).toEqual(expected(placement, present))
          // Every tool of a worker step was declared for a worker.
          if (placement === "worker") for (const tool of toolset.tools) expect(declaredWhere(tool)).toBe("worker")
        })
      }
    }
  }

  it("a session that is not placed gets every tool, as before", async () => {
    const plugins = () => loadPluginTools({ registry: registryOf(PLUGINS) })
    const got = ids(await buildToolset({ config: {} }, { plugins }))
    expect(got).toEqual(expect.arrayContaining(PLUGINS.map((p) => p.id)))
    expect(got).toContain("view_mount")
    expect(got).not.toContain(STEP_TOOL_IDS[0])
  })

  it("a worker step gets a package's tools — the Nootka step's assumptions_set among them", async () => {
    const assumptions = [
      { id: "assumptions_set", where: "worker", risk: "edit" },
      { id: "assumptions_export", where: "worker", risk: "read" },
    ]
    const got = ids(await buildToolset(WORKER_STEP, { plugins: () => loadPluginTools({ registry: registryOf(assumptions) }) }))
    expect(got).toEqual(expect.arrayContaining(["assumptions_set", "assumptions_export", "doc_edit", "workflow_request"]))
    expect(got).not.toContain("view_mount")
  })
})

describe("the toolset a research step gets", () => {
  // [source, broken] → admitted: scoped and declared for a worker, wherever it runs.
  it.each([
    ["a tab's registry", null],
    ["the worker's catalogue", []],
    ["the worker's catalogue, nothing loading", PLUGINS.map((p) => p.id)],
  ])("from %s: the research built-ins and scoped_tool alone", async (_, broken) => {
    const plugins = broken ? await catalogueOf(PLUGINS, broken).tools() : await loadPluginTools({ registry: registryOf(PLUGINS) })
    const toolset = await researchToolset({ plugins })
    expect(ids(toolset)).toEqual([...SCOPED_TOOL_IDS, "scoped_tool"])
  })

  it("a scoped plugin that cannot load in the worker is listed, and its calls go to a tab", async () => {
    const plugins = await catalogueOf(PLUGINS, ["scoped_tool"]).tools()
    const tool = (await researchToolset({ plugins })).get("scoped_tool")
    expect(tool.where).toBe("host")
    expect(callNeeds({ where: "worker" }, tool)).toBe("host")
  })

  it("one that loads runs in the worker", async () => {
    const tool = (await researchToolset({ plugins: await catalogueOf(PLUGINS).tools() })).get("scoped_tool")
    expect(tool.where).toBe("worker")
    expect(await tool.execute({}, {})).toBe("ran scoped_tool in the worker")
  })
})

describe("where a call runs", () => {
  // Every combination of what the recording runner wrote and what this runner's tool says.
  const tiers = [undefined, "worker", "host"]
  for (const recorded of tiers) {
    for (const here of tiers) {
      const want = recorded === "host" || here === "host" ? "host" : (here ?? recorded ?? "worker")
      it(`recorded ${recorded ?? "nothing"}, tool here ${here ?? "absent"} → ${want}`, () => {
        expect(callNeeds({ where: recorded }, here === undefined ? null : { where: here })).toBe(want)
      })
    }
  }

  it("fitsPlacement: only a worker placement filters, and only by the declaration", () => {
    for (const placement of [null, undefined, "worker"]) {
      for (const tool of [{ where: "worker" }, { where: "host" }, { where: "host", declared: "worker" }, {}]) {
        const want = placement !== "worker" || (tool.declared ?? tool.where ?? "worker") === "worker"
        expect(fitsPlacement(tool, placement)).toBe(want)
      }
    }
  })
})

describe("a step's prompt, checked before it starts", () => {
  // Every tool this page knows, as the driver is handed them.
  const installed = { builtins: BUILTIN_TOOLS, plugins: PLUGINS.map((p) => ({ id: p.id, where: p.where ?? "worker", scoped: p.scoped === true })) }
  const whereOf = (id) => [...installed.builtins, ...installed.plugins].find((t) => t.id === id).where
  const step = (where, access, prompt) => ({ id: "s", where, ...(access ? { access } : {}), prompt })

  // [what the prompt names, worker step, host step, research step]
  const NAMES = [
    ["nothing", "Summarise the battery datasheets.", null, null, null],
    ["a worker built-in", "Use doc_edit on the report.", null, null, "fail"],
    ["a page built-in", "Open it with view_mount and check it.", "host", null, "fail"],
    ["a worker plugin", "Record each value with repo_tool.", null, null, "fail"],
    ["a page-only plugin", "Draw it with page_tool.", "host", null, "fail"],
    ["a scoped plugin", "Keep the page with scoped_tool.", null, null, null],
    ["a research built-in", "Use web_search and finding_write.", null, null, null],
    ["the step's own tool", "If more is needed, use workflow_request.", null, null, null],
    ["an orchestrator's tool", "Then call workflow_start.", "fail", "fail", "fail"],
    ["a word that only looks like a tool", "Set cell_capacity and pack_voltage.", null, null, null],
    ["a tool's name inside a longer word", "Write a view_mounting note.", null, null, null],
  ]

  for (const [what, prompt, worker, host, web] of NAMES) {
    for (const [placement, access, want] of [["worker", null, worker], ["host", null, host], ["worker", "web", web]]) {
      it(`${access === "web" ? "a research step" : `a ${placement} step`} naming ${what} → ${want ?? "starts"}`, () => {
        const verdict = checkStepTools(step(placement, access, prompt), installed)
        if (want === null) expect(verdict).toBeNull()
        else if (want === "host") expect(verdict).toEqual({ where: "host", why: expect.stringMatching(/^Moved to the page: its prompt names .+/) })
        else expect(verdict).toEqual({ fail: expect.any(String) })
      })
    }
  }

  it("says which tools, and why", () => {
    expect(checkStepTools(step("worker", null, "view_mount, then view_interact"), installed).why).toBe("Moved to the page: its prompt names view_mount, view_interact, which need the page.")
    expect(checkStepTools(step("worker", "web", "read it with doc_read"), installed).fail).toMatch(/names doc_read, which a research step cannot have/)
  })

  it("a step that moved to the page then starts", () => {
    const moved = step("worker", null, "Open it with view_mount and page_tool.")
    const verdict = checkStepTools(moved, installed)
    expect(checkStepTools({ ...moved, where: verdict.where }, installed)).toBeNull()
  })

  it("what each kind of step gets, by the same rule the runners use", () => {
    const worker = stepToolIds(step("worker", null, ""), installed)
    expect([...worker].every((id) => whereOf(id) === "worker")).toBe(true)
    expect(worker.has("repo_tool") && !worker.has("page_tool") && !worker.has("workflow_start")).toBe(true)
    const web = stepToolIds(step("worker", "web", ""), installed)
    expect([...web].sort()).toEqual([...SCOPED_TOOL_IDS, "scoped_tool"].sort())
  })

  // The same kinds of tool, listed in the step's `tools` instead of named in
  // its prompt: [what, tools, worker step, host step, research step]. A
  // listed id is checked against what is installed, so a word that only looks
  // like a tool is no longer passed over: it is not installed.
  const LISTED = [
    ["nothing", [], null, null, null],
    ["a worker built-in", ["doc_edit"], null, null, "fail"],
    ["a page built-in", ["view_mount"], "host", null, "fail"],
    ["a worker plugin", ["repo_tool"], null, null, "fail"],
    ["a page-only plugin", ["page_tool"], "host", null, "fail"],
    ["a scoped plugin", ["scoped_tool"], null, null, null],
    ["a research step's own built-in", ["finding_write"], "fail", "fail", null],
    ["a research built-in both kinds get", ["web_search"], null, null, null],
    ["the step's own tool", ["workflow_request"], null, null, null],
    ["an orchestrator's tool", ["workflow_start"], "fail", "fail", "fail"],
    ["a tool no package provides", ["cell_capacity"], "fail", "fail", "fail"],
    ["an installed tool and a missing one", ["doc_read", "nope_tool"], "fail", "fail", "fail"],
  ]

  for (const [what, tools, worker, host, web] of LISTED) {
    for (const [placement, access, want] of [["worker", null, worker], ["host", null, host], ["worker", "web", web]]) {
      it(`${access === "web" ? "a research step" : `a ${placement} step`} listing ${what} → ${want ?? "starts"}`, () => {
        const verdict = checkStepTools({ ...step(placement, access, "Do the work."), tools }, installed)
        if (want === null) expect(verdict).toBeNull()
        else if (want === "host") expect(verdict).toEqual({ where: "host", why: expect.stringMatching(/^Moved to the page: it needs .+/) })
        else expect(verdict).toEqual({ fail: expect.any(String) })
      })
    }
  }

  it("a listed tool nothing provides is said first, as not installed", () => {
    const verdict = checkStepTools({ ...step("worker", null, "Open it with view_mount."), tools: ["view_mount", "cad_export", "nope_tool"] }, installed)
    expect(verdict.fail).toMatch(/^Not installed: cad_export, nope_tool\. /)
  })

  it("listed tools and prompt names count together", () => {
    const verdict = checkStepTools({ ...step("worker", null, "Then draw it with page_tool."), tools: ["view_mount"] }, installed)
    expect(verdict).toEqual({ where: "host", why: "Moved to the page: it needs view_mount, page_tool, which need the page." })
  })

  it("namedIn: whole words only", () => {
    expect(namedIn("use doc_read, then doc_reader", ["doc_read", "doc_reader", "doc_edit"])).toEqual(["doc_read", "doc_reader"])
    expect(namedIn("`view_mount`(x)", ["view_mount"])).toEqual(["view_mount"])
    expect(namedIn("view_mounted", ["view_mount"])).toEqual([])
    expect(namedIn("", ["view_mount"])).toEqual([])
  })
})

describe("a worker step calling a plugin the worker cannot load", () => {
  // The SharedWorker records the call as it sees the tool (host-tier, since
  // it will not load there); a tab — taking only host-tier work while the
  // worker is up — runs it with its own registry, where the tool is a worker
  // tool. And the other way round: a tab recorded it as a worker call, the
  // worker cannot run it, so it parks it as host-tier for the tab.
  function setup() {
    const doc = {}
    initSession(doc, {})
    doc.workflow = { planUrl: plan.url, stepId: "s" }
    doc.tools = { where: "worker" }
    doc.turns = [makeTurn("user", [textBlock("record the value")])]
    const store = memoryStore(doc)
    const ran = []
    const registry = {
      all: () => [{ id: "assumptions_set", where: "worker", risk: "edit" }],
      load: async (id) => ({ id, where: "worker", risk: "edit", module: { execute: (input, ctx) => (ran.push(ctx.runnerName), "set") } }),
    }
    const catalogue = createPluginCatalogue({ importPlugin: async () => { throw new Error("Failed to resolve module specifier") } })
    catalogue.set([{ id: "assumptions_set", where: "worker", risk: "edit", importUrl: "automerge:pkg#h" }])
    const runner = (name, plugins, canRun, provider) =>
      new SessionRunner({ store, runnerUrl: name, ctx: { repo, runnerName: name }, buildToolset: (d) => buildToolset(d, { plugins }), getProvider: async () => provider, canRun, confirmMs: 0 })
    return { store, ran, registry, catalogue, runner }
  }
  const callBlock = (store) => findCall(store.doc(), "c1")?.block

  it("recorded by the worker: it parks host-tier, and the tab runs it", async () => {
    const { store, ran, registry, catalogue, runner } = setup()
    const provider = makeMock([[{ type: "call", id: "c1", name: "assumptions_set", input: { register: "automerge:r" } }], [{ type: "text", delta: "done" }]])
    const worker = runner("worker", () => catalogue.tools(), (w) => w === "worker", provider)
    await worker.tick()
    // The model was offered the plugin in the worker, and the call waits for a tab.
    expect(provider.requests[0].tools.map((t) => t.id ?? t.name)).toContain("assumptions_set")
    expect(callBlock(store).where).toBe("host")
    expect(store.doc().status).toBe("parked")
    const tab = runner("tab", () => loadPluginTools({ registry }), (w) => w === "host", provider)
    await tab.tick()
    expect(ran).toEqual(["tab"])
    expect(store.doc().turns.at(-1).blocks[0].text).toBe("done")
  })

  it("recorded by a tab as a worker call: the worker parks it host-tier for the tab", async () => {
    const { store, ran, registry, catalogue, runner } = setup()
    // The tab records the call and stops at it: worker calls are the worker's while it is up.
    const provider = makeMock([[{ type: "call", id: "c1", name: "assumptions_set", input: {} }], [{ type: "text", delta: "done" }]])
    const tab = runner("tab", () => loadPluginTools({ registry }), (w) => w === "host", provider)
    await tab.tick()
    expect(callBlock(store).where).toBe("worker")
    const worker = runner("worker", () => catalogue.tools(), (w) => w === "worker", provider)
    await worker.tick()
    expect(callBlock(store).where).toBe("host")
    expect(ran).toEqual([])
    await tab.tick()
    expect(ran).toEqual(["tab"])
    expect(store.doc().turns.at(-1).blocks[0].text).toBe("done")
  })
})

describe("the driver, starting a step", () => {
  // A stand-in runner: it answers every step it is given, as a real one would leave the document.
  async function run(steps, { limits = {}, plugins = [] } = {}) {
    const { WorkflowDriver, _resetDrivers } = await import("./workflow/driver.js")
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => initPlan(d, { title: "W", goal: "G", limits, steps: steps.map((s) => ({ title: s.id, why: "test", where: "worker", tier: "fast", after: [], ...s })) }))
    const order = []
    const startSession = async (session) => {
      const doc = session.doc()
      if (!order.includes(doc.workflow.stepId)) {
        order.push(doc.workflow.stepId)
        session.change((d) => {
          d.turns.push(makeTurn("assistant", [textBlock(`result of ${d.workflow.stepId}`)]))
          d.status = "idle"
        })
      }
      return { runner: { interrupt() {} }, listen() {} }
    }
    const tools = async () => ({ builtins: BUILTIN_TOOLS, plugins })
    const driver = new WorkflowDriver({ repo, handle, startSession, tools, heartbeatMs: 1e9, confirmMs: 0 })
    driver.start()
    for (let i = 0; i < 20; i++) await driver.kick()
    driver.stop()
    _resetDrivers()
    const sessions = {}
    for (const s of handle.doc().steps) if (s.sessionUrl) sessions[s.id] = (await repo.find(s.sessionUrl)).doc()
    return { plan: handle.doc(), sessions, order }
  }

  it("a worker step's session is placed, not handed a list", async () => {
    const { sessions } = await run([{ id: "w", prompt: "Record the values." }])
    expect(sessions.w.tools).toEqual({ where: "worker" })
  })

  it("a worker step that names a tool needing the page moves there and runs, after the page is free", async () => {
    const { plan, sessions, order } = await run([
      { id: "h", where: "host", prompt: "Check the view." },
      { id: "w", prompt: "Open the hull with view_mount and measure it." },
    ])
    const w = plan.steps.find((s) => s.id === "w")
    expect([w.status, w.where, w.moved]).toEqual(["done", "host", "Moved to the page: its prompt names view_mount, which needs the page."])
    expect(sessions.w.tools).toBeUndefined()
    expect(order).toEqual(["h", "w"])
  })

  it("so does one naming a page-only plugin; one naming a worker plugin stays", async () => {
    const plugins = [{ id: "page_tool", where: "host" }, { id: "assumptions_set", where: "worker" }]
    const { plan } = await run([{ id: "p", prompt: "Draw it with page_tool." }, { id: "a", prompt: "Record each with assumptions_set." }], { plugins })
    expect(plan.steps.map((s) => [s.id, s.where, s.status])).toEqual([["p", "host", "done"], ["a", "worker", "done"]])
  })

  it("a step listing a tool no installed package provides fails at start, and gets no session", async () => {
    const { plan, sessions } = await run([{ id: "x", tools: ["doc_read", "cad_export"], prompt: "Export the hull." }, { id: "ok", prompt: "Summarise." }])
    const x = plan.steps.find((s) => s.id === "x")
    expect([x.status, x.error.split(".")[0]]).toEqual(["failed", "Not installed: cad_export"])
    expect(sessions.x).toBeUndefined()
    expect(plan.steps.find((s) => s.id === "ok").status).toBe("done")
  })

  it("a step's session is attached to the step's own document, else the workflow's; a research step's to none", async () => {
    const { sessions } = await run([
      { id: "own", subject: "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXq", prompt: "Write the report." },
      { id: "none", prompt: "Summarise." },
    ])
    expect(sessions.own.subject).toBe("automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXq")
    expect(sessions.none.subject).toBeNull()
  })

  it("a worker step listing a page-only plugin moves to the page and runs there", async () => {
    const { plan, sessions } = await run([{ id: "p", tools: ["page_tool"], prompt: "Draw it." }], { plugins: [{ id: "page_tool", where: "host" }] })
    const p = plan.steps.find((s) => s.id === "p")
    expect([p.status, p.where, p.moved]).toEqual(["done", "host", "Moved to the page: it needs page_tool, which needs the page."])
    expect(sessions.p.tools).toBeUndefined()
  })

  it("a research step naming a tool it cannot have fails at once, saying why, and gets no session", async () => {
    const { plan, sessions } = await run([{ id: "r", access: "web", prompt: "Read the register with doc_read, then search." }])
    const r = plan.steps.find((s) => s.id === "r")
    expect(r.status).toBe("failed")
    expect(r.error).toMatch(/names doc_read, which a research step cannot have/)
    expect(sessions.r).toBeUndefined()
  })
})
