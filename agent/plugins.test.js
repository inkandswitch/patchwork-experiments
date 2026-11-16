import { describe, it, expect } from "vitest"
import { loadPluginTools, runTool, buildToolset, BUILTIN_TOOLS } from "./tools/index.js"

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
    expect((await runTool(tool, {}, {})).output).toMatch(/SyntaxError in agent\.js/)
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
  const everyBuiltin = BUILTIN_TOOLS.map((t) => t.id).filter((id) => !id.startsWith("workflow_") && id !== "finding_write")

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
