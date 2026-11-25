/**
 * The tool registry.
 *
 * Three layers, per the design:
 *
 *   1. built-ins  — defined in this package, in the files beside this one.
 *   2. plugins    — `agent:tool` plugins contributed by any installed package.
 *                   Metadata is plain JSON at the top level (it has to be: the
 *                   host structured-clones plugin entries into a worker), and
 *                   the executor comes back from `load()`.
 *   3. tool docs  — user-authored tools stored as documents. Not yet wired;
 *                   the seam is `loadToolDocs` below.
 *
 * A tool definition:
 *
 *   { id, name, description, input_schema, where, risk, alwaysAsk?, askWhen?, target?,
 *     execute(input, ctx), summarize?(input, output) }
 *
 * `where` is "worker" | "host" | "task" and decides who may run it.
 * `risk` is "read" | "self" | "edit" | "write" | "external"; see
 * session.needsApproval. "self" touches only this conversation (its document,
 * a view it opened and is closing, or — for a research step — what it made
 * itself and its workflow's findings) and "edit"
 * only to automerge documents, so neither is asked about — except that an
 * `edit` tool's `askWhen(input)` can name calls that write source code, which
 * then need a grant like any `write`.
 */

import { tryHostImport } from "../host/import.js"
import { isInterruption } from "../net/network.js"
import { fitsPlacement } from "../kernel/placement.js"
import docTools from "./docs.js"
import folderTools from "./folders.js"
import environmentTools from "./environment.js"
import webTools from "./web.js"
import checkingTools from "./checking.js"
import discoveryTools from "./discovery.js"
import httpTools, { scopedHttpRequest } from "./http.js"
import readSourceTools from "./read-source.js"
import fileSourceTools from "./file-source.js"
import findingTools from "./findings.js"
import citingTools from "./citing.js"
import askTools from "./ask.js"
import namingTools from "./naming.js"
import recallTools from "./recall.js"
import noteTools from "../knowledge/notes.js"
import guideTools from "../knowledge/guides.js"
import workflowTools from "../workflow/tools.js"
import { WORKFLOW_TOOL_IDS, STEP_TOOL_IDS } from "../workflow/plan.js"
import skillTools from "../knowledge/skills.js"
import buildTools from "./build.js"
import testingTools from "./testing.js"
import screenshotTools from "./screenshot.js"
import watchTools from "./watch.js"

export const BUILTIN_TOOLS = [...docTools, ...watchTools, ...folderTools, ...environmentTools, ...webTools, ...skillTools, ...buildTools, ...testingTools, ...screenshotTools, ...checkingTools, ...discoveryTools, ...httpTools, ...readSourceTools, ...fileSourceTools, ...findingTools, ...citingTools, ...askTools, ...namingTools, ...recallTools, ...noteTools, ...guideTools, ...workflowTools]

/**
 * Tools for one kind of session only. finding_write writes into a research
 * step's ledger, which only a research step has; source_file writes into a
 * folder, which a research step may not. Neither toolset ever contains the
 * other's: buildToolset leaves out SCOPED_ONLY_IDS, and kernel/scope.js's
 * scopedToolset leaves out UNSCOPED_ONLY_IDS.
 */
export const SCOPED_ONLY_IDS = ["finding_write"]
export const UNSCOPED_ONLY_IDS = ["source_file"]

/** The narrower versions of built-ins a research step gets in their place (kernel/scope.js). */
export const SCOPED_VARIANTS = Object.freeze({ http_request: scopedHttpRequest })

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

/** The `agent:tool` registry, or null outside Patchwork (tests, node, a worker with no registry). */
async function toolRegistry() {
  const plugins = await tryHostImport("plugins")
  return plugins ? plugins.getRegistry("agent:tool") : null
}

/** Every `agent:tool` plugin's metadata, without loading any of them. */
export async function pluginDescriptions({ registry: given } = {}) {
  const registry = given ?? (await toolRegistry())
  if (!registry) return []
  return registry.all().map(describePlugin).filter(Boolean)
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
    // it is handed, which is what lets a research step have it (kernel/scope.js
    // admitScoped). Read from the metadata, as plain JSON, and only as
    // exactly true.
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

/** The ids a plugin may not take. */
export const builtinIds = () => new Set(BUILTIN_TOOLS.map((t) => t.id))

/**
 * A plugin may not take a built-in's name. Whichever came second in the
 * toolset would win, so a package could replace web_fetch or doc_edit — and
 * inherit its grants and its place in the prompt — without anyone seeing a
 * difference in the tool list.
 */
export function takesBuiltin(id, taken = builtinIds()) {
  return taken.has(id) ? new Error(`'${id}' is a built-in tool; a plugin cannot replace it.`) : null
}

/**
 * Discover `agent:tool` plugins from the host registry.
 *
 * Loading is lazy and failure is non-fatal: a broken third-party tool should
 * cost the agent that one capability, not the whole session.
 */
export async function loadPluginTools({ onError, registry: given } = {}) {
  const registry = given ?? (await toolRegistry())
  if (!registry) return [] // not running inside Patchwork (tests, node)

  const found = []
  const taken = builtinIds()

  for (const description of registry.all()) {
    const refused = takesBuiltin(description.id, taken)
    if (refused) {
      onError?.(description.id, refused)
      continue
    }
    try {
      const loaded = await registry.load(description.id)
      const impl = loaded?.module
      if (!impl?.execute) continue
      const id = description.id
      const current = async () => {
        const now = await registry.load(id)
        if (!now?.module?.execute) throw new Error(`The ${id} package no longer provides an execute function.`)
        return now
      }
      found.push(pluginTool(description, current, { impl }))
    } catch (err) {
      onError?.(description.id, err)
    }
  }

  return found
}

/**
 * The built-in tools as a toolset, for deciding about calls outside a runner
 * — a permission granted from the pop-over, or spread across a workflow —
 * where no runner has built one. Plugin tools are not in it: a call to one is
 * left for its own session's view to release.
 */
let builtins = null
export function builtinToolset() {
  if (!builtins) {
    const byId = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]))
    builtins = { tools: BUILTIN_TOOLS, schemas: [], get: (id) => byId.get(id) ?? null }
  }
  return builtins
}

/**
 * The toolset for a full-access session: built-ins plus plugins, filtered by
 * what the session has enabled. A session that says nothing gets everything;
 * one whose `enabled` is a list gets exactly that list — so an empty list is
 * no tools, not all of them. One whose `where` is "worker" — a workflow step
 * placed on a worker — gets only the tools declared to run there.
 *
 * The plugins are this page's registry's, or `opts.plugins()` from a runner
 * with no registry of its own (runners/worker.js). A research step's toolset is not built here and
 * does not depend on anything the session says (kernel/scope.js).
 */
export async function buildToolset(sessionDoc, opts = {}) {
  const plugins = opts.skipPlugins ? [] : opts.plugins ? await opts.plugins() : await loadPluginTools(opts)
  const all = [...BUILTIN_TOOLS, ...plugins]
  // A workflow step on a worker gets what runs without the page, built-in or
  // plugin alike, by what each declared (kernel/placement.js).
  const placement = sessionDoc?.tools?.where ?? null

  const enabled = sessionDoc?.tools?.enabled
  const disabled = sessionDoc?.tools?.disabled ?? []
  // Orchestrating is opt-in per session: many sessions, real cost.
  const workflows = !!sessionDoc?.config?.workflows?.enabled
  // Asking an orchestrator for more work means something only in a step.
  const step = !!sessionDoc?.workflow?.planUrl
  const chosen = (Array.isArray(enabled) ? all.filter((t) => enabled.includes(t.id)) : all).filter(
    (t) => !disabled.includes(t.id) && !SCOPED_ONLY_IDS.includes(t.id) && (workflows || !WORKFLOW_TOOL_IDS.includes(t.id)) && (step || !STEP_TOOL_IDS.includes(t.id)) && fitsPlacement(t, placement)
  )

  const byId = new Map(chosen.map((t) => [t.id, t]))
  return {
    tools: chosen,
    schemas: chosen.map(toSchema),
    get(id) {
      return byId.get(id) ?? null
    },
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
