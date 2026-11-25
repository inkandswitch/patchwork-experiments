/**
 * Before a step starts: would it get the tools it needs?
 *
 * Asked of the functions its runner will build its toolset with
 * (kernel/toolset.js), over every tool this page knows, so the answer here and
 * the toolset there cannot differ.
 */

import { fullTools, scopedTools } from "../kernel/toolset.js"
import { HOST, WORKER } from "../kernel/placement.js"

const WORD = /[A-Za-z0-9_]/

/**
 * The ids out of `ids` that `text` names, as whole words: `assumptions_set`
 * in "use assumptions_set for each value", not `doc_read` in `doc_reader`.
 */
export function namedIn(text, ids) {
  const s = String(text ?? "")
  const found = []
  for (const id of ids) {
    let at = s.indexOf(id)
    while (at >= 0) {
      const before = at > 0 ? s[at - 1] : ""
      const after = s[at + id.length] ?? ""
      if (!WORD.test(before) && !WORD.test(after)) {
        found.push(id)
        break
      }
      at = s.indexOf(id, at + 1)
    }
  }
  return found
}

/** What a step's session will say that decides its tools (driver.js begin). */
const sessionOf = (step) => ({ workflow: { planUrl: "this plan" }, tools: step?.where === WORKER ? { where: WORKER } : {} })

/**
 * The tool ids a step would get, out of `tools` — every tool this page knows,
 * as `{ builtins, plugins }`, each tool as it declares itself.
 *
 *   research (access "web")  the built-ins that declare `scoped`, and plugins
 *                            declaring `scoped: true` on a worker
 *   full, on a worker        every tool declared "worker"
 *   full, on the page        every tool
 *
 * Never the orchestrator's tools: workflows do not nest.
 */
export function stepToolIds(step, tools) {
  const got = step?.access === "web" ? scopedTools(sessionOf(step), tools) : fullTools(sessionOf(step), tools)
  return new Set(got.map((tool) => tool.id))
}

/**
 * Before a step starts: does it need a tool it would not get? What it needs
 * is the tools its `tools` field lists — the orchestrator's word — and those
 * its prompt names.
 *
 *   null                       no — start it
 *   { where: "host", why }     a worker step needing tools that need the
 *                              page: move it there; it starts when the page
 *                              is free
 *   { fail: why }              anything else — a listed tool no installed
 *                              package provides, a research step needing a
 *                              tool that reads the person's documents, a full
 *                              step needing a research step's own tool, a step
 *                              needing the orchestrator's tools. Said once, at
 *                              start, instead of found out by searching.
 *
 * The listed tools are checked first, against everything installed: a tool
 * listed and missing is a fact about this page, not a guess. In the prompt
 * only names of tools this page knows are recognised: a word is not a tool
 * because it looks like one (an assumptions entry is called `cell_capacity`).
 */
export function checkStepTools(step, tools) {
  const builtins = tools?.builtins ?? []
  const plugins = tools?.plugins ?? []
  // What a full-access session could ever be offered: these are the names a prompt can mean.
  const known = [...builtins.filter((tool) => tool.scoped !== "only"), ...plugins].map((tool) => tool.id)
  const orchestrators = builtins.filter((tool) => tool.needs?.includes("workflows")).map((tool) => tool.id)
  const listed = Array.isArray(step?.tools) ? [...new Set(step.tools)] : []
  const installed = new Set([...builtins, ...plugins].map((tool) => tool.id))
  const absent = listed.filter((id) => !installed.has(id))
  if (absent.length) {
    return { fail: `Not installed: ${absent.join(", ")}. No package installed here provides ${absent.length === 1 ? "that tool" : "those tools"}, so the step cannot do its work as written. Ask the person to install the package, or plan the work without ${absent.length === 1 ? "it" : "them"}.` }
  }
  const named = [...new Set([...listed, ...namedIn(step?.prompt, known)])]
  if (!named.length) return null
  const gets = stepToolIds(step, { builtins, plugins })
  const missing = named.filter((id) => !gets.has(id))
  if (!missing.length) return null

  const list = missing.join(", ")
  const said = listed.length ? "It needs" : "Its prompt names"
  if (step.access === "web") {
    return { fail: `${said} ${list}, which a research step cannot have: it reaches only the web and what research steps kept. Make it a full step, or split the part that needs ${missing.length === 1 ? "that tool" : "those tools"} into one.` }
  }
  const orchestrating = missing.filter((id) => orchestrators.includes(id))
  if (orchestrating.length) {
    return { fail: `${said} ${orchestrating.join(", ")}, which only the orchestrator has: a step cannot change the workflow. Ask with workflow_request instead.` }
  }
  const researchOnly = missing.filter((id) => !known.includes(id))
  if (researchOnly.length) {
    return { fail: `${said} ${researchOnly.join(", ")}, which only a research step (access: web) has.` }
  }
  // Everything else it lacks needs the page, and on the page it gets everything.
  return { where: HOST, why: `Moved to the page: ${said.toLowerCase()} ${list}, which ${missing.length === 1 ? "needs" : "need"} the page.` }
}
