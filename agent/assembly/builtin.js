/**
 * The tools this package defines. Which kind of session is offered which is
 * each tool's own to say (kernel/toolset.js), not this list's.
 */

import docTools from "../tools/docs.js"
import folderTools from "../tools/folders.js"
import environmentTools from "../tools/environment.js"
import webTools from "../tools/web.js"
import checkingTools from "../tools/checking.js"
import discoveryTools from "../tools/discovery.js"
import httpTools from "../tools/http.js"
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

export const BUILTIN_TOOLS = Object.freeze([...docTools, ...watchTools, ...folderTools, ...environmentTools, ...webTools, ...skillTools, ...buildTools, ...testingTools, ...screenshotTools, ...checkingTools, ...discoveryTools, ...httpTools, ...readSourceTools, ...fileSourceTools, ...findingTools, ...citingTools, ...askTools, ...namingTools, ...recallTools, ...noteTools, ...guideTools, ...workflowTools])

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
