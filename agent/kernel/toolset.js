/**
 * Which tools a session is offered, out of those a runner has.
 *
 * Decided by what each tool declares and what the session document says, and
 * by nothing else: no list of tool ids anywhere says who gets what.
 *
 *   scoped   true: a research step may have it too. "only": a research step
 *            alone has it. Otherwise a full-access session alone.
 *   needs    what it needs of the session (session/capabilities.js); a
 *            session without all of it is not offered the tool
 *   where    who can run it; a session placed on a worker is offered only
 *            what runs there (placement.js)
 *
 * The same functions say what a step would get before it has a session
 * (placement.js checkStepTools), so the answer cannot differ from what its
 * runner then builds.
 */

import { sessionCapabilities } from "../session/capabilities.js"
import { fitsPlacement, declaredWhere, WORKER } from "./placement.js"
import { toSchema } from "./tool.js"

/** Tools as a toolset: what the loop is given, and what a view asks about calls. */
export function toolsetOf(tools) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  return { tools, schemas: tools.map(toSchema), get: (id) => byId.get(id) ?? null }
}

const offered = (tool, has) => (tool.needs ?? []).every((need) => has.has(need))

/** Does this plugin declare a tool a research step may have? Scoped as exactly true, and declared a worker tool. */
export const declaresScoped = (meta) => meta?.scoped === true && declaredWhere(meta) === WORKER

/**
 * A full-access session's tools: every built-in not kept for research steps,
 * then the plugins, less what the session leaves out. A session that says
 * nothing gets everything; one whose `enabled` is a list gets exactly that
 * list, so an empty list is no tools, not all of them.
 */
export function fullTools(doc, { builtins = [], plugins = [] } = {}) {
  const has = sessionCapabilities(doc)
  const all = [...builtins.filter((tool) => tool.scoped !== "only"), ...plugins]
  const enabled = doc?.tools?.enabled
  const disabled = doc?.tools?.disabled ?? []
  const placement = doc?.tools?.where ?? null
  return (Array.isArray(enabled) ? all.filter((tool) => enabled.includes(tool.id)) : all).filter(
    (tool) => !disabled.includes(tool.id) && offered(tool, has) && fitsPlacement(tool, placement),
  )
}

/**
 * A research step's tools: the built-ins that declare `scoped`, then the
 * plugins that declare `scoped: true` on a worker and take no built-in's id,
 * the first of two with one id. Whatever the session says about its tools is
 * not consulted: it is not the session's to say.
 */
export function scopedTools(doc, { builtins = [], plugins = [] } = {}) {
  const has = sessionCapabilities(doc, { scoped: true })
  const taken = new Set(builtins.map((tool) => tool.id))
  const admitted = []
  for (const tool of plugins) {
    if (!declaresScoped(tool) || typeof tool.id !== "string" || taken.has(tool.id)) continue
    taken.add(tool.id)
    admitted.push(tool)
  }
  return [...builtins.filter((tool) => tool.scoped && offered(tool, has)), ...admitted]
}
