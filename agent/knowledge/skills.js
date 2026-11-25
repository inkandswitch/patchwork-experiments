/**
 * Skills — knowledge, on demand.
 *
 * The third layer of the capability model. Plugins are what the agent can do,
 * tool documents are what you can teach it to do, and skills are what it needs
 * to know: the render contract, the edit vocabulary, how to find things in a
 * Patchwork it has not seen before.
 *
 * Names and one-line descriptions go in the system prompt; bodies are read only
 * when needed. That is the whole point — this guidance is far too long to carry
 * on every turn, and far too important to leave out.
 *
 * A skill is a folder document containing a `SKILL.md`, so a user-written skill
 * is an ordinary document you can edit in the file tool. The built-ins ship with
 * the package as a fallback, and a folder skill of the same name wins — because
 * when the agent gets something wrong, fixing it should mean editing a document,
 * not redeploying the harness.
 */

import { BUILTIN_SKILLS } from "./builtin-skills.js"
import { contentToText, isFolder } from "../tools/folders.js"
import { truncate } from "../documents/format.js"

/** Skills from a folder document: one subfolder per skill, each with SKILL.md. */
export async function folderSkills(repo, folderUrl) {
  if (!folderUrl) return []
  let folder
  try {
    folder = (await repo.find(folderUrl)).doc()
  } catch {
    return []
  }
  if (!isFolder(folder)) return []

  const found = []
  for (const entry of folder.docs ?? []) {
    try {
      const doc = (await repo.find(entry.url)).doc()

      // A skill can be a folder holding SKILL.md, or just a markdown file.
      let body = null
      if (isFolder(doc)) {
        const file = (doc.docs ?? []).find((d) => /^skill\.md$/i.test(d.name))
        if (file) body = contentToText((await repo.find(file.url)).doc()?.content)
      } else if (doc?.content != null) {
        body = contentToText(doc.content)
      }
      if (!body) continue

      found.push({
        name: entry.name.replace(/\.md$/i, ""),
        description: describeFrom(body),
        body,
        url: entry.url,
      })
    } catch {
      /* an unreadable skill is not worth failing over */
    }
  }
  return found
}

/** A skill's one-line description: YAML frontmatter, else the first heading. */
export function describeFrom(body) {
  const frontmatter = String(body).match(/^---\n([\s\S]*?)\n---/)
  if (frontmatter) {
    const described = frontmatter[1].match(/^description:\s*(.+)$/m)
    if (described) return described[1].trim().replace(/^["']|["']$/g, "")
  }
  const firstLine = String(body).split("\n").find((line) => line.trim() && !line.startsWith("#"))
  return truncate((firstLine ?? "").trim(), 140)
}

/**
 * Skills contributed by installed packages: `patchwork:skill` plugins, the
 * same entries Patchwork's other agents read. The name and description come
 * from the plugin's metadata, so listing them loads nothing; the body —
 * `documentation` on what `load()` returns, or a string — is loaded when the
 * skill is read. Installing the package is what puts its guidance here, the
 * same trust boundary as its `agent:tool`s.
 *
 * `registry` is the host's `patchwork:skill` registry, which the tab runner
 * puts on the context as `skillRegistry`; without one there are none.
 */
export async function packageSkills({ registry } = {}) {
  if (!registry) return [] // a worker, node, or a test: no plugin registry
  const found = []
  for (const description of registry.all()) {
    if (!description?.id) continue
    found.push({
      name: description.id,
      description: truncate(String(description.description ?? description.name ?? ""), 400),
      body: null,
      source: `package skill '${description.name ?? description.id}'`,
      async loadBody() {
        const loaded = await registry.load(description.id)
        const module = loaded?.module
        const body = typeof module === "string" ? module : module?.documentation ?? module?.default?.documentation
        if (!body) throw new Error(`The package behind skill '${description.id}' gives no documentation.`)
        return String(body)
      },
    })
  }
  return found
}

/**
 * Everything available. Built-ins first; package skills beside them, except
 * that a package cannot take a built-in's name (it would replace guidance the
 * harness depends on, invisibly — the rule plugin tools follow too); folder
 * skills shadow both, because a person's correction should win.
 */
export async function resolveSkills(ctx) {
  const fromFolder = await folderSkills(ctx.repo, ctx.skillsFolderUrl)
  const fromPackages = await packageSkills({ registry: ctx.skillRegistry })
  const byName = new Map(BUILTIN_SKILLS.map((skill) => [skill.name, { ...skill, source: "built-in" }]))
  for (const skill of fromPackages) if (!byName.has(skill.name)) byName.set(skill.name, skill)
  for (const skill of fromFolder) byName.set(skill.name, { ...skill, source: skill.url })
  return [...byName.values()]
}

/**
 * The part of the system prompt that names the skills installed packages
 * bring. Built-ins are named in the prompt already; these are not, and a
 * skill the agent never hears of is one it never reads. Null when there are
 * none (or a person's folder skill has the name).
 */
export async function packageSkillsSection(ctx) {
  const skills = (await resolveSkills(ctx)).filter((skill) => typeof skill.loadBody === "function")
  if (!skills.length) return null
  return [
    "## Skills from installed packages",
    "",
    ...skills.map((skill) => `- ${skill.name} — ${skill.description}`),
    "",
    "When one describes the task in front of you, skill_read it before you start — and before you plan the task as a workflow, so the plan uses it.",
  ].join("\n")
}

export const skillList = {
  id: "skill_list",
  name: "List skills",
  description:
    "List the guidance available to you, by name. Read one with skill_read before doing something you have not done here before — especially writing a tool.",
  where: "worker",
  risk: "read",
  input_schema: { type: "object", properties: {} },
  async execute(input, ctx) {
    const skills = await resolveSkills(ctx)
    if (!skills.length) return "No skills available."
    return skills.map((skill) => `${skill.name} — ${skill.description}`).join("\n")
  },
  summarize(input, output) {
    return `skills · ${String(output ?? "").split("\n").length} available`
  },
}

export const skillRead = {
  id: "skill_read",
  name: "Read a skill",
  description:
    "Read one skill in full. Do this before writing a Patchwork tool, before your first edit to an unfamiliar document shape, and whenever a skill's description sounds like the thing you are about to attempt.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "The skill's name, exactly as skill_list gave it." },
    },
  },
  async execute(input, ctx) {
    const skills = await resolveSkills(ctx)
    const wanted = String(input.name ?? "").toLowerCase()
    const skill =
      skills.find((s) => s.name.toLowerCase() === wanted) ??
      skills.find((s) => s.name.toLowerCase().includes(wanted))

    if (!skill) {
      return `No skill '${input.name}'. Available: ${skills.map((s) => s.name).join(", ") || "(none)"}`
    }
    const body = skill.body ?? (await skill.loadBody())
    return `# ${skill.name} (${skill.source})\n\n${body}`
  },
  summarize(input) {
    return `read skill ${input?.name}`
  },
}

export default [skillList, skillRead]
