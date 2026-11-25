/**
 * A folder of markdown files: what notes and guides each keep, and what a
 * folder of skills is read as.
 *
 * A store is a folder with a name inside a parent folder. It is found by that
 * name, or by a marker set on the folder document itself so that a renamed
 * folder is still found, and it is made, with its README, the first time
 * something is written. Files are written through tools/folders.js writeFile,
 * the write fs_write makes, so a rewrite changes only the characters that
 * differ and a note's history says what changed.
 *
 * Where a store's folder is, once found, is remembered for the context it was
 * found for (a WeakMap here, keyed by that context), so a session looks it up
 * once and the context itself is left as it was given.
 */

import { writeFile } from "../tools/folders.js"
import { contentText } from "../documents/values.js"
import { createFolder, isTreeEntry, treeEnter, treeEntries, treeLink, treeNode, treeRemove } from "../documents/tree.js"

const README = "README.md"

/** Where each store's folder was found, by context: ctx → Map(store name → url). */
const found = new WeakMap()

/** The text of a file entry in a folder, or null when it cannot be read. */
export async function entryText(repo, entry) {
  try {
    return contentText((await treeEnter(repo, entry)).handle.doc()?.content)
  } catch {
    return null
  }
}

/** The tree node at a folder URL, or null. */
async function nodeAt(repo, url) {
  try {
    return treeNode(await repo.find(url))
  } catch {
    return null
  }
}

/**
 * A store. `parent(ctx, { create })` gives the URL of the folder it lives in
 * (null when there is none), `given(ctx)` the store's own folder when the
 * context names it outright, `marker` the field set on the folder document,
 * and `readme` the README written into a new folder.
 */
export function markdownFolder({ name, parent, given = () => null, marker = null, readme = null }) {
  const remembered = (ctx) => found.get(ctx)?.get(name) ?? null
  const remember = (ctx, url) => {
    if (!found.has(ctx)) found.set(ctx, new Map())
    found.get(ctx).set(name, url)
  }

  /** The folder's URL: given, remembered, found, or (with `create`) made. Null when there is nowhere to keep it. */
  async function folder(ctx, { create = false } = {}) {
    const known = given(ctx) ?? remembered(ctx)
    if (known) return known
    if (!ctx.repo) return null
    const parentUrl = await parent(ctx, { create })
    if (!parentUrl) return null
    const home = await nodeAt(ctx.repo, parentUrl)
    if (!home) return null

    const folders = treeEntries(home).filter((entry) => entry.type === "folder" && entry.url)
    let url = folders.find((entry) => entry.name === name)?.url ?? null
    if (!url && marker) {
      for (const entry of folders) {
        try {
          if ((await ctx.repo.find(entry.url)).doc()?.[marker]) {
            url = entry.url
            break
          }
        } catch {
          /* unreachable entry; not ours */
        }
      }
    }

    if (!url && create) {
      const made = await createFolder(ctx.repo, name)
      if (marker) made.change((d) => { d[marker] = true })
      treeLink(home, { name, type: "folder", url: made.url })
      url = made.url
      if (readme) await writeFile(ctx.repo, treeNode(made), README, readme, ctx.splice)
    }

    if (url) remember(ctx, url)
    return url
  }

  /** Every markdown file but the README, by file name: `{ folderUrl, files: [{ file, url, text }] }`. */
  async function list(ctx) {
    const folderUrl = await folder(ctx)
    if (!folderUrl) return { folderUrl: null, files: [] }
    const node = await nodeAt(ctx.repo, folderUrl)
    const files = []
    for (const entry of node ? treeEntries(node) : []) {
      if (isTreeEntry(entry) || !/\.md$/i.test(entry.name) || entry.name === README) continue
      files.push({ file: entry.name, url: entry.url, text: (await entryText(ctx.repo, entry)) ?? "" })
    }
    files.sort((a, b) => a.file.localeCompare(b.file))
    return { folderUrl, files }
  }

  /** One file's text, any file in the folder; null when there is no such file. */
  async function read(ctx, file) {
    const folderUrl = await folder(ctx)
    const node = folderUrl && (await nodeAt(ctx.repo, folderUrl))
    const entry = node && treeEntries(node).find((e) => e.name === file)
    return entry ? entryText(ctx.repo, entry) : null
  }

  /** Write one file, making the folder if it is not there. Returns the folder's URL. */
  async function write(ctx, file, content) {
    const folderUrl = await folder(ctx, { create: true })
    const node = folderUrl && (await nodeAt(ctx.repo, folderUrl))
    if (!node) return null
    await writeFile(ctx.repo, node, file, content, ctx.splice)
    return folderUrl
  }

  /** Unlink one file. The document stays in history; true when there was one to unlink. */
  async function remove(ctx, file) {
    const folderUrl = await folder(ctx)
    const node = folderUrl && (await nodeAt(ctx.repo, folderUrl))
    const entry = node && treeEntries(node).find((e) => e.name === file)
    if (!entry) return false
    treeRemove(node, entry)
    return true
  }

  return { name, folder, list, read, write, remove }
}
