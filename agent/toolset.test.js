/**
 * What tools a session gets is decided in one place, the runner's `prepare`,
 * from the session document: a research step's scope gives it exactly its
 * scoped toolset whatever else the session says, and every other session gets
 * what its tool list allows, never a research step's own tools.
 *
 * A research step's scoped toolset is the built-ins in SCOPED_TOOL_IDS, then
 * the plugins of this runner's registry that declare `scoped: true`: the
 * rule, over every kind of plugin a registry can hold, and what an admitted
 * plugin is handed when it runs — the confined context, exactly.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner } from "./kernel/runner.js"
import { memoryStore, handleStore } from "./kernel/store.js"
import { initSession } from "./session/schema.js"
import { makeTurn, textBlock } from "./session/blocks.js"
import { makeMock } from "./providers/mock.js"
import { initPlan, WORKFLOW_TOOL_IDS, STEP_TOOL_IDS } from "./workflow/plan.js"
import { buildToolset, loadPluginTools, BUILTIN_TOOLS, SCOPED_VARIANTS } from "./tools/index.js"
import { SCOPED_TOOL_IDS, UNDECLARED_MID_RUN, scopedToolset, admitScoped, webScope } from "./kernel/scope.js"

await initSubduction()

const BUILTIN_IDS = BUILTIN_TOOLS.map((t) => t.id)
/** The two tools for one kind of session only, named here rather than taken from the registry's own lists. */
const RESEARCH_ONLY = "finding_write"
const FULL_ONLY = "source_file"
/** What a research step's context holds (kernel/scope.js confine), written out. */
const CONFINED = ["direct", "events", "fetchImpl", "reader", "repo", "scope", "search", "signal"]

/** What a research step's tool list said before scopes decided it. */
const OLD_WEB_IDS = ["web_search", "web_fetch", "http_request", "source_read", "source_list", "session_recall"]

/** A plugin registry with one tool of its own and one that takes a built-in's name. */
const registry = (colliding) => {
  const ids = ["extra_tool", ...(colliding ? ["web_fetch"] : [])]
  return {
    all: () => ids.map((id) => ({ id, name: id, description: "", where: "worker", risk: "read" })),
    load: async (id) => ({ id, module: { execute: () => `plugin ${id}` } }),
  }
}

/** The rule, written out: what a full session with this list gets. */
function expectedFull(enabled, disabled) {
  const pool = [...BUILTIN_IDS, "extra_tool"]
  const listed = Array.isArray(enabled) ? pool.filter((id) => enabled.includes(id)) : pool
  // Not a step here, so not the step's tool either.
  return listed.filter((id) => !disabled.includes(id) && id !== RESEARCH_ONLY && !WORKFLOW_TOOL_IDS.includes(id) && !STEP_TOOL_IDS.includes(id))
}

const repo = new Repo({ network: [] })
const plan = repo.create({})
plan.change((d) => initPlan(d, { title: "P", goal: "G", steps: [{ id: "r", title: "R", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" }] }))

describe("the toolset a session gets", () => {
  const cases = []
  for (const scoped of [false, true]) {
    for (const [enabledName, enabled] of [["undefined", undefined], ["[]", []], ["old web ids", OLD_WEB_IDS], ["all", BUILTIN_IDS], ["the research-only tool", [RESEARCH_ONLY]]]) {
      for (const [disabledName, disabled] of [["[]", []], ["web ids", OLD_WEB_IDS]]) {
        for (const colliding of [false, true]) cases.push([scoped, enabledName, disabledName, colliding, enabled, disabled])
      }
    }
  }

  it.each(cases)("scoped %s · enabled %s · disabled %s · colliding plugin %s", async (scoped, _e, _d, colliding, enabled, disabled) => {
    const doc = {}
    // Workflows off, so the rule below need not say what the switch adds.
    initSession(doc, { config: { workflows: { enabled: false } } })
    doc.tools = { ...(enabled === undefined ? {} : { enabled }), disabled }
    if (scoped) {
      doc.scope = webScope(plan.url, "r")
      doc.workflow = { planUrl: plan.url, stepId: "r" }
    }
    let built = 0
    const runner = new SessionRunner({
      store: memoryStore(doc),
      ctx: { repo },
      buildToolset: async (d) => (built++, buildToolset(d, { registry: registry(colliding) })),
      getProvider: async () => null,
    })
    const { toolset, ctx } = await runner.prepare(doc)
    const ids = toolset.tools.map((t) => t.id)

    if (scoped) {
      // Exactly the scoped set, each the built-in itself or its scoped
      // variant, frozen, and plugins never consulted.
      expect(ids).toEqual(SCOPED_TOOL_IDS)
      for (const tool of toolset.tools) expect(tool).toBe(SCOPED_VARIANTS[tool.id] ?? BUILTIN_TOOLS.find((t) => t.id === tool.id))
      expect(Object.isFrozen(toolset.tools)).toBe(true)
      expect(built).toBe(0)
      expect(Object.keys(ctx).sort()).toEqual(CONFINED)
    } else {
      expect([...ids].sort()).toEqual(expectedFull(enabled, disabled).sort())
      // The built-in, not the plugin that took its name.
      if (ids.includes("web_fetch")) expect(toolset.get("web_fetch")).toBe(BUILTIN_TOOLS.find((t) => t.id === "web_fetch"))
    }
    // A research step always has finding_write and never source_file; any
    // other session never has finding_write, whatever its list says.
    expect(ids.includes(RESEARCH_ONLY)).toBe(scoped)
    if (scoped) expect(ids).not.toContain(FULL_ONLY)
  })

  it("the scoped set has the research-only tool and not the full-only one", async () => {
    expect(SCOPED_TOOL_IDS).toContain(RESEARCH_ONLY)
    expect(SCOPED_TOOL_IDS).not.toContain(FULL_ONLY)
    expect((await scopedToolset()).tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
  })
})

describe("the plugins a research step admits", () => {
  /**
   * Every kind of plugin a registry can hold, by what it declares. The rule,
   * written out: admitted iff it declares `scoped` as exactly true, is a
   * worker tool, and takes no built-in's id.
   */
  const KINDS = [
    ["declared", { id: "declared_tool", where: "worker", scoped: true }, true],
    ["undeclared", { id: "plain_tool", where: "worker" }, false],
    ["declared false", { id: "false_tool", where: "worker", scoped: false }, false],
    ["declared as a string", { id: "string_tool", where: "worker", scoped: "true" }, false],
    ["declared, but taking a built-in's id", { id: "web_fetch", where: "worker", scoped: true }, false],
    ["declared, but a research step's own built-in's id", { id: "finding_write", where: "worker", scoped: true }, false],
    ["declared, but a full session's built-in's id", { id: "source_file", where: "worker", scoped: true }, false],
    ["declared, but needing the page", { id: "host_tool", where: "host", scoped: true }, false],
    ["declared, but needing a task runner", { id: "task_tool", where: "task", scoped: true }, false],
  ]
  /**
   * A registry as Patchwork's is: one plugin per id, so that registering an
   * id again replaces what was there, and `load` giving the plugin's
   * metadata with its module.
   */
  const registryOf = (entries, seen = []) => {
    const plugins = new Map()
    const register = (meta) => plugins.set(meta.id, { name: meta.id, description: "", risk: "read", ...meta })
    entries.forEach(register)
    return {
      register,
      all: () => [...plugins.values()],
      load: async (id) => {
        const meta = plugins.get(id)
        if (!meta) return undefined
        const execute = (input, ctx) => {
          seen.push({ id, keys: Object.keys(ctx).sort(), ctx, by: meta.by ?? null })
          return `ran ${id}`
        }
        return { ...meta, module: { execute } }
      },
    }
  }

  it.each(KINDS)("%s → admitted %s", async (_, meta, admitted) => {
    const plugins = await loadPluginTools({ registry: registryOf([meta]) })
    const ids = (await scopedToolset({ plugins })).tools.map((t) => t.id)
    expect(ids).toEqual(admitted ? [...SCOPED_TOOL_IDS, meta.id] : SCOPED_TOOL_IDS)
    // The built-ins are still the built-ins themselves, never a plugin by their name.
    const toolset = await scopedToolset({ plugins })
    for (const id of SCOPED_TOOL_IDS) expect(toolset.get(id)).toBe(SCOPED_VARIANTS[id] ?? BUILTIN_TOOLS.find((t) => t.id === id))
    expect(Object.isFrozen(toolset.tools)).toBe(true)
  })

  it("admits every declared plugin of a registry that holds all of them, and nothing else", async () => {
    const plugins = await loadPluginTools({ registry: registryOf(KINDS.map(([, meta]) => meta)) })
    expect((await admitScoped(plugins)).map((t) => t.id)).toEqual(["declared_tool"])
  })

  it("checks the declaration again at every call, on the plugin about to run", async () => {
    const seen = []
    const registry = registryOf([KINDS[0][1]], seen)
    const tool = (await scopedToolset({ plugins: await loadPluginTools({ registry }) })).get("declared_tool")
    expect(await tool.execute({}, {})).toBe("ran declared_tool")
    // Another package registers the id during the run: what was admitted is
    // gone, and what is there now runs only if it declares too. Every kind
    // of plugin in KINDS that does not declare is refused at the call.
    for (const [, meta] of KINDS) {
      if (meta.scoped === true && meta.where === "worker") continue
      registry.register({ ...meta, id: "declared_tool", by: "other" })
      await expect(tool.execute({}, {}), meta.id).rejects.toThrow(UNDECLARED_MID_RUN)
    }
    registry.register({ ...KINDS[0][1], by: "other" })
    expect(await tool.execute({}, {})).toBe("ran declared_tool")
    expect(seen.map((s) => s.by)).toEqual([null, "other"])
  })

  it("admits nothing from a runner with no registry: a worker's or node's research steps get the built-ins", async () => {
    const doc = {}
    initSession(doc, {})
    doc.scope = webScope(plan.url, "r")
    doc.workflow = { planUrl: plan.url, stepId: "r" }
    const runner = new SessionRunner({ store: memoryStore(doc), ctx: { repo }, buildToolset: async () => null, getProvider: async () => null })
    expect((await runner.prepare(doc)).toolset.tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
    // And a registry that fails to load is no plugins, not no run.
    const failing = new SessionRunner({ store: memoryStore(doc), ctx: { repo }, pluginTools: async () => { throw new Error("no registry") }, buildToolset: async () => null, getProvider: async () => null })
    expect((await failing.prepare(doc)).toolset.tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
  })

  it("decides per run, from the runner's registry as it is then", async () => {
    const doc = {}
    initSession(doc, {})
    doc.scope = webScope(plan.url, "r")
    doc.workflow = { planUrl: plan.url, stepId: "r" }
    let entries = [KINDS[1][1]]
    let asked = 0
    const runner = new SessionRunner({
      store: memoryStore(doc),
      ctx: { repo },
      pluginTools: () => (asked++, loadPluginTools({ registry: registryOf(entries) })),
      buildToolset: async () => null,
      getProvider: async () => null,
    })
    expect((await runner.prepare(doc)).toolset.tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
    entries = [KINDS[0][1]]
    expect((await runner.prepare(doc)).toolset.tools.map((t) => t.id)).toEqual([...SCOPED_TOOL_IDS, "declared_tool"])
    expect(asked).toBe(2)
  })

  it("an admitted plugin is handed the confined context exactly, in a real run, with everything of the person's left out", async () => {
    const sessionRepo = new Repo({ network: [] })
    const stepPlan = sessionRepo.create({})
    stepPlan.change((d) => initPlan(d, { title: "P", goal: "G", steps: [{ id: "r", title: "R", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" }] }))
    const handle = sessionRepo.create({})
    handle.change((d) => {
      initSession(d, {})
      d.scope = webScope(stepPlan.url, "r")
      d.workflow = { planUrl: stepPlan.url, stepId: "r" }
      d.turns.push(makeTurn("user", [textBlock("research")]))
    })
    const seen = []
    const provider = makeMock([[{ type: "call", id: "c1", name: "declared_tool", input: {} }], [{ type: "text", delta: "done" }]])
    const fetchImpl = Object.assign(async () => null, { policy: { deny: [], direct: false, dns: false } })
    const runner = new SessionRunner({
      store: handleStore(handle),
      // A runner's context with things of the person's in it, none of which the plugin may see.
      ctx: { repo: sessionRepo, fetchImpl, reader: "https://reader.test/", direct: false, subject: "automerge:subject", rootFolderUrl: "automerge:root", sessionUrl: handle.url, element: {}, startStepSession: () => null },
      pluginTools: () => loadPluginTools({ registry: registryOf(KINDS.map(([, meta]) => meta), seen) }),
      buildToolset: async () => null,
      getProvider: async () => provider,
      canRun: () => true,
    })
    await runner.tick()
    // The model was offered the admitted plugin, and only that one.
    const offered = provider.requests[0].tools.map((t) => t.id ?? t.name)
    expect(offered.filter((id) => !SCOPED_TOOL_IDS.includes(id))).toEqual(["declared_tool"])
    // It ran with what every research tool runs with: the confined context
    // (CONFINED), and what the loop adds to every call — the transcript
    // reader, and which tool ids the session has (nothing of the person's).
    expect(seen.map((s) => [s.id, s.keys])).toEqual([["declared_tool", [...CONFINED, "hasTool", "recall"].sort()]])
    expect(seen[0].ctx.fetchImpl).toBe(fetchImpl)
    expect(seen[0].ctx.repo).not.toBe(sessionRepo)
    expect(Object.keys(seen[0].ctx.repo).sort()).toEqual(["create2", "find", "sources"])
  })
})

describe("a research step's http_request", () => {
  const variant = SCOPED_VARIANTS.http_request
  // [method, body] → refused before any request? The rule: GET or HEAD, no body.
  const cases = []
  for (const method of [undefined, "GET", "get", "HEAD", "POST", "PUT", "DELETE"]) {
    for (const body of [undefined, "x"]) {
      const allowed = ["GET", "HEAD"].includes(String(method ?? "GET").toUpperCase()) && body === undefined
      cases.push([method, body, allowed])
    }
  }
  it.each(cases)("method %s, body %s → sent %s", async (method, body, allowed) => {
    const sent = []
    const fetchImpl = async (url, init) => {
      sent.push(init.method)
      return { ok: true, status: 204, statusText: "No Content", url, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const attempt = variant.execute({ url: "https://api.test/x", method, body }, { fetchImpl })
    if (allowed) {
      await attempt
      expect(sent).toEqual([String(method ?? "GET").toUpperCase()])
    } else {
      await expect(attempt).rejects.toThrow(/research step/)
      expect(sent).toEqual([])
    }
  })

  it("never asks, and offers no body", () => {
    expect(variant.alwaysAsk).toBe(false)
    expect(Object.keys(variant.input_schema.properties)).not.toContain("body")
    expect(variant.input_schema.properties.method.enum).toEqual(["GET", "HEAD"])
  })
})

describe("the modules a research step's tools are made of", () => {
  // Everything a scoped tool runs, and nothing in it that reaches past its
  // context: the page's globals, the platform's fetch, or the host's modules.
  const MODULES = ["kernel/scope.js", "tools/web.js", "tools/http.js", "tools/read-source.js", "tools/findings.js", "tools/recall.js", "tools/sources.js", "net/guard.js", "documents/format.js"]
  it.each(MODULES)("%s uses no globalThis, no bare fetch( and no hostImport", (file) => {
    const code = readFileSync(join(import.meta.dirname, file), "utf8")
    expect(code).not.toMatch(/globalThis/)
    expect(code).not.toMatch(/(^|[^.\w])fetch\(/m)
    expect(code).not.toMatch(/hostImport/)
  })
})
