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
 * session.needsApproval. "self" writes only to the session document and "edit"
 * only to automerge documents, so neither is asked about — except that an
 * `edit` tool's `askWhen(input)` can name calls that write source code, which
 * then need a grant like any `write`.
 */

import { tryHostImport } from "./host.js"
import docTools from "./docs.js"
import folderTools from "./folders.js"
import environmentTools from "./environment.js"
import webTools from "./web.js"
import checkingTools from "./checking.js"
import discoveryTools from "./discovery.js"
import httpTools from "./http.js"
import ingestTools from "./ingest.js"
import askTools from "./ask.js"
import namingTools from "./naming.js"
import recallTools from "./recall.js"
import noteTools from "./notes.js"
import skillTools from "./skills.js"
import buildTools from "./build.js"
import testingTools from "./testing.js"
import screenshotTools from "./screenshot.js"

export const BUILTIN_TOOLS = [...docTools, ...folderTools, ...environmentTools, ...webTools, ...skillTools, ...buildTools, ...testingTools, ...screenshotTools, ...checkingTools, ...discoveryTools, ...httpTools, ...ingestTools, ...askTools, ...namingTools, ...recallTools, ...noteTools]

/** Everything about a tool the model is allowed to see. */
export function toSchema(tool) {
  return {
    id: tool.id,
    description: tool.description ?? tool.name ?? tool.id,
    input_schema: tool.input_schema ?? { type: "object", properties: {} },
  }
}

/**
 * Discover `agent:tool` plugins from the host registry.
 *
 * Loading is lazy and failure is non-fatal: a broken third-party tool should
 * cost the agent that one capability, not the whole session.
 */
export async function loadPluginTools({ onError, registry: given } = {}) {
  let registry = given
  if (!registry) {
    const plugins = await tryHostImport("plugins")
    if (!plugins) return [] // not running inside Patchwork (tests, node)
    registry = plugins.getRegistry("agent:tool")
  }

  const found = []

  for (const description of registry.all()) {
    try {
      const loaded = await registry.load(description.id)
      const impl = loaded?.module
      if (!impl?.execute) continue
      const id = description.id
      found.push({
        id: description.id,
        name: description.name ?? description.id,
        description: description.description ?? "",
        input_schema: description.input_schema ?? { type: "object", properties: {} },
        where: description.where ?? "worker",
        risk: description.risk ?? "write",
        alwaysAsk: description.alwaysAsk ?? false,
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
        async execute(input, ctx) {
          const current = (await registry.load(id))?.module
          if (!current?.execute) throw new Error(`The ${id} package no longer provides an execute function.`)
          return current.execute(input, ctx)
        },
        summarize: impl.summarize ?? null,
        source: description.importUrl ?? null,
      })
    } catch (err) {
      onError?.(description.id, err)
    }
  }

  return found
}

/**
 * The toolset for a session: built-ins plus plugins, filtered by what the
 * session has enabled (all of them, when it says nothing).
 */
export async function buildToolset(sessionDoc, opts = {}) {
  const plugins = opts.skipPlugins ? [] : await loadPluginTools(opts)
  const all = [...BUILTIN_TOOLS, ...plugins]

  const enabled = sessionDoc?.tools?.enabled
  const chosen = enabled?.length ? all.filter((t) => enabled.includes(t.id)) : all

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
    let doc = null
    let made = null
    let output
    if (
      result &&
      typeof result === "object" &&
      (typeof result.image === "string" || result.doc || result.made || typeof result.text === "string")
    ) {
      image = typeof result.image === "string" ? result.image : null
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
    return { output, image, doc, made, isError: false, summary: summary ?? `${tool.id} ok` }
  } catch (err) {
    const message = String(err?.message ?? err)
    return { output: `Error: ${message}`, isError: true, summary: `${tool.id} failed` }
  }
}
