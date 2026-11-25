/**
 * What a session can offer a tool beyond the context every tool gets, by name.
 *
 * A tool names what it needs (`needs`, kernel/tool.js). It is offered only to
 * a session that has all of it (kernel/toolset.js), and is handed what the
 * name stands for only if it is one of the runner's built-ins
 * (kernel/runner.js `privileges`): a plugin gains nothing by naming one.
 *
 *   workflows      may plan a workflow and drive it: its Workflows switch is
 *                  on, and it is not itself a step, since steps do not
 *                  orchestrate. Orchestrating is opt-in per session: many
 *                  sessions, real cost.
 *   step           is a step of a plan, so has an orchestrator to ask
 *   session.write  may write its own session document
 *   watches        may keep watches in its session document
 *
 * A research step (`scoped`) is offered only what follows from being a step:
 * nothing in it writes a session.
 */
export function sessionCapabilities(doc, { scoped = false } = {}) {
  const has = new Set()
  const step = !!doc?.workflow?.planUrl
  if (step) has.add("step")
  if (scoped) return has
  has.add("session.write")
  has.add("watches")
  if (doc?.config?.workflows?.enabled && !step) has.add("workflows")
  return has
}
