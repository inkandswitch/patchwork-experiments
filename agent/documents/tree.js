/**
 * Folder trees: what a folder holds, and walking, linking and unlinking in it.
 *
 * A tree is made of two shapes of document, and everything here reads and
 * writes both the same way:
 *
 *   a folder document     `{ title, docs: [{ name, type, url }] }`, Patchwork's
 *   a directory document  what pushwork writes for a package: one document
 *                         keyed by full path, `"src/index.ts": "automerge:…"`,
 *                         each value a link to a file document, pinned to
 *                         heads for build output. A folder inside one is only
 *                         a shared prefix and has no document of its own.
 *
 * A place that can hold files is a tree node, `{ handle, prefix }`: a folder
 * document (prefix null) or a prefix inside a directory document ("" or a
 * string ending "/"). Its entries are `{ name, type, url, node? }`, the same
 * whichever shape they came from, so `src` is a folder to list, walk and write
 * into whether it is a document of its own or a prefix on some keys.
 */

import { textOf } from "./values.js"

export function isFolder(doc) {
  return !!doc && Array.isArray(doc.docs)
}

export function isFile(doc) {
  return !!doc && "content" in doc
}

/** A directory document: what pushwork writes for a package (its "vfs" shape). */
export function isDirectory(doc) {
  return doc?.["@patchwork"]?.type === "directory"
}

/** Keys a directory document uses for itself rather than for files. */
const DIRECTORY_RESERVED = new Set(["@patchwork", "lastSyncAt", "contentVersion", "title"])

/** A link's URL, held as a string or an ImmutableString; null when it is not one. */
function linkUrl(value) {
  const text = textOf(value)
  return text != null && text.startsWith("automerge:") ? text : null
}

/** The tree node a document is, or null when it is neither a folder nor a directory. */
export function treeNode(handle) {
  const doc = handle?.doc()
  if (isFolder(doc)) return { handle, prefix: null }
  if (isDirectory(doc)) return { handle, prefix: "" }
  return null
}

/** What is under `prefix` in a document: its entries, as treeEntries gives them. */
function entriesIn(doc, prefix, handle) {
  if (prefix === null) {
    return (doc?.docs ?? []).map((d) => ({ name: textOf(d?.name) ?? d?.name, type: textOf(d?.type) ?? d?.type, url: textOf(d?.url) ?? d?.url }))
  }
  const entries = new Map()
  for (const [key, value] of Object.entries(doc ?? {})) {
    if (DIRECTORY_RESERVED.has(key) || !key.startsWith(prefix)) continue
    const url = linkUrl(value)
    if (!url) continue
    const rest = key.slice(prefix.length)
    const slash = rest.indexOf("/")
    if (slash === -1) {
      entries.set(rest, { name: rest, type: "file", url })
    } else {
      const name = rest.slice(0, slash)
      if (!entries.has(name)) {
        entries.set(name, { name, type: "folder", url: null, node: { handle, prefix: `${prefix}${name}/` } })
      }
    }
  }
  return [...entries.values()]
}

/** What is in a tree node: `{ name, type, url, node? }`; `node` for a prefix inside a directory. */
export function treeEntries(node) {
  return entriesIn(node.handle.doc(), node.prefix, node.handle)
}

/**
 * What is at the top of a folder or directory document, read off the document
 * alone, or null when it is neither. For a question about a document in hand,
 * where there is no handle to make a node of.
 */
export function entriesOf(doc) {
  if (isFolder(doc)) return entriesIn(doc, null, null)
  if (isDirectory(doc)) return entriesIn(doc, "", null)
  return null
}

/**
 * Might this entry be a tree, judged from the listing alone? A prefix in a
 * directory is; a link is when it says it is a folder or a directory. Walkers
 * that must not load every document in an account ask this first.
 */
export function isTreeEntry(entry) {
  return !!entry?.node || entry?.type === "folder" || entry?.type === "directory"
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

/**
 * Link a document into a tree node under a name. A folder document records
 * its type ("file" unless said); a directory knows only paths, so there the
 * link is the key.
 */
export function treeLink(node, { name, type = "file", url }) {
  node.handle.change((draft) => {
    if (node.prefix === null) {
      if (!draft.docs) draft.docs = []
      draft.docs.push({ name, type, url })
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

const MIME_BY_EXTENSION = {
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
}

/** Make a file document, typed by its extension. */
export async function createFile(repo, name, content) {
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

/** A child folder of a tree node, made if it does not exist. */
export async function treeChild(repo, node, name) {
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
  treeLink(node, { name, type: "folder", url: created.url })
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

/** Walk to a folder, making the folders along the way that are not there. */
export async function ensurePath(repo, rootUrl, parts) {
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
 * Walk to a folder without making anything along the way: `{ node, missing }`,
 * `missing` naming the first part of the path that is not there.
 *
 * `ensurePath` makes the folders it cannot find, which is right for writing and
 * wrong for deleting: a typo in a path to delete would otherwise silently build
 * the folders it was about to look in and then report finding nothing.
 */
export async function findPath(repo, rootUrl, parts) {
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

/**
 * Every file under a node, by path from it, judged from listings alone:
 * `{ files: [{ path, entry }], truncated }`. Only entries that may be trees
 * (isTreeEntry) are entered, so nothing but folders is loaded. An entry that
 * cannot be entered, or is not a tree after all, or lies deeper than
 * `maxDepth`, is listed as it is. `skip(path)` leaves an entry out, and
 * `stop()`, asked before each entry, ends the walk early (truncated).
 */
export async function treeFiles(repo, node, { maxDepth = 8, skip = null, stop = null } = {}) {
  const files = []
  let truncated = false
  const walk = async (here, prefix, depth) => {
    for (const entry of treeEntries(here)) {
      if (truncated) return
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (skip?.(path)) continue
      if (stop?.()) {
        truncated = true
        return
      }
      if (isTreeEntry(entry) && depth < maxDepth) {
        const { node: inside } = await treeEnter(repo, entry).catch(() => ({}))
        if (inside) {
          await walk(inside, path, depth + 1)
          continue
        }
      }
      files.push({ path, entry })
    }
  }
  await walk(node, "", 0)
  return { files, truncated }
}
