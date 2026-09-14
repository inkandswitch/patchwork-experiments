/**
 * Bringing outside data in, rather than just reading it.
 *
 * `web_fetch` puts a page into the conversation, where it costs context on
 * every subsequent turn and evaporates when the session ends. Importing puts it
 * into a document: it persists, it syncs, it can be linked to and searched with
 * doc_search, and the agent can re-read a slice of it later instead of carrying
 * the whole thing.
 *
 * Re-importing the same source updates the existing document rather than making
 * a second copy, so "refresh that page" is a sensible thing to ask for and the
 * document keeps its history.
 */

import { readerUrl, DEFAULT_READER } from "./web.js"
import { isFolder } from "./folders.js"
import { bytes, truncate } from "./format.js"
import { applyChange } from "../identity.js"

const IMPORTS_FOLDER = "Imports"

/** A filesystem-safe-ish name derived from a page title or URL. */
export function nameFor(url, title) {
  const base = (title ?? "").trim() || (() => {
    try {
      const parsed = new URL(url)
      const last = parsed.pathname.split("/").filter(Boolean).pop()
      return last ? `${parsed.host}-${last}` : parsed.host
    } catch {
      return "imported"
    }
  })()
  const safe = base.replace(/[\/\\:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
  return `${safe || "imported"}.md`
}

/** The reader puts `Title: …` on the first line; use it if it is there. */
export function titleFrom(markdown) {
  const match = String(markdown ?? "").match(/^Title:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

/** Find (or create) the folder imports go into, so the root stays tidy. */
async function importsFolder(ctx, explicit) {
  if (explicit) return await ctx.repo.find(explicit)

  const rootUrl = ctx.rootFolderUrl
  if (!rootUrl) throw new Error("No folder to import into. Pass `folder` with a folder document URL.")

  const root = await ctx.repo.find(rootUrl)
  const existing = (root.doc()?.docs ?? []).find((entry) => entry.name === IMPORTS_FOLDER)
  if (existing) return await ctx.repo.find(existing.url)

  const folder = await ctx.repo.create2()
  folder.change((doc) => {
    doc.title = IMPORTS_FOLDER
    doc.docs = []
    doc["@patchwork"] = { type: "folder" }
  })
  root.change((doc) => {
    if (!doc.docs) doc.docs = []
    doc.docs.push({ name: IMPORTS_FOLDER, type: "folder", url: folder.url })
  })
  return folder
}

export const webImport = {
  id: "web_import",
  name: "Import a page as a document",
  description:
    "Fetch a web page and save it as a document, so it persists, syncs, and can be found later with doc_search. Prefer this over web_fetch when the user wants to keep the material, work with it over several turns, or refer to it again. Re-importing the same URL updates the existing document instead of duplicating it.",
  where: "worker",
  risk: "external",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Absolute http(s) URL." },
      name: { type: "string", description: "File name. Defaults to the page title." },
      folder: { type: "string", description: "Folder document to import into. Defaults to an 'Imports' folder." },
    },
  },

  async execute(input, ctx) {
    const target = String(input.url ?? "").trim()
    if (!/^https?:\/\//.test(target)) throw new Error("Pass an absolute http(s) URL.")

    const fetchImpl = ctx.fetchImpl ?? fetch
    const response = await fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), {
      signal: ctx.signal,
      headers: { accept: "text/plain" },
    })
    if (!response.ok) throw new Error(`Could not read ${target} (${response.status}).`)

    const content = await response.text()
    const title = titleFrom(content)
    const name = input.name ?? nameFor(target, title)

    const folder = await importsFolder(ctx, input.folder)
    if (!isFolder(folder.doc())) throw new Error(`${folder.url} is not a folder document.`)

    // Update in place when we have imported this source before, so the
    // document keeps its identity and its history.
    let existingUrl = null
    for (const entry of folder.doc().docs ?? []) {
      try {
        const candidate = (await ctx.repo.find(entry.url)).doc()
        if (candidate?.source === target) {
          existingUrl = entry.url
          break
        }
      } catch {
        /* skip anything unreadable */
      }
    }

    if (existingUrl) {
      const handle = await ctx.repo.find(existingUrl)
      const before = String(handle.doc()?.content ?? "").length
      handle.change((doc) => {
        doc.content = content
        doc.importedAt = Date.now()
      })
      return `Updated ${name} (${existingUrl}) from ${target}: ${bytes(before)} → ${bytes(content.length)}.\n\n${truncate(content, 600)}`
    }

    const file = await ctx.repo.create2()
    file.change((doc) => {
      doc.name = name
      doc.extension = "md"
      doc.mimeType = "text/markdown"
      doc.content = content
      doc.source = target
      doc.importedAt = Date.now()
      doc["@patchwork"] = { type: "file" }
    })
    folder.change((doc) => {
      if (!doc.docs) doc.docs = []
      doc.docs.push({ name, type: "file", url: file.url })
    })

    return [
      `Imported ${target} as '${name}' (${bytes(content.length)}) at ${file.url}`,
      `In folder: ${folder.doc()?.title ?? folder.url}`,
      "",
      truncate(content, 600),
    ].join("\n")
  },

  summarize(input, output) {
    let host = input?.url ?? ""
    try {
      host = new URL(input.url).host
    } catch {
      /* keep it */
    }
    const size = String(output ?? "").match(/\(([\d.]+ [kMB]+)\)/)
    return `imported ${host}${size ? ` · ${size[1]}` : ""}`
  },
}

export default [webImport]
