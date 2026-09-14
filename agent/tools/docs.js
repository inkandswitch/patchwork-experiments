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

import { hostImport } from "./host.js"
import { applyOps, OpError } from "./ops.js"
import { previewJson, shape, bytes } from "./format.js"

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
  description: [
    "Read an automerge document, or one path inside it. Defaults to the document this session is attached to.",
    "",
    "Large strings and byte arrays are summarized rather than dumped. To read a long one in full — a page web_fetch saved, a file's content — point `path` at the string and page through it with `offset` and `limit`. The result says how much is left.",
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
    // only ever as its first 2000 characters. Without this the advice to
    // re-read a saved page with doc_read would not be true.
    if (typeof value === "string" && (input.offset != null || input.limit != null)) {
      return readRange(value, input, url, path)
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

export const docEdit = {
  id: "doc_edit",
  name: "Edit document",
  description: [
    "Edit any automerge document with one or more ops. Each op is { path, range, value }:",
    "• path: array of keys/indices from the document root to what you are touching. [] is the root.",
    "• range: [from, to] to SPLICE — replacing characters when the target is a string, items when it is a list.",
    "  Insert without deleting by using [n, n]. Or give a key (string/number) to SET that key on the map/list at path.",
    "• value: what to insert or set. Omit it (or null) to delete.",
    "Examples: set a title — { path: [], range: 'title', value: 'New' }.",
    "Append to a list — { path: ['items'], range: [2, 2], value: { done: false } }.",
    "Insert text at offset 10 — { path: ['body'], range: [10, 10], value: 'hello' }.",
  ].join("\n"),
  where: "worker",
  risk: "write",
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

    const { handle } = await findDoc(url, ctx)
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
  description:
    "Create a new document of a registered datatype. Use registry_list to see what datatypes exist. Returns the new document's URL.",
  // Host tier: it needs the datatype from the page's plugin registry.
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["datatype"],
    properties: {
      datatype: { type: "string", description: "Datatype id, e.g. 'folder' or 'chitterchatter'." },
      title: { type: "string" },
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

    return `Created ${input.datatype} document: ${handle.url}`
  },
  summarize(input, output) {
    return `created ${input?.datatype} · ${String(output ?? "").split(": ")[1] ?? ""}`
  },
}

export const docHistory = {
  id: "doc_history",
  name: "Document history",
  description:
    "Summarize a document's change history: how many changes, by whom, and the most recent ones. Useful for 'what changed recently' and for finding what to undo.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string" },
      limit: { type: "number", description: "How many recent changes to describe. Default 20." },
    },
  },
  async execute(input, ctx) {
    const url = targetUrl(input, ctx)
    const { handle } = await findDoc(url, ctx)
    const automerge = await hostImport("automerge")
    const changes = automerge.getAllChanges(handle.doc())
    const limit = input.limit ?? 20

    const decoded = changes.slice(-limit).map((change) => {
      const meta = automerge.decodeChange(change)
      return {
        actor: meta.actor.slice(0, 8),
        time: meta.time ? new Date(meta.time * 1000).toISOString() : null,
        message: meta.message ?? null,
        ops: meta.ops?.length ?? 0,
      }
    })

    return previewJson({ url, totalChanges: changes.length, recent: decoded })
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/"totalChanges":\s*(\d+)/)
    return `history · ${match ? match[1] : "?"} changes`
  },
}

export default [docRead, docEdit, docCreate, docHistory]
