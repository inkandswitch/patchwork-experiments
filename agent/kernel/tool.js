/**
 * Tools, as the loop sees them.
 *
 * A tool definition:
 *
 *   { id, name, description, input_schema, where, risk, alwaysAsk?, askWhen?, target?,
 *     scoped?, needs?, execute(input, ctx), summarize?(input, output) }
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
 * top level of the plugin entry, which is what lets it cross into a worker
 * (runners/worker-client.js hands the shared runner every entry's metadata, and the
 * worker loads the code from `importUrl` itself: runners/worker-plugins.js).
 */
export const PLUGIN_FIELDS = ["id", "name", "description", "input_schema", "where", "risk", "alwaysAsk", "scoped", "target", "importUrl"]

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
    // What a call is about, for approval scoping — see session.callScope.
    target: description.target,
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
    let output
    if (
      result &&
      typeof result === "object" &&
      (typeof result.image === "string" || result.file || result.doc || result.made || typeof result.text === "string")
    ) {
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
      summary = tool.summarize?.(input, output) ?? null
    } catch {
      summary = null // a broken summarizer must not fail the call
    }
    return { output, image, file, doc, made, isError: false, summary: summary ?? `${tool.id} ok` }
  } catch (err) {
    const message = String(err?.message ?? err)
    // Not a result at all: the call had no effect and runs again when the
    // network is back (net/network.js, kernel/loop.js executeCalls).
    if (isInterruption(err)) return { interrupted: true, reason: message, output: "", isError: false, summary: "interrupted" }
    return { output: `Error: ${message}`, isError: true, summary: `${tool.id} failed` }
  }
}
