/**
 * Document tools — the agent's hands on automerge.
 *
 * Every one of these runs in the worker tier: they need a repo and nothing
 * else, so they keep working when no tab is in the foreground.
 *
 * `ctx` carries { repo, subject, splice, signal }. `subject` is the document
 * the session is attached to, and is the default target of every tool that
 * takes a url — so "add a field" works without the model first having to ask
 * what it is looking at.
 */

import { isImmutableString } from "@automerge/automerge"
import { hostImport } from "./host.js"
import { applyOps, OpError } from "./ops.js"
import { previewJson, preview, shape, bytes } from "./format.js"
import { editsBetween, editsOfChange, headsAt, matchEdit, touchesPath } from "./history.js"
import { isCodePath, isDirectory, isFile, isFolder, treeNode } from "./folders.js"

/** Resolve a url argument against the session's subject. */
function targetUrl(input, ctx) {
  const url = input?.url ?? ctx.subject
  if (!url) {
    throw new Error("No document specified and this session is not attached to one. Pass `url`.")
  }
  return url
}

async function findDoc(url, ctx) {
  const handle = await ctx.repo.find(url)
  const doc = handle.doc()
  if (!doc) throw new Error(`Document ${url} could not be loaded.`)
  return { handle, doc }
}

function valueAtPath(doc, path = []) {
  let node = doc
  for (const key of path) {
    if (node == null) return undefined
    node = node[key]
  }
  return node
}

/** How much of a string one ranged read returns by default. */
export const RANGE_LIMIT = 8000

/**
 * A slice of a long string, framed so the model knows where it is.
 *
 * The header matters as much as the text: without it a model that reads
 * characters 8000–16000 has no way to tell whether it has reached the end, and
 * either stops early or keeps asking.
 */
export function readRange(value, input, url, path) {
  const total = value.length
  const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), total))
  const limit = Math.max(1, Math.floor(input.limit ?? RANGE_LIMIT))
  const end = Math.min(offset + limit, total)
  const remaining = total - end

  const header =
    `${url} /${path.join("/")} — characters ${offset}–${end} of ${total}` +
    (remaining ? `, ${remaining} remaining (read on with offset: ${end})` : ", to the end")

  return `${header}\n\n${value.slice(offset, end)}`
}

export const docRead = {
  id: "doc_read",
  name: "Read document",
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "Read an automerge document, or one path inside it. Defaults to the document this session is attached to.",
    "",
    "Large strings and byte arrays are summarized rather than dumped. To read a long one in full — a file's content, say — point `path` at the string and page through it with `offset` and `limit`. The result says how much is left. For a page, PDF or response a fetch kept, source_read is better: it searches, and knows the headings.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "automerge: URL. Defaults to the session's document." },
      path: {
        type: "array",
        items: { type: ["string", "number"] },
        description: "Path into the document, e.g. ['messages', 0, 'text']. Omit for the whole doc.",
      },
      shapeOnly: {
        type: "boolean",
        description: "Return only the structure (keys and types), not the values. Good for a first look at a big document.",
      },
      offset: {
        type: "number",
        description: "For a string value: start here. Use with limit to page through a long one.",
      },
      limit: {
        type: "number",
        description: "For a string value: how many characters to return. Default 8000 when offset is given.",
      },
    },
  },
  async execute(input, ctx) {
    const url = targetUrl(input, ctx)
    const { doc } = await findDoc(url, ctx)
    const path = input.path ?? []
    const value = valueAtPath(doc, path)

    if (value === undefined) {
      const available = path.length
        ? Object.keys(valueAtPath(doc, path.slice(0, -1)) ?? {}).join(", ")
        : ""
      throw new Error(
        `No value at /${path.join("/")}.${available ? ` Available keys there: ${available}` : ""}`
      )
    }

    if (input.shapeOnly) return `${url} /${path.join("/")}\n${shape(value)}`

    // A range over a string, so a long one can be read in full rather than
    // only ever as its first 2000 characters. Text written once (a kept
    // source's content, a tool result) is an ImmutableString, which pages the
    // same way once it is a string.
    const text = typeof value === "string" ? value : isImmutableString(value) ? String(value) : null
    if (text != null && (input.offset != null || input.limit != null)) {
      return readRange(text, input, url, path)
    }

    return previewJson(value)
  },
  summarize(input, output) {
    const where = input?.path?.length ? `/${input.path.join("/")}` : "document"
    if (input?.offset != null || input?.limit != null) {
      const range = String(output ?? "").match(/characters (\d+)–(\d+)/)
      return `read ${where}${range ? ` ${range[1]}–${range[2]}` : ""} · ${bytes(String(output ?? "").length)}`
    }
    return `read ${where} · ${bytes(String(output ?? "").length)}`
  },
}

/**
 * Is this document source code? doc_edit is approved before it knows what it
 * is pointed at, so it checks here, once it does: a code file, or a package
 * (a folder or directory holding a package.json). See session.needsApproval.
 */
function sourceCode(doc) {
  if (isFile(doc) && isCodePath(doc.name)) return `the source file ${doc.name}`
  if (isFolder(doc) && doc.docs.some((entry) => entry?.name === "package.json")) return "a package folder"
  if (isDirectory(doc) && "package.json" in doc) return "a package"
  return null
}

export const docEdit = {
  id: "doc_edit",
  name: "Edit document",
  // The url defaults to the session's subject in execute(), so it does here.
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "Edit any automerge document with one or more ops. Each op is { path, range, value }:",
    "• path: array of keys/indices from the document root to what you are touching. [] is the root.",
    "• range: [from, to] to SPLICE — replacing characters when the target is a string, items when it is a list.",
    "  Insert without deleting by using [n, n]. Or give a key (string/number) to SET that key on the map/list at path.",
    "• find: for a string, the exact text to replace instead of a range. It must occur exactly once. This is how to change text you have read — you never need to count characters.",
    "• value: what to insert or set. Omit it (or null) to delete.",
    "Examples: set a title — { path: [], range: 'title', value: 'New' }.",
    "Append to a list — { path: ['items'], range: [2, 2], value: { done: false } }.",
    "Change some text — { path: ['body'], find: 'teh cat', value: 'the cat' }.",
    "Insert text at offset 10 — { path: ['body'], range: [10, 10], value: 'hello' }.",
    "Setting a value writes only what differs, so sending back a whole object you read with one field changed writes just that field, and merges with anyone else's edits. Setting a counter to a number increments it.",
    "Edits to documents run without asking: history keeps every overwritten value (doc_history). Source code is the exception — edit code files with fs_edit/fs_write, which ask first.",
    "For a file, fs_edit does the same by path.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["ops"],
    properties: {
      url: { type: "string", description: "Defaults to the session's document." },
      ops: {
        type: "array",
        description: "Ops applied in order, in a single change.",
        items: {
          type: "object",
          properties: {
            path: { type: "array", items: { type: ["string", "number"] } },
            range: {
              description: "[from,to] to splice, or a key to set/delete.",
              oneOf: [
                { type: "array", items: { type: "number" } },
                { type: "string" },
                { type: "number" },
              ],
            },
            find: {
              type: "string",
              description:
                "For a string at path: the exact text to replace with `value` (omit value to delete it). Must occur exactly once. Use this instead of counting offsets for a range.",
            },
            value: { description: "What to insert or set. Omit to delete." },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    const url = targetUrl(input, ctx)
    const ops = input.ops ?? []
    if (!Array.isArray(ops) || !ops.length) throw new Error("Pass at least one op.")

    const { handle, doc } = await findDoc(url, ctx)
    const code = sourceCode(doc)
    if (code) {
      throw new Error(
        `${url} is ${code}. Edit source code with fs_edit or fs_write: doc_edit runs without asking because history can undo a document, but code runs with the user's authority on its next load, so the file tools ask first.`
      )
    }
    let done = []
    let failure = null

    // One change for all ops: a partially-applied edit is worse than none, and
    // automerge gives us the all-or-nothing for free if we throw inside.
    handle.change((draft) => {
      try {
        done = applyOps(draft, ops, { spliceText: ctx.splice })
      } catch (err) {
        failure = err
        throw err // abandon the change
      }
    })

    if (failure) {
      const hint = failure instanceof OpError ? "" : " (check the path exists — read the document first)"
      throw new Error(`${failure.message}${hint}`)
    }

    return `Applied ${done.length} op(s) to ${url}:\n${done.map((d) => `• ${d}`).join("\n")}`
  },
  summarize(input) {
    const n = input?.ops?.length ?? 0
    return `edited document · ${n} op${n === 1 ? "" : "s"}`
  },
}

export const docCreate = {
  id: "doc_create",
  name: "Create document",
  // A new document is about no existing one. Keyed on the subject, its card
  // offered "this document", which was not what it was going to touch.
  target: "none",
  description: [
    "Create a new document of an installed datatype, and return its URL. This is how to make something for the person — a table, a board, a list, a sketch — so it opens in a real tool and merges field by field, instead of keeping it as a file.",
    "",
    "Use registry_list to find the datatype id first — this fails on one that is not installed, and the id is rarely what you would guess.",
    "",
    "Pass `folder` (a folder's automerge: URL) to file it there; without one it is listed only in this session's panel of what it made. Then doc_read it to see the shape the datatype starts with, and fill it in with doc_edit.",
  ].join("\n"),
  // Host tier: it needs the datatype from the page's plugin registry.
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["datatype"],
    properties: {
      datatype: { type: "string", description: "Datatype id, e.g. 'folder' or 'chitterchatter'. Get one from registry_list." },
      title: { type: "string", description: "What to call it. Give it one — an untitled document is hard for the user to find later." },
      folder: { type: "string", description: "automerge: URL of the folder to file it in, under its title." },
    },
  },
  async execute(input, ctx) {
    const { getRegistry, createDocOfDatatype2 } = await hostImport("plugins")
    const datatype = await getRegistry("patchwork:datatype").load(input.datatype)
    if (!datatype) throw new Error(`No datatype '${input.datatype}' is installed.`)

    const handle = await createDocOfDatatype2(datatype, ctx.repo, (doc) => {
      if (input.title && datatype.module.setTitle) datatype.module.setTitle(doc, input.title)
      else if (input.title) doc.title = input.title
    })

    const filed = input.folder ? await fileInFolder(ctx.repo, input.folder, { name: input.title || input.datatype, type: input.datatype, url: handle.url }) : null

    return {
      text: `Created ${input.datatype} document: ${handle.url}${filed ? ` — filed in ${filed}` : ""}. doc_read it to see its shape, then fill it in with doc_edit.`,
      // Without this the new document is reachable from this one line of the
      // transcript and nowhere else — the shortest path to losing the thing the
      // user just asked for.
      doc: { url: handle.url, name: input.title || input.datatype, kind: input.datatype },
    }
  },
  summarize(input, output) {
    return `created ${input?.datatype} · ${String(output ?? "").split(": ")[1] ?? ""}`
  },
}

/**
 * Link a document into a folder under a name, as the datatype it is. Returns
 * how to say where it went; throws when the URL is not a folder.
 */
export async function fileInFolder(repo, folderUrl, { name, type, url }) {
  const handle = await repo.find(String(folderUrl).trim())
  const node = treeNode(handle)
  if (!node) throw new Error(`${folderUrl} is not a folder; the document was made but not filed (${url}).`)
  handle.change((d) => {
    if (node.prefix === null) {
      if (!d.docs) d.docs = []
      d.docs.push({ name, type, url })
    } else {
      d[`${node.prefix}${name}`] = url
    }
  })
  const doc = handle.doc()
  return `'${doc?.title ?? doc?.name ?? "folder"}' (${handle.url})`
}

/** Values in a history are evidence, not content: enough to recognise, with doc_read for the rest. */
const EDIT_PREVIEW = { maxString: 200, maxItems: 10, maxDepth: 4 }
const EDITS_PER_CHANGE = 8
const EDITS_PER_COMPARE = 60
const DEFAULT_SCAN = 500

export const docHistory = {
  id: "doc_history",
  name: "Document history",
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "See how a document changed. Every edit is listed with its `path`, what it did (set, insert, delete, increment, format), the new `value`, and `was` — the value it replaced or removed. That old value is how you recover lost data.",
    "",
    "Three ways to use it:",
    "- **Recent changes** (no options): the last `limit` changes, newest first, each with its time, editor and edits.",
    "- **When did X go?** Pass `query` (text or regex, matched against values written AND removed) and/or `path` (only edits at, under or above it). This searches back through up to `scan` changes, not just `limit`, and lists only the changes that matched, with a snippet. If it stopped before the beginning, the result gives a `skip` to continue further back.",
    "- **Compare two versions.** Pass `from` and optionally `to` (default: now). Each is either a version URL from an earlier result (`before`/`after`) or a time like '2026-11-14T09:00'. You get the net edits between them — the right tool when text was typed one keystroke per change, or to see what is different now from how it was on a given day. Narrow it with `path`/`query`. Bisect with two compares to pin down when something happened.",
    "",
    "Long values are cut short. For the whole thing, doc_read a `before`/`after`/`from` URL — a read-only snapshot — with the edit's `path`. Never edit through those URLs; to restore, doc_edit the live document. This tool changes nothing.",
    "",
    "Times are each writer's own clock. `editor` is an automerge actor id: a device or session, not a person.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Document to describe. Defaults to the session's document." },
      path: {
        type: "array",
        items: { type: ["string", "number"] },
        description: "Only edits at, under or above this path, e.g. ['tasks', 3].",
      },
      query: { type: "string", description: "Only edits whose new or removed value matches this (case-insensitive text or regex)." },
      from: { type: "string", description: "Compare from this version: a version URL from an earlier result, or a time (ISO, e.g. '2026-11-14T09:00')." },
      to: { type: "string", description: "Compare to this version. Same forms as `from`. Default: the current document." },
      limit: { type: "number", description: "How many changes to list. Default 20." },
      skip: { type: "number", description: "Start this many changes back from the newest. Use the `skip` an earlier result gave to keep going." },
      scan: { type: "number", description: `With path or query: how many changes to search before stopping. Default ${DEFAULT_SCAN}.` },
    },
  },
  async execute(input, ctx) {
    // A version URL pins heads; the history belongs to the document behind it.
    const url = targetUrl(input, ctx).split("#")[0]
    const { handle, doc } = await findDoc(url, ctx)
    const automerge = await hostImport("automerge")
    const { stringifyAutomergeUrl, encodeHeads, decodeHeads } = await hostImport("repo")

    const versionUrl = (hashes) =>
      hashes.length ? stringifyAutomergeUrl({ documentId: handle.documentId, heads: encodeHeads(hashes) }) : null

    let pattern = null
    if (input.query) {
      try {
        pattern = new RegExp(input.query, "i")
      } catch {
        pattern = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      }
    }
    const filtering = Boolean(pattern || input.path)

    /** The edits worth showing, each with the snippet that matched. */
    const select = (edits) => {
      const kept = []
      for (const edit of edits) {
        if (input.path && !touchesPath(edit, input.path)) continue
        let match = null
        if (pattern) {
          match = matchEdit(edit, pattern, { shown: EDIT_PREVIEW.maxString })
          if (match === null) continue
        }
        kept.push(match ? { ...edit, match } : edit)
      }
      return kept
    }
    const show = (edits, cap) => edits.slice(0, cap).map((edit) => preview(edit, EDIT_PREVIEW))

    // ---- Compare two versions --------------------------------------------
    if (input.from || input.to) {
      const resolve = (version, name) => {
        if (!version || version === "now") return automerge.getHeads(doc)
        if (version.startsWith("automerge:")) {
          const [, heads] = version.split("#")
          if (!heads) throw new Error(`\`${name}\` is a document URL with no version in it. Use a before/after URL from an earlier result, or a time.`)
          return decodeHeads(heads.split("|"))
        }
        const when = new Date(version)
        if (Number.isNaN(when.getTime())) throw new Error(`\`${name}\` must be a version URL or a time like '2026-11-14T09:00', not '${version}'.`)
        return headsAt(automerge, doc, when)
      }
      const fromHeads = input.from ? resolve(input.from, "from") : []
      const toHeads = resolve(input.to, "to")
      const edits = select(editsBetween(automerge, doc, fromHeads, toHeads))

      return previewJson({
        url,
        from: versionUrl(fromHeads) ?? "(empty document)",
        to: versionUrl(toHeads),
        edits: edits.length,
        ...(edits.length > EDITS_PER_COMPARE
          ? { note: `Showing the first ${EDITS_PER_COMPARE}. Narrow with path or query, or compare a shorter span.` }
          : {}),
        changes: show(edits, EDITS_PER_COMPARE),
      })
    }

    // ---- Walk the changes, newest first -------------------------------------
    const all = automerge.getAllChanges(doc)
    const limit = input.limit ?? 20
    const skip = input.skip ?? 0
    const scan = filtering ? input.scan ?? DEFAULT_SCAN : limit

    const listed = []
    let index = all.length - 1 - skip
    let scanned = 0
    for (; index >= 0 && scanned < scan && listed.length < limit; index--, scanned++) {
      const meta = automerge.decodeChange(all[index])
      const edits = select(editsOfChange(automerge, doc, meta))
      if (filtering && !edits.length) continue
      listed.push({
        time: meta.time ? new Date(meta.time * 1000).toISOString() : null,
        editor: meta.actor.slice(0, 8),
        ...(meta.message ? { message: meta.message } : {}),
        edits: show(edits, EDITS_PER_CHANGE),
        ...(edits.length > EDITS_PER_CHANGE ? { moreEdits: edits.length - EDITS_PER_CHANGE } : {}),
        before: versionUrl(meta.deps) ?? "(empty document)",
        after: versionUrl([meta.hash]),
      })
    }

    const remaining = index + 1
    return previewJson({
      url,
      totalChanges: all.length,
      searched: `${scanned} change${scanned === 1 ? "" : "s"}, starting ${skip} back from the newest`,
      ...(remaining > 0 ? { olderChangesLeft: remaining, skip: skip + scanned } : {}),
      ...(filtering && !listed.length ? { found: "nothing in the changes searched" } : {}),
      changes: listed,
    })
  },
  summarize(input, output) {
    const text = String(output ?? "")
    if (input?.from || input?.to) {
      const match = text.match(/"edits":\s*(\d+)/)
      return `compared versions · ${match ? match[1] : "?"} edits`
    }
    const total = text.match(/"totalChanges":\s*(\d+)/)
    const what = input?.query ? `"${input.query}" in history` : input?.path ? `history of /${input.path.join("/")}` : "history"
    return `${what} · ${total ? total[1] : "?"} changes`
  },
}

export default [docRead, docEdit, docCreate, docHistory]
