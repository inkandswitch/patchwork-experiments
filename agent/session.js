/**
 * The session model — pure functions over plain objects.
 *
 * Nothing in this file touches automerge, the DOM, or the network, so all of it
 * is unit-testable. `store.js` applies these shapes to a real DocHandle; the
 * loop reads and writes through that.
 *
 * A session document:
 *
 *   {
 *     title:   string
 *     subject: AutomergeUrl | null      the doc this session is about
 *     config:  { providerId, model, params }
 *     turns:   Turn[]
 *     status:  "idle" | "running" | "awaiting-approval" | "parked" | "error"
 *     lease:   { runner, at, generation } | null
 *     grants:  { [grantKey]: "session" | "always" }
 *   }
 *
 *   Turn  = { id, role: "user"|"assistant"|"tool", at, author, blocks: Block[] }
 *   Block = { type: "text",      id, text }
 *         | { type: "reasoning", id, text }
 *         | { type: "call",      id, tool, input, where, status, runner, generation }
 *         | { type: "result",    id, callId, output, isError, image, doc }
 *
 * Automerge cannot hold `undefined`, so every optional field is either present
 * or `null` — never assigned undefined. See patchwork-skill §5.
 */

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

export const DEFAULT_CONFIG = {
  providerId: "openrouter",
  model: "anthropic/claude-sonnet-4.5",
  params: { temperature: 0, maxTokens: 8192 },
}

/** Seed a brand-new session document. Runs inside a `handle.change`. */
export function initSession(doc, opts = {}) {
  doc.schemaVersion = SCHEMA_VERSION
  doc.title = opts.title ?? "Agent"
  doc.subject = opts.subject ?? null
  doc.config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) }
  doc.turns = []
  doc.status = STATUS.idle
  doc.lease = null
  doc.grants = {}
  doc.usage = { in: 0, out: 0, turns: 0 }
}

/** Accumulate token usage so a session can show what it has cost. */
export function addUsage(doc, usage) {
  if (!doc.usage) doc.usage = { in: 0, out: 0, turns: 0 }
  doc.usage.in += usage?.in ?? 0
  doc.usage.out += usage?.out ?? 0
  doc.usage.turns += 1
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

export function resultBlock(callId, output, opts = {}) {
  return {
    type: "result",
    id: opts.id ?? makeId("r"),
    callId,
    output: output ?? "",
    isError: opts.isError ?? false,
    // A data URL, when the tool answered with a picture.
    image: opts.image ?? null,
    // { url, name, bytes, mimeType } when the tool put its content in a
    // document — a fetched page, an imported file — so the transcript can link
    // to it and a person can open it instead of reading a wall of text.
    doc: opts.doc ?? null,
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

// ---------------------------------------------------------------- grants

/**
 * Which document is a call about?
 *
 * Most tools act on `input.url` (or `input.root`), and fall back to the
 * session's subject when neither is given. Tools that act on no particular
 * document — a web search, say — have no target.
 */
export function callTarget(block, subject = null) {
  const input = block?.input ?? {}
  return normalizeTarget(input.url ?? input.root ?? subject ?? null)
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
export function grantKey(toolId, target) {
  return target ? `${toolId}@${normalizeTarget(target)}` : toolId
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
  if (target == null) {
    keys.push(toolId)
  } else {
    keys.push(grantKey(toolId, target))
    for (const prefix of urlPrefixes(target)) keys.push(grantKey(toolId, prefix))
  }
  keys.push(grantKey(toolId, ANY_TARGET))
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
export function grantOffers(toolId, target) {
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
    offers.push({ key: grantKey(toolId, ANY_TARGET), label: "any site", detail: `every ${toolId} call in this session` })
    return offers
  }

  return [
    { key: grantKey(toolId, target), label: "this document", detail: String(target) },
    { key: grantKey(toolId, ANY_TARGET), label: "any document", detail: `every ${toolId} call in this session` },
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
 * `risk: "read"` runs silently. Everything else needs a grant for this tool on
 * this document. Tools flagged `alwaysAsk` ignore grants entirely — installing
 * code that runs on every future load should be deliberate every time.
 */
export function needsApproval(doc, toolDef, block = null, subject = null, sensitive = []) {
  if (!toolDef) return true
  if (toolDef.risk === "read") return false
  if (toolDef.alwaysAsk) return true

  const grants = doc.grants ?? {}
  const target = block ? callTarget(block, subject) : null

  // Risk belongs to the document, not only to the verb. Your module settings
  // decide what code runs on every future load, and your account is your
  // identity; a write to either deserves an explicit yes every time, whichever
  // tool is doing it. Attaching this to a bespoke "install" tool instead would
  // just mean the next tool that can write a document routes around it.
  if (target && sensitive.includes(target)) return true

  // Any grant from the exact target up to "anything" answers for this call.
  return !grantCandidates(toolDef.id, target).some((key) => {
    const held = grants[key]
    return held === "session" || held === "always"
  })
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
 * What the model is told when a person refuses a call.
 *
 * A statement of fact, not an instruction. The policy — do not retry, say what
 * you wanted it for — belongs in the system prompt, where it is said once;
 * repeating it per denial per turn is what made the agent fixate on declining.
 */
export const DENIED_RESULT = "Declined by the user."

export function toRequest(doc, { system = "", maxImages = MAX_IMAGES_IN_REQUEST } = {}) {
  const messages = []
  const turns = doc.turns ?? []

  // Find which result blocks still get to carry their image, and which calls
  // have an answer at all.
  const withImages = []
  const answered = new Set()
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      if (block.type !== "result") continue
      answered.add(block.callId)
      if (block.image) withImages.push(block.id)
    }
  }
  const keepImages = new Set(withImages.slice(-maxImages))

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
        const part = {
          type: "result",
          callId: block.callId,
          output: block.output ?? "",
          isError: !!block.isError,
        }
        if (block.image) {
          if (keepImages.has(block.id)) part.image = block.image
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

/** A lease is live if its heartbeat is recent enough. */
export function leaseIsLive(lease, { now = Date.now(), staleAfterMs = 15000 } = {}) {
  if (!lease || !lease.at) return false
  return now - lease.at < staleAfterMs
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
  return !leaseIsLive(lease, opts)
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
