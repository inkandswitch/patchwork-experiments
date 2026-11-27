import { describe, it, expect } from "vitest"
import { loadPluginTools } from "./plugins.js"
import { runTool } from "../kernel/tool.js"
import { buildToolset } from "./toolset.js"
import { BUILTIN_TOOLS } from "./builtin.js"
import { waits } from "../fixtures/asking.js"
import { initSession } from "../session/schema.js"
import { recordArtifact } from "../session/made.js"
import { keptSources } from "../tools/sources.js"
import { SCOPED_TOOL_IDS, researchToolset, FULL_TOOLS } from "../fixtures/tool-ids.js"

/** A registry that hands out whatever module is current, as Patchwork's does after a re-register. */
function fakeRegistry(id) {
  const state = { module: { execute: () => "stub" } }
  return {
    state,
    all: () => [{ id, name: id, description: "", where: "worker", risk: "write" }],
    load: async () => ({ id, module: state.module }),
  }
}

describe("agent:tool plugins", () => {
  it("run the package's current code, not the code the run started with", async () => {
    // A run builds its toolset once. When the agent rewrote a tool's executor
    // mid-run and called it, it got the stub back every time.
    const registry = fakeRegistry("lm_eval")
    const [tool] = await loadPluginTools({ registry })
    expect((await runTool(tool, {}, {})).output).toBe("stub")

    registry.state.module = { execute: () => "real" }
    expect((await runTool(tool, {}, {})).output).toBe("real")
  })

  it("report a reload that broke the tool instead of running the old version", async () => {
    const registry = fakeRegistry("lm_eval")
    const [tool] = await loadPluginTools({ registry })

    registry.state.module = {}
    const result = await runTool(tool, {}, {})
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/no longer provides an execute function/)

    registry.load = async () => {
      throw new Error("SyntaxError in agent.js")
    }
    expect((await runTool(tool, {}, {})).output).toBe("Error: The code of lm_eval did not load here: SyntaxError in agent.js")
  })

  it("are offered as declared when their code does not load here, and a call to one fails saying so", async () => {
    const registry = {
      all: () => [{ id: "needs_dom", where: "host", risk: "read" }, { id: "broken", where: "worker", risk: "read" }],
      load: async (id) => {
        throw new ReferenceError(`document is not defined (${id})`)
      },
    }
    const tools = await loadPluginTools({ registry })
    expect(tools.map((t) => [t.id, t.where, t.risk])).toEqual([["needs_dom", "host", "read"], ["broken", "worker", "read"]])
    expect(await runTool(tools[1], {}, {})).toMatchObject({ isError: true, output: "Error: The code of broken did not load here: document is not defined (broken)" })
  })
})

describe("a plugin cannot take a built-in's name", () => {
  const registryOf = (ids) => ({
    all: () => ids.map((id) => ({ id, name: id, description: "", where: "worker", risk: "read" })),
    load: async (id) => ({ id, module: { execute: () => `plugin ${id}` } }),
  })

  it("drops a colliding plugin, says so, and keeps the built-in", async () => {
    const errors = []
    const tools = await loadPluginTools({ registry: registryOf(["web_fetch", "lm_eval"]), onError: (id, err) => errors.push([id, err.message]) })
    expect(tools.map((t) => t.id)).toEqual(["lm_eval"])
    expect(errors).toEqual([["web_fetch", "'web_fetch' is a built-in tool; a plugin cannot replace it."]])

    const toolset = await buildToolset({}, { registry: registryOf(["web_fetch", "lm_eval"]) })
    expect(toolset.get("web_fetch")).toBe(BUILTIN_TOOLS.find((t) => t.id === "web_fetch"))
    expect(toolset.tools.filter((t) => t.id === "web_fetch")).toHaveLength(1)
  })
})

describe("what a session's tool list means", () => {
  const ids = async (tools) => (await buildToolset({ config: {}, tools }, { skipPlugins: true })).tools.map((t) => t.id)
  // Everything but the workflow tools (off unless switched on) and what only a
  // research step may have.
  const everyBuiltin = FULL_TOOLS.map((t) => t.id).filter((id) => !id.startsWith("workflow_") && id !== "finding_write")

  it.each([
    ["no list", undefined, everyBuiltin],
    ["no enabled list", {}, everyBuiltin],
    ["an empty list", { enabled: [] }, []],
    ["a list", { enabled: ["doc_read", "web_fetch"] }, ["doc_read", "web_fetch"]],
    ["a list with a name that is not a tool", { enabled: ["doc_read", "no_such_tool"] }, ["doc_read"]],
    ["a list, less what is disabled", { enabled: ["doc_read", "web_fetch"], disabled: ["web_fetch"] }, ["doc_read"]],
  ])("%s", async (_, tools, expected) => {
    expect((await ids(tools)).sort()).toEqual([...expected].sort())
  })

  it("never gives a session what only a research step may have, even when its list names it", async () => {
    expect(await ids({ enabled: ["finding_write"] })).toEqual([])
  })
})

/**
 * The Web snapshot package hands the agent web_capture as a plugin. Its
 * metadata is restated here from that package's index.js (the agent cannot
 * import another package): what matters on this side is that it loads like
 * any plugin, carries its `scoped` declaration, is asked about like the web,
 * and runs with the context it is handed.
 */
describe("the Web snapshot package's web_capture", () => {
  const WEB_CAPTURE = { id: "web_capture", name: "Keep a web page", description: "Keep a web page as it looks…", where: "worker", risk: "external", scoped: true, group: "web", groupCovers: "every web fetch, capture, search and plain GET in this session", input_schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } }
  const seen = []
  const modules = {
    web_capture: {
      execute: (input, ctx) => {
        seen.push(ctx)
        return { text: "Captured 'Cells'…", doc: { url: "automerge:snap", name: "Cells", kind: "source", source: input.url, engine: "reader-dom", chars: 5, at: 1, what: "web-snapshot" } }
      },
      summarize: () => "captured site.test",
    },
  }
  const registry = { all: () => [WEB_CAPTURE], load: async (id) => ({ id, module: modules[id] }) }

  it("is not a built-in, and loads as a plugin with its own tier, risk and declaration", async () => {
    expect(BUILTIN_TOOLS.map((t) => t.id)).not.toContain("web_capture")
    expect(SCOPED_TOOL_IDS).not.toContain("web_capture")
    const tools = await loadPluginTools({ registry })
    expect(tools.map((t) => [t.id, t.where, t.risk, t.scoped])).toEqual([["web_capture", "worker", "external", true]])
  })

  it("is asked about and granted with the rest of the web", async () => {
    const [capture] = await loadPluginTools({ registry })
    expect(capture.group).toBe("web")
    const input = { url: "https://site.test/page" }
    expect(waits({ grants: {} }, capture, input)).toBe(true)
    expect(waits({ grants: { "web@*": true } }, capture, input)).toBe(false)
    expect(waits({ grants: { "web@https://site.test/": true } }, capture, input)).toBe(false)
    expect(waits({ grants: { "web@https://other.test/": true } }, capture, input)).toBe(true)
  })

  it("runs with the context it is handed, guarded fetch and session included", async () => {
    const [capture] = await loadPluginTools({ registry })
    const fetchImpl = Object.assign(async () => null, { policy: { deny: [], direct: false, dns: false } })
    const ctx = { fetchImpl, session: { doc: () => ({ made: [] }) } }
    seen.length = 0
    const result = await runTool(capture, { url: "https://site.test/page" }, ctx)
    expect(seen[0]).toBe(ctx)
    expect(seen[0].fetchImpl).toBe(fetchImpl)
    expect([result.summary, result.doc.what]).toEqual(["captured site.test", "web-snapshot"])
  })

  it("a snapshot it returns is recorded with what it is, so the next capture of the page finds it", () => {
    const doc = {}
    initSession(doc, {})
    recordArtifact(doc, { url: "automerge:snap", name: "Cells", kind: "source", source: "https://site.test/page", engine: "reader-dom", chars: 5, at: 1, what: "web-snapshot" })
    expect(keptSources({ session: { doc: () => doc } })).toEqual([
      { url: "automerge:snap", name: "Cells", kind: "source", bytes: null, at: 1, source: "https://site.test/page", engine: "reader-dom", chars: 5, what: "web-snapshot" },
    ])
  })

  it("reaches a research step because it says it is scoped, and only then", async () => {
    const declared = await loadPluginTools({ registry })
    expect((await researchToolset({ plugins: declared })).tools.map((t) => t.id)).toEqual([...SCOPED_TOOL_IDS, "web_capture"])
    const undeclared = await loadPluginTools({ registry: { ...registry, all: () => [{ ...WEB_CAPTURE, scoped: undefined }] } })
    expect((await researchToolset({ plugins: undeclared })).tools.map((t) => t.id)).toEqual(SCOPED_TOOL_IDS)
  })
})
