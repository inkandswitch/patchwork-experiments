/**
 * Tools, as the loop sees them.
 *
 * A tool definition:
 *
 *   { id, name, description, input_schema, where, risk, alwaysAsk?, askWhen?, target?,
 *     group?, groupCovers?, scoped?, needs?, present?, execute(input, ctx), summarize?(input, output, facts) }
 *
 * `where` is "worker" | "host" and decides who may run it (placement.js).
 * `scoped` and `needs` decide which sessions are offered it (toolset.js), and
 * `needs` what a built-in is handed beyond the context every tool gets
 * (session/capabilities.js, runner.js privileges).
 * `risk` is "read" | "self" | "edit" | "write" | "external"; see
 * session/grants.js needsApproval. "self" touches only this conversation (its
 * document, a view it opened and is closing, or — for a research step — what
 * it made itself and its workflow's findings) and "edit" only automerge
 * documents, so neither is asked about — except that an `edit` tool's
 * `askWhen(input)` can name calls that write source code, which then need a
 * grant like any `write`.
 *
 * A tool comes from this package (assembly/builtin.js) or from an `agent:tool`
 * plugin of any installed package, whose metadata is plain JSON at the top
 * level of its entry (it has to be: the host structured-clones plugin entries
 * into a worker) and whose executor comes back from `load()`.
 */

import { isInterruption } from "../net/network.js"

/** How long a call's detail may be in the log. */
const MAX_DETAIL = 64

/**
 * How a call reads in the log: `{ verb, detail }`, a verb a person would use
 * and what the call acted on. Worked out when the call is written and kept on
 * it, because a view has the session document and nothing else: the tool may
 * have run in another realm, or belong to a package this page does not have.
 *
 * A tool says how with `present: { verb, detail }`, each a string or a
 * function of the input (`detail` is also given the session's subject, to
 * say "this document"). Null for a tool that does not say, or whose way of
 * saying fails on this input; a view then makes its best guess.
 *
 * It may also say how the call opens: `body`, the name of a layout for its
 * input ("files", "edits", "question"; a view that has no such layout lists
 * the fields), and `format`, what its result's text is ("markdown", or a
 * language such as "js"), as a string or a function of the input. Each is on
 * the call only when the tool says it.
 */
export function presentCall(tool, input, subject = null) {
  const entry = tool?.present
  if (!entry) return null
  try {
    const verb = typeof entry.verb === "function" ? entry.verb(input ?? {}) : entry.verb
    const said = typeof entry.detail === "function" ? entry.detail(input ?? {}, subject) : entry.detail
    if (!verb) return null
    const detail = said == null ? "" : String(said)
    const format = typeof entry.format === "function" ? entry.format(input ?? {}) : entry.format
    return {
      verb: String(verb),
      detail: detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1)}…` : detail,
      ...(entry.body ? { body: String(entry.body) } : {}),
      ...(format ? { format: String(format) } : {}),
    }
  } catch {
    return null
  }
}

/** Everything about a tool the model is allowed to see. */
export function toSchema(tool) {
  return {
    id: tool.id,
    description: tool.description ?? tool.name ?? tool.id,
    input_schema: tool.input_schema ?? { type: "object", properties: {} },
  }
}

/**
 * The metadata of an `agent:tool` plugin a toolset reads. Plain JSON at the
 * top level of the plugin entry, which is what lets it cross into a worker:
 * a task's input carries every entry's metadata as the catalogue
 * (assembly/plugins.js pluginCatalogue), and a burst offers the tools and
 * parks their calls for a page.
 */
export const PLUGIN_FIELDS = ["id", "name", "description", "input_schema", "where", "risk", "alwaysAsk", "scoped", "target", "group", "groupCovers", "importUrl"]

/** One plugin entry's metadata, and nothing that cannot be cloned. Null for an entry with no id. */
export function describePlugin(entry) {
  if (typeof entry?.id !== "string") return null
  const out = {}
  for (const field of PLUGIN_FIELDS) {
    const value = entry[field]
    if (value === undefined || typeof value === "function") continue
    try {
      out[field] = JSON.parse(JSON.stringify(value))
    } catch {
      /* not plain data; left out, as a worker could not be handed it */
    }
  }
  return out
}

/**
 * A plugin tool, from its metadata and `current`, which loads the plugin as
 * registered now: `{ ...metadata, module }`. `impl` is the module loaded
 * already, for its `summarize`. `where` is who runs it when that is not what
 * it declared — a runner that cannot load it here (kernel/placement.js).
 */
export function pluginTool(description, current, { impl = null, where = null } = {}) {
  const declared = description.where ?? "worker"
  return {
    id: description.id,
    name: description.name ?? description.id,
    description: description.description ?? "",
    input_schema: description.input_schema ?? { type: "object", properties: {} },
    where: where ?? declared,
    // What the package declared, which decides who gets the tool even where
    // this runner hands its calls to another (kernel/placement.js declaredWhere).
    declared,
    risk: description.risk ?? "write",
    alwaysAsk: description.alwaysAsk ?? false,
    // The package's word that this tool works only through the context
    // it is handed, which is what lets a research step have it
    // (kernel/toolset.js scopedTools). Read from the metadata, as plain JSON,
    // and only as exactly true.
    scoped: description.scoped === true,
    // What a call is about, and which tools its grants are shared with, for
    // approval (session/grants.js askOf).
    target: description.target,
    ...(typeof description.group === "string" ? { group: description.group } : {}),
    ...(typeof description.groupCovers === "string" ? { groupCovers: description.groupCovers } : {}),
    // Looked up again at call time, not kept from when the toolset was
    // built: a run lasts as long as the model keeps calling tools, and
    // when the package behind this tool is edited mid-run Patchwork
    // re-registers it, which the registry's own memo follows and a
    // captured function does not. The agent that rewrote a tool and then
    // called it got the old one back for the rest of the run.
    // If the new version fails to load, that is the answer: quietly running
    // the old one is exactly what made the stale code so hard to see.
    // `current` is the plugin as registered now, metadata and module
    // together, so a caller that admitted this tool by what it declared
    // can check the declaration of the code that is about to run.
    current,
    async execute(input, ctx) {
      return (await current()).module.execute(input, ctx)
    },
    summarize: impl?.summarize ?? null,
    // How its calls read in the log, from the package's own module (presentCall).
    present: impl?.present ?? null,
    source: description.importUrl ?? null,
  }
}

/**
 * Run one tool, normalizing whatever it returns into a string plus a one-line
 * summary for the transcript. Errors become error results rather than
 * exceptions — a failed tool call is information the model should see and
 * recover from, not a crash.
 */
export async function runTool(tool, input, ctx) {
  if (!tool) {
    return { output: "No such tool.", isError: true, summary: "unknown tool" }
  }
  try {
    const result = await tool.execute(input ?? {}, ctx)

    // A tool may answer with more than words: a picture, or a document holding
    // content too big to live in the transcript. Both ride alongside the text
    // rather than inside it, so the transcript can decide how to show them and
    // the provider can send an image as an image part.
    let image = null
    let file = null
    let doc = null
    let made = null
    let facts = null
    let output
    if (
      result &&
      typeof result === "object" &&
      (typeof result.image === "string" || result.file || result.doc || result.made || typeof result.text === "string")
    ) {
      // What the call did, as plain data for code to read: a view, a hook
      // after the call, the tool's own summary. Nothing parses it back out
      // of the text, which is for the model.
      facts = result.facts && typeof result.facts === "object" ? JSON.parse(JSON.stringify(result.facts)) : null
      image = typeof result.image === "string" ? result.image : null
      // A file for the model to read itself — a PDF — by its document, never
      // its bytes: those are loaded when the request is made (documents/files.js).
      file = typeof result.file?.url === "string" ? { url: result.file.url, name: result.file.name ?? null, mimeType: result.file.mimeType ?? null } : null
      doc = result.doc ?? null
      // Several documents at once — a folder of files, say. `doc` is the one
      // the transcript links beside the call; `made` is everything created.
      made = Array.isArray(result.made) ? result.made : null
      output = result.text ?? ""
    } else {
      output = typeof result === "string" ? result : JSON.stringify(result, null, 2)
    }
    let summary = null
    try {
      summary = tool.summarize?.(input, output, facts) ?? null
    } catch {
      summary = null // a broken summarizer must not fail the call
    }
    return { output, image, file, doc, made, facts, isError: false, summary: summary ?? `${tool.id} ok` }
  } catch (err) {
    const message = String(err?.message ?? err)
    // Not a result at all: the call had no effect and runs again when the
    // network is back (net/network.js, kernel/loop.js executeCalls).
    if (isInterruption(err)) return { interrupted: true, reason: message, output: "", isError: false, summary: "interrupted" }
    return { output: `Error: ${message}`, isError: true, summary: `${tool.id} failed` }
  }
}
