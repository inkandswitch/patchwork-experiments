/**
 * What a tool call looks like in the log.
 *
 * A transcript is mostly tool calls. Shown as the raw tool id beside whichever
 * input field happens to be present — `view_interact` next to a CSS selector,
 * `package_build` next to a 50-character automerge URL — a line is a dump of
 * the arguments, not a description of what happened. So a call is shown as a
 * verb a person would use, and a detail drawn from the field that says what
 * the call was about.
 *
 * The tool says which (`present` on its definition), and the call carries it
 * (`shown` on the call block, kernel/tool.js presentCall): a view has the
 * session document and nothing else. A call that says nothing — its tool
 * does not, or a runner that did not know the tool wrote it — still reads as
 * its id and its most plausible input, never as a broken line.
 */

import { isDocUrl, pathLabel, shortDoc } from "../documents/labels.js"

const MAX_DETAIL = 64

/** The first argument a person could read, for a tool we have no entry for. */
function firstReadableValue(input) {
  for (const value of Object.values(input ?? {})) {
    if (typeof value === "string" && value.trim()) return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
  }
  return undefined
}

/**
 * The one-line description of a call: a verb, what it acted on, and how it went.
 *
 * `note` is the tool's own summary when it has one, because a tool knows better
 * than this file what its result meant.
 */
export function describeCall(block, result, { subject = null } = {}) {
  // What the call says of itself, written with it by the runner that knew its
  // tool (kernel/tool.js presentCall), comes before anything worked out here.
  if (block?.shown?.verb) return { verb: String(block.shown.verb), detail: String(block.shown.detail ?? ""), note: noteFor(block, result) }

  // A call that says nothing of itself. Show the field most likely to mean
  // something, and if none of the usual names are there, the first short
  // string it was given: otherwise the row is a bare id and nothing else.
  const input = block?.input ?? {}
  const named = input.path ?? input.name ?? input.query ?? input.selector ?? input.id ?? input.url
  const guess = named ?? firstReadableValue(input)
  let detail = isDocUrl(guess) ? shortDoc(guess, subject) : (pathLabel(guess) ?? guess)
  detail = detail == null ? "" : String(detail)
  if (detail.length > MAX_DETAIL) detail = `${detail.slice(0, MAX_DETAIL - 1)}…`

  return { verb: String(block?.tool ?? "call"), detail, note: noteFor(block, result) }
}

function noteFor(block, result) {
  if (block?.status === "running") return "running…"
  if (block?.status === "asking") return "waiting for you"
  if (block?.status === "pending") return "needs approval"
  if (block?.status === "denied") return "declined"
  if (!result) return ""

  if (result.isError) {
    const firstLine = String(result.output ?? "").split("\n")[0]
    return firstLine.replace(/^Error:\s*/, "").slice(0, 80)
  }
  // The tool's own summary, else the first line — a fallback for results
  // written before summaries were recorded.
  if (result.summary) return result.summary
  return String(result.output ?? "").split("\n")[0].slice(0, 60)
}
