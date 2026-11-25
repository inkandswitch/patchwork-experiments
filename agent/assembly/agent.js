/**
 * The agent, put together: what every runner of it is made with, whatever
 * the environment. A runner adds what only its environment has — a context,
 * a provider and its key, its plugins, which tiers it runs (runners/).
 *
 *   new SessionRunner({ ...AGENT, store, ctx, pluginTools, getProvider, ... })
 */

import { restoreWatches } from "../tools/watch.js"
import { BUILTIN_TOOLS } from "./builtin.js"
import { DEFAULT_SYSTEM, PROMPT_SECTIONS, AFTER_CALL } from "./prompt.js"

/** Listen again to every watch the session has, reporting first what changed while no runner was (tools/watch.js). */
async function listenAgain({ repo, events, store, report }) {
  for (const result of await restoreWatches({ repo, events, store })) {
    if (!result.ok) report({ type: "watch-error", id: result.id, error: result.error })
  }
}

export const AGENT = Object.freeze({
  builtins: BUILTIN_TOOLS,
  system: DEFAULT_SYSTEM,
  sections: PROMPT_SECTIONS,
  afterCall: AFTER_CALL,
  onStart: Object.freeze([listenAgain]),
})
