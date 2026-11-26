/**
 * A session shown in a page, in a test: its work asked for whenever its copy
 * changes (each ask a burst, or the burst under way: fixtures/burst.js
 * `ask`), and, given `startSession`, its parked page calls run here
 * (runners/page.js pageCalls) with that way of starting a step's session.
 * What runners/page.js follow does in a page, with the pool's burst run in
 * this process on a scripted model.
 *
 *   const shown = showSession(handle, { provider, toolset, ctx, startSession })
 *   shown.ask()    // ask now; also what a step starter returns
 *   shown.stop()   // the burst under way cancelled, and the page's calls let go
 */

import * as A from "@automerge/automerge"
import { burstRunner } from "./burst.js"
import { handleStore } from "../kernel/store.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { pageCalls } from "../runners/page.js"

export function showSession(handle, { provider, toolset = { tools: [], schemas: [], get: () => null }, ctx = {}, startSession = null }) {
  const store = handleStore(handle, A.splice)
  const buildToolset = async (doc) => (typeof toolset === "function" ? toolset(doc) : toolset)
  const runner = burstRunner({
    builtins: BUILTIN_TOOLS,
    store,
    ctx,
    buildToolset,
    getProvider: async () => provider,
    getKey: () => "test",
  })
  handle.on("change", () => runner.ask())
  const calls = startSession ? pageCalls(handle, { context: ctx, builtins: BUILTIN_TOOLS, buildToolset, startSession, ask: () => runner.ask(), beatMs: 0, target: null }) : null
  calls?.tick()
  runner.ask()
  return {
    runner,
    store,
    ask: () => runner.ask(),
    stop: () => {
      runner.stop()
      calls?.dispose()
    },
  }
}
