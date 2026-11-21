/**
 * The session model — pure functions over plain objects.
 *
 * It takes one thing from automerge: ImmutableString, a value type rather than
 * a document operation — no repo, no handle, no wasm, no network — so all of
 * this is still unit-testable. It belongs here because it is part of the shape:
 * it says a field is a scalar rather than collaborative text. `store.js`
 * applies these shapes to a real DocHandle; the loop reads and writes through
 * that.
 *
 * A session document:
 *
 *   {
 *     title:   string
 *     subject: AutomergeUrl | null      the doc this session is about
 *     config:  { providerId, model, params }
 *     turns:   Turn[]
 *     status:  "idle" | "running" | "awaiting-approval" | "parked" | "reconnecting" | "error"
 *     reconnecting: { reason, since, attempts } | null   while the network is away (network.js)
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
 * events.js). It rides in a "user" turn because that is what wakes a runner and
 * what every provider accepts after an assistant turn, but it is not the user
 * speaking, and both the model and the transcript are told so.
 *
 * Automerge cannot hold `undefined`, so every optional field is either present
 * or `null` — never assigned undefined. See patchwork-skill §5.
 */

import { ImmutableString } from "@automerge/automerge"
import { interpretAsDocumentId } from "@automerge/automerge-repo"

export const SCHEMA_VERSION = 1

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
  // and the runner carries on when it comes back (network.js, runner.js).
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

export const SESSION_TYPE = "agent-session"

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
 * Accumulate usage so a session can show what it has cost.
 *
 * `cost` is in dollars, as OpenRouter reports it for each request; a turn
 * whose cost was worked out from list prices instead marks the total as
 * partly estimated. A session that has never had a cost has no `cost` at all,
 * rather than a zero that would claim it was free.
 */
export function addUsage(doc, usage) {
  if (!doc.usage) doc.usage = { in: 0, out: 0, turns: 0 }
  doc.usage.in += usage?.in ?? 0
  doc.usage.out += usage?.out ?? 0
  doc.usage.turns += 1
  // Input tokens served from the prompt cache, at a fraction of the price.
  if (usage?.cached) doc.usage.cached = (doc.usage.cached ?? 0) + usage.cached
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) {
    doc.usage.cost = (doc.usage.cost ?? 0) + usage.cost
    if (usage.estimated) doc.usage.costEstimated = true
  }
}

/**
 * What one request cost: as the provider reported it, else worked out from the
 * catalogue's list prices (dollars per million tokens), else unknown.
 */
export function costOf(usage, prices = null) {
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) return { cost: usage.cost, estimated: false }
  const input = prices?.promptPerM
  const output = prices?.completionPerM
  if (input == null && output == null) return { cost: null, estimated: false }
  const cost = ((usage?.in ?? 0) * (input ?? 0) + (usage?.out ?? 0) * (output ?? 0)) / 1e6
  return { cost, estimated: true }
}

/** "$0.42", "<$0.01", "$1,204", "~" in front when partly estimated; null when no cost is known. */
export function formatCost(usage) {
  const cost = usage?.cost
  if (typeof cost !== "number" || !Number.isFinite(cost)) return null
  const mark = usage.costEstimated ? "~" : ""
  if (cost > 0 && cost < 0.01) return `${mark}<$0.01`
  if (cost >= 100) return `${mark}$${Math.round(cost).toLocaleString("en")}`
  return `${mark}$${cost.toFixed(2)}`
}

// ---------------------------------------------------------------- turns

export function makeTurn(role, blocks = [], opts = {}) {
  return {
    id: opts.id ?? makeId("t"),
    role,
    at: opts.at ?? Date.now(),
    author: opts.author ?? null,
    blocks,
  }
}

export function textBlock(text, opts = {}) {
  return { type: "text", id: opts.id ?? makeId("b"), text }
}

/**
 * Something a person attached to a message: a document dropped in from the
 * sidebar, or an image pasted or dropped, kept as a file document. An image
 * also carries what the model is shown (`image`, a data URL fitted as a
 * screenshot is), so the request needs nothing but this document.
 */
export function attachmentBlock({ url, name = null, docType = null, mimeType = null, image = null }, opts = {}) {
  return { type: "attachment", id: opts.id ?? makeId("b"), url: String(url), name, docType, mimeType, image: image ? frozen(image) : null }
}

/**
 * What the person had in front of them when they spoke.
 *
 * An ambient session is about no one document: it is summoned from anywhere,
 * and "this" means whatever was focused at the moment of asking — which is
 * different on every message. So each message carries its own snapshot, kept
 * in the transcript beside the words it explains, rather than a live value the
 * runner reads later and that has moved on by the time the model is called.
 *
 * `views` are `{ url, title, toolId }`; every field is present (null when
 * unknown) because automerge will not store `undefined`.
 */
export function contextBlock({ focused = null, open = [] } = {}, opts = {}) {
  const view = (v) => ({ url: String(v.url), title: v.title ?? null, toolId: v.toolId ?? null })
  return {
    type: "context",
    id: opts.id ?? makeId("b"),
    focused: focused?.url ? view(focused) : null,
    open: (open ?? []).filter((v) => v?.url && v.url !== focused?.url).map(view),
  }
}

/** A context block as the model reads it. */
export function describeContext(block) {
  const line = (v) => {
    const name = v.title ? `"${v.title}"` : "untitled"
    return `${name} — ${v.url}${v.toolId ? ` (in ${v.toolId})` : ""}`
  }
  const lines = ["[Workspace when this message was sent]"]
  lines.push(block.focused ? `Focused: ${line(block.focused)}` : "Focused: nothing")
  if (block.open?.length) {
    lines.push("Also open:")
    for (const v of block.open) lines.push(`- ${line(v)}`)
  }
  return lines.join("\n")
}

/**
 * Something a tool noticed after its call was over: `source` is the tool id,
 * `label` what it was watching, `count` how many notices were folded into it.
 */
export function eventBlock(source, text, opts = {}) {
  return {
    type: "event",
    id: opts.id ?? makeId("b"),
    source: String(source),
    label: opts.label ?? null,
    text: String(text),
    count: opts.count ?? 1,
    at: opts.at ?? Date.now(),
  }
}

/** An event block as the model reads it. */
export function describeEvent(block) {
  const watching = block.label ? `, watching ${block.label}` : ""
  return `[Event from ${block.source}${watching}. Not a message from the user: you asked to be woken when this happened.]\n${block.text ?? ""}`
}

export function reasoningBlock(text, opts = {}) {
  return { type: "reasoning", id: opts.id ?? makeId("b"), text }
}

export function callBlock(tool, input, opts = {}) {
  return {
    type: "call",
    id: opts.id ?? makeId("c"),
    tool,
    input: input ?? {},
    where: opts.where ?? WHERE.worker,
    status: opts.status ?? CALL.pending,
    runner: opts.runner ?? null,
    generation: opts.generation ?? null,
  }
}

/**
 * A summary that supersedes the turns before it.
 *
 * Compaction here is non-destructive, which is the advantage of keeping the
 * transcript in a document: the superseded turns stay exactly where they are,
 * still readable in the panel and still in history. Only the *request* skips
 * them. Nothing is thrown away to save context.
 */
export function summaryBlock(text, upToTurnId, opts = {}) {
  return { type: "summary", id: opts.id ?? makeId("s"), text, upToTurnId }
}

/**
 * Content written to the document once and never edited again.
 *
 * A plain string in automerge is a text CRDT: per-character structure, so two
 * people can edit the same sentence and have it merge. A tool result is not
 * that. One runner writes it whole and nothing ever edits it — but it is by far
 * the largest thing in the document, carrying screenshots as data URLs and
 * fetched pages as text.
 *
 * Getting this wrong is not marginal. Measured on this version of automerge,
 * twelve 200kB screenshots — 2.4MB of real content — stored as plain strings:
 * 374MB resident, ~1s to write each, ~900ms to load. The same content as
 * ImmutableStrings: 9MB, 13ms, 14ms. Roughly 155 bytes of CRDT metadata per
 * character. That is the difference between a session that works and a tab that
 * runs the browser out of memory, which is what a session holding a few dozen
 * screenshots was doing.
 *
 * Readers coerce with String(), and toRequest hands plain strings to the
 * providers, so nothing downstream needs to know.
 */
const frozen = (text) => new ImmutableString(String(text))

export function resultBlock(callId, output, opts = {}) {
  return {
    type: "result",
    id: opts.id ?? makeId("r"),
    callId,
    output: frozen(output ?? ""),
    isError: opts.isError ?? false,
    // A data URL, when the tool answered with a picture. The single biggest
    // thing in any session document, so it is stored frozen — see above.
    image: opts.image ? frozen(opts.image) : null,
    // { url, name, bytes, mimeType } when the tool put its content in a
    // document — a fetched page, an imported file — so the transcript can link
    // to it and a person can open it instead of reading a wall of text.
    doc: opts.doc ?? null,
    // { url, name, mimeType } when the tool handed the model a file to read
    // itself (a PDF). A reference: the bytes are loaded for each request,
    // so a datasheet never sits in this synced document.
    file: opts.file ?? null,
    // The tool's own one-line description of what it did. Computed once, when
    // the call runs, because the transcript needs it on every render and the
    // raw output's first line is a poor substitute (a JSON result renders as
    // the single character "{").
    summary: opts.summary ?? null,
  }
}

export function userTurn(text, opts = {}) {
  return makeTurn("user", [textBlock(text)], opts)
}

export function lastTurn(doc) {
  const turns = doc.turns ?? []
  return turns.length ? turns[turns.length - 1] : null
}

/** Every block in the session, flattened, with its position. */
export function* eachBlock(doc) {
  const turns = doc.turns ?? []
  for (let ti = 0; ti < turns.length; ti++) {
    const blocks = turns[ti].blocks ?? []
    for (let bi = 0; bi < blocks.length; bi++) {
      yield { turnIndex: ti, blockIndex: bi, turn: turns[ti], block: blocks[bi] }
    }
  }
}

/** Locate a call block by id. Returns null when absent. */
export function findCall(doc, callId) {
  for (const found of eachBlock(doc)) {
    if (found.block.type === "call" && found.block.id === callId) return found
  }
  return null
}

/** Locate the result block answering a call, if it has landed. */
export function findResult(doc, callId) {
  for (const found of eachBlock(doc)) {
    if (found.block.type === "result" && found.block.callId === callId) return found
  }
  return null
}

/** Calls that have no result yet, in document order. */
export function unansweredCalls(doc) {
  const out = []
  for (const found of eachBlock(doc)) {
    if (found.block.type !== "call") continue
    if (found.block.status === CALL.denied) continue
    if (findResult(doc, found.block.id)) continue
    out.push(found.block)
  }
  return out
}

/**
 * Calls a runner claimed and never finished.
 *
 * A call is claimed (`running`) under the lease of the runner executing it.
 * If that runner's tab closes or reloads mid-call, nothing will ever write the
 * call's result — and before this, nothing noticed: the call was neither
 * runnable nor awaiting anyone, so the session sat there looking busy forever.
 * A running call is orphaned exactly when its claim is not the live lease:
 * the lease has gone stale, or another runner or generation holds it.
 */
export function orphanedCalls(doc, opts = {}) {
  const lease = doc?.lease
  const live = !!lease && livenessOf(opts)(lease)
  return unansweredCalls(doc).filter(
    (call) => call.status === CALL.running && !(live && lease.runner === call.runner && lease.generation === call.generation)
  )
}

/** What an interrupted call's result says. */
export const INTERRUPTED =
  "This call was interrupted before it finished: the tab or process running it closed or reloaded. It may or may not have taken effect, so check before trying it again."

/**
 * Close out orphaned calls with an error result, inside a change.
 *
 * Not re-run: a call that was cut off may already have done what it does, and
 * doing a write twice is worse than telling the model it might not have
 * happened. Returns how many were closed.
 */
export function resolveOrphans(doc, opts = {}) {
  const orphans = orphanedCalls(doc, opts)
  if (!orphans.length) return 0
  for (const call of orphans) {
    const found = findCall(doc, call.id)
    if (found) found.block.status = CALL.error
  }
  if (!doc.turns) doc.turns = []
  doc.turns.push(makeTurn("tool", orphans.map((call) => resultBlock(call.id, INTERRUPTED, { isError: true, summary: "interrupted" }))))
  return orphans.length
}

/**
 * Mark a session as waiting for the network, inside a change (network.js).
 * `since` is when it first went, kept across attempts; `attempts` counts them.
 */
export function markReconnecting(doc, reason, now = Date.now()) {
  const was = doc.reconnecting
  doc.reconnecting = { reason: String(reason ?? "the network went away"), since: was?.since ?? now, attempts: (was?.attempts ?? 0) + 1 }
  doc.status = STATUS.reconnecting
}

/** What a call put back for the network says, when a person stops the session instead. */
export const STOPPED_OFFLINE = "Not run: the network went away before it could, and the person stopped the session rather than wait for it."

/**
 * A person stopping a session that is waiting for the network, inside a
 * change. Every call put back to wait gets its answer, the session says in
 * one line that it stopped, and nothing is left to run — otherwise the next
 * look would find work and try again. Returns whether there was anything to stop.
 */
export function stopReconnecting(doc) {
  if (doc.status !== STATUS.reconnecting) return false
  const reason = doc.reconnecting?.reason ?? "the network went away"
  const waiting = runnableCalls(doc)
  for (const call of waiting) {
    const found = findCall(doc, call.id)
    if (found) found.block.status = CALL.error
  }
  if (!doc.turns) doc.turns = []
  if (waiting.length) doc.turns.push(makeTurn("tool", waiting.map((call) => resultBlock(call.id, STOPPED_OFFLINE, { isError: true, summary: "stopped" }))))
  doc.turns.push(makeTurn("assistant", [textBlock(`⚠ Stopped while waiting for the network (${reason}).`)]))
  doc.reconnecting = null
  doc.status = STATUS.idle
  return true
}

/** Calls blocked on a human decision. */
export function callsAwaitingApproval(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.pending)
}

/** Calls cleared to run but not yet claimed by a runner. */
export function runnableCalls(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.approved)
}

/**
 * Calls that are questions waiting on a person.
 *
 * Separate from approvals on purpose. An approval is "may I", and the answer is
 * yes or no; a question is "which", and the answer is content that becomes the
 * call's result and goes to the model. Sharing one mechanism would mean the
 * model could get a question answered by someone clicking "allow".
 */
export function questionsAwaitingAnswer(doc) {
  return unansweredCalls(doc).filter((c) => c.status === CALL.asking)
}

/** The options a question offers, normalized to {label, detail}. */
export function questionOptions(block) {
  const raw = block?.input?.options
  if (!Array.isArray(raw)) return []
  return raw
    .map((option) =>
      typeof option === "string" ? { label: option, detail: null } : { label: option?.label ?? "", detail: option?.detail ?? null }
    )
    .filter((option) => option.label)
}

/** The longest a session title should be: it lives in a document list. */
export const MAX_TITLE = 60

/**
 * Name a session after the work it is doing.
 *
 * Trimmed, collapsed and capped, because this ends up in a sidebar row — and a
 * model asked for a title will sometimes hand back a sentence, or a sentence
 * with quotes around it.
 */
export function cleanTitle(text) {
  const once = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
  if (!once) return null
  return once.length > MAX_TITLE ? `${once.slice(0, MAX_TITLE - 1).trimEnd()}…` : once
}

/**
 * What to call a session that has not named itself.
 *
 * The first thing asked of it, which is nearly always a better name than
 * anything generic — and is available from the moment there is anything to
 * name at all.
 */
export function derivedTitle(doc) {
  const firstUserTurn = (doc?.turns ?? []).find((t) => t.role === "user")
  const text = (firstUserTurn?.blocks ?? []).find((b) => b.type === "text")?.text
  return cleanTitle(text)
}

/** The session's title: what it called itself, what it was asked, or nothing. */
export function sessionTitle(doc) {
  return cleanTitle(doc?.title) ?? derivedTitle(doc) ?? null
}

// ------------------------------------------------------------- artifacts

/**
 * What this session made.
 *
 * A document the agent creates is reachable from the tool result that made it
 * and from nowhere else — so as soon as the transcript is longer than a screen,
 * the thing you asked for is lost. Six calls later "where did my tool go" has no
 * answer that does not involve scrolling and reading base58.
 *
 * So every document a tool creates is recorded here, newest first, and the view
 * keeps them one click away for the whole session. It is a list rather than a
 * set because the ORDER is the story: the last thing made is almost always the
 * thing you want.
 */
export const MAX_ARTIFACTS = 40

export function recordArtifact(doc, ref) {
  if (!doc || !ref?.url) return false
  if (!doc.made) doc.made = []

  // Re-writing a file, or answering a fetch from what was already kept,
  // updates the entry in place rather than stacking duplicates — it is the
  // same artifact.
  const existing = doc.made.findIndex((a) => a.url === ref.url)
  if (existing >= 0) {
    doc.made[existing].at = ref.at ?? Date.now()
    if (ref.name) doc.made[existing].name = ref.name
    if (ref.bytes != null) doc.made[existing].bytes = ref.bytes
    return false
  }

  const entry = {
    url: ref.url,
    name: ref.name ?? "document",
    kind: ref.kind ?? "document",
    bytes: ref.bytes ?? null,
    at: ref.at ?? Date.now(),
  }
  // A kept source says what it was fetched from, how, and whether it has text
  // to read, which is what a later fetch of the same URL checks before going
  // to the network.
  if (ref.source) {
    entry.source = ref.source
    entry.engine = ref.engine ?? null
    entry.chars = ref.chars ?? null
    // What it is — a snapshot, say — so a capture of the same page can find it.
    if (ref.what) entry.what = ref.what
  }
  doc.made.unshift(entry)
  // Only what is not a kept source is capped: this list is what a later fetch
  // checks before going to the network, so dropping an old source would send
  // the session out for a page it already has.
  let others = doc.made.filter((a) => !a.source).length
  for (let i = doc.made.length - 1; i >= 0 && others > MAX_ARTIFACTS; i--) {
    if (doc.made[i].source) continue
    doc.made.splice(i, 1)
    others--
  }
  return true
}

/** Everything this session made, newest first. */
export function artifacts(doc) {
  return doc?.made ?? []
}

// ---------------------------------------------------------------- grants

/**
 * Which document is a call about? Each tool says.
 *
 * A tool definition may carry `target`, plain JSON so a plugin can declare it:
 *
 *   target: "none"                                   acts on no document
 *   target: { fields: ["docUrl", "url"] }            the first of these given
 *   target: { fields: ["url"], fallback: "subject" } …else the session's subject
 *
 * With no declaration a call is about `input.url`, else `input.root`, else
 * nothing. The one rule that used to apply to every tool — url, root, else the
 * subject — was wrong for most of them, and wrong in a way that showed up on
 * the approval card: a web_search was "about" whatever document the session
 * was open on, so its card offered "this document" and "any document", and
 * "any document" wrote `web@*` — every site, for every web tool. fs_write by
 * path was "about" the subject too, though it writes wherever the path says;
 * doc_create, view_interact and the rest likewise. Only doc_read, doc_edit and
 * doc_history really default to the subject, and they say so.
 *
 * `kind` says what sort of thing the target is, so the card can say "this
 * folder — anything inside it" for a root and "this document" for a file.
 */
export const DEFAULT_TARGET = { fields: ["url", "root"] }

/** What callers with no tool definition get: the historical rule, kept for them. */
const LEGACY_TARGET = { fields: ["url", "root"], fallback: "subject" }

export function callScope(block, env = null, toolDef = null) {
  const subject = typeof env === "string" ? env : (env?.subject ?? null)
  const input = block?.input ?? {}

  const spec = toolDef ? (toolDef.target === undefined ? DEFAULT_TARGET : toolDef.target) : LEGACY_TARGET
  if (spec === "none" || spec === null) return { target: null, kind: null }

  for (const field of spec.fields ?? []) {
    const value = input[field]
    if (value != null && value !== "") {
      return { target: normalizeTarget(value), kind: spec.kind ?? (field === "root" || field === "folder" ? "folder" : "document") }
    }
  }
  if (spec.fallback === "subject" && subject) return { target: normalizeTarget(subject), kind: "document" }
  return { target: null, kind: null }
}

export function callTarget(block, env = null, toolDef = null) {
  return callScope(block, env, toolDef).target
}

/**
 * One spelling per thing, so two grants cannot disagree about the same target.
 *
 * Only web URLs are normalized: case-folding a host is correct, and a fragment
 * never changes what is fetched. An automerge URL is already canonical and is
 * left exactly as it came.
 */
export function normalizeTarget(target) {
  if (target == null) return null
  const raw = String(target)
  if (!/^https?:\/\//i.test(raw)) return raw
  try {
    const url = new URL(raw)
    url.hash = ""
    return url.href
  } catch {
    return raw
  }
}

/**
 * The directory URLs that contain this one, innermost first, ending at the origin.
 *
 *   https://docs.python.org/3/library/os.html
 *     -> https://docs.python.org/3/library/
 *        https://docs.python.org/3/
 *        https://docs.python.org/
 *
 * Prefixes are built by walking path *segments*, never by comparing strings.
 * That is the whole security argument: a grant on `https://example.com/` can
 * never be matched by `https://example.com.attacker.net/`, because the attacker
 * URL simply generates a different set of keys.
 */
export function urlPrefixes(target) {
  let url
  try {
    url = new URL(String(target ?? ""))
  } catch {
    return []
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return []

  // The directory part: everything up to and including the last slash. A page
  // is contained by its directory, not by itself.
  const directory = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) || "/"
  const segments = directory.split("/").filter(Boolean)

  const prefixes = []
  for (let depth = segments.length; depth >= 0; depth--) {
    prefixes.push(`${url.origin}/${segments.slice(0, depth).map((s) => `${s}/`).join("")}`)
  }
  return [...new Set(prefixes)]
}

/**
 * Grants are scoped to a tool AND a document.
 *
 * Scoping to the tool alone is too coarse to be safe: approving `doc_edit` once
 * would let the agent edit every document you own for the rest of the session,
 * including ones you never had in mind. A grant should mean "yes, edit THIS",
 * not "yes, edit anything".
 */
/**
 * Tools that mean the same thing to the person approving them.
 *
 * "May you read adjointlabs.com" is one decision. It was three: a real session
 * ended up holding web_fetch@adjointlabs.com, web_import@adjointlabs.com AND
 * http_request@adjointlabs.com, because every tool carried its own grant and
 * the user was asked once per tool per site. (web_import has since gone.)
 *
 * http_request is in the group only for the calls that are equivalent in power
 * to a fetch — a plain GET. Another method, or a body, still asks every time;
 * see `asksEveryTime`.
 */
export const GRANT_GROUPS = {
  web_fetch: "web",
  web_search: "web",
  // Keeping a page is reading it, with its pictures: the same decision.
  // web_capture is a plugin (the Web snapshot package's), and a grouping is by
  // id, so its calls are asked about and granted with the web's all the same
  // — and a research step's standing web grant covers it.
  web_capture: "web",
  http_request: "web",
  // "May you write files" is likewise one decision; before fs_edit existed it
  // was implicitly one tool. Grants written as fs_write@… keep working.
  fs_write: "files",
  fs_edit: "files",
  fs_delete: "files",
  // Filing a kept source into a folder is writing into that folder.
  source_file: "files",
}

/** What a broad grant on this tool's group actually allows, for the button's tooltip. */
export function describeGrantScope(toolId) {
  switch (grantGroup(toolId)) {
    case "web":
      return "every web fetch, capture, search and plain GET in this session"
    case "files":
      return "every file write, edit, delete and filing in this session"
    default:
      return `every ${toolId} call in this session`
  }
}

export function grantGroup(toolId) {
  return GRANT_GROUPS[toolId] ?? toolId
}

export function grantKey(toolId, target) {
  // A grant with no target is on the tool, not the group: "always allow
  // searching" must not be stored as a bare `web`, which reads as the whole
  // group and would need a rule saying it means less than it says.
  if (!target) return toolId
  return `${grantGroup(toolId)}@${normalizeTarget(target)}`
}

/**
 * Does this call ask every time, whatever has been granted?
 *
 * `alwaysAsk` may be a boolean or a function of the input, because for some
 * tools the danger is in the arguments rather than the verb: an http_request
 * GET with no credential is a fetch, and the same tool with your API key
 * attached is the most dangerous thing here.
 */
export function asksEveryTime(toolDef, input = {}) {
  const rule = toolDef?.alwaysAsk
  if (typeof rule === "function") {
    try {
      return !!rule(input ?? {})
    } catch {
      return true // a rule that throws is not a rule that grants permission
    }
  }
  return !!rule
}

/** The key that means "this tool, on anything at all". */
export const ANY_TARGET = "*"

/**
 * Every grant that would cover this call, narrowest first.
 *
 * Approving each fetch individually is what made the loop unusable — the agent
 * stops on every page of a documentation site and waits for a human to agree
 * that yes, it may read the next one. So a grant can name a subtree: the exact
 * URL, any directory above it, the whole origin, or every target the tool can
 * reach.
 *
 * Matching is by generating the call's own keys and looking each up exactly, so
 * no substring comparison is ever made against a stored grant.
 */
export function grantCandidates(toolId, target) {
  const keys = []
  // The group key first, then the tool's own — so grants written before tools
  // were grouped keep working instead of silently asking again.
  const scopes = [...new Set([grantGroup(toolId), toolId])]

  for (const scope of scopes) {
    if (target == null) {
      keys.push(scope)
    } else {
      keys.push(`${scope}@${normalizeTarget(target)}`)
      for (const prefix of urlPrefixes(target)) keys.push(`${scope}@${prefix}`)
    }
    keys.push(`${scope}@${ANY_TARGET}`)
  }
  return [...new Set(keys)]
}

/**
 * The grants worth *offering* a human for this call, narrowest first.
 *
 * Not the same list as the candidates: every intermediate directory is a valid
 * grant, but a column of six buttons is a worse interface than three. So the
 * offer is the exact target, its immediate directory, the whole site, and
 * anything — the scopes people actually think in.
 */
export function grantOffers(toolId, target, kind = "document") {
  if (target == null) {
    return [{ key: toolId, label: "always", detail: `every ${toolId} call in this session` }]
  }

  const offers = []
  const isWeb = /^https?:\/\//i.test(String(target))

  if (isWeb) {
    const prefixes = urlPrefixes(target)
    const origin = prefixes[prefixes.length - 1]
    const directory = prefixes[0]
    let host = target
    try {
      host = new URL(target).host
    } catch {
      /* keep the raw string */
    }

    // Only offer the exact URL when it is not already the directory, otherwise
    // two buttons would mean the same thing.
    if (normalizeTarget(target) !== directory) {
      offers.push({ key: grantKey(toolId, target), label: "this page", detail: String(target) })
    }
    if (directory && directory !== origin) {
      offers.push({ key: grantKey(toolId, directory), label: shortPath(directory), detail: `anything under ${directory}` })
    }
    if (origin) offers.push({ key: grantKey(toolId, origin), label: host, detail: `anything on ${host}` })
    offers.push({ key: grantKey(toolId, ANY_TARGET), label: "any site", detail: describeGrantScope(toolId) })
    return offers
  }

  // The tooltip has to say what the broad grant covers, because it is keyed by
  // group: "any document" on an fs_edit is every write, edit and delete.
  if (kind === "folder") {
    return [
      { key: grantKey(toolId, target), label: "this folder", detail: `anything inside ${target}` },
      { key: grantKey(toolId, ANY_TARGET), label: "any folder", detail: describeGrantScope(toolId) },
    ]
  }
  return [
    { key: grantKey(toolId, target), label: "this document", detail: String(target) },
    { key: grantKey(toolId, ANY_TARGET), label: "any document", detail: describeGrantScope(toolId) },
  ]
}

/** `https://docs.python.org/3/library/` -> `/3/library/`, for a button label. */
export function shortPath(url) {
  try {
    const path = new URL(url).pathname
    return path.length > 28 ? `…${path.slice(-27)}` : path
  } catch {
    return String(url)
  }
}

/**
 * Does this call still need a human decision?
 *
 *   read      runs silently: it touches nothing.
 *   self      runs silently: it touches only this conversation — its own
 *             document, or a view it opened and is now closing.
 *   edit      runs silently: it writes only automerge documents, which keep
 *             their history, so anything it does can be seen and put back —
 *             doc_history shows every overwritten value. Asking first bought
 *             nothing that history does not, and the prompts were the main
 *             thing slowing the loop down. Two exceptions, below.
 *   write     needs a grant: it does something history cannot undo.
 *   external  needs a grant: it reaches past the user's documents.
 *
 * `edit` has two exceptions, and both are about the one thing history cannot
 * undo — code that has already run:
 *
 *   - Sensitive documents always ask (see below).
 *   - A tool's `askWhen(input)` names the calls that write source code. Code in
 *     a package runs with the user's authority on its next load, and automerge
 *     has no access control, so a package someone else published is as
 *     writable as your own — editing it changes it for everyone who installed
 *     it. Those calls fall back to needing a grant, like `write`.
 *
 * Tools flagged `alwaysAsk` ignore grants entirely.
 */
export function needsApproval(doc, toolDef, block = null, subject = null, sensitive = []) {
  if (!toolDef) return true
  // "self" is a write, but only ever to the session document — the conversation
  // you are already having. Stopping to ask permission to name your own
  // conversation would be an absurd thing to put in front of someone, and
  // calling it "read" to get that behaviour would be a lie in the tool list.
  if (toolDef.risk === "read" || toolDef.risk === "self") return false
  if (asksEveryTime(toolDef, block?.input)) return true

  const target = block ? callTarget(block, subject, toolDef) : null

  // Risk belongs to the document, not only to the verb. Your module settings
  // decide what code runs on every future load, and your account is your
  // identity; a write to either deserves an explicit yes every time, whichever
  // tool is doing it. Attaching this to a bespoke "install" tool instead would
  // just mean the next tool that can write a document routes around it.
  if (target && isSensitive(target, sensitive)) return true

  if (toolDef.risk === "edit" && !writesCode(toolDef, block?.input)) return false

  // Any grant from the exact target up to "anything" answers for this call.
  const grants = doc.grants ?? {}
  return !grantCandidates(toolDef.id, target).some((key) => {
    const held = grants[key]
    return held === "session" || held === "always"
  })
}

/** Does this `edit` call write source code? A rule that throws is taken as yes. */
export function writesCode(toolDef, input = {}) {
  const rule = toolDef?.askWhen
  if (typeof rule !== "function") return false
  try {
    return !!rule(input ?? {})
  } catch {
    return true
  }
}

/**
 * The document a reference names, in canonical form, or null when it names
 * none.
 *
 * `automerge:X`, `automerge:X#heads`, `automerge:X/a/b`, the bare id `X` and
 * the legacy UUID spelling of the same bytes are all one document, and the
 * repo will open any of them. So this asks the repo's own parser
 * (`interpretAsDocumentId`, which `repo.find` uses) rather than comparing
 * strings, which let every spelling but the first past a check.
 *
 * Surrounding whitespace is dropped first, because the tools that open a
 * reference trim it before they do; a check that did not would judge a
 * different string from the one that gets opened.
 */
export function documentIdOf(url) {
  const raw = String(url ?? "").trim()
  if (!raw) return null
  try {
    return interpretAsDocumentId(raw)
  } catch {
    return null
  }
}

/**
 * Is `target` one of the sensitive documents, however it is spelled?
 *
 * An `automerge:` reference the parser rejects counts as sensitive. Whether
 * it reaches a document then depends on what each tool does to it before
 * opening it, and the answer to "can this touch your account" must not.
 * When nothing is sensitive, nothing is.
 */
export function isSensitive(target, sensitive = []) {
  if (!sensitive.length) return false
  const id = documentIdOf(target)
  if (id) return sensitive.some((url) => documentIdOf(url) === id)
  return /^automerge:/i.test(String(target ?? "").trim())
}

/** Which grant is answering for this call, if any. For explaining a decision. */
export function grantCovering(doc, toolId, target) {
  const grants = doc?.grants ?? {}
  return grantCandidates(toolId, target).find((key) => {
    const held = grants[key]
    return held === "session" || held === "always"
  }) ?? null
}

// ---------------------------------------------------------------- request

/**
 * Build the provider-neutral request from the session.
 *
 * This is the one place the transcript becomes a model input, and it is
 * deliberately lossy in exactly two ways:
 *
 *   - reasoning blocks are dropped. Replaying another model's chain of thought
 *     back at it is not portable, and this transcript is model-agnostic by
 *     decision — a session can change models halfway through.
 *   - a call with no result yet becomes a result saying so, because a dangling
 *     tool call with no answer is a protocol error for most providers.
 */
/**
 * How many screenshots to carry in a request.
 *
 * Images are expensive on every subsequent turn, not just the one that took
 * them, so only the most recent few travel. Older ones keep their text and lose
 * the picture, with a note saying so — the agent can always take another.
 */
export const MAX_IMAGES_IN_REQUEST = 2

/**
 * Which large tool results still travel in full, and which go as a one-line
 * stand-in (taperedResult).
 *
 * A transcript is almost all tool results, and every one is re-sent on every
 * turn — measured, 97% of a real session's weight. So old large results are
 * shortened. But how they are shortened matters as much as how much:
 *
 *   - It used to keep only the newest 40,000 characters of large results.
 *     That is about four file reads: an agent working across a handful of
 *     files lost each one a few turns after reading it, recalled it, lost the
 *     recall, and recalled the recall — one real step read the same three files
 *     four to seven times each.
 *   - The line between kept and shortened moved on every turn, so the request
 *     changed in the middle on every turn, and prompt caching — which bills a
 *     repeated prefix at a tenth of the price — could never get past it.
 *
 * So results are now shortened in batches. Large results stay whole until they
 * pass HIGH characters in all; then the oldest are shortened, in one go, until
 * what stays whole is under LOW. Between batches nothing earlier in the
 * request changes. The decision is a fold over the results in order, so it
 * depends on nothing but the transcript, and a result once shortened stays
 * shortened (each prefix's choice is contained in the next one's).
 *
 * A small result always travels whole, and so does a pinned one (a result the
 * agent asked to have back).
 */
export const TAPER_ABOVE = 2000
export const RESULTS_HIGH = 160_000
export const RESULTS_LOW = 80_000

/** How much pinned text travels in full at most; past it, the oldest pins are let go. */
export const PIN_BUDGET = 60_000

/**
 * Pin a result so it travels in full, inside a change. Pins are numbered in
 * order, and when what is pinned passes PIN_BUDGET the oldest are released —
 * so asking for things back never grows a conversation without bound.
 * Returns { pinned, released: [result ids] }.
 */
export function pinResult(doc, resultId, { budget = PIN_BUDGET } = {}) {
  const results = (doc.turns ?? []).flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "result"))
  const target = results.find((b) => b.id === resultId)
  if (!target) return { pinned: false, released: [] }
  doc.pinSeq = (doc.pinSeq ?? 0) + 1
  target.pinned = doc.pinSeq
  const pins = results.filter((b) => b.pinned).sort((a, b) => a.pinned - b.pinned)
  let total = pins.reduce((sum, b) => sum + String(b.output ?? "").length, 0)
  const released = []
  for (const pin of pins) {
    if (total <= budget || pin === target) break
    delete pin.pinned
    total -= String(pin.output ?? "").length
    released.push(pin.id)
  }
  return { pinned: true, released }
}

export function resultsToKeepWhole(results, config = {}) {
  const taperAbove = config.taperAbove ?? TAPER_ABOVE
  const high = config.resultsHigh ?? RESULTS_HIGH
  const low = Math.min(config.resultsLow ?? RESULTS_LOW, high)
  const size = (block) => String(block.output ?? "").length

  const whole = [] // large results still whole, oldest first
  let wholeChars = 0
  const shortened = new Set()
  for (const block of results) {
    if (size(block) <= taperAbove || block.pinned) continue
    whole.push(block)
    wholeChars += size(block)
    if (wholeChars <= high) continue
    // A batch: down to LOW, but never the result just added — it is what the
    // agent asked for this turn.
    while (wholeChars > low && whole.length > 1) {
      const oldest = whole.shift()
      shortened.add(oldest.id)
      wholeChars -= size(oldest)
    }
  }

  const keep = new Set()
  for (const block of results) if (!shortened.has(block.id)) keep.add(block.id)
  return keep
}

/**
 * The stand-in for a result that is no longer carried in full.
 *
 * Has to say three things or it is worse than nothing: what the call was, that
 * this is an elision rather than the whole answer, and how to get the rest.
 */
export function taperedResult(block) {
  const size = String(block.output ?? "").length
  const what = block.summary || "an earlier tool result"
  // When the content is a kept source, reading it there is cheaper than
  // either route below, and its offsets are stable, so that comes first. Any
  // other document a call made is only pointed at.
  const url = block.doc?.url
  const saved = !url
    ? ""
    : block.doc.kind === "source"
      ? ` The content is kept at ${url}: read it with source_read {source:"${url}", offset:0}, or search it with find.`
      : ` It made ${url}.`
  // Two routes, and the difference between them matters: one is free and gives
  // exactly what this call said, the other does the work again and gives what
  // is true now.
  return (
    `[Not re-sent in full: ${what}. ${size} characters elided.${saved}` +
    ` Use session_recall with callId ${block.callId} for what it said,` +
    ` or make the call again for the current state.]`
  )
}

/**
 * What the model is told when a person refuses a call.
 *
 * A statement of fact, not an instruction. The policy — do not retry, say what
 * you wanted it for — belongs in the system prompt, where it is said once;
 * repeating it per denial per turn is what made the agent fixate on declining.
 */
export const DENIED_RESULT =
  "Declined by the user. Do not retry it. Carry on with everything that does not depend on it, and say in one line what you could not do."

/**
 * Mark the images a request would carry as refused by the provider, so no later
 * request carries them. The picture stays in the document — only the sending
 * stops; the agent can always take another.
 */
export function rejectSentImages(doc, { maxImages = MAX_IMAGES_IN_REQUEST } = {}) {
  const sent = []
  for (const turn of doc.turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if ((block.type === "result" || block.type === "attachment") && block.image && !block.imageRejected) sent.push(block)
    }
  }
  for (const block of sent.slice(-maxImages)) block.imageRejected = true
}

export function toRequest(doc, { system = "", maxImages = MAX_IMAGES_IN_REQUEST } = {}) {
  const messages = []
  const turns = doc.turns ?? []
  const confined = doc.scope != null

  // Find which result blocks still get to carry their image, and which calls
  // have an answer at all.
  const withImages = []
  const results = []
  const answered = new Set()
  const sent = theResultOfEachCall(turns)
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      // What a person attached shares the images-in-a-request budget with
      // screenshots: the newest are sent, older ones only named.
      if (block.type === "attachment") {
        if (block.image && !block.imageRejected) withImages.push(block.id)
        continue
      }
      if (block.type !== "result" || sent.get(block.callId) !== block.id) continue
      answered.add(block.callId)
      results.push(block)
      if (block.image && !block.imageRejected) withImages.push(block.id)
    }
  }
  const keepImages = new Set(withImages.slice(-maxImages))
  // Files handed to the model (a PDF a tool read, or one attached): only the
  // newest goes with a request; each can be read again on demand.
  const withFiles = []
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "result" && block.file?.url && sent.get(block.callId) === block.id) withFiles.push(block.id)
      if (block.type === "attachment" && isPdfAttachment(block)) withFiles.push(block.id)
    }
  }
  const keepFiles = new Set(withFiles.slice(-MAX_FILES_IN_REQUEST))
  const keepWhole = resultsToKeepWhole(results, doc.config ?? {})

  // A summary supersedes everything up to the turn it names. Only the most
  // recent one matters — an older summary is itself inside the range a newer
  // one covers.
  let startIndex = 0
  let summaryText = null
  for (let i = turns.length - 1; i >= 0 && summaryText === null; i--) {
    for (const block of turns[i].blocks ?? []) {
      if (block.type !== "summary") continue
      summaryText = block.text
      const supersededUpTo = turns.findIndex((t) => t.id === block.upToTurnId)
      startIndex = supersededUpTo >= 0 ? supersededUpTo + 1 : i + 1
      break
    }
  }

  if (summaryText) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: `[Summary of the earlier conversation]\n${summaryText}` }],
    })
  }

  for (const turn of turns.slice(startIndex)) {
    const content = []

    for (const block of turn.blocks ?? []) {
      if (block.type === "text") {
        if (block.text) content.push({ type: "text", text: block.text })
      } else if (block.type === "context") {
        // What a person had open is the names and URLs of their documents. A
        // research step must never hold those (scope.js), and the view adds
        // this note on its own, unasked, so it is not sent to one.
        if (!confined) content.push({ type: "text", text: describeContext(block) })
      } else if (block.type === "event") {
        content.push({ type: "text", text: describeEvent(block) })
      } else if (block.type === "attachment") {
        const what = [block.docType, block.mimeType].filter(Boolean).join(", ")
        const shown = block.image && keepImages.has(block.id)
        content.push({
          type: "text",
          text: `[Attached: ${block.name ?? "a document"}${what ? ` (${what})` : ""} — ${block.url}${block.image && !shown ? "; an image, not re-sent — doc_read it to look again" : ""}]`,
        })
        if (shown) content.push({ type: "image", image: String(block.image) })
        if (isPdfAttachment(block)) {
          if (keepFiles.has(block.id)) content.push({ type: "file", url: block.url, name: block.name ?? "document.pdf", mimeType: "application/pdf" })
          else content.push({ type: "text", text: "[That PDF is not re-sent: doc_read it to read it again.]" })
        }
      } else if (block.type === "call") {
        content.push({ type: "call", id: block.id, name: block.tool, input: block.input ?? {} })
        // A denial is the call's RESULT, in the place the call happened.
        //
        // It used to be skipped here and re-announced as a trailing user
        // message instead — every denial in the conversation, re-sent on every
        // turn, appended after everything else. So the last thing the model read
        // before writing was "this was declined, ask what they would like
        // instead", N times over, and it did exactly that: reported the decline
        // again and again instead of getting on with the rest of the work.
        //
        // As a result it is stated once, in order, attached to the call it
        // belongs to — the same shape as every other outcome the model already
        // knows how to read.
        // Denials are recorded as results when they happen. Sessions from
        // before that still have bare denied calls, and a call with no result
        // is a protocol error for most providers, so synthesize one.
        if (block.status === CALL.denied && !answered.has(block.id)) {
          content.push({ type: "result", callId: block.id, output: DENIED_RESULT, isError: true })
        }
      } else if (block.type === "result") {
        // One result per call, whatever the document holds (theResultOfEachCall).
        if (sent.get(block.callId) !== block.id) continue
        const part = {
          type: "result",
          callId: block.callId,
          // Plain strings from here on. This is the boundary with the
          // providers, and an ImmutableString is not a string to a `typeof`
          // check or to JSON.stringify.
          output: keepWhole.has(block.id) ? String(block.output ?? "") : taperedResult(block),
          isError: !!block.isError,
        }
        if (block.file?.url) {
          if (keepFiles.has(block.id)) part.file = { url: block.file.url, name: block.file.name ?? null, mimeType: block.file.mimeType ?? null }
          else part.output = `${part.output}\n[The file is not re-sent: read it again if you need it.]`
        }
        if (block.image) {
          if (keepImages.has(block.id)) part.image = String(block.image)
          else part.output = `${part.output}\n[screenshot from earlier, not re-sent — take another if you need to look again]`
        }
        content.push(part)
      }
      // reasoning: intentionally dropped, see above
    }

    if (!content.length) continue
    messages.push({ role: turn.role, content })
  }

  return { system, messages }
}

/**
 * The one result each call is answered with in a request.
 *
 * A provider refuses a call with two results, and a document can hold two:
 * a runner taking a session over closes a call it thinks was cut off, while
 * the runner it displaced finishes the call and writes what it found; or two
 * runners each record a result before their writes meet. Both are writes to a
 * shared document, so nothing can stop them both landing. What is sent is
 * decided here instead: a real result over the takeover's "interrupted" note,
 * since it says what actually happened, and otherwise the first.
 * Returns callId -> the id of its result block.
 */
export function theResultOfEachCall(turns) {
  const chosen = new Map()
  for (const turn of turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if (block.type !== "result") continue
      const held = chosen.get(block.callId)
      if (!held || (isInterruptedResult(held) && !isInterruptedResult(block))) chosen.set(block.callId, block)
    }
  }
  // By id: a document hands out a fresh object for a block on every read.
  return new Map([...chosen].map(([callId, block]) => [callId, block.id]))
}

/** Is this the result a takeover writes for a call it found cut off? */
export function isInterruptedResult(block) {
  return block?.summary === "interrupted" && String(block.output ?? "") === INTERRUPTED
}

/**
 * Give a session `add` dollars more than it has spent, inside a change. A
 * session stopped for its budget carries on from where it stopped: it is told
 * its new budget, which is also what wakes its runner. Returns the new limit.
 */
export function liftBudget(doc, add) {
  const amount = Number(add)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Lift the budget by a positive number of dollars.")
  if (!doc.config) doc.config = {}
  const spent = doc.usage?.cost ?? 0
  const limit = Math.round((Math.max(doc.config.budget ?? 0, spent) + amount) * 100) / 100
  doc.config.budget = limit
  if (doc.stopped?.reason === "budget") {
    doc.stopped = null
    if (!doc.turns) doc.turns = []
    doc.turns.push(makeTurn("user", [textBlock(`[Your budget is now $${limit.toFixed(2)}. Carry on from where you stopped.]`)]))
  }
  return limit
}

/** What a person can give a session that spent its budget: as much again, or four times as much. */
export function liftAmounts(limit) {
  const base = Math.max(0.5, Number(limit) || 0)
  return [...new Set([base, base * 4].map((n) => Math.round(n * 100) / 100))]
}

/** How many files (PDFs) go with one request: the newest. */
export const MAX_FILES_IN_REQUEST = 1

function isPdfAttachment(block) {
  return /application\/pdf/i.test(String(block.mimeType ?? "")) || /\.pdf$/i.test(String(block.name ?? ""))
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

// ---------------------------------------------------------------- lease

/**
 * Rough size of what would be sent, in tokens.
 *
 * Four characters per token is crude, but it is provider-neutral and free,
 * which a real tokenizer is neither. It only has to be good enough to decide
 * *when* to compact.
 */
export function estimateTokens(doc, system = "") {
  const request = toRequest(doc, { system })
  return Math.ceil((system.length + JSON.stringify(request.messages).length) / 4)
}

/**
 * A lease is live if its heartbeat is recent enough — by the reader's clock
 * against the writer's. Good enough for display and for one machine; across
 * machines whose clocks disagree it is wrong, and a runner deciding whether
 * it may take a session over asks a LeaseWatch instead.
 */
export function leaseIsLive(lease, { now = Date.now(), staleAfterMs = 15000 } = {}) {
  if (!lease || !lease.at) return false
  return now - lease.at < staleAfterMs
}

/** How long ago, by its own stamp, a lease seen for the first time must be to count as dead on sight. */
export const DEAD_ON_SIGHT_MS = 10 * 60 * 1000

/**
 * Is a lease live, as one observer sees it — without trusting anyone's clock?
 *
 * A heartbeat stamps the lease with the holder's clock, and comparing that
 * with ours is only right when the two clocks agree. Two browsers on two
 * machines need not: one running a minute fast sees every lease the other
 * holds as stale, takes the session over, and both run it.
 *
 * So liveness is judged by change, on the observer's own clock: a lease is
 * live until its value — holder, generation and stamp — has gone unchanged
 * for `staleAfterMs` of OUR time. A holder heartbeating every few seconds
 * keeps changing it, whatever its clock says; a dead one stops.
 *
 * One exception, so that a session whose runner died long ago resumes the
 * moment it is opened rather than after a wait: the first value this watch
 * ever sees, if its own stamp is DEAD_ON_SIGHT_MS old by our clock, is dead.
 * That trusts clocks to agree to within ten minutes, and only for leases
 * nobody has been seen renewing. Once the watch has seen a lease change, it
 * goes by change alone.
 *
 * Sample it often (every change and every heartbeat); a watch sampled late
 * errs towards live, which delays a takeover and never doubles one.
 */
export class LeaseWatch {
  constructor({ now = () => Date.now(), staleAfterMs = 15000, deadOnSightMs = DEAD_ON_SIGHT_MS } = {}) {
    this.now = now
    this.staleAfterMs = staleAfterMs
    this.deadOnSightMs = deadOnSightMs
    this.key = null
    this.since = 0
    this.first = true
  }

  live(lease) {
    if (!lease) return false
    const t = this.now()
    const key = `${lease.runner}\u0000${lease.generation}\u0000${lease.at}`
    if (key !== this.key) {
      if (this.key !== null) this.first = false
      this.key = key
      this.since = t
    }
    if (t - this.since >= this.staleAfterMs) return false
    if (this.first && typeof lease.at === "number" && t - lease.at >= this.deadOnSightMs) return false
    return true
  }
}

/** The liveness test `opts` asks for: a watch's, or the clock-comparing one. */
export function livenessOf(opts = {}) {
  if (typeof opts.live === "function") return opts.live
  return (lease) => leaseIsLive(lease, opts)
}

/**
 * May `runnerUrl` claim this session?
 *
 * Yes when there is no lease, when the lease is already ours, or when the
 * current holder has gone quiet. Takeover bumps the generation, which is how a
 * stale runner discovers it has been displaced (see `holdsLease`).
 */
export function canClaim(doc, runnerUrl, opts = {}) {
  const lease = doc.lease
  if (!lease) return true
  if (lease.runner === runnerUrl) return true
  return !livenessOf(opts)(lease)
}

export function claimLease(doc, runnerUrl, now = Date.now()) {
  const prev = doc.lease
  const generation = prev && prev.runner === runnerUrl ? prev.generation : (prev?.generation ?? 0) + 1
  doc.lease = { runner: runnerUrl, at: now, generation }
  return doc.lease
}

/**
 * Does this runner still hold the lease at this generation?
 *
 * Called before every write that has side effects. A runner that lost a race
 * sees a bumped generation and stands down rather than double-executing.
 */
export function holdsLease(doc, runnerUrl, generation) {
  const lease = doc.lease
  return !!lease && lease.runner === runnerUrl && lease.generation === generation
}
