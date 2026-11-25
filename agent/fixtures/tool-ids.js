/**
 * The built-in tools by kind, read off their own declarations
 * (kernel/toolset.js). toolset.test.js pins each list as written out, so a
 * declaration cannot change one unnoticed.
 */

import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { scopedToolset } from "../kernel/scope.js"

const ids = (is) => BUILTIN_TOOLS.filter(is).map((tool) => tool.id)

/** The built-ins a full-access session can be offered. */
export const FULL_TOOLS = BUILTIN_TOOLS.filter((tool) => tool.scoped !== "only")

/** What a research step is offered. */
export const SCOPED_TOOL_IDS = ids((tool) => tool.scoped)

/** Offered to a research step alone, with no counterpart in a full-access session. */
export const SCOPED_ONLY_IDS = ids((tool) => tool.scoped === "only").filter((id) => !FULL_TOOLS.some((tool) => tool.id === id))

/** The tools that orchestrate. */
export const WORKFLOW_TOOL_IDS = ids((tool) => tool.needs?.includes("workflows"))

/** The tools only a step has. */
export const STEP_TOOL_IDS = ids((tool) => tool.needs?.includes("step"))

/**
 * A research step's toolset over the built-ins, as its runner builds one.
 * `step: false` is a confined session that is not a step.
 */
export const researchToolset = ({ plugins = [], step = true } = {}) =>
  scopedToolset(step ? { workflow: { planUrl: "automerge:plan" } } : {}, { builtins: BUILTIN_TOOLS, plugins })
