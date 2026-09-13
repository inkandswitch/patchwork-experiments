/**
 * Environment tools — how the agent learns what Patchwork it is living in.
 *
 * Without these the model is guessing: it does not know which datatypes exist,
 * what a tool is called, or what the page currently looks like. `dom_snapshot`
 * is the one host-tier tool in the built-in set, because a SharedWorker has no
 * document to look at.
 */

import { hostImport } from "./host.js"
import { previewJson, truncate, bytes } from "./format.js"
import { contentToText, isFolder } from "./folders.js"

export const registryList = {
  id: "registry_list",
  name: "List installed plugins",
  description:
    "List what is installed in this Patchwork: tools, datatypes, components, themes, and any other plugin type. Use this before doc_create (to find a datatype id) or before opening a view (to find a tool id).",
  // Host tier: the plugin registry lives in the page, not in the repo, so a
  // worker sees an empty one.
  where: "host",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Restrict to one registry, e.g. 'patchwork:tool' or 'patchwork:datatype'. Omit for all.",
      },
      search: { type: "string", description: "Case-insensitive filter on id or name." },
    },
  },
  async execute(input) {
    const { getAllRegistries } = await hostImport("plugins")
    const search = input.search ? input.search.toLowerCase() : null
    const out = {}

    for (const [type, registry] of getAllRegistries()) {
      if (input.type && type !== input.type) continue
      const plugins = registry
        .all()
        .map((p) => ({
          id: p.id,
          name: p.name ?? null,
          supportedDatatypes: p.supportedDatatypes ?? null,
          unlisted: p.unlisted ?? false,
          importUrl: p.importUrl ?? null,
        }))
        .filter((p) => !search || `${p.id} ${p.name ?? ""}`.toLowerCase().includes(search))
      if (plugins.length) out[type] = plugins
    }

    if (!Object.keys(out).length) return "No plugins matched."
    return previewJson(out, { maxTotal: 16000 })
  },
  summarize(input, output) {
    const count = (String(output ?? "").match(/"id":/g) ?? []).length
    return `registry · ${count} plugins`
  },
}

export const pluginSource = {
  id: "plugin_source",
  name: "Read plugin source",
  description:
    "Read the source of an installed plugin, by plugin id. This is how you learn how an existing tool works before writing one like it. Automerge-hosted packages are read from their folder document; http-hosted ones are fetched.",
  // Host tier: it resolves the plugin through the page's registry.
  where: "host",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "Plugin id, e.g. 'chitterchatter'." },
      type: { type: "string", description: "Registry to look in. Default 'patchwork:tool'." },
      file: { type: "string", description: "File within the package. Defaults to the entry point." },
      list: { type: "boolean", description: "List the package's files instead of reading one." },
    },
  },
  async execute(input, ctx) {
    const { getRegistry } = await hostImport("plugins")
    const registry = getRegistry(input.type ?? "patchwork:tool")
    const plugin = registry.all().find((p) => p.id === input.id)
    if (!plugin) throw new Error(`No plugin '${input.id}' in ${input.type ?? "patchwork:tool"}.`)

    const importUrl = plugin.importUrl
    if (!importUrl) throw new Error(`Plugin '${input.id}' has no importUrl; its source is not reachable.`)

    if (importUrl.startsWith("automerge:")) {
      const bare = importUrl.split("#")[0].split("?")[0]
      const doc = (await ctx.repo.find(bare)).doc()
      if (!isFolder(doc)) throw new Error(`${bare} is not a package folder.`)

      if (input.list || !input.file) {
        const names = (doc.docs ?? []).map((d) => d.name)
        if (input.list) return `${input.id} (${bare})\n${names.join("\n")}`
        // Default to the entry point named by package.json.
        const pkgEntry = (doc.docs ?? []).find((d) => d.name === "package.json")
        let main = "index.js"
        if (pkgEntry) {
          const pkgDoc = (await ctx.repo.find(pkgEntry.url)).doc()
          try {
            main = JSON.parse(contentToText(pkgDoc.content)).main ?? main
          } catch {
            /* fall back to index.js */
          }
        }
        input = { ...input, file: main.replace(/^\.\//, "") }
      }

      const parts = input.file.split("/").filter(Boolean)
      let node = doc
      for (const part of parts) {
        const entry = (node.docs ?? []).find((d) => d.name === part)
        if (!entry) throw new Error(`'${part}' not in package. Use list:true to see the files.`)
        node = (await ctx.repo.find(entry.url)).doc()
      }
      const text = contentToText(node.content)
      return `${input.id}/${input.file} · ${bytes(text.length)}\n${truncate(text, 20000)}`
    }

    const url = input.file ? new URL(input.file, importUrl).href : importUrl
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Fetching ${url} returned ${response.status}.`)
    const text = await response.text()
    return `${url} · ${bytes(text.length)}\n${truncate(text, 20000)}`
  },
  summarize(input, output) {
    const first = String(output ?? "").split("\n")[0] ?? ""
    return `read source ${input?.id} · ${first.split("·")[1]?.trim() ?? ""}`
  },
}

export const domSnapshot = {
  id: "dom_snapshot",
  name: "Look at the page",
  description:
    "Snapshot the live DOM of the Patchwork view the user is looking at. Use it to see what is actually rendered — what a tool drew, whether an element exists, what classes it has. Requires an open tab.",
  where: "host",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector to snapshot. Defaults to the whole document area." },
      maxChars: { type: "number", description: "Default 8000." },
      text: { type: "boolean", description: "Return visible text instead of markup." },
    },
  },
  async execute(input, ctx) {
    const root = ctx.element?.ownerDocument ?? globalThis.document
    if (!root) throw new Error("No document available — this needs to run in a tab.")

    const target = input.selector
      ? root.querySelector(input.selector)
      : root.querySelector("patchwork-view") ?? root.body

    if (!target) throw new Error(`Nothing matches ${input.selector}.`)

    const raw = input.text ? (target.innerText ?? target.textContent ?? "") : target.outerHTML
    return truncate(raw, input.maxChars ?? 8000)
  },
  summarize(input, output) {
    return `looked at ${input?.selector ?? "the page"} · ${bytes(String(output ?? "").length)}`
  },
}

export default [registryList, pluginSource, domSnapshot]
