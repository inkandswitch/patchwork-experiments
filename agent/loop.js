/**
 * The agentic loop.
 *
 * This is the piece that does not exist anywhere else in the codebase: every
 * other loop in Patchwork is main-thread, in-memory, capped at a handful of
 * rounds, and returns a string. This one reads and writes a document, can be
 * taken over mid-flight by another runner, stops for human approval, and
 * resumes.
 *
 * It is deliberately free of automerge, DOM and network: it takes a `store`
 * (see store.js), a `provider` (see providers/), and a `toolset` (see tools/),
 * so the whole thing is testable with plain objects and a scripted model.
 *
 * One turn = one model call plus the tool calls it asks for. `run` keeps taking
 * turns until the model stops asking for tools, a human decision is needed, a
 * host-tier call has nowhere to run, or the iteration budget runs out.
 */

import {
  STATUS,
  CALL,
  WHERE,
  callTarget,
  grantKey,
  addUsage,
  makeTurn,
  textBlock,
  reasoningBlock,
  callBlock,
  resultBlock,
  summaryBlock,
  toRequest,
  estimateTokens,
  unansweredCalls,
  callsAwaitingApproval,
  questionsAwaitingAnswer,
  runnableCalls,
  needsApproval,
  findCall,
  holdsLease,
} from "./session.js"
import { batchedAppender } from "./store.js"
import { runTool } from "./tools/index.js"

export const DEFAULT_SYSTEM = `You are an agent living inside Patchwork, a local-first workspace where everything is an automerge document.

You work on documents directly through your tools. Prefer acting over describing: if the user asks for a change, make it and report what you did.

Guidance specific to this environment:
- Documents have no fixed schema. Read a document (doc_read, shapeOnly first if it is large) before editing it, so your paths are real.
- Folders and files are documents too, and so is everything else. A Patchwork TOOL is just a folder of files: write them with fs_write, run it with tool_check, and install it by adding that folder's URL to the module settings document. There is no build step and no special machinery.
- You have skills — read them. skill_list shows what guidance exists; skill_read gives you one in full. Read "writing-patchwork-tools" before writing a tool and "editing-documents" before your first substantial edit. They exist because the mistakes they describe are the ones that actually get made.
- view_mount opens any document in any installed tool so you can drive it: click controls, type into fields, and see what rendered. Use it to check that a change LOOKS right, not just that it is structurally present.
- When a choice is genuinely the user's — which of two designs, what to call something, a fact only they have — use ask_user and give it options. Do not ask in prose and wait; that makes them read a paragraph and type a reply. Do not ask permission to use a tool either: running it asks for you.
- Everything you do is collaborative and versioned. Other people may be editing the same documents while you work.

Be concise. The transcript is read in a narrow sidebar.`

/** Outcome of a single call to `run`. */
export const OUTCOME = {
  idle: "idle", // the model finished its turn
  awaitingApproval: "awaiting-approval",
  awaitingAnswer: "awaiting-answer", // the agent asked the human something
  parked: "parked", // a host-tier call has no tab to run in
  aborted: "aborted",
  error: "error",
  budgetExhausted: "budget-exhausted",
}

/**
 * Take turns until there is nothing left to do.
 *
 * @param {object} opts
 * @param {object} opts.store      session store (store.js)
 * @param {object} opts.provider   provider adapter (providers/)
 * @param {object} opts.toolset    from tools/buildToolset
 * @param {object} opts.ctx        tool execution context { repo, subject, ... }
 * @param {string} opts.runnerUrl  identity of this runner, for the lease
 * @param {number} opts.generation lease generation this runner believes it holds
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.maxTurns] iteration budget (default 24)
 * @param {(where:string)=>boolean} [opts.canRun] may this runner execute a tier?
 */
export async function run(opts) {
  const {
    store,
    provider,
    toolset,
    ctx = {},
    runnerUrl = "local",
    generation = 1,
    signal,
    maxTurns = 24,
    system = DEFAULT_SYSTEM,
    canRun = (where) => where === WHERE.worker,
    onEvent = null,
  } = opts

  const emit = (event) => {
    try {
      onEvent?.(event)
    } catch {
      /* a broken observer must not break the loop */
    }
  }

  const stillOurs = () => holdsLease(store.doc(), runnerUrl, generation)

  // Defaults are applied above by destructuring, which does not write them back
  // onto `opts`. The helpers below read their settings from this normalized
  // object so they see the same values `run` does — passing `opts` through
  // would hand them `undefined` for anything the caller omitted.
  const settings = {
    store,
    provider,
    toolset,
    ctx,
    runnerUrl,
    generation,
    signal,
    system,
    canRun,
    emit,
    stillOurs,
    key: opts.key ?? null,
    flushMs: opts.flushMs ?? 120,
    subject: ctx?.subject ?? null,
    sensitive: (ctx?.sensitiveDocs ?? []).filter(Boolean),
  }

  for (let turnNumber = 0; turnNumber < maxTurns; turnNumber++) {
    if (signal?.aborted) return finish(store, STATUS.idle, OUTCOME.aborted, emit)
    if (!stillOurs()) return { outcome: OUTCOME.aborted, reason: "lease lost" }

    // ---- 1. Anything already pending decides what happens before we call out.
    //
    // A question comes first: if the agent has asked something, nothing else it
    // queued matters until there is an answer.
    const asking = questionsAwaitingAnswer(store.doc())
    if (asking.length) return finish(store, STATUS.awaitingAnswer, OUTCOME.awaitingAnswer, emit)

    const pending = callsAwaitingApproval(store.doc())
    if (pending.length) return finish(store, STATUS.awaitingApproval, OUTCOME.awaitingApproval, emit)

    const runnable = runnableCalls(store.doc())
    if (runnable.length) {
      const result = await executeCalls(settings)
      if (result) return result
      continue // results landed; go straight back to the model
    }

    // ---- 2. Compact first if the conversation has outgrown the window.
    await maybeCompact(settings)

    // ---- 3. Ask the model.
    setStatus(store, STATUS.running)
    let assistant
    try {
      assistant = await streamTurn(settings)
    } catch (err) {
      if (signal?.aborted) return finish(store, STATUS.idle, OUTCOME.aborted, emit)
      appendTurn(store, makeTurn("assistant", [textBlock(`⚠ ${String(err?.message ?? err)}`)]))
      return finish(store, STATUS.error, OUTCOME.error, emit, String(err?.message ?? err))
    }

    if (signal?.aborted) return finish(store, STATUS.idle, OUTCOME.aborted, emit)

    // ---- 4. Did it ask for anything?
    if (!assistant.calls.length) return finish(store, STATUS.idle, OUTCOME.idle, emit)

    // A question the model just asked outranks anything else it queued: the
    // answer may make the rest pointless, and being asked to approve work that
    // is about to be thrown away is a waste of the person's attention.
    if (questionsAwaitingAnswer(store.doc()).length) {
      return finish(store, STATUS.awaitingAnswer, OUTCOME.awaitingAnswer, emit)
    }

    const nowPending = callsAwaitingApproval(store.doc())
    if (nowPending.length) return finish(store, STATUS.awaitingApproval, OUTCOME.awaitingApproval, emit)

    const result = await executeCalls(settings)
    if (result) return result
  }

  return finish(store, STATUS.idle, OUTCOME.budgetExhausted, emit)
}

// ---------------------------------------------------------------- compaction

export const DEFAULT_COMPACT_AT = 80000

const COMPACT_PROMPT = `Summarize the conversation above for your own future reference. You are about to lose the detail, so keep what you would need to carry on:

- what the user asked for, in their terms
- what you did, and what the results were
- every document URL, tool name and decision that still matters, written out exactly
- what is still outstanding

Write it as notes to yourself, not as a message to the user. Be specific and complete rather than brief — this replaces the conversation.`

/**
 * Replace the early conversation with a summary when it has grown too large.
 *
 * Non-destructive: the summary block supersedes earlier turns for the purpose
 * of building the request, and the turns themselves stay in the document. If
 * the summarizing call fails, the turn proceeds uncompacted rather than
 * failing — a large request is better than no request.
 */
async function maybeCompact(settings) {
  const { store, provider, system, key, signal, emit } = settings
  const doc = store.doc()
  const threshold = doc.config?.compactAt ?? DEFAULT_COMPACT_AT

  if (estimateTokens(doc, system) < threshold) return false

  const turns = doc.turns ?? []
  // Keep the most recent exchanges intact; they are what the next turn is
  // actually about. Summarize everything before them.
  const keep = 6
  if (turns.length <= keep + 1) return false
  const upTo = turns[turns.length - keep - 1]

  emit({ type: "compacting", turns: turns.length - keep })

  const window = { ...doc, turns: turns.slice(0, turns.length - keep) }
  const request = toRequest(window, { system })
  request.messages.push({ role: "user", content: [{ type: "text", text: COMPACT_PROMPT }] })

  let text = ""
  try {
    for await (const event of provider.stream({
      ...request,
      tools: [],
      model: doc.config?.model,
      params: { ...(doc.config?.params ?? {}), maxTokens: 4000 },
      key,
      signal,
    })) {
      if (event.type === "text") text += event.delta
    }
  } catch (err) {
    emit({ type: "compact-failed", error: String(err?.message ?? err) })
    return false
  }

  if (!text.trim()) return false

  store.change((d) => {
    d.turns.push(makeTurn("user", [summaryBlock(text, upTo.id)]))
  })
  emit({ type: "compacted", supersededUpTo: upTo.id, summaryChars: text.length })
  return true
}

// ---------------------------------------------------------------- one turn

/**
 * Stream one model response into the document.
 *
 * Blocks are created lazily — an assistant turn that is pure tool use never
 * gets an empty text block — and text is appended through a batching appender
 * so a long answer is not one automerge change per token.
 */
async function streamTurn(opts) {
  const { store, provider, toolset, signal, system, flushMs = 120, emit, stillOurs } = opts

  const request = {
    ...toRequest(store.doc(), { system }),
    tools: toolset.schemas,
    model: store.doc().config?.model,
    params: store.doc().config?.params ?? {},
    key: opts.key ?? null,
    signal,
    onRetry: (info) => emit({ type: "retry", ...info }),
  }

  const turn = makeTurn("assistant", [])
  appendTurn(store, turn)
  const turnIndex = store.doc().turns.length - 1

  const appender = batchedAppender(store, flushMs)
  const calls = []
  let textIndex = null
  let reasoningIndex = null
  let stopReason = "end"

  const blockPath = (blockIndex) => ["turns", turnIndex, "blocks", blockIndex, "text"]

  try {
    for await (const event of provider.stream(request)) {
      if (signal?.aborted) break

      if (event.type === "text") {
        if (textIndex === null) {
          appender.flush()
          store.change((d) => {
            d.turns[turnIndex].blocks.push(textBlock(""))
          })
          textIndex = store.doc().turns[turnIndex].blocks.length - 1
        }
        appender.append(blockPath(textIndex), event.delta)
        emit({ type: "text", delta: event.delta })
      } else if (event.type === "reasoning") {
        if (reasoningIndex === null) {
          appender.flush()
          store.change((d) => {
            d.turns[turnIndex].blocks.push(reasoningBlock(""))
          })
          reasoningIndex = store.doc().turns[turnIndex].blocks.length - 1
        }
        appender.append(blockPath(reasoningIndex), event.delta)
      } else if (event.type === "call") {
        calls.push(event)
      } else if (event.type === "usage") {
        store.change((d) => addUsage(d, event))
        emit({ type: "usage", ...event })
      } else if (event.type === "stop") {
        stopReason = event.reason
      }
    }
  } finally {
    appender.flush()
  }

  // Commit the calls once the stream is complete, so the transcript never shows
  // a half-parsed call. Approval state is decided here, at write time.
  if (calls.length && stillOurs()) {
    store.change((d) => {
      for (const call of calls) {
        const tool = toolset.get(call.name)
        // A question is not approved or refused, it is answered — so it goes
        // in as `asking` and no runner will ever pick it up.
        const status = tool?.asksHuman
          ? CALL.asking
          : tool && !needsApproval(d, tool, { input: call.input }, opts.subject ?? null, opts.sensitive ?? [])
            ? CALL.approved
            : CALL.pending
        d.turns[turnIndex].blocks.push(
          callBlock(call.name, call.input, {
            id: call.id,
            where: tool?.where ?? WHERE.worker,
            status,
          })
        )
      }
    })
  }

  return { calls, stopReason, turnIndex }
}

// ---------------------------------------------------------------- calls

/**
 * Execute every runnable call, appending results as one tool turn.
 *
 * Returns a terminal result object when the loop must stop (parked, aborted,
 * lease lost); returns null when it should continue to the next model turn.
 */
async function executeCalls(opts) {
  const { store, toolset, ctx, signal, runnerUrl, generation, canRun, emit, stillOurs } = opts

  const runnable = runnableCalls(store.doc())
  if (!runnable.length) return null

  const results = []

  for (const call of runnable) {
    if (signal?.aborted) return finish(store, STATUS.idle, OUTCOME.aborted, emit)
    if (!stillOurs()) return { outcome: OUTCOME.aborted, reason: "lease lost" }

    const tool = toolset.get(call.tool)
    const where = tool?.where ?? call.where ?? WHERE.worker

    // A call this runner cannot execute parks the session rather than failing
    // it: a host-tier call waits for a tab, it does not error.
    if (!canRun(where)) {
      commitResults(store, results)
      return finish(store, STATUS.parked, OUTCOME.parked, emit, `needs ${where}`)
    }

    // Claim the call before running it. A runner that took over mid-flight
    // sees a live claim and leaves it alone; this is what keeps a takeover
    // from double-executing a side effect.
    let claimed = false
    store.change((d) => {
      const found = findCall(d, call.id)
      if (!found) return
      if (found.block.status !== CALL.approved) return
      found.block.status = CALL.running
      found.block.runner = runnerUrl
      found.block.generation = generation
      claimed = true
    })
    if (!claimed) continue

    emit({ type: "call-start", tool: call.tool, input: call.input })
    const outcome = await runTool(tool, call.input, { ...ctx, signal })
    emit({ type: "call-end", tool: call.tool, summary: outcome.summary, isError: outcome.isError })

    store.change((d) => {
      const found = findCall(d, call.id)
      if (found) found.block.status = outcome.isError ? CALL.error : CALL.done
    })

    results.push(
      resultBlock(call.id, outcome.output, {
        isError: outcome.isError,
        summary: outcome.summary,
        image: outcome.image ?? null,
        doc: outcome.doc ?? null,
      })
    )
  }

  commitResults(store, results)
  return null
}

function commitResults(store, results) {
  if (!results.length) return
  // Copy: the turn keeps this array, and the caller reuses its buffer.
  appendTurn(store, makeTurn("tool", results.slice()))
  results.length = 0
}

// ---------------------------------------------------------------- helpers

function appendTurn(store, turn) {
  store.change((d) => {
    if (!d.turns) d.turns = []
    d.turns.push(turn)
  })
}

function setStatus(store, status) {
  if (store.doc().status === status) return
  store.change((d) => {
    d.status = status
  })
}

function finish(store, status, outcome, emit, reason = null) {
  setStatus(store, status)
  emit?.({ type: "finish", outcome, reason })
  return { outcome, reason }
}

// ---------------------------------------------------------------- approvals

/**
 * Record a human decision on a pending call.
 *
 * `decision` is one of:
 *   "once" | "deny"                 — answer this call and nothing else
 *   "session" | "always"            — and grant this tool on this exact target
 *   { grant: "<grantKey>" }         — and grant this tool on a chosen scope
 *
 * The object form is what makes broad authority possible: the UI offers the
 * scopes from `grantOffers` — this page, this directory, this site, anything —
 * and hands back the key the human picked, rather than the loop assuming the
 * narrowest one. Grants are stored on the session document, so any participant
 * can approve and every approval is in the history.
 */
export function decide(store, callId, decision, subject = null) {
  store.change((d) => {
    const found = findCall(d, callId)
    if (!found) return
    const block = found.block
    if (block.status !== CALL.pending) return

    if (decision === "deny") {
      block.status = CALL.denied
      return
    }
    block.status = CALL.approved

    if (decision && typeof decision === "object" && decision.grant) {
      if (!d.grants) d.grants = {}
      d.grants[decision.grant] = "always"
      return
    }
    if (decision === "session" || decision === "always") {
      if (!d.grants) d.grants = {}
      // Scoped to the document this call is about, so "yes" means yes to this
      // rather than yes to everything this tool could ever touch.
      d.grants[grantKey(block.tool, callTarget(block, subject))] = decision
    }
  })
}

/**
 * Record a person's answer to an `ask_user` call.
 *
 * The answer becomes the call's *result*, which is what makes this work without
 * any new machinery: to the model it is an ordinary tool result, so no adapter,
 * no prompt shape and no provider has to know that a human was involved.
 *
 * `author` is recorded because in a shared session it matters who answered.
 */
export function answerQuestion(store, callId, answer, author = null) {
  const text = String(answer ?? "").trim()
  if (!text) return false

  let recorded = false
  store.change((d) => {
    const found = findCall(d, callId)
    if (!found) return
    const block = found.block
    if (block.status !== CALL.asking) return

    block.status = CALL.done
    if (!d.turns) d.turns = []
    d.turns.push(
      makeTurn("tool", [resultBlock(callId, text, { summary: `answered: ${text.slice(0, 40)}` })], { author })
    )
    d.status = STATUS.idle
    recorded = true
  })
  return recorded
}

/** Add a human message and mark the session ready to run. */
export function say(store, text, author = null) {
  store.change((d) => {
    if (!d.turns) d.turns = []
    d.turns.push(makeTurn("user", [textBlock(text)], { author }))
    d.status = STATUS.idle
  })
}

export { unansweredCalls }
