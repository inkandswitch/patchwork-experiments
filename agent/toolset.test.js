/**
 * What tools a session gets is decided in one place, the runner's `prepare`,
 * from the session document: a research step's scope gives it exactly its
 * scoped toolset whatever else the session says, and every other session gets
 * what its tool list allows, never a research step's own tools.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner } from "./runner.js"
import { memoryStore } from "./store.js"
import { initSession } from "./session.js"
import { initPlan, WORKFLOW_TOOL_IDS } from "./workflow/plan.js"
import { buildToolset, BUILTIN_TOOLS, SCOPED_VARIANTS } from "./tools/index.js"
import { SCOPED_TOOL_IDS, scopedToolset, webScope } from "./scope.js"

await initSubduction()

const BUILTIN_IDS = BUILTIN_TOOLS.map((t) => t.id)
/** The two tools for one kind of session only, named here rather than taken from the registry's own lists. */
const RESEARCH_ONLY = "finding_write"
const FULL_ONLY = "source_file"
/** What a research step's context holds (scope.js confine), written out. */
const CONFINED = ["direct", "events", "fetchImpl", "reader", "repo", "scope", "signal"]

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
  return listed.filter((id) => !disabled.includes(id) && id !== RESEARCH_ONLY && !WORKFLOW_TOOL_IDS.includes(id))
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
  const MODULES = ["scope.js", "tools/web.js", "tools/http.js", "tools/read-source.js", "tools/findings.js", "tools/recall.js", "tools/sources.js", "tools/guard.js", "tools/format.js"]
  it.each(MODULES)("%s uses no globalThis, no bare fetch( and no hostImport", (file) => {
    const code = readFileSync(join(import.meta.dirname, file), "utf8")
    expect(code).not.toMatch(/globalThis/)
    expect(code).not.toMatch(/(^|[^.\w])fetch\(/m)
    expect(code).not.toMatch(/hostImport/)
  })
})
