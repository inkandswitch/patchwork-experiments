/** The toolset of a full-access session here: the built-ins and this page's plugins, as the session's document selects them. */

import { fullTools, toolsetOf } from "../kernel/toolset.js"
import { loadPluginTools } from "./plugins.js"
import { BUILTIN_TOOLS } from "./builtin.js"

/**
 * The plugins are this page's registry's, or `opts.plugins()` from a caller
 * with no registry of its own. Which of them and of the built-ins the session
 * gets is kernel/toolset.js fullTools; a research step's toolset is not built
 * here (kernel/scope.js).
 */
export async function buildToolset(sessionDoc, opts = {}) {
  const plugins = opts.skipPlugins ? [] : opts.plugins ? await opts.plugins() : await loadPluginTools(opts)
  return toolsetOf(fullTools(sessionDoc, { builtins: BUILTIN_TOOLS, plugins }))
}
