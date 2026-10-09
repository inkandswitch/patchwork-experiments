import { describe, it, expect } from "vitest"
import { loadPluginTools, runTool } from "./tools/index.js"

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
