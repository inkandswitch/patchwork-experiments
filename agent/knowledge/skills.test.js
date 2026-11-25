import { describe, it, expect } from "vitest"
import { skillList, skillRead, describeFrom, folderSkills, resolveSkills, packageSkillsSection } from "./skills.js"
import { BUILTIN_SKILLS } from "./builtin-skills.js"

function fakeRepo(docs) {
  return { async find(url) { if (!(url in docs)) throw new Error("missing"); return { url, doc: () => docs[url] } } }
}

describe("describeFrom", () => {
  it("prefers a frontmatter description", () => {
    expect(describeFrom("---\nname: x\ndescription: How to do the thing\n---\n# Title")).toBe("How to do the thing")
  })
  it("strips quotes", () => {
    expect(describeFrom('---\ndescription: "quoted"\n---\n')).toBe("quoted")
  })
  it("falls back to the first non-heading line", () => {
    expect(describeFrom("# Title\n\nThe first real line.")).toBe("The first real line.")
  })
})

describe("built-in skills", () => {
  it("include the tool-writing contract", async () => {
    const out = await skillList.execute({}, { repo: fakeRepo({}) })
    expect(out).toContain("writing-patchwork-tools")
    expect(out).toContain("editing-documents")
  })

  it("carry the guidance that measurably fixed the tools it writes", async () => {
    const out = await skillRead.execute({ name: "writing-patchwork-tools" }, { repo: fakeRepo({}) })
    expect(out).toContain("handle.doc()` is a FUNCTION")
    expect(out).toContain("handle.off")
    expect(out).toContain("cleanup function")
  })

  it("steer away from the things that fail without saying why", async () => {
    // Each of these is a failure the build or the host reports badly or not at
    // all: a CSS import, Solid JSX, a hex colour that ignores the theme, and an
    // edit by URL that leaves the installed package on its old version.
    const out = await skillRead.execute({ name: "writing-patchwork-tools" }, { repo: fakeRepo({}) })
    expect(out).toContain('Do not \`import "./styles.css"\`')
    expect(out).toContain("solid-js/html")
    expect(out).toContain("Do not use JSX for Solid")
    expect(out).toContain("@layer package")
    expect(out).toContain("Never write a hex colour")
    expect(out).toContain("always write by path")
  })

  it("match by prefix, so a near-miss name still works", async () => {
    const out = await skillRead.execute({ name: "writing" }, { repo: fakeRepo({}) })
    expect(out).toContain("# writing-patchwork-tools")
  })

  it("say what exists when the name is wrong", async () => {
    const out = await skillRead.execute({ name: "nonsense" }, { repo: fakeRepo({}) })
    expect(out).toMatch(/No skill 'nonsense'/)
    expect(out).toContain("writing-patchwork-tools")
  })
})

describe("skills from a folder document", () => {
  const docs = {
    "automerge:skills": { docs: [
      { name: "house-style", type: "folder", url: "automerge:house" },
      { name: "loose.md", type: "file", url: "automerge:loose" },
      { name: "empty", type: "folder", url: "automerge:empty" },
    ] },
    "automerge:house": { docs: [{ name: "SKILL.md", type: "file", url: "automerge:houseFile" }] },
    "automerge:houseFile": { content: "---\ndescription: Our house style\n---\nUse tabs." },
    "automerge:loose": { content: "# Loose\n\nA skill that is just a file." },
    "automerge:empty": { docs: [] },
  }
  const ctx = { repo: fakeRepo(docs), skillsFolderUrl: "automerge:skills" }

  it("reads a SKILL.md out of a subfolder", async () => {
    const found = await folderSkills(ctx.repo, "automerge:skills")
    const house = found.find((s) => s.name === "house-style")
    expect(house.description).toBe("Our house style")
    expect(house.body).toContain("Use tabs.")
  })

  it("accepts a bare markdown file as a skill", async () => {
    const found = await folderSkills(ctx.repo, "automerge:skills")
    expect(found.find((s) => s.name === "loose")).toBeTruthy()
  })

  it("skips a folder with no SKILL.md rather than failing", async () => {
    const found = await folderSkills(ctx.repo, "automerge:skills")
    expect(found.find((s) => s.name === "empty")).toBeUndefined()
  })

  it("tolerates a missing or unreadable folder", async () => {
    expect(await folderSkills(ctx.repo, null)).toEqual([])
    expect(await folderSkills(ctx.repo, "automerge:gone")).toEqual([])
  })

  it("lets a folder skill shadow a built-in of the same name", async () => {
    const shadowing = {
      "automerge:skills": { docs: [{ name: "writing-patchwork-tools", type: "folder", url: "automerge:mine" }] },
      "automerge:mine": { docs: [{ name: "SKILL.md", type: "file", url: "automerge:mineFile" }] },
      "automerge:mineFile": { content: "---\ndescription: My override\n---\nDo it my way." },
    }
    const skills = await resolveSkills({ repo: fakeRepo(shadowing), skillsFolderUrl: "automerge:skills" })
    const skill = skills.find((s) => s.name === "writing-patchwork-tools")

    expect(skill.body).toBe("---\ndescription: My override\n---\nDo it my way.")
    expect(skill.source).toBe("automerge:mine")
    // and the other built-ins are still there
    expect(skills.length).toBe(BUILTIN_SKILLS.length)
  })
})

describe("skills from installed packages", () => {
  // The registry as the host hands it: metadata from all(), the module from load().
  function registry(entries) {
    const loads = []
    return {
      loads,
      all: () => entries.map(({ module, ...meta }) => meta),
      async load(id) {
        loads.push(id)
        return { module: entries.find((e) => e.id === id)?.module }
      },
    }
  }
  const register = {
    id: "assumptions-register",
    name: "Assumptions register",
    description: "Keep every number a task's models share in one register.",
    module: { documentation: "# Working from an assumptions register\n\nMake the register first." },
  }

  it("are listed from metadata alone and read on demand", async () => {
    const skillRegistry = registry([register])
    const ctx = { repo: fakeRepo({}), skillRegistry }
    expect(await skillList.execute({}, ctx)).toContain("assumptions-register — Keep every number")
    expect(skillRegistry.loads).toEqual([])
    const out = await skillRead.execute({ name: "assumptions-register" }, ctx)
    expect(out).toContain("package skill 'Assumptions register'")
    expect(out).toContain("Make the register first.")
  })

  it("cannot take a built-in's name, and a folder skill shadows them", async () => {
    const builtinName = BUILTIN_SKILLS[0].name
    const skillRegistry = registry([{ ...register, id: builtinName }, register])
    const docs = {
      "automerge:skills": { docs: [{ name: "assumptions-register.md", url: "automerge:mine" }] },
      "automerge:mine": { content: "---\ndescription: my own\n---\nmine" },
    }
    const skills = await resolveSkills({ repo: fakeRepo(docs), skillRegistry, skillsFolderUrl: "automerge:skills" })
    expect(skills.find((s) => s.name === builtinName).source).toBe("built-in")
    expect(skills.find((s) => s.name === "assumptions-register")).toMatchObject({ description: "my own", source: "automerge:mine" })
  })

  it("are named in the system prompt section, and only they", async () => {
    const section = await packageSkillsSection({ repo: fakeRepo({}), skillRegistry: registry([register]) })
    expect(section).toContain("## Skills from installed packages")
    expect(section).toContain("- assumptions-register — Keep every number")
    expect(section).not.toContain(BUILTIN_SKILLS[0].name)
    expect(await packageSkillsSection({ repo: fakeRepo({}), skillRegistry: registry([]) })).toBeNull()
  })
})
