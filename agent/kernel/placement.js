/**
 * Where a tool runs, and which tools a session placed somewhere gets.
 *
 * A tool declares `where`: "worker" when a repo is all it needs, "host" when
 * it needs the page (a DOM, mounted views, the plugin registry). Built-in or
 * plugin, the declaration is the only thing that decides. A workflow step on
 * a worker gets every tool declared "worker", whoever provides it, and none
 * declared "host"; its session says so with `tools.where = "worker"`, and the
 * toolset is filtered when a runner builds it (kernel/toolset.js fullTools),
 * so a package installed after the step began is in it, and no list of tool
 * ids is ever frozen into a session.
 *
 * A run may be unable to run a tool it lists — a burst in a pool's worker
 * imports no plugin code. Such a tool keeps its declaration (`declared`) for
 * deciding who gets it, and carries `where: "host"` for who runs it: its
 * calls park until a page takes them (assembly/plugins.js catalogueTools,
 * kernel/loop.js, runners/page.js).
 */

import { WHERE } from "../session/schema.js"

export const WORKER = WHERE.worker
export const HOST = WHERE.host

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
 * that sees work in it (kernel/loop.js executeCalls, kernel/runner.js needsWork).
 */
export function callNeeds(call, tool) {
  return call?.where === HOST || tool?.where === HOST ? HOST : (tool?.where ?? call?.where ?? WORKER)
}
