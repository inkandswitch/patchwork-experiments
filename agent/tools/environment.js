/**
 * Environment tools — how the agent learns what Patchwork it is living in.
 *
 * Without these the model is guessing: it does not know which datatypes exist,
 * what a tool is called, or what the page currently looks like. `dom_snapshot`
 * is the one host-tier tool in the built-in set, because a SharedWorker has no
 * document to look at.
 */

import { hostImport } from "../host/import.js"
import { truncate, bytes } from "../documents/format.js"
import { resolvePath, treeNode, treeEntries, treeEnter } from "./folders.js"
import { contentText } from "../documents/values.js"
import { fetcher } from "../net/guard.js"

/**
 * The registry, one line per plugin, grouped by type.
 *
 * It used to be pretty-printed JSON with every plugin's import URL: 66 plugins
 * came to 16,000 characters, re-sent on every later turn of the session, and a
 * search for 'pcb|kicad' matched nothing because it was a substring test. One
 * real session spent a dozen calls and much of its budget finding out what was
 * installed.
 */
export function listRegistries(registries, { type = null, search = null, urls = false } = {}) {
  let pattern = null
  if (search) {
    try {
      pattern = new RegExp(search, "i")
    } catch {
      pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    }
  }
  const sections = []
  let count = 0
  for (const [registryType, registry] of registries) {
    if (type && registryType !== type) continue
    const lines = []
    for (const p of registry.all()) {
      const datatypes = Array.isArray(p.supportedDatatypes) ? p.supportedDatatypes : []
      if (pattern && !pattern.test([p.id, p.name ?? "", registryType, ...datatypes].join(" "))) continue
      const name = p.name && p.name !== p.id ? ` — ${p.name}` : ""
      const views = datatypes.length ? ` (for ${datatypes.join(", ")})` : ""
      const hidden = p.unlisted ? " [unlisted]" : ""
      lines.push(`  ${p.id}${name}${views}${hidden}${urls && p.importUrl ? `  ${p.importUrl}` : ""}`)
    }
    if (lines.length) {
      count += lines.length
      sections.push(`${registryType} (${lines.length})\n${lines.join("\n")}`)
    }
  }
  if (!count) return `0 plugins matched${search ? ` /${search}/` : ""}${type ? ` in ${type}` : ""}.`
  return `${count} plugin${count === 1 ? "" : "s"}${search ? ` matching /${search}/` : ""}:\n\n${sections.join("\n\n")}`
}

export const registryList = {
  id: "registry_list",
  name: "List installed plugins",
  description:
    "List what is installed in this Patchwork: tools, datatypes, components, themes, and any other plugin type. Use this before doc_create (to find a datatype id) or before opening a view (to find a tool id).\n\nPass type: 'agent:tool' to see the capabilities packages have exposed for YOU rather than for a person. Those are already in your tool list — this tells you which package each came from, and whether the thing the user is asking for exists as a tool you can simply call.",
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
      search: {
        type: "string",
        description: "Case-insensitive regex over id, name, registry type and supported datatypes — 'pcb|kicad|circuit' finds any of them in one call.",
      },
      urls: { type: "boolean", description: "Also give each plugin's import URL. Rarely needed: plugin_source takes the id." },
    },
  },
  async execute(input) {
    const { getAllRegistries } = await hostImport("plugins")
    return listRegistries(getAllRegistries(), input)
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/^(\d+) plugins?/)
    return `registry · ${match ? match[1] : "0"} plugins`
  },
}

/**
 * The package document an import URL names, or null for one hosted anywhere
 * else. A package served by the page is named either `automerge:<id>` or by
 * the service worker's spelling of it, `<origin>/automerge%3A<id>/<file>`;
 * both are read from the document, never fetched, because a fetch of the page's
 * origin is how a document would be read past every check.
 */
/** The origin of a URL as the guard compares it: no trailing dot on the host. */
function originOfUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname.replace(/\.+$/, "")}${parsed.port ? `:${parsed.port}` : ""}`.toLowerCase()
  } catch {
    return null
  }
}

export function packageDocOf(importUrl) {
  const bare = (url) => url.split("#")[0].split("?")[0]
  const raw = String(importUrl ?? "")
  if (raw.startsWith("automerge:")) return bare(raw)
  try {
    const first = decodeURIComponent(new URL(raw).pathname.split("/")[1] ?? "")
    return first.startsWith("automerge:") ? bare(first) : null
  } catch {
    return null
  }
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

    const bare = packageDocOf(importUrl)
    if (bare) {
      const root = await ctx.repo.find(bare)
      const tree = treeNode(root)
      if (!tree) throw new Error(`${bare} is not a package folder.`)

      if (input.list || !input.file) {
        // Every file, by path: a directory document keeps its whole tree in
        // one document, so the top level alone would hide src/ entirely.
        const names = []
        const walk = async (node, prefix, depth) => {
          for (const entry of treeEntries(node)) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.type === "folder" && depth < 8) {
              const { node: inside } = await treeEnter(ctx.repo, entry).catch(() => ({}))
              if (inside) {
                await walk(inside, path, depth + 1)
                continue
              }
            }
            names.push(path)
          }
        }
        await walk(tree, "", 0)
        if (input.list) return `${input.id} (${bare})\n${names.join("\n")}`
        // Default to the entry point named by package.json.
        let main = "index.js"
        const pkgEntry = treeEntries(tree).find((d) => d.name === "package.json")
        if (pkgEntry) {
          const pkgDoc = (await ctx.repo.find(pkgEntry.url)).doc()
          try {
            main = JSON.parse(contentText(pkgDoc.content)).main ?? main
          } catch {
            /* fall back to index.js */
          }
        }
        input = { ...input, file: main.replace(/^\.\//, "") }
      }

      let node
      try {
        node = (await resolvePath(ctx.repo, bare, input.file)).doc
      } catch {
        throw new Error(`'${input.file}' not in package. Use list:true to see the files.`)
      }
      const text = contentText(node?.content)
      return `${input.id}/${input.file} · ${bytes(text.length)}\n${truncate(text, 20000)}`
    }

    // An http-hosted package is fetched like anything else, through the guard,
    // and only from where the package lives: an absolute `file` would
    // otherwise replace the package's address with any the model chose.
    const url = input.file ? new URL(input.file, importUrl).href : importUrl
    if (new URL(url).origin !== new URL(importUrl).origin) throw new Error(`'${input.file}' is not in the package at ${importUrl}.`)
    // A plugin the page serves itself is read with the page's own fetch: every
    // other fetch denies this origin (and localhost, where development runs).
    const own = ctx.pageFetch?.origin
    const response = own && originOfUrl(url) === own ? await ctx.pageFetch(url) : await fetcher(ctx)(url)
    if (!response.ok) throw new Error(`Fetching ${url} returned ${response.status}.`)
    const text = await response.text()
    return `${url} · ${bytes(text.length)}\n${truncate(text, 20000)}`
  },
  summarize(input, output) {
    const first = String(output ?? "").split("\n")[0] ?? ""
    return `read source ${input?.id} · ${first.split("·")[1]?.trim() ?? ""}`
  },
}

/** How long dom_snapshot waits for what it was asked to look at. */
export const SNAPSHOT_WAIT_MS = 3000

/**
 * The view showing a document: a `<patchwork-view>` whose document is `url`
 * (heads ignored), preferring one that is on screen.
 */
export function viewShowing(root, url) {
  const bare = String(url).split("#")[0]
  const views = [...root.querySelectorAll("patchwork-view")].filter((view) => {
    const shown = String(view.docUrl ?? view.getAttribute("doc-url") ?? "").split("#")[0]
    return shown === bare
  })
  return views.find((view) => view.getClientRects?.().length) ?? views[0] ?? null
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
      url: {
        type: "string",
        description: "A document's URL: look only inside the view showing it — the one view_open just opened, say — rather than the first match anywhere on the page.",
      },
      waitMs: {
        type: "number",
        description: `How long to wait for the view and selector to appear. Default ${SNAPSHOT_WAIT_MS}: a view opened a moment ago may not have rendered yet.`,
      },
      maxChars: { type: "number", description: "Default 8000." },
      text: { type: "boolean", description: "Return visible text instead of markup." },
    },
  },
  async execute(input, ctx) {
    const root = ctx.element?.ownerDocument ?? globalThis.document
    if (!root) throw new Error("No document available — this needs to run in a tab.")

    // Looked for until it appears, briefly: straight after view_open the view
    // has not rendered, and "nothing matches" sent the agent off to record
    // that dom_snapshot cannot see `.openscad-status` — which it can, a moment
    // later.
    const find = () => {
      const scope = input.url ? viewShowing(root, input.url) : root
      if (!scope) return null
      if (input.selector) return scope.querySelector(input.selector)
      return input.url ? scope : root.querySelector("patchwork-view") ?? root.body
    }
    const deadline = Date.now() + Math.max(0, input.waitMs ?? SNAPSHOT_WAIT_MS)
    let target = find()
    while (!target && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      target = find()
    }

    if (!target) {
      if (input.url && !viewShowing(root, input.url)) throw new Error(`${input.url} is not open on the page. Open it with view_open first.`)
      throw new Error(`Nothing matches ${input.selector}${input.url ? ` in the view of ${input.url}` : ""}.`)
    }

    const raw = input.text ? (target.innerText ?? target.textContent ?? "") : target.outerHTML
    return truncate(raw, input.maxChars ?? 8000)
  },
  summarize(input, output) {
    return `looked at ${input?.selector ?? "the page"} · ${bytes(String(output ?? "").length)}`
  },
}

export const viewOpen = {
  id: "view_open",
  name: "Open a document for the user",
  description:
    "Navigate the user's Patchwork to a document, optionally in a particular tool. Use it when you have made or found something they should look at — handing over a URL in prose is worse than just showing them.",
  where: "host",
  // It changes and reads nothing: it asks Patchwork to show a document, in a
  // tool that is already installed. Asking first only held up the work — an
  // orchestrator waited most of an hour on it, unseen.
  risk: "read",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "automerge: URL of the document to open." },
      toolId: { type: "string", description: "Which tool to open it in. Defaults to the usual one for its datatype." },
    },
  },
  async execute(input, ctx) {
    const element = ctx.element ?? globalThis.document?.body
    if (!element) throw new Error("view_open needs a page.")
    if (!String(input.url ?? "").startsWith("automerge:")) throw new Error("Pass an automerge: URL.")

    element.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: { url: input.url, toolId: input.toolId ?? undefined },
        bubbles: true,
        composed: true,
      })
    )
    return `Opened ${input.url}${input.toolId ? ` in ${input.toolId}` : ""} for the user.`
  },
  summarize(input) {
    return `opened ${String(input?.url ?? "").replace(/^automerge:/, "").slice(0, 10)}…`
  },
}

export default [registryList, pluginSource, domSnapshot, viewOpen]
