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
import { locate, lineOf, minimalSplice, spliceString } from "./ops.js"

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

/**
 * Is this path source code — something a package loads and runs?
 *
 * File writes are approved by what they write, not by the fact of writing:
 * notes, data and prose go straight in, because history keeps every version,
 * but code runs with the user's authority on its next load. Judged by the name
 * alone, because approval is decided before anything is loaded.
 */
const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
  "css", "html", "htm", "json", "wasm", "svelte", "vue",
])

export function isCodePath(path) {
  const name = String(path ?? "").split("/").filter(Boolean).at(-1) ?? ""
  const dot = name.lastIndexOf(".")
  return dot > 0 && CODE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/** A write by url alone could be to anything, so it counts as code. */
export function writesCodeFiles(input) {
  const paths = input.files && typeof input.files === "object" ? Object.keys(input.files) : []
  if (input.path) paths.push(input.path)
  if (!paths.length) return true
  return paths.some(isCodePath)
}

/** Unlinking a non-code file is recoverable; a path with no extension may be a whole folder. */
export function deletesCode(input) {
  const path = String(input.path ?? "")
  const name = path.split("/").filter(Boolean).at(-1) ?? ""
  return !name || isCodePath(path) || name.lastIndexOf(".") <= 0
}

export function isFolder(doc) {
  return !!doc && Array.isArray(doc.docs)
}

export function isFile(doc) {
  return !!doc && "content" in doc
}

/**
 * A directory document: what pushwork writes for a package (its "vfs" shape).
 *
 * One document holds the whole tree, keyed by full path — `"src/index.ts":
 * "automerge:…"` — with each value a link to a file document, pinned to heads
 * for build output. There are no folder documents in it at all, so code that
 * only knew `docs[]` saw an empty package and built nothing.
 */
export function isDirectory(doc) {
  return doc?.["@patchwork"]?.type === "directory"
}

/** Keys a directory document uses for itself rather than for files. */
const DIRECTORY_RESERVED = new Set(["@patchwork", "lastSyncAt", "contentVersion", "title"])

/**
 * A place in a tree that can hold files.
 *
 * Either a folder document (`{ handle }`), or a path inside a directory
 * document (`{ handle, prefix }`, where the prefix is "" or ends in "/"). The
 * tools below walk, list and write through these, so both shapes behave the
 * same to the agent: `src` is a folder you can list and write into whether it
 * is a document of its own or a prefix on some keys.
 */
export function treeNode(handle) {
  const doc = handle?.doc()
  if (isFolder(doc)) return { handle, prefix: null }
  if (isDirectory(doc)) return { handle, prefix: "" }
  return null
}

/** What is in a tree node: `{ name, type: "file" | "folder", url, node? }`. */
export function treeEntries(node) {
  const doc = node.handle.doc()
  if (node.prefix === null) return (doc?.docs ?? []).map((d) => ({ name: d.name, type: d.type, url: d.url }))

  const entries = new Map()
  for (const [key, value] of Object.entries(doc ?? {})) {
    if (DIRECTORY_RESERVED.has(key) || !key.startsWith(node.prefix)) continue
    if (typeof value !== "string" || !value.startsWith("automerge:")) continue
    const rest = key.slice(node.prefix.length)
    const slash = rest.indexOf("/")
    if (slash === -1) {
      entries.set(rest, { name: rest, type: "file", url: value })
    } else {
      const name = rest.slice(0, slash)
      if (!entries.has(name)) {
        // A folder here is only a shared prefix: it has no document of its own.
        entries.set(name, { name, type: "folder", url: null, node: { handle: node.handle, prefix: `${node.prefix}${name}/` } })
      }
    }
  }
  return [...entries.values()]
}

/**
 * Step into an entry: the tree node it is, or `{ handle }` for a file.
 *
 * Always the live document, even through a link pinned to heads: a pinned
 * link finds a read-only view, and every tool that walks here may go on to
 * write. A write re-pins the link (treeRepin), so reading the live document is
 * reading what the link will say.
 */
export async function treeEnter(repo, entry) {
  if (entry.node) return { node: entry.node, handle: entry.node.handle }
  const handle = await repo.find(String(entry.url).split("#")[0])
  return { node: treeNode(handle), handle }
}

/** Link a new file into a tree node. */
export function treeAdd(node, name, url) {
  node.handle.change((draft) => {
    if (node.prefix === null) {
      if (!draft.docs) draft.docs = []
      draft.docs.push({ name, type: "file", url })
    } else {
      draft[`${node.prefix}${name}`] = url
    }
  })
}

/** Unlink an entry — a file, or a folder and everything under it. */
export function treeRemove(node, entry) {
  node.handle.change((draft) => {
    if (node.prefix === null) {
      const index = draft.docs.findIndex((d) => d.name === entry.name)
      if (index !== -1) draft.docs.splice(index, 1)
      return
    }
    const key = `${node.prefix}${entry.name}`
    for (const existing of Object.keys(draft)) {
      if (existing === key || existing.startsWith(`${key}/`)) delete draft[existing]
    }
  })
}

/**
 * After a file's content changes, keep a pinned link pointing at it.
 *
 * pushwork links build output with heads (`automerge:…#heads`), so the
 * directory names an exact version. Rewriting that file without moving the
 * link would leave Patchwork serving the old build however often it rebuilt.
 */
export function treeRepin(node, entry, handle) {
  if (node.prefix === null || !String(entry.url).includes("#") || !handle.view) return
  const pinned = handle.view(handle.heads()).url
  node.handle.change((draft) => {
    draft[`${node.prefix}${entry.name}`] = pinned
  })
}

/** A child folder of a tree node, made if it does not exist. */
async function treeChild(repo, node, name) {
  const existing = treeEntries(node).find((entry) => entry.name === name)
  if (existing) {
    const { node: child } = await treeEnter(repo, existing)
    if (!child) throw new Error(`'${name}' is a file, so nothing can go inside it.`)
    return child
  }
  // Inside a directory document a folder is just a longer key, which the
  // first file written into it creates.
  if (node.prefix !== null) return { handle: node.handle, prefix: `${node.prefix}${name}/` }
  const created = await createFolder(repo, name)
  node.handle.change((draft) => {
    if (!draft.docs) draft.docs = []
    draft.docs.push({ name, type: "folder", url: created.url })
  })
  return { handle: created, prefix: null }
}

/**
 * Walk a slash-separated path from a root folder or directory document.
 * Returns { url, doc, handle, node, trail }: `node` when the path names a
 * folder, `doc` and `handle` for whatever is there. Throws with the available
 * names on a miss, because "no such file" without a listing costs the model
 * another round trip.
 */
export async function resolvePath(repo, rootUrl, path = "") {
  const parts = String(path)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)

  let url = rootUrl
  let handle = await repo.find(url)
  let node = treeNode(handle)
  const trail = []

  for (const part of parts) {
    if (!node) throw new Error(`/${trail.join("/")} is not a folder, so '${part}' cannot be inside it.`)
    const entries = treeEntries(node)
    const entry = entries.find((d) => d.name === part)
    if (!entry) {
      const names = entries.map((d) => d.name).join(", ")
      throw new Error(`'${part}' is not in /${trail.join("/")}. Contains: ${names || "(empty)"}`)
    }
    ;({ node, handle } = await treeEnter(repo, entry))
    url = entry.url ?? handle.url
    trail.push(part)
  }

  return { url, doc: node?.prefix ? null : handle.doc(), handle, node, trail }
}

/** A real automerge URL, rather than the shape of one. */
function looksLikeDocUrl(value) {
  return typeof value === "string" && /^automerge:[A-Za-z0-9]+/.test(value.trim())
}

/** Shared by every tool that takes a `root`, so they cannot drift apart. */
export const ROOT_DESCRIPTION =
  "Folder document to work from. Omit this for the account's root folder, which is almost always what you want — do not pass a placeholder."

/** A file whose content is data — records, a table, a config — rather than prose or code. */
export const DATA_FILE = /\.(json|ndjson|jsonl|csv|tsv|ya?ml|xml|toml)$/i

/**
 * The data files just created that are not part of a package: no package.json
 * in their folder or any folder above it, up to where the write began. Inside a
 * package a data file is the package's (a manifest, a fixture); outside one it
 * is somebody's data, kept as a blob of text.
 */
async function dataOutsidePackages(repo, root, created) {
  const out = []
  for (const { path, parts } of created) {
    let inPackage = false
    for (let depth = 0; depth <= parts.length && !inPackage; depth++) {
      const node = await ensurePath(repo, root, parts.slice(0, depth))
      inPackage = treeEntries(node).some((entry) => entry.name === "package.json")
    }
    if (!inPackage) out.push(path)
  }
  return out
}

/** What fs_write says when it has kept data as a file. */
export function dataFileNote(paths) {
  return [
    `Note: ${paths.join(", ")} ${paths.length === 1 ? "keeps" : "keep"} data as a plain file — one blob of text, opened as text, merged only as text.`,
    "If this is data for the person (records, a table, a list), a document of an installed datatype is better: it opens in a real tool and merges field by field. registry_list for a datatype, then doc_create { datatype, title, folder }, then doc_edit. A file is right for a tool's source, or when a file was asked for.",
  ].join(" ")
}

function rootFor(input, ctx) {
  // A model filling in the `root` field with a placeholder — "automerge:",
  // "root", "" — is a predictable mistake, and passing it through meant a failed
  // call, a red block in the user's transcript, and a wasted turn while the
  // agent worked out that it should have omitted the field. An entry with no
  // document id in it is not a document; take it as "not given", which is
  // unambiguously what was meant.
  const given = typeof input?.root === "string" ? input.root.trim() : null
  const explicit = looksLikeDocUrl(given) ? given : null
  if (given && !explicit && !/^(automerge:)?$|^(root|default)$/i.test(given)) {
    throw new Error(`'${given}' is not a document URL. Omit \`root\` to write at the account root.`)
  }

  // The account's root folder is the useful default: a session's subject is
  // usually an ordinary document, not a folder, so defaulting to it made every
  // fs_* call fail with "not a folder" unless a root was passed by hand.
  const root = explicit ?? ctx.rootFolderUrl ?? ctx.subject
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
      root: { type: "string", description: ROOT_DESCRIPTION },
      path: { type: "string", description: "Sub-path inside the root, e.g. 'src/components'. Omit for the root itself." },
    },
  },
  async execute(input, ctx) {
    const { doc, node, url, trail } = await resolvePath(ctx.repo, rootFor(input, ctx), input.path ?? "")
    if (!node) {
      return `/${trail.join("/")} is a ${doc?.["@patchwork"]?.type ?? "document"}, not a folder. Use fs_read or doc_read.`
    }
    const entries = treeEntries(node).map(({ name, type, url }) => (url ? { name, type, url } : { name, type }))
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
  description: [
    "Read a file document's text. Pass `path` to find it by name in a folder, or `url` to read one you already have.",
    "",
    "Use `offset` and `limit` — in lines — for anything large; the result says how many lines remain so you can page on.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string", description: ROOT_DESCRIPTION },
      path: { type: "string", description: "Path to the file, e.g. 'src/tool.js'. Pass this or `url`." },
      url: { type: "string", description: "Read a file document directly by URL instead of by path. Pass this or `path`." },
      offset: { type: "number", description: "First line to return (1-based)." },
      limit: { type: "number", description: "How many lines. Default 400." },
    },
  },
  async execute(input, ctx) {
    let doc
    let label
    let url = null
    if (input.url) {
      doc = (await ctx.repo.find(input.url)).doc()
      label = input.url
    } else {
      const found = await resolvePath(ctx.repo, rootFor(input, ctx), input.path ?? "")
      doc = found.doc
      label = `/${found.trail.join("/")}`
      url = found.url
    }

    if (!isFile(doc)) throw new Error(`${label} has no content field — it is not a file document.`)

    const text = contentToText(doc.content)
    const lines = text.split("\n")
    const offset = Math.max(1, input.offset ?? 1)
    const limit = input.limit ?? 400
    const slice = lines.slice(offset - 1, offset - 1 + limit)

    // The URL rides along so the file can be edited or re-read by URL without
    // an fs_list to find it: before this, a file found by path had no URL
    // anywhere in the transcript.
    const header = `${label} · ${lines.length} lines · ${bytes(text.length)}${url ? ` · ${url}` : ""}`
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
      root: { type: "string", description: ROOT_DESCRIPTION },
      path: { type: "string", description: "Sub-path to search under. Omit to search the whole tree." },
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

    const walk = async (place, prefix, depth) => {
      if (matches.length >= maxMatches || depth > 12) {
        truncated = truncated || matches.length >= maxMatches
        return
      }
      const { node, handle } = place
      if (node) {
        for (const entry of treeEntries(node)) {
          if (matches.length >= maxMatches) {
            truncated = true
            return
          }
          await walk(await treeEnter(ctx.repo, entry), `${prefix}/${entry.name}`, depth + 1)
        }
        return
      }
      const doc = handle.doc()
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

    await walk(start, `/${start.trail.join("/")}`.replace(/\/$/, ""), 0)

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
export async function createFolder(repo, name) {
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
  let node = treeNode(await repo.find(rootUrl))
  const trail = []

  for (const part of parts) {
    if (!node) throw new Error(`/${trail.join("/")} is not a folder, so '${part}' cannot go inside it.`)
    node = await treeChild(repo, node, part)
    trail.push(part)
  }

  if (!node) throw new Error(`/${trail.join("/")} is not a folder, so nothing can be written inside it.`)
  return node
}

/**
 * Move the version of every package a write landed in.
 *
 * Patchwork loads a package at its folder document's heads, and every module
 * inside it — `./agent.js` imported from `index.js` — at those same heads. A
 * file's content lives in its own document, so editing it in place changes the
 * file's heads and not the folder's: the package's URL stays the same, the
 * module watcher sees nothing to reload, and the browser's module map and the
 * service worker's cache keep answering that URL with the old bytes, through
 * reloads and new tabs. A real session rewrote a tool's executor four times and
 * got the first stub back every time. Writing to the package folder itself is
 * what makes "I changed this package" visible to the thing that loads it.
 *
 * `folders` is a list of folder paths (as part arrays) under `rootUrl`; every
 * folder from the root down each path that holds a package.json is a package,
 * and each is bumped once however many of the writes landed in it.
 */
async function bumpPackages(repo, rootUrl, folders) {
  const found = new Map()
  for (const parts of folders) {
    let node = treeNode(await repo.find(rootUrl))
    for (let depth = 0; node; depth++) {
      const entries = treeEntries(node)
      // A package inside a directory document is that document: its heads are
      // the version, whatever prefix the package.json sits under.
      const { handle } = node
      if (entries.some((entry) => entry.name === "package.json") && !found.has(handle.url)) {
        found.set(handle.url, { handle, path: `/${parts.slice(0, depth).join("/")}` })
      }
      if (depth === parts.length) break
      const next = entries.find((entry) => entry.name === parts[depth])
      if (!next) break
      ;({ node } = await treeEnter(repo, next))
    }
  }

  const version = Math.random().toString(36).slice(2, 9)
  for (const { handle } of found.values()) {
    handle.change((draft) => {
      draft.contentVersion = version
    })
  }
  return [...found.values()].map(({ handle, path }) => ({ url: handle.url, path }))
}

/** One line for a tool result saying which packages will reload, or nothing. */
function bumpedLine(bumped) {
  if (!bumped.length) return null
  const names = bumped.map(({ path, url }) => `${path} (${url})`).join(", ")
  return `Package version moved: ${names}. Patchwork reloads it at its new heads, so its tools and views pick up this change — there is nothing to touch by hand.`
}

/** What to say after writing a file by URL, where the package it is in is unknown. */
const BY_URL_NOTE =
  "Written by URL, so the package this file belongs to (if any) was not marked as changed, and Patchwork keeps running its old version. To change an installed package's code, write by `path` instead."

export const fsWrite = {
  id: "fs_write",
  name: "Write files",
  // A url names one file; a root names the folder written under; a path with
  // neither writes into the account tree, which no single document stands
  // for. It used to fall back to the session's subject, so the card offered
  // "this document" for a write that went nowhere near it.
  target: { fields: ["url", "root"] },
  description: [
    "Write one or more files, creating them — and any folders in their path — if they do not exist.",
    "",
    "Pass `path` and `content` for a single file, or `files` (a map of path to content) to write several at once, which is one approval instead of several.",
    "",
    "This is how you create a Patchwork tool: a tool is just a folder of files. Write a package.json naming your entry point, an entry module exporting `plugins`, and whatever else it needs. Read the 'writing-patchwork-tools' skill first — it has the contract the entry module and render function must satisfy.",
    "",
    "The folder you write into is shown to the user with an Install button beside it, so you never need to give them a URL to paste.",
    "",
    "Writing over an existing file changes only the characters that differ, so it is safe to use for a rewrite. To change one part of a file, fs_edit is quicker: give it the old text and the new.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  // Prose and data go straight in; source code still asks. See isCodePath.
  askWhen: writesCodeFiles,
  input_schema: {
    type: "object",
    properties: {
      root: { type: "string", description: ROOT_DESCRIPTION },
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
      const content = String(input.content ?? "")
      const before = contentToText(handle.doc()?.content)
      const changed = overwrite(handle, before, content, ctx.splice)
      return {
        text: [
          `Wrote ${input.url}: ${before.split("\n").length} → ${content.split("\n").length} lines, ${bytes(content.length)} (${changed})`,
          ...(changed === "unchanged" ? [] : [``, BY_URL_NOTE]),
        ].join("\n"),
        doc: { url: input.url, name: handle.doc()?.name ?? "file", kind: "file", bytes: content.length },
      }
    }

    const batch =
      input.files ?? (input.path != null ? { [input.path]: input.content ?? "" } : null)
    if (!batch || !Object.keys(batch).length) {
      throw new Error("Pass `path` and `content`, or a `files` map.")
    }

    const root = rootFor(input, ctx)
    const written = []
    const touched = []
    const createdData = []

    for (const [path, content] of Object.entries(batch)) {
      const parts = String(path).split("/").filter(Boolean)
      if (!parts.length) throw new Error(`'${path}' is not a file path.`)
      const name = parts.pop()

      const folder = await ensurePath(ctx.repo, root, parts)
      const existing = treeEntries(folder).find((entry) => entry.name === name)

      if (existing) {
        if (existing.type === "folder") throw new Error(`'${path}' is a folder, not a file.`)
        const { handle } = await treeEnter(ctx.repo, existing)
        const before = contentToText(handle.doc()?.content)
        const changed = overwrite(handle, before, content, ctx.splice)
        if (changed !== "unchanged") {
          touched.push(parts)
          treeRepin(folder, existing, handle)
        }
        written.push(`${path} · updated ${before.split("\n").length} → ${content.split("\n").length} lines (${changed})`)
      } else {
        touched.push(parts)
        const created = await createFile(ctx.repo, name, content)
        treeAdd(folder, name, created.url)
        if (DATA_FILE.test(name)) createdData.push({ path, parts: [...parts] })
        written.push(`${path} · created ${content.split("\n").length} lines (${created.url})`)
      }
    }

    const data = await dataOutsidePackages(ctx.repo, root, createdData)

    // The folder a package lives in is what gets installed, so say which it is.
    const topFolder = Object.keys(batch)[0].split("/").filter(Boolean).slice(0, -1)
    const containing = topFolder.length
      ? (await ensurePath(ctx.repo, root, topFolder)).handle.url
      : root
    const folderName = topFolder.length ? topFolder.join("/") : "root"
    const bumped = bumpedLine(await bumpPackages(ctx.repo, root, touched))

    // Say what the URL is FOR. "Containing folder" read as "the folder this
    // package is in", and a real session spent a turn on fs_list working out
    // that it was the package itself.
    return {
      text: [
        `Wrote ${written.length} file(s):`,
        ...written.map((line) => `• ${line}`),
        ``,
        topFolder.length
          ? `Package folder: ${containing} — this is the \`url\` for tool_check, view_mount, package_build and package_test.`
          : `Written at the root folder: ${containing}`,
        ...(bumped ? [bumped] : []),
        ...(data.length ? ["", dataFileNote(data)] : []),
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

/**
 * Apply text splices to a file's content in one change.
 *
 * Through automerge's text splice when the runner has one, so only the
 * characters that changed are in the change: a concurrent edit elsewhere in
 * the file merges instead of being overwritten, and the history says what
 * changed rather than "the whole file". Falls back to reassigning the string
 * when there is no splice (tests) or the content is not spliceable text (an
 * ImmutableString written by something else, say).
 *
 * `splices` is [{ from, to, inserted }] in ascending order of `from`.
 */
function spliceContent(handle, before, splices, splice) {
  let after = before
  for (const { from, to, inserted } of [...splices].reverse()) {
    after = after.slice(0, from) + inserted + after.slice(to)
  }
  handle.change((draft) => {
    try {
      if (!splice || typeof draft.content !== "string") throw new Error("not spliceable")
      // Later positions first, so the earlier offsets stay valid.
      for (const { from, to, inserted } of [...splices].reverse()) {
        spliceString(draft, ["content"], from, to, inserted, splice)
      }
    } catch {
      draft.content = after
    }
  })
  return after
}

/** Replace a file's content with `content`, as the smallest splice that does it. */
function overwrite(handle, before, content, splice) {
  const { from, to, inserted } = minimalSplice(before, content)
  if (from === to && !inserted.length) return "unchanged"
  spliceContent(handle, before, [{ from, to, inserted }], splice)
  return `${to - from} chars removed, ${inserted.length} added`
}

/** The file a `path` or `url` names, with a label for messages. */
async function fileFor(input, ctx) {
  if (input.url) {
    const handle = await ctx.repo.find(input.url)
    if (!isFile(handle.doc())) throw new Error(`${input.url} is not a file document.`)
    return { handle, label: handle.doc()?.name ?? input.url, url: input.url, root: null, folder: null }
  }
  if (input.path == null || input.path === "") throw new Error("Pass `path` (from the root folder) or `url` to say which file.")
  const root = rootFor(input, ctx)
  const found = await resolvePath(ctx.repo, root, input.path)
  if (!isFile(found.doc)) throw new Error(`/${found.trail.join("/")} is not a file.`)
  return { handle: found.handle, label: `/${found.trail.join("/")}`, url: found.url, root, folder: found.trail.slice(0, -1) }
}

export const fsEdit = {
  id: "fs_edit",
  name: "Edit a file",
  target: { fields: ["url", "root"] },
  description: [
    "Change part of an existing file: give the exact text to replace (`old`) and what to put there (`new`).",
    "",
    "Copy `old` from what fs_read or fs_grep showed you, character for character, whitespace included. It must occur exactly once — if it does not, include a line or two around it, or pass `replaceAll: true` to change every occurrence. You never need character offsets: the tool finds the text and changes only the characters that differ, so the edit merges with concurrent edits elsewhere in the file and the history stays readable.",
    "",
    "The result shows the edited lines with a little context, so you can see the change landed without reading the file again. To replace a whole file, use fs_write; to rename or remove one, fs_delete plus fs_write.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  askWhen: writesCodeFiles,
  input_schema: {
    type: "object",
    required: ["old"],
    properties: {
      root: { type: "string", description: ROOT_DESCRIPTION },
      path: { type: "string", description: "Path to the file, e.g. 'my-tool/tool.js'. Pass this or `url`." },
      url: { type: "string", description: "The file document's URL, if you have it. Pass this or `path`." },
      old: { type: "string", description: "The exact text to replace, copied from the file." },
      new: { type: "string", description: "What to put in its place. Omit it, or pass an empty string, to delete `old`." },
      replaceAll: {
        type: "boolean",
        description: "Change every occurrence of `old` instead of requiring exactly one. Default false.",
      },
    },
  },

  async execute(input, ctx) {
    const old = input.old
    const replacement = input.new ?? ""
    if (typeof old !== "string" || !old.length) throw new Error("Pass `old`: the exact text to replace, copied from the file.")
    if (old === replacement) throw new Error("`old` and `new` are identical, so there is nothing to change.")

    const { handle, label, url, root, folder } = await fileFor(input, ctx)
    const before = contentToText(handle.doc()?.content)

    let positions
    if (input.replaceAll) {
      positions = []
      for (let at = before.indexOf(old); at !== -1; at = before.indexOf(old, at + old.length)) positions.push(at)
      if (!positions.length) locate(before, old) // throws, saying why it was not found
    } else {
      positions = [locate(before, old)]
    }

    const { from, to, inserted } = minimalSplice(old, replacement)
    const after = spliceContent(
      handle,
      before,
      positions.map((at) => ({ from: at + from, to: at + to, inserted })),
      ctx.splice
    )

    // Show the change in place: a few lines either side, numbered the way
    // fs_read numbers them, so the next edit can anchor on what is there now.
    const lines = after.split("\n")
    const line = lineOf(after, positions[0])
    const start = Math.max(1, line - 2)
    const end = Math.min(lines.length, line + replacement.split("\n").length + 1)
    const context = lines.slice(start - 1, end).map((text, i) => `${start + i}\t${text}`).join("\n")

    const n = positions.length
    if (folder) {
      const { node } = await resolvePath(ctx.repo, root, folder.join("/"))
      const entry = node && treeEntries(node).find((e) => e.url === url)
      if (entry) treeRepin(node, entry, handle)
    }
    const bumped = folder ? bumpedLine(await bumpPackages(ctx.repo, root, [folder])) : BY_URL_NOTE
    return {
      text: [
        `Edited ${label}: replaced ${n === 1 ? "1 occurrence" : `${n} occurrences`} of ${old.length} chars${n === 1 ? ` at line ${line}` : ""}. Now ${lines.length} lines, ${bytes(after.length)}.`,
        ``,
        truncate(context, 4000),
        ...(bumped ? [``, bumped] : []),
      ].join("\n"),
      doc: { url, name: handle.doc()?.name ?? label, kind: "file", bytes: after.length },
    }
  },

  summarize(input, output) {
    const what = input?.path ? String(input.path).split("/").filter(Boolean).pop() : "file"
    const line = String(output ?? "").match(/at line (\d+)/)?.[1]
    const count = String(output ?? "").match(/replaced (\d+) occurrences/)?.[1]
    return `edited ${what}${line ? ` · line ${line}` : count ? ` · ${count} places` : ""}`
  },
}

/**
 * Walk to a folder without creating anything along the way.
 *
 * `ensurePath` makes the folders it cannot find, which is right for writing and
 * wrong for deleting: a typo in a path to delete would otherwise silently build
 * the folders it was about to look in and then report finding nothing.
 */
async function findPath(repo, rootUrl, parts) {
  let node = treeNode(await repo.find(rootUrl))
  const trail = []
  for (const part of parts) {
    if (!node) throw new Error(`/${trail.join("/")} is not a folder.`)
    const existing = treeEntries(node).find((entry) => entry.name === part)
    if (!existing) return { node: null, missing: `/${[...trail, part].join("/")}` }
    ;({ node } = await treeEnter(repo, existing))
    trail.push(part)
  }
  if (!node) throw new Error(`/${trail.join("/")} is not a folder.`)
  return { node, missing: null }
}

export const fsDelete = {
  id: "fs_delete",
  name: "Delete a file or folder",
  target: { fields: ["root"] },
  description: [
    "Remove a file or folder from the folder that contains it.",
    "",
    "Use it when a file should no longer be part of a package — you restructured, renamed something, or wrote a file you did not end up needing. A package that keeps its abandoned files ships dead code, and a stray entry point can make tool_check load the wrong thing.",
    "",
    "This unlinks: it takes the entry out of its parent folder. The document itself still exists and is still in the history, so nothing is destroyed and a mistake is recoverable — but it will no longer be found by path, by fs_list, or by a build.",
    "",
    "Renaming or moving is this plus fs_write. Deleting a folder takes everything under it out with it, so name the exact path you mean.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  askWhen: deletesCode,
  input_schema: {
    type: "object",
    required: ["path"],
    properties: {
      root: { type: "string", description: ROOT_DESCRIPTION },
      path: { type: "string", description: "Path of the file or folder to remove, e.g. 'tally/old-tool.js'." },
    },
  },

  async execute(input, ctx) {
    const parts = String(input.path ?? "").split("/").filter(Boolean)
    if (!parts.length) throw new Error("Pass the path of the file or folder to remove.")

    const root = rootFor(input, ctx)
    const name = parts.pop()
    const { node: folder, missing } = await findPath(ctx.repo, root, parts)
    if (!folder) throw new Error(`${missing} does not exist, so '${input.path}' cannot be removed.`)

    const entries = treeEntries(folder)
    const entry = entries.find((e) => e.name === name)
    if (!entry) {
      const available = entries.map((e) => e.name).join(", ")
      throw new Error(
        `'${name}' is not in /${parts.join("/")}. It contains: ${available || "nothing"}`
      )
    }

    // Count what goes with a folder, so the result says how much was removed
    // rather than leaving the agent to assume it was one thing.
    let removed = 1
    if (entry.type === "folder") {
      try {
        const { node: inside } = await treeEnter(ctx.repo, entry)
        removed += inside ? treeEntries(inside).length : 0
      } catch {
        /* an unreadable folder is still unlinked; the count is just a count */
      }
    }

    treeRemove(folder, entry)
    const bumped = bumpedLine(await bumpPackages(ctx.repo, root, [parts]))

    return `Removed ${entry.type} '${input.path}'${
      entry.type === "folder" ? ` and the ${removed - 1} entr${removed - 1 === 1 ? "y" : "ies"} in it` : ""
    }. ${
      entry.url
        ? `The document still exists at ${entry.url} — this unlinked it, it did not destroy it.`
        : "The documents in it still exist — this unlinked them, it did not destroy them."
    }${bumped ? `\n\n${bumped}` : ""}`
  },

  summarize(input) {
    return `removed ${String(input?.path ?? "").split("/").filter(Boolean).pop() ?? ""}`
  },
}

export default [fsList, fsRead, fsGrep, fsWrite, fsEdit, fsDelete]
