/**
 * Folder tools — the filesystem, when the filesystem is automerge.
 *
 * A folder document is `{ title, docs: DocLink[] }` and a file document is
 * `{ name, extension, mimeType, content }`. Together they are a tree, which
 * means an agent that can walk folders and read files can read source code —
 * including, when the repo is synced with pushwork, its own.
 *
 * Worker tier throughout: repo access only.
 */

import { previewJson, truncate, bytes } from "./format.js"

/** File content arrives as a string, an ImmutableString, or raw bytes. */
export function contentToText(content) {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
    return new TextDecoder("utf-8", { fatal: false }).decode(content)
  }
  // automerge's ImmutableString and friends stringify usefully
  const text = String(content)
  return text === "[object Object]" ? "" : text
}

export function isFolder(doc) {
  return !!doc && Array.isArray(doc.docs)
}

export function isFile(doc) {
  return !!doc && "content" in doc
}

/**
 * Walk a slash-separated path from a root folder document.
 * Returns { url, doc, trail }. Throws with the available names on a miss,
 * because "no such file" without a listing costs the model another round trip.
 */
export async function resolvePath(repo, rootUrl, path = "") {
  const parts = String(path)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)

  let url = rootUrl
  let handle = await repo.find(url)
  let doc = handle.doc()
  const trail = []

  for (const part of parts) {
    if (!isFolder(doc)) throw new Error(`/${trail.join("/")} is not a folder, so '${part}' cannot be inside it.`)
    const entry = (doc.docs ?? []).find((d) => d.name === part)
    if (!entry) {
      const names = (doc.docs ?? []).map((d) => d.name).join(", ")
      throw new Error(`'${part}' is not in /${trail.join("/")}. Contains: ${names || "(empty)"}`)
    }
    url = entry.url
    handle = await repo.find(url)
    doc = handle.doc()
    trail.push(part)
  }

  return { url, doc, handle, trail }
}

function rootFor(input, ctx) {
  // The account's root folder is the useful default: a session's subject is
  // usually an ordinary document, not a folder, so defaulting to it made every
  // fs_* call fail with "not a folder" unless a root was passed by hand.
  const root = input?.root ?? ctx.rootFolderUrl ?? ctx.subject
  if (!root) throw new Error("No folder specified and no root folder is available. Pass `root`.")
  return root
}

export const fsList = {
  id: "fs_list",
  name: "List folder",
  description:
    "List the contents of a folder document. `path` is slash-separated from the root folder. Shows each entry's name, type and URL.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Folder document URL. Defaults to the session's document." },
      path: { type: "string", description: "Sub-path inside the root, e.g. 'src/components'." },
    },
  },
  async execute(input, ctx) {
    const { doc, url, trail } = await resolvePath(ctx.repo, rootFor(input, ctx), input.path ?? "")
    if (!isFolder(doc)) {
      return `/${trail.join("/")} is a ${doc?.["@patchwork"]?.type ?? "document"}, not a folder. Use fs_read or doc_read.`
    }
    const entries = (doc.docs ?? []).map((d) => ({ name: d.name, type: d.type, url: d.url }))
    return previewJson({ path: `/${trail.join("/")}`, url, entries })
  },
  summarize(input, output) {
    const count = (String(output ?? "").match(/"name":/g) ?? []).length
    return `listed ${input?.path || "/"} · ${count} entries`
  },
}

export const fsRead = {
  id: "fs_read",
  name: "Read file",
  description:
    "Read a file document's text content by path from a root folder. Use `offset` and `limit` (in lines) for a big file.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string" },
      path: { type: "string", description: "Path to the file, e.g. 'src/tool.js'." },
      url: { type: "string", description: "Read a file document directly by URL instead of by path." },
      offset: { type: "number", description: "First line to return (1-based)." },
      limit: { type: "number", description: "How many lines. Default 400." },
    },
  },
  async execute(input, ctx) {
    let doc
    let label
    if (input.url) {
      doc = (await ctx.repo.find(input.url)).doc()
      label = input.url
    } else {
      const found = await resolvePath(ctx.repo, rootFor(input, ctx), input.path ?? "")
      doc = found.doc
      label = `/${found.trail.join("/")}`
    }

    if (!isFile(doc)) throw new Error(`${label} has no content field — it is not a file document.`)

    const text = contentToText(doc.content)
    const lines = text.split("\n")
    const offset = Math.max(1, input.offset ?? 1)
    const limit = input.limit ?? 400
    const slice = lines.slice(offset - 1, offset - 1 + limit)

    const header = `${label} · ${lines.length} lines · ${bytes(text.length)}`
    const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n")
    const footer =
      offset - 1 + slice.length < lines.length
        ? `\n… ${lines.length - (offset - 1 + slice.length)} more lines; read again with offset ${offset + slice.length}`
        : ""

    return `${header}\n${truncate(numbered, 20000)}${footer}`
  },
  summarize(input, output) {
    const first = String(output ?? "").split("\n")[0] ?? ""
    return `read ${input?.path ?? input?.url ?? "file"} · ${first.split("·")[1]?.trim() ?? ""}`
  },
}

export const fsGrep = {
  id: "fs_grep",
  name: "Search files",
  description:
    "Search a folder tree for a regular expression, returning matching lines with their file and line number. This is how you find code without reading every file.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["pattern"],
    properties: {
      root: { type: "string" },
      path: { type: "string", description: "Sub-path to search under." },
      pattern: { type: "string", description: "JavaScript regular expression." },
      flags: { type: "string", description: "Regex flags. Default 'i'." },
      include: { type: "string", description: "Only search files whose name matches this regex, e.g. '\\.js$'." },
      maxMatches: { type: "number", description: "Default 100." },
    },
  },
  async execute(input, ctx) {
    let re
    try {
      re = new RegExp(input.pattern, input.flags ?? "i")
    } catch (err) {
      throw new Error(`Bad pattern: ${err.message}`)
    }
    const includeRe = input.include ? new RegExp(input.include) : null
    const maxMatches = input.maxMatches ?? 100

    const start = await resolvePath(ctx.repo, rootFor(input, ctx), input.path ?? "")
    const matches = []
    let filesSearched = 0
    let truncated = false

    const walk = async (url, prefix, depth) => {
      if (matches.length >= maxMatches || depth > 12) {
        truncated = truncated || matches.length >= maxMatches
        return
      }
      const doc = (await ctx.repo.find(url)).doc()
      if (isFolder(doc)) {
        for (const entry of doc.docs ?? []) {
          if (matches.length >= maxMatches) {
            truncated = true
            return
          }
          await walk(entry.url, `${prefix}/${entry.name}`, depth + 1)
        }
        return
      }
      if (!isFile(doc)) return
      if (includeRe && !includeRe.test(prefix)) return

      filesSearched++
      const lines = contentToText(doc.content).split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          matches.push(`${prefix}:${i + 1}: ${truncate(lines[i].trim(), 200)}`)
          if (matches.length >= maxMatches) {
            truncated = true
            return
          }
        }
      }
    }

    await walk(start.url, `/${start.trail.join("/")}`.replace(/\/$/, ""), 0)

    if (!matches.length) return `No matches for /${input.pattern}/ in ${filesSearched} files.`
    return [
      `${matches.length}${truncated ? "+" : ""} matches in ${filesSearched} files:`,
      ...matches,
      truncated ? `… stopped at ${maxMatches} matches; narrow the pattern or set maxMatches.` : "",
    ]
      .filter(Boolean)
      .join("\n")
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/^(\d+\+?) matches/)
    return `grep ${input?.pattern} · ${match ? match[1] : "0"} hits`
  },
}

const MIME_BY_EXTENSION = {
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
}

/** Make a file document. */
async function createFile(repo, name, content) {
  const extension = name.includes(".") ? name.split(".").pop() : ""
  const handle = await repo.create2()
  handle.change((doc) => {
    doc.name = name
    doc.extension = extension
    doc.mimeType = MIME_BY_EXTENSION[extension] ?? "text/plain"
    doc.content = content
    doc["@patchwork"] = { type: "file" }
  })
  return handle
}

/** Make a folder document. */
async function createFolder(repo, name) {
  const handle = await repo.create2()
  handle.change((doc) => {
    doc.title = name
    doc.docs = []
    doc["@patchwork"] = { type: "folder" }
  })
  return handle
}

/**
 * Walk to a path, creating folders along the way.
 *
 * This is what `fs_write` was missing, and its absence is why a separate
 * "write a tool" tool existed at all: a Patchwork package is nothing but a
 * folder document of file documents, so once files and folders can be created
 * here, writing a tool is writing files. There is nothing else to it.
 */
async function ensurePath(repo, rootUrl, parts) {
  let handle = await repo.find(rootUrl)
  const trail = []

  for (const part of parts) {
    const doc = handle.doc()
    if (!isFolder(doc)) throw new Error(`/${trail.join("/")} is not a folder, so '${part}' cannot go inside it.`)

    const existing = (doc.docs ?? []).find((entry) => entry.name === part)
    if (existing) {
      handle = await repo.find(existing.url)
    } else {
      const created = await createFolder(repo, part)
      const parent = handle
      parent.change((draft) => {
        if (!draft.docs) draft.docs = []
        draft.docs.push({ name: part, type: "folder", url: created.url })
      })
      handle = created
    }
    trail.push(part)
  }

  return handle
}

export const fsWrite = {
  id: "fs_write",
  name: "Write files",
  description: [
    "Write one or more files, creating them — and any folders in their path — if they do not exist.",
    "",
    "Pass `path` and `content` for a single file, or `files` (a map of path to content) to write several at once, which is one approval instead of several.",
    "",
    "This is how you create a Patchwork tool: a tool is just a folder of files. Write a package.json naming your entry point, an entry module exporting `plugins`, and whatever else it needs. Read the 'writing-patchwork-tools' skill first — it has the contract the entry module and render function must satisfy.",
    "",
    "The folder you write into is shown to the user with an Install button beside it, so you never need to give them a URL to paste.",
    "",
    "For a small edit inside a large existing file, prefer doc_edit with a splice range: it merges cleanly with concurrent edits and does not rewrite the whole file.",
  ].join("\n"),
  where: "worker",
  risk: "write",
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Folder to write under. Defaults to the account root." },
      path: { type: "string", description: "Path of one file, e.g. 'my-tool/index.js'." },
      content: { type: "string", description: "Contents of that file." },
      files: {
        type: "object",
        description: "Several files at once: path → contents.",
        additionalProperties: { type: "string" },
      },
      url: { type: "string", description: "Overwrite an existing file document directly by URL." },
    },
  },

  async execute(input, ctx) {
    // Direct overwrite by URL: no path resolution, no creation.
    if (input.url) {
      const handle = await ctx.repo.find(input.url)
      if (!isFile(handle.doc())) throw new Error(`${input.url} is not a file document.`)
      const before = contentToText(handle.doc()?.content).split("\n").length
      handle.change((draft) => {
        draft.content = input.content ?? ""
      })
      const after = String(input.content ?? "").split("\n").length
      return {
        text: `Wrote ${input.url}: ${before} → ${after} lines, ${bytes(String(input.content ?? "").length)}`,
        doc: { url: input.url, name: handle.doc()?.name ?? "file", kind: "file", bytes: String(input.content ?? "").length },
      }
    }

    const batch =
      input.files ?? (input.path != null ? { [input.path]: input.content ?? "" } : null)
    if (!batch || !Object.keys(batch).length) {
      throw new Error("Pass `path` and `content`, or a `files` map.")
    }

    const root = rootFor(input, ctx)
    const written = []

    for (const [path, content] of Object.entries(batch)) {
      const parts = String(path).split("/").filter(Boolean)
      if (!parts.length) throw new Error(`'${path}' is not a file path.`)
      const name = parts.pop()

      const folder = await ensurePath(ctx.repo, root, parts)
      const existing = (folder.doc()?.docs ?? []).find((entry) => entry.name === name)

      if (existing) {
        const handle = await ctx.repo.find(existing.url)
        const before = contentToText(handle.doc()?.content).split("\n").length
        handle.change((draft) => {
          draft.content = content
        })
        written.push(`${path} · updated ${before} → ${content.split("\n").length} lines`)
      } else {
        const created = await createFile(ctx.repo, name, content)
        folder.change((draft) => {
          if (!draft.docs) draft.docs = []
          draft.docs.push({ name, type: "file", url: created.url })
        })
        written.push(`${path} · created ${content.split("\n").length} lines (${created.url})`)
      }
    }

    // The folder a package lives in is what gets installed, so say which it is.
    const topFolder = Object.keys(batch)[0].split("/").filter(Boolean).slice(0, -1)
    const containing = topFolder.length
      ? (await ensurePath(ctx.repo, root, topFolder)).url
      : root
    const folderName = topFolder.length ? topFolder.join("/") : "root"

    return {
      text: [
        `Wrote ${written.length} file(s):`,
        ...written.map((line) => `• ${line}`),
        ``,
        `Containing folder: ${containing}`,
      ].join("\n"),
      // The FOLDER is the artifact, not the individual files: it is what you
      // open, what you install, and what a person means by "my tool". Listing
      // twelve files instead would bury it.
      doc: topFolder.length
        ? { url: containing, name: folderName, kind: "package", bytes: null }
        : null,
    }
  },

  summarize(input) {
    const count = input?.files ? Object.keys(input.files).length : 1
    const what = input?.files ? `${count} files` : (input?.path ?? input?.url ?? "file")
    return `wrote ${what}`
  },
}

export default [fsList, fsRead, fsGrep, fsWrite]
