import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { plugins } from "./index.js"

const tools = plugins.filter((p) => p.type === "agent:tool")
const source = readFileSync(join(process.cwd(), "src/agent-tools.js"), "utf8")

describe("plugin metadata", () => {
  it("is plain data apart from load()", () => {
    for (const plugin of plugins) {
      const { load, ...rest } = plugin
      expect(typeof load).toBe("function")
      expect(structuredClone(rest)).toEqual(rest)
    }
  })

  it("every tool input the executors read is declared, with a description", () => {
    const declared = new Set()
    const entryFields = new Set()
    for (const tool of tools) {
      for (const [key, schema] of Object.entries(tool.input_schema.properties)) {
        declared.add(key)
        expect(schema.description, `${tool.id}.${key}`).toBeTruthy()
      }
    }
    const set = tools.find((t) => t.id === "assumptions_set")
    for (const [key, schema] of Object.entries(set.input_schema.properties.entries.items.properties)) {
      entryFields.add(key)
      expect(schema.description, `entries.${key}`).toBeTruthy()
    }
    const read = (pattern) => new Set([...source.matchAll(pattern)].map((m) => m[1]))
    for (const key of read(/\binput\.(\w+)/g)) expect(declared, `input.${key}`).toContain(key)
    for (const key of read(/\braw\.(\w+)/g)) expect(entryFields, `entries[].${key}`).toContain(key)
    for (const key of read(/pick\("(\w+)"\)/g)) expect(entryFields, `entries[].${key}`).toContain(key)
  })

  it("each tool loads an executor", async () => {
    for (const tool of tools) expect(typeof (await tool.load()).execute).toBe("function")
  })

  it("the skill names only tools this package provides", async () => {
    const skill = plugins.find((p) => p.type === "patchwork:skill")
    const { documentation } = await skill.load()
    const ids = new Set(tools.map((t) => t.id))
    for (const [name] of documentation.matchAll(/\bassumptions_\w+/g)) expect(ids, name).toContain(name)
  })
})
