/** The `agent:tool` plugins of this realm's registry, as tools: a page's, or a pool's (a burst's). */

import { tryHostImport } from "../host/import.js"
import { pluginTool } from "../kernel/tool.js"
import { builtinIds, takesBuiltin } from "./builtin.js"
import { packageOfPlugin } from "../knowledge/guides.js"

/** A registry of this realm's, or null where there is none (tests, a plain Node program). */
async function hostRegistry(type) {
  const plugins = await tryHostImport("plugins")
  return plugins ? plugins.getRegistry(type) : null
}

/** `ctx.packageOf`: the package behind a plugin of this realm's registry, `{ url, heads, name }`, or null (knowledge/guides.js). */
export async function packageOf(type, id) {
  return packageOfPlugin((await hostRegistry(type))?.all().find((p) => p.id === id))
}

/**
 * Every `agent:tool` plugin of the registry, as a tool, as its package
 * declares it. A tool that would take a built-in's id is left out, and
 * `onError` is told.
 *
 * Each is loaded once here for what it says of its calls (`present`,
 * `summarize`), and looked up again at every call. Its code failing to load
 * costs that one tool, and only when it is called: the call fails, saying
 * so, and the run goes on. A tool that needs a page is offered in a pool too,
 * whether or not its code loads there; its calls park for a page.
 */
export async function loadPluginTools({ onError, registry: given } = {}) {
  const registry = given ?? (await hostRegistry("agent:tool"))
  if (!registry) return []

  const found = []
  const taken = builtinIds()

  for (const description of registry.all()) {
    const id = description.id
    const refused = takesBuiltin(id, taken)
    if (refused) {
      onError?.(id, refused)
      continue
    }
    const current = async () => {
      let now
      try {
        now = await registry.load(id)
      } catch (err) {
        throw new Error(`The code of ${id} did not load here: ${String(err?.message ?? err)}`)
      }
      if (!now?.module?.execute) throw new Error(`The ${id} package no longer provides an execute function.`)
      return now
    }
    const impl = await current().then(
      (now) => now.module,
      () => null
    )
    found.push(pluginTool(description, current, { impl }))
  }

  return found
}
