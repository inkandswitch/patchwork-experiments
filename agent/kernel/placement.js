/**
 * Where a tool runs, and which tools a session placed somewhere gets.
 *
 * A tool declares `where`: "worker" when a repo is all it needs, "host" when
 * it needs the page (a DOM, mounted views, what only a page holds). Built-in or
 * plugin, the declaration is the only thing that decides. A workflow step on
 * a worker gets every tool declared "worker", whoever provides it, and none
 * declared "host"; its session says so with `tools.where = "worker"`, and the
 * toolset is filtered when a runner builds it (kernel/toolset.js fullTools),
 * so a package installed after the step began is in it, and no list of tool
 * ids is ever frozen into a session.
 *
 * A burst runs a "worker" tool's calls itself, whoever provides the tool, and
 * parks a "host" tool's until a page takes them (kernel/loop.js,
 * runners/page.js).
 */

import { WHERE } from "../session/schema.js"

export const WORKER = WHERE.worker
export const HOST = WHERE.host

/** Does a session placed at `placement` get this tool? Unplaced sessions get every tool. */
export function fitsPlacement(tool, placement) {
  return placement !== WORKER || (tool?.where ?? WORKER) === WORKER
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
