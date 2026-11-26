/**
 * The session document: its shape, its constants, and a new one.
 *
 * Everything in session/ is functions over plain objects: no repo, no handle,
 * no network. One thing comes from automerge, a value rather than a document
 * operation: ImmutableString (blocks.js), which says a field is a scalar
 * rather than collaborative text. `kernel/store.js` applies these shapes to a
 * real DocHandle; the loop reads and writes through that.
 *
 * The document's fields, its turns and blocks, a call's life, status, stops,
 * the burst mark and approval are written out in SESSION.md, and only there.
 *
 * Automerge cannot hold `undefined`, so every optional field is either present
 * or `null`, never assigned undefined.
 */

/**
 * The shape a session document is in. A burst leaves alone a session that
 * says another (kernel/burst.js `outdated`): one a newer agent wrote, or one
 * from before the shapes were brought to this one.
 */
export const SCHEMA_VERSION = 2

/**
 * Where a session stands against this code: "current"; written by an
 * "earlier" version of the agent (one with no version is from before they
 * were stamped); or by a "newer" one. Only a current session is run. The
 * others are left as they are, and said to be so (ui/session-value.js); the
 * places that keep one session for a person start another in place of an
 * earlier one (ui/panel.js, ui/ambient.js).
 */
export function versionStanding(doc) {
  const version = doc?.schemaVersion ?? 1
  return version === SCHEMA_VERSION ? "current" : version < SCHEMA_VERSION ? "earlier" : "newer"
}

/** What a session is doing, as status.js reads it off the document. `parked` means a call needs a browser tab and none is open. */
export const STATUS = {
  idle: "idle",
  running: "running",
  awaitingApproval: "awaiting-approval",
  // The agent asked the human something and cannot proceed until it is
  // answered. Distinct from awaiting-approval: nothing is being permitted, a
  // question is being answered, and the answer becomes the call's result.
  awaitingAnswer: "awaiting-answer",
  parked: "parked",
  // The network went away mid-run. Not an error: nothing was written for it,
  // and the run carries on when it comes back (net/network.js, kernel/burst.js).
  reconnecting: "reconnecting",
  error: "error",
}

/** Where a tool call can execute. See kernel/tool.js. */
export const WHERE = { worker: "worker", host: "host" }

/** Lifecycle of a single tool call. */
export const CALL = {
  pending: "pending", // waiting on approval
  asking: "asking", // waiting on a human's answer; no runner will execute it
  approved: "approved", // cleared to run, not yet claimed
  running: "running", // claimed by a run or a page (`runner` names it)
  done: "done",
  error: "error",
  denied: "denied",
}

let idCounter = 0

/**
 * Monotonic-ish unique id. Injectable clock/random so tests are deterministic.
 * The counter guarantees uniqueness within a tick, which `Date.now()` alone
 * does not — two blocks committed in the same millisecond would collide.
 */
export function makeId(prefix, now = Date.now, rand = Math.random) {
  const n = (idCounter = (idCounter + 1) % 0xffff)
  return `${prefix}_${now().toString(36)}_${n.toString(36)}_${Math.floor(rand() * 0xffffff).toString(36)}`
}

/** Reset the id counter. Tests only. */
export function _resetIds() {
  idCounter = 0
}

// No sampling parameters by default. A knob the session does not set is not
// sent, so the model runs at the values its authors recommend and the provider
// applies — which differ: Claude's default is 1.0, MiMo forces 1.0 and top_p
// 0.95, and greedy decoding (temperature 0, the old default here) is exactly
// what sends open-weight reasoning models into verbatim thinking loops. The
// model catalogue carries each model's defaults; the settings panel shows them.
// Anything set here is an explicit override and travels with the session.
export const DEFAULT_CONFIG = {
  providerId: "openrouter",
  // The alias follows the newest Opus, so the default does not age.
  model: "~anthropic/claude-opus-latest",
  // Room for a long tool call — a whole file, a workflow's steps. At 8192 a
  // real session's workflow_start was cut off mid-arguments and the turn was
  // lost. Only what is generated is paid for; it is capped at each model's own
  // limit (providers/openrouter.js).
  params: { maxTokens: 16000 },
  // On: a session can split a large job across several. The limits and the
  // tier models are the plan's defaults (workflow/plan.js) until set here.
  workflows: { enabled: true },
}

const SESSION_TYPE = "agent-session"

/** Seed a brand-new session document. Runs inside a `handle.change`. */
export function initSession(doc, opts = {}) {
  // The type is set here, not by each caller: a session created any other way
  // than through Patchwork's own create path (a workflow step, say) otherwise
  // came out untyped, and Patchwork could not tell what it was.
  if (doc["@patchwork"]) doc["@patchwork"].type = SESSION_TYPE
  else doc["@patchwork"] = { type: SESSION_TYPE }
  doc.schemaVersion = SCHEMA_VERSION
  // Null, not "Agent". A fresh session has not earned a name yet, and a
  // placeholder here is worse than nothing: it defeats every fallback that
  // would otherwise describe the session by what it is doing, and leaves a
  // document list where everything is called the same thing.
  doc.title = opts.title ?? null
  doc.subject = opts.subject ?? null
  doc.config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) }
  doc.turns = []
  doc.burst = null
  doc.grants = {}
  doc.made = []
  doc.usage = { in: 0, out: 0, turns: 0 }
}

/**
 * Every kind of block this version of the agent writes and reads. A newer
 * version may add one — attachments were added this way — and a burst from
 * before it would read past it as if it were not there: the model is sent the
 * words of a message and never the image that came with it. So a burst that
 * meets a block it does not know leaves the session to one that does
 * (kernel/burst.js `outdated`).
 */
export const BLOCK_TYPES = ["text", "reasoning", "call", "result", "context", "event", "summary", "attachment", "notice"]

/** The kinds of block in a session this version does not know, if any. */
export function unknownBlocks(doc) {
  const unknown = new Set()
  for (const turn of doc?.turns ?? []) for (const block of turn.blocks ?? []) if (!BLOCK_TYPES.includes(block?.type)) unknown.add(block?.type)
  return [...unknown]
}
