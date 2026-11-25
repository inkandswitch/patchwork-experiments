/**
 * The session document: its shape, its constants, and a new one.
 *
 * Everything in session/ is functions over plain objects: no repo, no handle,
 * no network. Two things come from automerge, both values rather than document
 * operations: ImmutableString (blocks.js), which says a field is a scalar
 * rather than collaborative text, and the document id parser (grants.js).
 * `kernel/store.js` applies these shapes to a real DocHandle; the loop reads
 * and writes through that.
 *
 * A session document:
 *
 *   {
 *     title:   string
 *     subject: AutomergeUrl | null      the doc this session is about
 *     config:  { providerId, model, params }
 *     turns:   Turn[]
 *     status:  "idle" | "running" | "awaiting-approval" | "parked" | "reconnecting" | "error"
 *     reconnecting: { reason, since, attempts } | null   while the network is away (net/network.js)
 *     halted:  { reason, at } | null      stopped from outside (a workflow step cancelled or
 *                                         reopened): no runner takes it until it is spoken to
 *     lease:   { runner, at, generation } | null
 *     grants:  { [grantKey]: "session" | "always" }
 *     made:    Artifact[]                 documents this session created
 *     watches: { [id]: Watch }            absent until doc_watch makes one (tools/watch.js)
 *   }
 *
 *   Turn  = { id, role: "user"|"assistant"|"tool", at, author, blocks: Block[] }
 *   Block = { type: "text",      id, text }
 *         | { type: "reasoning", id, text }
 *         | { type: "call",      id, tool, input, where, status, runner, generation }
 *         | { type: "result",    id, callId, output, isError, image, doc }
 *         | { type: "event",     id, source, label, text, count, at }
 *
 * An event block is news a tool delivered after its call was over (see
 * kernel/events.js). It rides in a "user" turn because that is what wakes a runner and
 * what every provider accepts after an assistant turn, but it is not the user
 * speaking, and both the model and the transcript are told so.
 *
 * Automerge cannot hold `undefined`, so every optional field is either present
 * or `null` — never assigned undefined. See patchwork-skill §5.
 */

const SCHEMA_VERSION = 1

/** Session-level status. `parked` means a call needs a browser tab and none is open. */
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
  // and the runner carries on when it comes back (net/network.js, kernel/runner.js).
  reconnecting: "reconnecting",
  error: "error",
}

/** Where a tool call can execute. See tools/index.js. */
export const WHERE = { worker: "worker", host: "host", task: "task" }

/** Lifecycle of a single tool call. */
export const CALL = {
  pending: "pending", // waiting on approval
  asking: "asking", // waiting on a human's answer; no runner will execute it
  approved: "approved", // cleared to run, not yet claimed
  running: "running", // claimed by a runner (see `runner` + `generation`)
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
  doc.status = STATUS.idle
  doc.lease = null
  doc.grants = {}
  doc.made = []
  doc.usage = { in: 0, out: 0, turns: 0 }
}

/**
 * Every kind of block this version of the agent writes and reads. A newer
 * version may add one — attachments were added this way — and a runner from
 * before it would read past it as if it were not there: the model is sent the
 * words of a message and never the image that came with it. So a runner that
 * meets a block it does not know leaves the session to one that does.
 */
export const BLOCK_TYPES = ["text", "reasoning", "call", "result", "context", "event", "summary", "attachment"]

/** The kinds of block in a session this version does not know, if any. */
export function unknownBlocks(doc) {
  const unknown = new Set()
  for (const turn of doc?.turns ?? []) for (const block of turn.blocks ?? []) if (!BLOCK_TYPES.includes(block?.type)) unknown.add(block?.type)
  return [...unknown]
}
