/** The tools this package defines, and the lists that say which kind of session gets which. */

import docTools from "../tools/docs.js"
import folderTools from "../tools/folders.js"
import environmentTools from "../tools/environment.js"
import webTools from "../tools/web.js"
import checkingTools from "../tools/checking.js"
import discoveryTools from "../tools/discovery.js"
import httpTools, { scopedHttpRequest } from "../tools/http.js"
import readSourceTools from "../tools/read-source.js"
import fileSourceTools from "../tools/file-source.js"
import findingTools from "../tools/findings.js"
import citingTools from "../tools/citing.js"
import askTools from "../tools/ask.js"
import namingTools from "../tools/naming.js"
import recallTools from "../tools/recall.js"
import noteTools from "../knowledge/notes.js"
import guideTools from "../knowledge/guides.js"
import workflowTools from "../workflow/tools.js"
import skillTools from "../knowledge/skills.js"
import buildTools from "../tools/build.js"
import testingTools from "../tools/testing.js"
import screenshotTools from "../tools/screenshot.js"
import watchTools from "../tools/watch.js"

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
