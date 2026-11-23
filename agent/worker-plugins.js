/**
 * Plugin tools in the SharedWorker runner.
 *
 * A worker has no plugin registry: Patchwork registers packages in the page.
 * So the page hands the worker what its registry holds — every `agent:tool`
 * entry's metadata, plain JSON with the `importUrl` it was registered from
 * (worker-client.js) — again whenever the registry changes, and the worker
 * keeps it here. Its toolset is built from that metadata, so a step gets the
 * same tools in the worker as in a tab, by construction.
 *
 * Running one is decided by what the package declared:
 *
 *   where "worker"  loaded here, from its `importUrl`, the way the page loads
 *                   it (Patchwork's own loader for a package document, or the
 *                   module's `plugins` entry and its `load()`), and run here.
 *                   A package whose code will not load in a worker — it
 *                   imports a bare specifier, or touches the DOM as it loads —
 *                   is still listed, but its calls go to a tab: it carries
 *                   `where: "host"` for this runner, so a call parks and a
 *                   tab runs it, through the session document like any other
 *                   host-tier call (loop.js, placement.js).
 *   where "host"    never loaded here; its calls go to a tab the same way.
 *
 * Nothing new is trusted. The worker shares the page's origin, so code it
 * loads has exactly the reach the same code has in the page, minus the DOM;
 * and it loads only what the page's registry registered and told it about.
 *
 * A new version of a package is registered under a new `importUrl` (its
 * document's heads), so a cached module is never a stale one: loads are
 * memoised by id and URL, and a failed load is tried again on the next run.
 */

import { BUILTIN_TOOLS, pluginTool, takesBuiltin } from "./tools/index.js"
import { hostImport } from "./tools/host.js"
import { HOST, WORKER } from "./placement.js"
import { packageOfPlugin } from "./tools/guides.js"

const AGENT_TOOL = "agent:tool"

/**
 * The registry types a usage guide can be about (tools/guides.js): a
 * package's agent tools, its views and its datatypes.
 */
export const PACKAGE_TYPES = [AGENT_TOOL, "patchwork:tool", "patchwork:datatype"]

/**
 * What the page's registry says about where each plugin came from, as plain
 * JSON for the worker: `[{ type, id, name, importUrl }]`, for every plugin of
 * `PACKAGE_TYPES` registered with the URL it came from. The worker answers
 * `ctx.packageOf` from it, so its sessions are told a package's usage guide
 * on the same triggers a tab's are.
 */
export function packageIndex(getRegistry, types = PACKAGE_TYPES) {
  const index = []
  for (const type of types) {
    let all = []
    try {
      all = getRegistry(type)?.all?.() ?? []
    } catch {
      continue // no such registry here
    }
    for (const p of all) {
      if (typeof p?.id === "string" && typeof p.importUrl === "string") index.push({ type, id: p.id, name: p.name ?? p.id, importUrl: p.importUrl })
    }
  }
  return index
}

/**
 * Load one plugin's implementation in this realm, as the page would.
 *
 * A package document's URL (`automerge:…#heads`) goes through Patchwork's own
 * loader (`importPluginFromFolderDocUrl`, which resolves its package.json and
 * runs the entry's `load()`); any other URL is a module exporting `plugins`.
 */
export async function importPluginHere(description, { importModule = (url) => import(/* @vite-ignore */ url), filesystem = () => hostImport("filesystem") } = {}) {
  const url = description?.importUrl
  if (!url) throw new Error(`${description?.id} was registered without the URL it came from.`)
  if (url.startsWith("automerge:")) {
    const fs = await filesystem()
    return fs.importPluginFromFolderDocUrl(url, AGENT_TOOL, description.id)
  }
  const mod = await importModule(url)
  const entry = (Array.isArray(mod?.plugins) ? mod.plugins : []).find((p) => p?.type === AGENT_TOOL && p?.id === description.id)
  if (!entry) throw new Error(`${url} exports no ${AGENT_TOOL} called ${description.id}.`)
  if (typeof entry.load === "function") return entry.load()
  if (typeof entry.import === "string") return importModule(entry.import)
  throw new Error(`${description.id} has neither load() nor import.`)
}

/**
 * The worker's plugin catalogue.
 *
 *   set(descriptions, packages)  what the page's registry holds now: its
 *                                agent:tool entries, and the package index
 *                                (packageIndex), when the page sent one
 *   tools()                      the plugin tools for a run, loading what runs here
 *   packageOf(type, id)          the package behind a plugin, as a tab's
 *                                ctx.packageOf answers (tools/guides.js)
 */
export function createPluginCatalogue({ importPlugin = importPluginHere, onError = null } = {}) {
  let entries = new Map() // id -> metadata
  let packages = [] // packageIndex: { type, id, name, importUrl }
  const loads = new Map() // `${id} ${importUrl}` -> Promise<impl>

  function load(description) {
    const key = `${description.id} ${description.importUrl}`
    let loading = loads.get(key)
    if (!loading) {
      loading = Promise.resolve()
        .then(() => importPlugin(description))
        .then((impl) => {
          if (typeof impl?.execute !== "function") throw new Error(`${description.id} provides no execute function.`)
          return impl
        })
      loads.set(key, loading)
      loading.catch(() => {
        if (loads.get(key) === loading) loads.delete(key)
      })
    }
    return loading
  }

  return {
    set(descriptions, index = null) {
      if (Array.isArray(index)) packages = index.filter((p) => typeof p?.type === "string" && typeof p.id === "string")
      const taken = new Set(BUILTIN_TOOLS.map((t) => t.id))
      const next = new Map()
      for (const d of Array.isArray(descriptions) ? descriptions : []) {
        if (typeof d?.id !== "string" || next.has(d.id)) continue
        const refused = takesBuiltin(d.id, taken)
        if (refused) {
          onError?.(d.id, refused)
          continue
        }
        next.set(d.id, d)
      }
      entries = next
      // Versions no longer registered are not kept loaded.
      const live = new Set([...next.values()].map((d) => `${d.id} ${d.importUrl}`))
      for (const key of [...loads.keys()]) if (!live.has(key)) loads.delete(key)
    },

    descriptions: () => [...entries.values()],

    async packageOf(type, id) {
      const listed = packages.find((p) => p.type === type && p.id === id)
      // An agent tool is in the catalogue itself, whether or not an index came.
      return packageOfPlugin(listed ?? (type === AGENT_TOOL ? entries.get(id) : null))
    },

    async tools() {
      const listed = [...entries.values()]
      return Promise.all(
        listed.map(async (description) => {
          const id = description.id
          let impl = null
          if ((description.where ?? WORKER) === WORKER) {
            try {
              impl = await load(description)
            } catch (err) {
              onError?.(id, err)
            }
          }
          // The plugin as registered when the call runs, as the page's
          // registry gives it (tools/index.js pluginTool).
          const current = async () => {
            const now = entries.get(id)
            if (!now) throw new Error(`The package that provided ${id} is no longer installed.`)
            return { ...now, module: await load(now) }
          }
          return pluginTool(description, current, { impl, where: impl ? WORKER : HOST })
        })
      )
    },
  }
}
