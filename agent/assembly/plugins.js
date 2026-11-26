/** The `agent:tool` plugins of the page's registry, as tools; and the catalogue of them that a task carries. */

import { tryHostImport } from "../host/import.js"
import { describePlugin, pluginTool } from "../kernel/tool.js"
import { HOST } from "../kernel/placement.js"
import { builtinIds, takesBuiltin } from "./builtin.js"
import { packageOfPlugin } from "../knowledge/guides.js"

/** A registry of the host's, or null outside Patchwork (tests, node, a worker with no registry). */
async function hostRegistry(type) {
  const plugins = await tryHostImport("plugins")
  return plugins ? plugins.getRegistry(type) : null
}

/** The `agent:tool` registry, or null outside Patchwork (tests, node, a worker with no registry). */
const toolRegistry = () => hostRegistry("agent:tool")

/** How long a package skill's description may be, as knowledge/skills.js lists it. */
const SKILL_DESCRIPTION_MAX = 400

/**
 * The catalogue: what the host's registries say about installed packages'
 * agent tools and skills, as plain JSON that can travel in a task's input,
 * loading none of them.
 *
 *   tools    every `agent:tool` entry's metadata (kernel/tool.js PLUGIN_FIELDS)
 *   skills   `[{ name, description }]` of every `patchwork:skill` entry
 */
export async function pluginCatalogue({ registry = null, skillRegistry = null } = {}) {
  const tools = await pluginDescriptions({ registry })
  const skills = []
  for (const entry of (skillRegistry ?? (await hostRegistry("patchwork:skill")))?.all?.() ?? []) {
    if (typeof entry?.id !== "string") continue
    skills.push({ name: entry.id, description: String(entry.description ?? entry.name ?? "").slice(0, SKILL_DESCRIPTION_MAX) })
  }
  return { tools, skills }
}

/**
 * The catalogue's tools, for a run that imports no plugin code (a pool's):
 * each is offered to the model as its package describes it, and runs only in
 * a page (`where: "host"`), so a call parks until a page takes it. A tool
 * that would take a built-in's id is left out (`onError` is told), as
 * loadPluginTools leaves it out.
 */
export function catalogueTools(catalogue, { onError } = {}) {
  const taken = builtinIds()
  const out = []
  for (const description of catalogue?.tools ?? []) {
    if (typeof description?.id !== "string" || out.some((tool) => tool.id === description.id)) continue
    const refused = takesBuiltin(description.id, taken)
    if (refused) {
      onError?.(description.id, refused)
      continue
    }
    const current = async () => {
      throw new Error(`${description.id} runs only in a page.`)
    }
    out.push(pluginTool(description, current, { where: HOST }))
  }
  return out
}

/**
 * The catalogue's skills as a `patchwork:skill` registry (the context's
 * `skillRegistry`, knowledge/skills.js): listed by name and description, and
 * read only in a page, so reading one here says so.
 */
export function catalogueSkills(catalogue) {
  const skills = (catalogue?.skills ?? []).filter((skill) => typeof skill?.name === "string")
  return {
    all: () => skills.map((skill) => ({ id: skill.name, name: skill.name, description: skill.description ?? "" })),
    load: async (id) => {
      throw new Error(`The skill '${id}' comes from an installed package, and is read in a page: it cannot be read here.`)
    },
  }
}

/**
 * `ctx.packageOf` for a run with only the catalogue (a pool's): the package
 * behind an agent tool, from the `importUrl` its metadata carries
 * (knowledge/guides.js packageOfPlugin). A view or a datatype is not in the
 * catalogue, and is found in a page (runners/page.js pageContext).
 */
export function cataloguePackageOf(catalogue) {
  return async (type, id) => (type === "agent:tool" ? packageOfPlugin((catalogue?.tools ?? []).find((tool) => tool?.id === id)) : null)
}

/** Every `agent:tool` plugin's metadata, without loading any of them. */
export async function pluginDescriptions({ registry: given } = {}) {
  const registry = given ?? (await toolRegistry())
  if (!registry) return []
  return registry.all().map(describePlugin).filter(Boolean)
}

/**
 * Discover `agent:tool` plugins from the host registry.
 *
 * Loading is lazy and failure is non-fatal: a broken third-party tool should
 * cost the agent that one capability, not the whole session.
 */
export async function loadPluginTools({ onError, registry: given } = {}) {
  const registry = given ?? (await toolRegistry())
  if (!registry) return [] // not running inside Patchwork (tests, node)

  const found = []
  const taken = builtinIds()

  for (const description of registry.all()) {
    const refused = takesBuiltin(description.id, taken)
    if (refused) {
      onError?.(description.id, refused)
      continue
    }
    try {
      const loaded = await registry.load(description.id)
      const impl = loaded?.module
      if (!impl?.execute) continue
      const id = description.id
      const current = async () => {
        const now = await registry.load(id)
        if (!now?.module?.execute) throw new Error(`The ${id} package no longer provides an execute function.`)
        return now
      }
      found.push(pluginTool(description, current, { impl }))
    } catch (err) {
      onError?.(description.id, err)
    }
  }

  return found
}
