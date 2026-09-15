/**
 * Finding things.
 *
 * Without this the agent can only work on a document someone hands it, which
 * makes "manage my documents" impossible — it cannot answer "the one about the
 * budget" or "all my recipes". The account's root folder is the entry point to
 * everything a person has, and it was simply never wired through.
 *
 * Search walks that tree breadth-first with a visit budget, because a real
 * account is large and an agent that spends its context enumerating folders has
 * not helped anybody.
 */

import { previewJson, truncate } from "./format.js"
import { contentToText, isFolder, isFile, ROOT_DESCRIPTION } from "./folders.js"

const DEFAULT_MAX_VISITS = 600

/** The root of everything: `input.root`, else the account's root folder. */
function searchRoot(input, ctx) {
  const root = input?.root ?? ctx.rootFolderUrl ?? ctx.subject
  if (!root) {
    throw new Error(
      "No root folder available. This Patchwork account has no rootFolderUrl, so pass `root` explicitly."
    )
  }
  return root
}

/**
 * Walk a folder tree breadth-first, calling `visit` for each entry.
 * Cycles are possible (a folder can link itself), hence `seen`.
 */
export async function walkTree(repo, rootUrl, visit, { maxVisits = DEFAULT_MAX_VISITS } = {}) {
  const seen = new Set([rootUrl])
  const queue = [{ url: rootUrl, path: "" }]
  let visits = 0

  while (queue.length && visits < maxVisits) {
    const { url, path } = queue.shift()
    let doc
    try {
      doc = (await repo.find(url)).doc()
    } catch {
      continue // a link to something we cannot load; skip it rather than fail
    }
    visits++

    if (!isFolder(doc)) continue

    for (const entry of doc.docs ?? []) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name
      const stop = await visit({ entry, path: entryPath, parentUrl: url })
      if (stop) return { visits, truncated: false }
      if (!seen.has(entry.url)) {
        seen.add(entry.url)
        queue.push({ url: entry.url, path: entryPath })
      }
    }
  }

  return { visits, truncated: visits >= maxVisits }
}

export const docSearch = {
  id: "doc_search",
  name: "Find documents",
  description:
    "Search the user's documents by name, and optionally by content. This is how you find something you were not handed — start here when the user refers to a document you do not have a URL for. Returns paths, types and URLs.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Case-insensitive substring or regex to match against document names.",
      },
      content: {
        type: "boolean",
        description: "Also search inside file documents' text. Slower; use when the name search finds nothing.",
      },
      type: { type: "string", description: "Only return documents of this datatype, e.g. 'folder'." },
      root: { type: "string", description: "Folder to search under. Defaults to the account root." },
      limit: { type: "number", description: "Default 30." },
    },
  },

  async execute(input, ctx) {
    const root = searchRoot(input, ctx)
    const limit = input.limit ?? 30
    const matches = []

    let pattern = null
    if (input.query) {
      try {
        pattern = new RegExp(input.query, "i")
      } catch {
        // A query that is not valid regex is almost certainly meant literally.
        pattern = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      }
    }

    const { visits, truncated } = await walkTree(ctx.repo, root, async ({ entry, path }) => {
      if (input.type && entry.type !== input.type) return false

      let matched = !pattern || pattern.test(entry.name) || pattern.test(path)
      let context = null

      if (!matched && input.content && pattern) {
        try {
          const doc = (await ctx.repo.find(entry.url)).doc()
          if (isFile(doc)) {
            const text = contentToText(doc.content)
            const line = text.split("\n").find((candidate) => pattern.test(candidate))
            if (line) {
              matched = true
              context = truncate(line.trim(), 160)
            }
          } else if (doc?.title && pattern.test(doc.title)) {
            matched = true
            context = `title: ${doc.title}`
          }
        } catch {
          /* unreadable; not a match */
        }
      }

      if (matched) {
        matches.push({ path: `/${path}`, name: entry.name, type: entry.type ?? null, url: entry.url, context })
      }
      return matches.length >= limit
    })

    if (!matches.length) {
      return `No documents matched${input.query ? ` /${input.query}/` : ""} (searched ${visits} folders${truncated ? ", stopped at the visit budget" : ""}).${input.content ? "" : " Try content: true to search inside files."}`
    }

    return previewJson({
      matched: matches.length,
      searchedFolders: visits,
      truncated,
      results: matches,
    })
  },

  summarize(input, output) {
    const match = String(output ?? "").match(/"matched":\s*(\d+)/)
    return `searched "${input?.query ?? "all"}" · ${match ? match[1] : "0"} found`
  },
}

export const docTree = {
  id: "doc_tree",
  name: "Outline my documents",
  description:
    "Show the shape of the user's document tree — folders and what is in them, a few levels deep. Use it once to orient yourself before searching.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string", description: ROOT_DESCRIPTION },
      depth: { type: "number", description: "How many levels deep to show. Default 2." },
    },
  },

  async execute(input, ctx) {
    const root = searchRoot(input, ctx)
    const maxDepth = input.depth ?? 2
    const lines = []

    const walk = async (url, prefix, depth) => {
      if (depth > maxDepth || lines.length > 400) return
      let doc
      try {
        doc = (await ctx.repo.find(url)).doc()
      } catch {
        return
      }
      if (!isFolder(doc)) return

      for (const entry of doc.docs ?? []) {
        const isDir = entry.type === "folder"
        lines.push(`${prefix}${entry.name}${isDir ? "/" : ""}${isDir ? "" : `  (${entry.type ?? "doc"})`}`)
        if (isDir) await walk(entry.url, `${prefix}  `, depth + 1)
      }
    }

    await walk(root, "", 1)
    if (!lines.length) return `The root folder (${root}) is empty.`
    return `${root}\n${lines.join("\n")}`
  },

  summarize(input, output) {
    return `outlined documents · ${String(output ?? "").split("\n").length - 1} entries`
  },
}

export default [docSearch, docTree]
