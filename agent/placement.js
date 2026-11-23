/**
 * Where a tool runs, and which tools a session placed somewhere gets.
 *
 * A tool declares `where`: "worker" when a repo is all it needs, "host" when
 * it needs the page (a DOM, mounted views, the plugin registry). Built-in or
 * plugin, the declaration is the only thing that decides. A workflow step on
 * a worker gets every tool declared "worker", whoever provides it, and none
 * declared "host"; its session says so with `tools.where = "worker"`, and the
 * toolset is filtered when a runner builds it (tools/index.js buildToolset),
 * so a package installed after the step began is in it, and no list of tool
 * ids is ever frozen into a session.
 *
 * A runner may be unable to run a tool it lists — the SharedWorker cannot run
 * a plugin whose code will not load without the page. Such a tool keeps its
 * declaration (`declared`) for deciding who gets it, and carries `where:
 * "host"` for who runs it: its calls park until a tab takes them
 * (worker-plugins.js, loop.js).
 */

export const WORKER = "worker"
export const HOST = "host"

/** What a tool declared, whatever this runner can do with it. */
export function declaredWhere(tool) {
  return tool?.declared ?? tool?.where ?? WORKER
}

/** Does a session placed at `placement` get this tool? Unplaced sessions get every tool. */
export function fitsPlacement(tool, placement) {
  return placement !== WORKER || declaredWhere(tool) === WORKER
}

/**
 * Which tier a call needs: the page if either the runner that recorded it or
 * the runner about to run it says so. A runner that cannot run a tool here
 * records that on the call when it parks, so the runner that can is the one
 * that sees work in it (loop.js executeCalls, runner.js needsWork).
 */
export function callNeeds(call, tool) {
  return call?.where === HOST || tool?.where === HOST ? HOST : (tool?.where ?? call?.where ?? WORKER)
}

// ------------------------------------------------------------ step checks

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

/**
 * The tool ids a step would get, out of `catalogue` — every tool this page
 * knows, built-in and plugin, as `{ id, where, scoped, builtin }`.
 *
 *   research (access "web")  the research built-ins, and plugins declaring
 *                            `scoped: true` on a worker (scope.js)
 *   full, on a worker        every tool declared "worker"
 *   full, on the page        every tool
 *
 * Never the orchestrator's tools: workflows do not nest.
 */
export function stepToolIds(step, catalogue, { scopedIds, orchestratorIds }) {
  if (step?.access === "web") {
    const plugins = catalogue.filter((t) => !t.builtin && t.scoped === true && declaredWhere(t) === WORKER).map((t) => t.id)
    return new Set([...scopedIds, ...plugins])
  }
  const placement = step?.where === WORKER ? WORKER : null
  return new Set(catalogue.filter((t) => !orchestratorIds.includes(t.id) && fitsPlacement(t, placement)).map((t) => t.id))
}

/**
 * Before a step starts: does its prompt name a tool it would not get?
 *
 *   null                       no — start it
 *   { where: "host", why }     a worker step naming tools that need the page:
 *                              move it there; it starts when the page is free
 *   { fail: why }              anything else — a research step naming a tool
 *                              that reads the person's documents, a step
 *                              naming the orchestrator's tools. Said once, at
 *                              start, instead of found out by searching.
 *
 * Only names of tools this page knows are recognised: a word in a prompt is
 * not a tool because it looks like one (an assumptions entry is called
 * `cell_capacity`).
 */
export function checkStepTools(step, catalogue, ids) {
  const known = catalogue.map((t) => t.id)
  const named = namedIn(step?.prompt, known)
  if (!named.length) return null
  const gets = stepToolIds(step, catalogue, ids)
  const missing = named.filter((id) => !gets.has(id))
  if (!missing.length) return null

  const list = missing.join(", ")
  if (step.access === "web") {
    return { fail: `Its prompt names ${list}, which a research step cannot have: it reaches only the web and what research steps kept. Make it a full step, or split the part that needs ${missing.length === 1 ? "that tool" : "those tools"} into one.` }
  }
  const orchestrating = missing.filter((id) => ids.orchestratorIds.includes(id))
  if (orchestrating.length) {
    return { fail: `Its prompt names ${orchestrating.join(", ")}, which only the orchestrator has: a step cannot change the workflow. Ask with workflow_request instead.` }
  }
  // Everything else it lacks needs the page, and on the page it gets everything.
  return { where: HOST, why: `Moved to the page: its prompt names ${list}, which ${missing.length === 1 ? "needs" : "need"} the page.` }
}
