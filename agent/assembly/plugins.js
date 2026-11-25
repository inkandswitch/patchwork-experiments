/** The `agent:tool` plugins of the page's registry, as tools. */

import { tryHostImport } from "../host/import.js"
import { describePlugin, pluginTool } from "../kernel/tool.js"
import { builtinIds, takesBuiltin } from "./builtin.js"

/** The `agent:tool` registry, or null outside Patchwork (tests, node, a worker with no registry). */
async function toolRegistry() {
  const plugins = await tryHostImport("plugins")
  return plugins ? plugins.getRegistry("agent:tool") : null
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
