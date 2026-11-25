/** Call blocks for tests, as the loop writes them. */

import { presentCall } from "../kernel/tool.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"

/** The built-in under an id: the full-access session's of two, else whichever there is. */
export const builtin = (id) => BUILTIN_TOOLS.find((tool) => tool.id === id && tool.scoped !== "only") ?? BUILTIN_TOOLS.find((tool) => tool.id === id) ?? null

/**
 * A call block with what the loop adds when it writes one for a built-in
 * tool: how the call reads in the log (kernel/tool.js presentCall).
 */
export const written = (block, subject = null) => ({ ...block, shown: presentCall(builtin(block.tool), block.input ?? {}, subject) })
