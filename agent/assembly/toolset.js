/** The toolset of a full-access session: built-ins and plugins, as the session's document selects them. */

import { fitsPlacement } from "../kernel/placement.js"
import { WORKFLOW_TOOL_IDS, STEP_TOOL_IDS } from "../workflow/plan.js"
import { loadPluginTools } from "./plugins.js"
import { BUILTIN_TOOLS, SCOPED_ONLY_IDS } from "./builtin.js"
import { toSchema } from "../kernel/tool.js"

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
