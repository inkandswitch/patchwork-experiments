import { describe, it, expect } from "vitest"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { toSchema } from "../kernel/tool.js"
import { BUILTIN_SKILLS } from "../knowledge/builtin-skills.js"
import { DEFAULT_SYSTEM } from "../kernel/loop.js"

/**
 * The tool descriptions ARE the documentation.
 *
 * Nothing else reaches the model: not the comments, not the README, not the
 * skills unless it goes and reads one. A parameter with no description is a
 * parameter the model has to guess at — which is not hypothetical, it is how
 * `root: "automerge:"` got sent and cost a turn.
 */
describe("every tool explains itself", () => {
  for (const tool of BUILTIN_TOOLS) {
    describe(tool.id, () => {
      it("has a description with something in it", () => {
        expect(tool.description?.length ?? 0, `${tool.id} description`).toBeGreaterThan(40)
      })

      it("documents every parameter", () => {
        const properties = tool.input_schema?.properties ?? {}
        const undocumented = Object.entries(properties)
          .filter(([, spec]) => !spec?.description?.trim())
          .map(([name]) => name)
        expect(undocumented, `${tool.id} has undocumented parameters`).toEqual([])
      })

      it("gives every parameter a type", () => {
        const properties = tool.input_schema?.properties ?? {}
        const untyped = Object.entries(properties)
          .filter(([, spec]) => !spec?.type && !spec?.oneOf)
          .map(([name]) => name)
        expect(untyped, `${tool.id} has untyped parameters`).toEqual([])
      })

      it("declares a risk the approval logic understands", () => {
        expect(["read", "self", "edit", "write", "external"]).toContain(tool.risk)
      })

      it("declares a tier", () => {
        expect(["worker", "host", "task"]).toContain(tool.where)
      })

      it("can summarize its own result", () => {
        // The transcript shows this on every call; falling back to the first
        // line of output renders a JSON result as the character "{".
        expect(typeof tool.summarize, `${tool.id}.summarize`).toBe("function")
      })

      it("says how its calls read in the transcript", () => {
        expect(tool.present, `${tool.id} has no \`present\``).toBeTruthy()
      })

      it("survives being turned into a schema for the model", () => {
        const schema = toSchema(tool)
        expect(schema.id).toBe(tool.id)
        expect(schema.description).toBeTruthy()
        expect(schema.input_schema.type).toBe("object")
      })
    })
  }

  it("names every required parameter in the schema's properties", () => {
    for (const tool of BUILTIN_TOOLS) {
      const properties = Object.keys(tool.input_schema?.properties ?? {})
      for (const name of tool.input_schema?.required ?? []) {
        expect(properties, `${tool.id} requires '${name}' but does not define it`).toContain(name)
      }
    }
  })
})

describe("the skills", () => {
  for (const skill of BUILTIN_SKILLS) {
    describe(skill.name, () => {
      it("is named the way a skill is asked for", () => {
        expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/)
      })

      it("says in one line what it is for, so it can be chosen unread", () => {
        // skill_list shows only names and descriptions. A description that does
        // not distinguish this skill from the others makes the list useless.
        expect(skill.description.length).toBeGreaterThan(40)
        expect(skill.description.length).toBeLessThan(240)
      })

      it("has a body worth reading", () => {
        expect(skill.body.length).toBeGreaterThan(300)
        expect(skill.body).toMatch(/^# /)
      })

      it("refers only to tools that exist", () => {
        // A built-in, or the one package's tool a skill names: the Web
        // snapshot package's web_capture, said to be there only when its
        // package is.
        const ids = new Set([...BUILTIN_TOOLS.map((t) => t.id), "web_capture"])
        // Backticked identifiers that look like tool names — the way a skill
        // names one. A skill naming a tool that was removed is worse than
        // silence: the agent will try to call it.
        const mentioned = [...skill.body.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1])
        const missing = [...new Set(mentioned)].filter((name) => !ids.has(name))
        expect(missing, `${skill.name} names tools that do not exist`).toEqual([])
      })
    })
  }

  it("leaves no tool entirely undocumented by guidance", () => {
    // A tool the model only meets as a schema is one it will use badly or not at
    // all. Every tool should be named somewhere a reader would look for it —
    // its skill, or the system prompt.
    const guidance = BUILTIN_SKILLS.map((s) => s.body).join("\n") + DEFAULT_SYSTEM
    const unmentioned = BUILTIN_TOOLS.map((t) => t.id).filter((id) => !guidance.includes(id))
    expect(unmentioned, "no skill or prompt mentions these tools").toEqual([])
  })

  it("has no two skills with the same name", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("the system prompt", () => {
  it("names only tools that exist", () => {
    const ids = new Set(BUILTIN_TOOLS.map((t) => t.id))
    const mentioned = [...DEFAULT_SYSTEM.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1])
    const missing = [...new Set(mentioned)].filter((name) => !ids.has(name))
    expect(missing, "the system prompt names tools that do not exist").toEqual([])
  })

  it("stays short enough to be read every turn", () => {
    // It is sent on every request. Guidance that belongs in a skill should be
    // in a skill, which is read once and on purpose.
    expect(DEFAULT_SYSTEM.length).toBeLessThan(3000)
  })
})
