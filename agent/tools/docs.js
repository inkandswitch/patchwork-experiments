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

import { hostImport } from "../host/import.js"
import { applyOps, opLabel, valueAtOrThrow, OP_NAMES } from "../documents/ops.js"
import { isBytes, isLines, textForm, textOf, valueAt } from "../documents/values.js"
import { previewJson, preview, shape, bytes, truncate, noDocumentError } from "../documents/format.js"
import { editsBetween, editsOfChange, headsAt, matchEdit, touchesPath } from "../documents/history.js"
import { isCodePath } from "./folders.js"
import { entriesOf, isDirectory, isFile, isFolder, treeNode, treeLink } from "../documents/tree.js"
import { imageForModel } from "../documents/images.js"
import { findAll, MAX_MATCHES, pdfOf, pdfWithoutText } from "./read-source.js"
import { fileKind, officeText, describeFile } from "../documents/files.js"
import { shortDoc, pathLabel, describeOps } from "../documents/labels.js"

/** Resolve a url argument against the session's subject. */
function targetUrl(input, ctx) {
  const url = input?.url ?? ctx.subject
  if (!url) {
    throw noDocumentError(ctx)
  }
  return url
}

async function findDoc(url, ctx) {
  const handle = await ctx.repo.find(url)
  const doc = handle.doc()
  if (!doc) throw new Error(`Document ${url} could not be loaded.`)
  return { handle, doc }
}

/** How much of a string one ranged read returns by default. */
export const RANGE_LIMIT = 8000

/**
 * Text at a path, when it should be shown as itself: a string, an
 * ImmutableString, or a list shaped like lines (documents/values.js isLines),
 * as notebooks keep source. A list of strings that is not shaped so (tags, say)
 * is shown as a list. `what` says which, for the header.
 */
function shownText(value) {
  const held = textForm(value)
  if (!held) return null
  if (held.form === "lines") return isLines(value) ? { text: held.text, what: `a list of ${value.length} lines, joined: ` } : null
  return { text: held.text, what: held.form === "immutable" ? "an ImmutableString, " : "" }
}

/**
 * A slice of text, shown as itself — not JSON-escaped, so what the model
 * quotes from it is exactly what is there — and framed so the model knows
 * where it is. The header matters as much as the text: without it a model that
 * reads characters 8000–16000 cannot tell whether it has reached the end.
 */
export function readRange(value, input, url, path, what = "") {
  const total = value.length
  const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), total))
  const limit = Math.max(1, Math.floor(input.limit ?? RANGE_LIMIT))
  const end = Math.min(offset + limit, total)
  const remaining = total - end

  const header =
    `${url} /${path.join("/")} — ${what}characters ${offset}–${end} of ${total}` +
    (remaining ? `, ${remaining} remaining (read on with offset: ${end})` : ", to the end")

  return `${header}\n\n${value.slice(offset, end)}`
}

/**
 * Every string under `value` — at `path` in its document — that contains
 * `find`, case-insensitively and literally: `{ count, strings, hits }`, with
 * at most `max` hits kept, each `{ path, at, text }`. Bytes are skipped.
 */
export function findInValue(value, path, find, max = MAX_MATCHES) {
  const hits = []
  let count = 0
  let strings = 0
  const walk = (node, at, depth) => {
    if (node == null || depth > 64) return
    const text = textOf(node)
    if (text != null) {
      const found = findAll(text, find, Math.max(0, max - hits.length))
      if (!found.count) return
      strings++
      count += found.count
      for (const match of found.matches) hits.push({ path: at, at: match.at, text })
      return
    }
    if (isBytes(node) || typeof node !== "object") return
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, [...at, i], depth + 1))
    else for (const [key, item] of Object.entries(node)) walk(item, [...at, key], depth + 1)
  }
  walk(value, path, 0)
  return { count, strings, hits }
}

const LINE_SHOWN = 300

/** The line a match is on, whole when it is short, and its 1-based number. */
export function matchLine(text, at, length) {
  const start = text.lastIndexOf("\n", at - 1) + 1
  let end = text.indexOf("\n", at)
  if (end === -1) end = text.length
  let line = text.slice(start, end)
  if (line.length > LINE_SHOWN) {
    const from = Math.max(0, Math.min(at - start - 120, line.length - LINE_SHOWN))
    line = `${from > 0 ? "…" : ""}${line.slice(from, from + LINE_SHOWN)}${from + LINE_SHOWN < line.length ? "…" : ""}`
  }
  let number = 1
  for (let i = 0; i < start; i++) if (text.charCodeAt(i) === 10) number++
  return { number, line }
}

/** The page a PDF's text has `at` on: the last `[Page N]` line before it (documents/pdf-text.js), or null. */
export function pageAt(text, at) {
  const before = text.slice(0, at)
  const marks = [...before.matchAll(/^\[Page (\d+)\]$/gm)]
  return marks.length ? Number(marks[marks.length - 1][1]) : null
}

/**
 * What a doc_read with `find` says: each match as the path of its string, its
 * line there and the line itself, exactly as written — the path and anchor a
 * doc_edit takes — and how to read around one.
 */
function foundIn(url, path, find, { count, strings, hits }, { pages = false } = {}) {
  const where = `${url} /${path.join("/")}`
  if (!count) return `${where} — no match for "${find}".`
  const first = hits[0]
  const read = `doc_read {url:"${url}", path:${JSON.stringify(first.path)}, offset:${Math.max(0, first.at - 200)}}`
  return [
    `${where} — ${count} match${count === 1 ? "" : "es"} for "${find}" in ${strings} string${strings === 1 ? "" : "s"}${count > hits.length ? `, first ${hits.length} shown` : ""}. Each is its string's path, line and @offset, then the line as written. Read around one with ${read}.`,
    ...hits.map((hit) => {
      const { number, line } = matchLine(hit.text, hit.at, find.length)
      const page = pages ? pageAt(hit.text, hit.at) : null
      return `${JSON.stringify(hit.path)}${page ? ` page ${page},` : ""} line ${number} @${hit.at}: ${line}`
    }),
  ].join("\n")
}

export const docRead = {
  id: "doc_read",
  present: {
    verb: "read",
    detail: (i, subject) => pathLabel(i.path) ?? (i.shapeOnly ? "shape" : shortDoc(i.url, subject)),
  },
  name: "Read document",
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "Read an automerge document, or one path inside it. Defaults to the document this session is attached to. A file is read in the form you can use: an image is shown to you, a PDF gives its text, each page under a `[Page N]` line to cite (a scan with no text layer is handed to you whole), a Word, Excel or PowerPoint file gives its text, and text stored as bytes is decoded — read it, rather than opening it in a view to screenshot.",
    "",
    "Point `path` at text — a string, an ImmutableString, or a notebook cell's list of lines — and it is shown as itself, not JSON-escaped, so you can quote it exactly as a doc_edit anchor. Up to 8000 characters come at once; page on with `offset` and `limit`, and the result says how much is left. Inside a bigger value, long strings and byte arrays are summarized. For a page, PDF or response a fetch kept, source_read is better: it searches, and knows the headings.",
    "",
    "To find something without reading everything, pass `find`: it lists each match as its string's path and line (in a PDF, its page too), then the line exactly as written — the `path` and the anchor text doc_edit takes. Read around one with `path` and `offset`.",
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
      find: {
        type: "string",
        description: "Search instead of reading: every string under `path` (the whole document if none) containing this text, case-insensitive and literal, with its path, line number and the line as written.",
      },
      shapeOnly: {
        type: "boolean",
        description: "Return only the structure (keys and types), not the values. Good for a first look at a big document.",
      },
      offset: {
        type: "number",
        description: "For text: start here. Use with limit to page through a long one.",
      },
      limit: {
        type: "number",
        description: "For text: how many characters to return. Default 8000.",
      },
    },
  },
  async execute(input, ctx) {
    const url = targetUrl(input, ctx)
    const { doc } = await findDoc(url, ctx)
    const path = input.path ?? []
    const value = valueAt(doc, path)

    if (value === undefined) {
      const available = path.length
        ? Object.keys(valueAt(doc, path.slice(0, -1)) ?? {}).join(", ")
        : ""
      throw new Error(
        `No value at /${path.join("/")}.${available ? ` Available keys there: ${available}` : ""}`
      )
    }

    // A file is read in the form a model can use (documents/files.js), not as a count
    // of bytes: an image shown, a PDF's text read page by page (a scan handed over whole), an Office file's
    // text, text that arrived as bytes decoded.
    const wholeFile = path.length === 0 || (path.length === 1 && path[0] === "content")
    const kind = wholeFile && isBytes(doc.content) ? fileKind(doc) : null

    const find = String(input.find ?? "")
    if (find.trim()) {
      // A file's text is what is searched, when it has text: its bytes would be skipped.
      if (kind?.kind === "text") return foundIn(url, ["content"], find, findInValue(kind.text, ["content"], find))
      if (kind?.kind === "office") {
        const text = await officeText(doc.content, kind.format)
        return foundIn(url, ["content"], find, findInValue(text, ["content"], find))
      }
      if (kind?.kind === "pdf") {
        const mine = await pdfOf(doc, url)
        if (mine.text != null) return foundIn(url, ["content"], find, findInValue(mine.text, ["content"], find), { pages: true })
      }
      return foundIn(url, path, find, findInValue(value, path, find))
    }

    if (input.shapeOnly) return `${url} /${path.join("/")}\n${shape(value)}`
    if (kind) {
      const about = `${url} — ${describeFile(doc, kind)}`
      if (kind.kind === "image") {
        const shown = await imageForModel(doc.content, kind.type)
        if (!shown) return `${about}: an image too large to show from here.`
        return { text: `${about}${shown.width ? `, shown at ${shown.width}×${shown.height}` : ""}. The image is attached to this result.`, image: shown.url }
      }
      let pdfNote = null
      if (kind.kind === "pdf") {
        // Its words, read from the bytes, page by page; only a scan has none.
        const mine = await pdfOf(doc, url)
        if (mine.text == null) return pdfWithoutText(doc, url, doc.name ?? "document.pdf", mine)
        kind.text = mine.text
        pdfNote = mine.summary
      }
      let text = kind.kind === "text" || kind.kind === "pdf" ? kind.text : null
      if (kind.kind === "office") {
        try {
          text = await officeText(doc.content, kind.format)
        } catch (err) {
          return `${about}: its text could not be read (${err.message}).`
        }
      }
      if (text != null) {
        const from = kind.kind === "office" ? `the text of this ${kind.format} file` : kind.kind === "pdf" ? `the text of this PDF (${pdfNote ?? "read from the PDF"})` : "its text"
        if (input.offset != null || input.limit != null) return readRange(text, input, url, ["content"])
        const shown = text.slice(0, RANGE_LIMIT)
        return `${about} — ${from}, ${text.length} characters${text.length > shown.length ? `; the first ${shown.length} below (read on with offset: ${shown.length})` : ""}.\n\n${shown}`
      }
      return `${previewJson(value)}\n\n${about}: binary${doc.mimeType ? "" : " of an unknown kind"}, not something readable here as text, an image or a document.`
    }

    // A range over a string, so a long one can be read in full rather than
    // only ever as its first 2000 characters. Text written once (a kept
    // source's content, a tool result) is an ImmutableString, which pages the
    // same way once it is a string.
    const text = shownText(value)
    if (text) return readRange(text.text, input, url, path, text.what)

    return previewJson(value, {
      path,
      more: (at, shown) => `read on with doc_read {url:"${url}", path:${JSON.stringify(at)}, offset:${shown}}`,
      narrow: "point path at a part of it, or search it with find",
    })
  },
  summarize(input, output) {
    const where = input?.path?.length ? `/${input.path.join("/")}` : "document"
    if (String(input?.find ?? "").trim()) {
      const found = String(output ?? "").match(/— (\d+) match/)
      return `found "${input.find}" in ${where} · ${found ? found[1] : "0"}`
    }
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
  if (!entriesOf(doc)?.some((entry) => entry.name === "package.json")) return null
  if (isFolder(doc)) return "a package folder"
  if (isDirectory(doc)) return "a package"
  return null
}

/**
 * What to use instead of doc_edit on the documents only the runtime writes.
 * The repo is what refuses the write (kernel/scope.js); this only adds, to its
 * refusal, the tools that do the job, which saves the model a turn of guessing.
 */
function insteadOfKernel(doc) {
  const type = doc?.["@patchwork"]?.type
  if (type === "agent-workflow") {
    return "This is a workflow plan: change it with the workflow tools — workflow_add_steps for more steps, workflow_edit_steps for a step that has not started (its prompt, after, tier, budget, tools), workflow_reopen to send a finished step back, workflow_stop to stop one. From inside a step, workflow_request asks the orchestrator."
  }
  if (type === "agent-session") {
    return "This is an agent session: session_title renames it; workflow_answer or workflow_reopen (with a note) tells a step something; note_write keeps something for later sessions."
  }
  return null
}

const MAX_REPORT = 6000

export const docEdit = {
  id: "doc_edit",
  present: { verb: "edit", detail: (i) => describeOps(i.ops) },
  name: "Edit document",
  // The url defaults to the session's subject in execute(), so it does here.
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "Edit any automerge document. `ops` run in order as one change: all of them or none.",
    "Every op has `op` and `path` — the keys and indices from the root to the thing itself, as doc_read shows them, e.g. ['cells', 2, 'source'].",
    "",
    "Values (`value` is any JSON value, or one list item):",
    "• {op:'set', path, value} — set a field or list item; a missing field is created. Writes only what differs, so sending back an object you read with one field changed writes that field.",
    "• {op:'delete', path} — remove a field or list item.",
    "• {op:'insert', path, value} — path ends at a list index: insert before it (the list's length inserts at the end).",
    "• {op:'append' | 'prepend', path, value} — add an item at the end or start of a list (made if missing).",
    "• {op:'test', path, value} — stop the whole edit unless path holds exactly this. Put it first to guard an edit on what you read.",
    "",
    "Text (`text` is text) — in a string, an ImmutableString, or a list of lines such as a notebook cell's source; each keeps its form:",
    "• {op:'replace', path, find, text, all?} — replace the exact text `find` (it must occur once, unless all: true). text '' deletes it.",
    "• {op:'insert', path, after | before, text} — insert next to an exact anchor that occurs once.",
    "• {op:'append' | 'prepend', path, text} — add text at the end or start (made if missing).",
    "• {op:'set', path, text} — replace the whole text; only the characters that differ are written.",
    "Copy anchors exactly from a read, whitespace included. You never need character offsets.",
    "Instead of `text`, `from: {url?, path}` takes the text at that path — in another document, or a version URL from doc_history — so you never retype text that already exists.",
    "",
    "Long text: write it in pieces of at most about 6 kB, one call each — set or append the first, append the rest. A call cut off by your output limit is never run, and each result shows how the text now ends.",
    "",
    "The result shows each change as a short diff. Edits run without asking: history keeps every overwritten value (doc_history). Source code is the exception — edit code files with fs_edit or fs_write, which ask first.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["ops"],
    properties: {
      url: { type: "string", description: "The document. Defaults to the session's document; a workflow step has none, so pass it there." },
      ops: {
        type: "array",
        description: "Applied in order, in one change: all or none.",
        items: {
          type: "object",
          required: ["op", "path"],
          properties: {
            op: { type: "string", enum: OP_NAMES },
            path: {
              type: "array",
              items: { type: ["string", "number"] },
              description: "Keys and indices from the root to the thing itself. For insert with value, it ends at a list index.",
            },
            value: { description: "set/insert/append/prepend: the value or list item. test: what path must hold." },
            text: { type: "string", description: "Text ops: the text to put in. replace with '' deletes." },
            find: { type: "string", description: "replace: the exact text to replace, copied from a read." },
            all: { type: "boolean", description: "replace: every occurrence instead of exactly one." },
            before: { type: "string", description: "insert text: the exact text to insert before (occurs once)." },
            after: { type: "string", description: "insert text: the exact text to insert after (occurs once)." },
            from: {
              type: "object",
              description: "Instead of `text`: the text at this path, in another document (or version) if url is given.",
              properties: { url: { type: "string" }, path: { type: "array", items: { type: ["string", "number"] } } },
              required: ["path"],
            },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    const url = targetUrl(input, ctx)
    const ops = input.ops
    if (!Array.isArray(ops) || !ops.length) throw new Error("Pass `ops`: a list of at least one op, like [{ op: \"set\", path: [\"title\"], value: \"New\" }].")

    const { handle, doc } = await findDoc(url, ctx)
    const code = sourceCode(doc)
    if (code) {
      throw new Error(
        `${url} is ${code}. Edit source code with fs_edit or fs_write: doc_edit runs without asking because history can undo a document, but code runs with the user's authority on its next load, so the file tools ask first.`
      )
    }

    // Text copied `from` another document, or another version of this one, is
    // read before the change: the change callback cannot wait on the repo.
    const others = new Map()
    for (const op of ops) {
      const from = op?.from?.url
      if (typeof from === "string" && from !== url && !others.has(from)) {
        try {
          others.set(from, (await findDoc(from, ctx)).doc)
        } catch (err) {
          throw new Error(`${opLabel(op, ops.indexOf(op))}: from ${from}: ${err.message} Nothing was changed.`)
        }
      }
    }
    const read = (from, draft) => (from.url && from.url !== url ? valueAtOrThrow(others.get(from.url), from.path) : valueAtOrThrow(draft, from.path))

    // One change for all ops: a partly applied edit is worse than none, and a
    // throw inside the change abandons it.
    let done = []
    try {
      handle.change((draft) => {
        done = applyOps(draft, ops, { spliceText: ctx.splice, read })
      })
    } catch (err) {
      const instead = insteadOfKernel(doc)
      const message = `${err.message}${/\.$/.test(err.message) ? "" : "."}`
      throw new Error(instead ? `${message} ${instead}` : `${message} Nothing was changed: the ops apply together or not at all.`)
    }

    const title = doc?.title ?? doc?.name ?? doc?.["@patchwork"]?.title
    const head = `Edited ${title ? `"${String(title)}" (${url})` : url} in one change:`
    return truncate([head, ...done].join("\n"), MAX_REPORT)
  },
  summarize(input) {
    const ops = Array.isArray(input?.ops) ? input.ops : []
    const kinds = [...new Set(ops.map((op) => op?.op).filter((op) => typeof op === "string"))]
    return `edited document · ${ops.length} op${ops.length === 1 ? "" : "s"}${kinds.length ? ` (${kinds.join(", ")})` : ""}`
  },
}

export const docCreate = {
  id: "doc_create",
  present: { verb: "create", detail: (i) => i.title || i.datatype || null },
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
      facts: { plugins: [{ type: "patchwork:datatype", id: input.datatype }] },
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
  treeLink(node, { name, type, url })
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
  present: { verb: "history", detail: (i, subject) => shortDoc(i.url, subject) },
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
