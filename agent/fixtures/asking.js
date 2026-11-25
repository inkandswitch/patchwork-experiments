/**
 * Approval, as tests ask about it: of a tool and an input, where the product
 * reads what a call asks off the call block (session/grants.js).
 */

import { askOf, needsApproval } from "../session/grants.js"
import { callBlock } from "../session/blocks.js"
import { CALL } from "../session/schema.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"

/** A tool by id: the built-in a full-access session has, or a bare external one for an id that is none. */
export const toolOf = (id) => BUILTIN_TOOLS.find((tool) => tool.id === id && tool.scoped !== "only") ?? { id, risk: "external" }

/** Does a call to this tool with this input wait for the person? */
export const waits = (doc, tool, input = {}, { subject = null, sensitive = [] } = {}) =>
  needsApproval(doc, tool, input, tool ? askOf(tool, input, { subject, sensitive }) : null)

/** A call block waiting for approval, as the loop writes one. */
export const pendingCall = (tool, input = {}, { id, subject = null, sensitive = [] } = {}) =>
  callBlock(tool.id, input, { id, status: CALL.pending, ask: askOf(tool, input, { subject, sensitive }) })

/** A call by the tool with this id about `target`, for asking which grants cover it and which are offered. */
export function about(id, target, kind = "document") {
  const tool = toolOf(id)
  const scope = tool.group ?? id
  return { tool: id, ask: { scope, covers: tool.groupCovers ?? `every ${scope} call in this session`, target, kind: target == null ? null : kind, always: false } }
}
