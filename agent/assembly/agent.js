/**
 * The agent, put together: what every run of it is made with, whatever the
 * environment. A host adds what only it has — a context, a provider and its
 * key, its plugins, which calls it runs (runners/session-task.js for a burst
 * in a pool's worker, runners/page.js for a page's parked calls).
 *
 *   runBurst(ctx, { ...AGENT, session, getProvider, ... })
 */

import { BUILTIN_TOOLS } from "./builtin.js"
import { DEFAULT_SYSTEM, PROMPT_SECTIONS, AFTER_CALL } from "./prompt.js"

export const AGENT = Object.freeze({
  builtins: BUILTIN_TOOLS,
  system: DEFAULT_SYSTEM,
  sections: PROMPT_SECTIONS,
  afterCall: AFTER_CALL,
})
