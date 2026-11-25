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
 * (see kernel/store.js), a `provider` (see providers/), and a `toolset` (see tools/),
 * so the whole thing is testable with plain objects and a scripted model.
 *
 * One turn = one model call plus the tool calls it asks for. `run` keeps taking
 * turns until the model stops asking for tools, a human decision is needed, a
 * host-tier call has nowhere to run, or the iteration budget runs out.
 */

import { CALL, WHERE } from "../session/schema.js"
import { STOP } from "../session/status.js"
import { askOf, covered, needsApproval, ownGrant } from "../session/grants.js"
import { addUsage, costOf, dollars } from "../session/usage.js"
import { resultsToKeepWhole, pinResult, rejectSentImages, toRequest, estimateTokens, DENIED_RESULT } from "../session/request.js"
import { makeTurn, textBlock, contextBlock, reasoningBlock, callBlock, resultBlock, summaryBlock, attachmentBlock, noticeBlock } from "../session/blocks.js"
import { unansweredCalls, callsAwaitingApproval, questionsAwaitingAnswer, runnableCalls, findCall, findResult, move, results as landed } from "../session/calls.js"
import { recordArtifact } from "../session/made.js"
import { holdsLease } from "../session/lease.js"
import { markReconnecting } from "../session/recovery.js"
import { batchedAppender } from "./store.js"
import { presentCall, runTool } from "./tool.js"
import { withFileData } from "../documents/files.js"
import { isInterruption } from "../net/network.js"
import { callNeeds } from "./placement.js"

/**
 * A stable, opaque key for a session: FNV-1a over its URL, as hex. Enough to
 * keep one session's requests together, and nothing that opens the document.
 */
export function sessionKey(url) {
  if (!url) return null
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const ch of String(url)) {
    const c = ch.codePointAt(0)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return `pw-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

/** Outcome of a single call to `run`. */
export const OUTCOME = {
  idle: "idle", // the model finished its turn
  awaitingApproval: "awaiting-approval",
  awaitingAnswer: "awaiting-answer", // the agent asked the human something
  truncated: "truncated", // the model kept running out of output budget
  repetition: "repetition", // the model kept repeating itself while thinking
  silent: "silent", // the model kept stopping without a word or a call
  parked: "parked", // a host-tier call has no tab to run in
  aborted: "aborted",
  reconnecting: "reconnecting", // the network went away; the runner resumes when it is back
  error: "error",
  budgetExhausted: "budget-exhausted",
}

/**
 * Take turns until there is nothing left to do.
 *
 * @param {object} opts
 * @param {object} opts.store      session store (kernel/store.js)
 * @param {object} opts.provider   provider adapter (providers/)
 * @param {object} opts.toolset    from tools/buildToolset
 * @param {object} opts.ctx        tool execution context { repo, subject, ... }
 * @param {(tool:object)=>object|null} [opts.privileged] fields one tool gets beyond `ctx`
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
    system = "",
    canRun = (where) => where === WHERE.worker,
    onEvent = null,
    modelInfo = null,
  } = opts

  const emit = (event) => {
    try {
      onEvent?.(event)
    } catch {
      /* a broken observer must not break the loop */
    }
  }

  const stillOurs = () => holdsLease(store.doc(), runnerUrl, generation)
  // Stopped. Said in the session only while it is still this runner's: a
  // page going away gives its leases up first (runners/registry.js), and must leave
  // what it was in the middle of for the next runner, not mark it idle.
  const stopped = () => (stillOurs() ? finish(store, OUTCOME.aborted, emit) : { outcome: OUTCOME.aborted, reason: "lease lost" })

  // Defaults are applied above by destructuring, which does not write them back
  // onto `opts`. The helpers below read their settings from this normalized
  // object so they see the same values `run` does — passing `opts` through
  // would hand them `undefined` for anything the caller omitted.
  const settings = {
    store,
    provider,
    toolset,
    ctx,
    privileged: opts.privileged ?? (() => null),
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
    // What the catalogue knows about the model in use, or null for "no
    // opinion". The provider uses it to drop parameters the model does not
    // take and to cap max_tokens; the truncation recovery below respects the
    // same ceiling.
    capabilities: modelInfo
      ? { supports: modelInfo.supports ?? null, maxOutput: modelInfo.maxOutput ?? null, efforts: modelInfo.efforts ?? null }
      : null,
    // List prices, for estimating a request's cost when the provider does not
    // report one.
    prices: modelInfo ? { promptPerM: modelInfo.promptPerM ?? null, completionPerM: modelInfo.completionPerM ?? null } : null,
    repeatWindow: opts.repeatWindow ?? REPEAT_WINDOW,
    sessionUrl: opts.sessionUrl ?? null,
    afterCall: opts.afterCall ?? [],
  }

  // What is added to the system prompt, in order: each section a function of
  // the tools' context giving text or nothing (assembly/prompt.js has the
  // agent's own). Read once per run, so what one turn wrote is in the next
  // run's prompt; a section that fails is left out, which is no reason to
  // stop working.
  for (const section of opts.sections ?? []) {
    try {
      const text = await section(ctx ?? {})
      if (text) settings.system = `${settings.system}\n\n${text}`
    } catch {
      /* this run goes without it */
    }
  }

  let truncations = 0
  const maxTruncations = opts.maxTruncations ?? 2
  let repetitions = 0
  const maxRepetitions = opts.maxRepetitions ?? 1
  let silences = 0

  for (let turnNumber = 0; turnNumber < maxTurns; turnNumber++) {
    if (signal?.aborted) return stopped()
    if (!stillOurs()) return { outcome: OUTCOME.aborted, reason: "lease lost" }
    const spent = spentBudget(store.doc())
    if (spent) return stopForBudget(store, spent, emit)

    // ---- 1. Anything already pending decides what happens before we call out.
    //
    // A question comes first: if the agent has asked something, nothing else it
    // queued matters until there is an answer.
    const asking = questionsAwaitingAnswer(store.doc())
    if (asking.length) return finish(store, OUTCOME.awaitingAnswer, emit)

    // A grant given a moment ago may already cover other calls that are still
    // waiting. Approval is decided when a call is written, so without this
    // three fetches of one site in one turn are three separate questions: the
    // person answers "yes, docs.python.org" and the other two go on waiting.
    releaseNowPermitted(settings)

    const pending = callsAwaitingApproval(store.doc())
    if (pending.length) return finish(store, OUTCOME.awaitingApproval, emit)

    const runnable = runnableCalls(store.doc())
    if (runnable.length) {
      const result = await executeCalls(settings)
      if (result) return result
      continue // results landed; go straight back to the model
    }

    // ---- 2. Compact first if the conversation has outgrown the window.
    try {
      await maybeCompact(settings)
    } catch (err) {
      if (signal?.aborted) return stopped()
      if (isInterruption(err)) return reconnect(store, err, emit)
      throw err
    }

    // ---- 3. Ask the model.
    let assistant
    try {
      assistant = await streamTurn(settings)
    } catch (err) {
      // streamTurn appends its assistant turn before the first token arrives,
      // so a request that dies leaves an empty one behind, which renders as
      // nothing and tells nobody anything.
      dropTrailingEmptyTurn(store)
      if (signal?.aborted) return stopped()
      // The network went away. What streamed of the turn is half a turn — no
      // call in it was committed — so it goes, and the turn is asked for again
      // whole when the network is back. Nothing is said about it in the
      // transcript: nothing happened that the model or the person must answer.
      if (isInterruption(err)) {
        dropTurn(store, err.turnId)
        return reconnect(store, err, emit)
      }
      return fail(store, String(err?.message ?? err), OUTCOME.error, emit)
    }

    if (signal?.aborted) return stopped()
    // Lost mid-stream: the session is another runner's, so write nothing more.
    if (assistant.lost) return { outcome: OUTCOME.aborted, reason: "lease lost" }

    // ---- 4. Was it cut off?
    //
    // `finish_reason: "length"` means the model ran out of output budget
    // mid-sentence. Left alone, a turn that stopped halfway through thinking
    // is written to the transcript and the session goes idle, which looks the
    // same as a model that finished: an agent that wrote a long plan and then
    // did none of it.
    //
    // Reasoning models make this much easier to hit, because the thinking
    // spends the same budget as the answer: several thousand tokens of thought
    // can exhaust the turn before a single tool call is emitted.
    if (assistant.stopReason === "length") {
      truncations++
      emit({
        type: "truncated",
        turn: turnNumber,
        attempt: truncations,
        where: assistant.broken?.length ? "tool-arguments" : "output",
      })

      // Carrying on is almost always what was meant, so do it rather than
      // making someone type "continue" — but bounded, because a model whose
      // thinking never fits will otherwise truncate forever.
      if (truncations <= maxTruncations) {
        // And give it more room than the attempt that ran out, since the most
        // likely reason it ran out is that the budget was too small for how
        // this model works.
        const maxTokens = Math.min(
          MAX_OUTPUT_TOKENS,
          settings.capabilities?.maxOutput ?? Infinity,
          (settings.paramsOverride?.maxTokens ?? store.doc().config?.params?.maxTokens ?? 8192) * 2
        )
        settings.paramsOverride = { ...(settings.paramsOverride ?? {}), maxTokens }
        // A turn that was mostly thinking will only think longer with more
        // room. Turn the thinking down as well, a step each time. Mostly, not
        // wholly: a turn that thinks at length and then has its long write
        // cut off would otherwise keep the same thinking and run out the same
        // way every time.
        if (mostlyThinking(store.doc().turns[assistant.turnIndex], assistant.broken)) {
          const current = settings.paramsOverride.reasoning ?? store.doc().config?.params?.reasoning ?? null
          settings.paramsOverride.reasoning = quieterReasoning(current, settings.capabilities, maxTokens)
        }
        nudge(
          store,
          assistant.broken?.length
            ? `(Your ${assistant.broken.map((c) => c.name).join(" and ")} call was cut off before its ` +
              "arguments finished, so it was not run.) Make the call again, and keep the arguments small — " +
              "several narrow calls are better than one that does not fit."
            : "(Your previous message was cut off by the output limit before you finished.) " +
              "Continue from where you stopped. Do not restate the plan — make the tool calls."
        )
        continue
      }

      return fail(
        store,
        `Cut off by the model's output limit ${truncations} times. ` +
          "It is spending its output budget on thinking before it acts. Raise `params.maxTokens` in this " +
          "session's config, cap the thinking with `params.reasoning` (e.g. { effort: \"low\" } or " +
          "{ max_tokens: 1024 }), or pick a model that reasons less.",
        OUTCOME.truncated,
        emit,
        "output limit"
      )
    }

    // ---- 5. Was it going round in circles?
    //
    // The truncation recovery above assumes a model that stopped needed more
    // room. A model that is repeating itself needs the opposite: it was
    // stopped by streamTurn the moment its thinking began re-emitting its own
    // earlier paragraphs, and giving it a bigger budget would buy more of the
    // same: a minute of "just rewrite the file — actually wait —" over the
    // same three options, which would run to the output limit and then be
    // told to continue.
    if (assistant.stopReason === "repetition") {
      repetitions++
      emit({ type: "repeating", turn: turnNumber, attempt: repetitions })

      if (repetitions <= maxRepetitions) {
        // The way out it is offered is one it has: a research step has no
        // tool that asks a person, and is not told to use one.
        const asker = toolset.tools.find((tool) => tool.asksHuman)
        nudge(
          store,
          "(You were repeating yourself, so your turn was stopped.) Do not deliberate further. " +
            "Take the simplest option that works and make the tool call now." +
            (asker ? ` If you are genuinely stuck, ask the user one question with ${asker.id} instead.` : "")
        )
        continue
      }

      return fail(
        store,
        "Stopped: the model kept repeating itself while thinking. " +
          "Try another model, or set sampling parameters for this one in the session's config " +
          "(its authors' recommended `temperature`, `top_p` and `repetition_penalty` are shown in the model picker).",
        OUTCOME.repetition,
        emit,
        "repetition"
      )
    }

    if (!assistant.calls.length) {
      // ---- 6. Did it stop without a word?
      //
      // A turn with no text and no call is not an answer. It went idle all the
      // same, and a workflow step that did it read as done — "finished without
      // saying anything", its document unwritten. Ask once; a model that does
      // it again has stopped working, and says so.
      if (saidNothing(store.doc().turns[assistant.turnIndex])) {
        silences++
        emit({ type: "silent", turn: turnNumber, attempt: silences })
        if (silences <= 1) {
          nudge(
            store,
            "(You stopped without saying anything or calling a tool.) If the work is finished, say what you " +
              "did and where the results are. If it is not, carry on with the next tool call."
          )
          continue
        }
        return fail(store, "The model stopped twice without a word or a tool call, so this ended here. Try again, or pick another model.", OUTCOME.silent, emit, "said nothing")
      }
      return finish(store, OUTCOME.idle, emit)
    }

    // A question the model just asked outranks anything else it queued: the
    // answer may make the rest pointless, and being asked to approve work that
    // is about to be thrown away is a waste of the person's attention.
    if (questionsAwaitingAnswer(store.doc()).length) {
      return finish(store, OUTCOME.awaitingAnswer, emit)
    }

    const nowPending = callsAwaitingApproval(store.doc())
    if (nowPending.length) return finish(store, OUTCOME.awaitingApproval, emit)

    const result = await executeCalls(settings)
    if (result) return result
  }

  return finish(store, OUTCOME.budgetExhausted, emit)
}

// ---------------------------------------------------------------- compaction

/** The most output we will ask any model for, however many times it truncates. */
export const MAX_OUTPUT_TOKENS = 32000

/** How many characters of a turn's own text must recur, verbatim, to count as a loop. */
export const REPEAT_WINDOW = 240

/**
 * Has the text just streamed already appeared, word for word, earlier in this
 * same turn?
 *
 * A model stuck in a thinking loop re-emits its own paragraphs — "Best idea:
 * just rewrite tool.js with fs_write. Do it. Actually wait" — and the third
 * copy reads exactly like the first. A working model does not produce 240
 * identical characters twice in one turn; a quoted line of code is shorter,
 * and a table or a run of dashes is caught by the whitespace test. So an exact
 * recurrence of the window is the signal, and it is the same signal whichever
 * model or sampling produced it.
 */
export function repeatsItself(streamed, window = REPEAT_WINDOW) {
  if (!window || streamed.length < window * 2) return false
  const tail = streamed.slice(-window)
  if (tail.trim().length < window / 2) return false
  // Prose has vocabulary. A table's separator rows, a grid of dashes, a run of
  // identical list markers repeat legitimately and have almost none.
  const words = new Set(tail.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  if (words.size < 12) return false
  return streamed.lastIndexOf(tail, streamed.length - window - 1) !== -1
}

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
  const { store, provider, system, key, signal, emit, capabilities } = settings
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
      capabilities: capabilities ?? null,
      key,
      signal,
    })) {
      if (event.type === "text") text += event.delta
    }
  } catch (err) {
    // No network is no network for the turn after it either: wait for it.
    if (isInterruption(err)) throw err
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

  const built = toRequest(store.doc(), { system })
  // Files the request refers to are loaded now, not kept in the session.
  built.messages = await withFileData(built.messages, opts.ctx?.repo ?? null)
  const request = {
    ...built,
    tools: toolset.schemas,
    model: store.doc().config?.model,
    params: { ...(store.doc().config?.params ?? {}), ...(opts.paramsOverride ?? {}) },
    capabilities: opts.capabilities ?? null,
    cacheKey: sessionKey(opts.sessionUrl),
    key: opts.key ?? null,
    signal,
    onRetry: (info) => {
      // The provider refused the images this request carried. Mark them, so the
      // next request leaves them out instead of failing first, every turn.
      if (info?.imagesRejected) store.change((d) => rejectSentImages(d))
      emit({ type: "retry", ...info })
    },
  }

  // Marked while it streams, so a runner that finds it after this page has
  // gone knows it is half a reply and asks again (session/recovery.js interruptedTurns).
  const turn = makeTurn("assistant", [])
  turn.streaming = { runner: opts.runnerUrl ?? null, generation: opts.generation ?? null }
  appendTurn(store, turn)
  const turnIndex = store.doc().turns.length - 1

  const appender = batchedAppender(store, flushMs)
  const calls = []
  let textIndex = null
  let reasoningIndex = null
  let stopReason = "end"
  let lost = false

  // Watch this turn's own prose for a loop. Checked every few dozen characters
  // rather than every delta; the scan is linear in the turn so far.
  const repeatWindow = opts.repeatWindow ?? REPEAT_WINDOW
  let streamed = ""
  let sinceCheck = 0
  let repeated = false
  const watch = (delta) => {
    if (repeated || !repeatWindow) return
    streamed += delta
    sinceCheck += delta.length
    if (sinceCheck < 32) return
    sinceCheck = 0
    if (repeatsItself(streamed, repeatWindow)) repeated = true
  }

  const blockPath = (blockIndex) => ["turns", turnIndex, "blocks", blockIndex, "text"]

  let heard = false
  let interrupted = false
  try {
    for await (const event of provider.stream(request)) {
      if (signal?.aborted) break
      if (repeated) break
      // The model answered: whatever cut the network off is over.
      if (!heard) {
        heard = true
        if (store.doc().reconnecting) store.change((d) => (d.reconnecting = null))
      }
      // Another runner has the session now (a claim that won a merge late):
      // stop writing into its transcript at once, not at the end of the turn.
      if (stillOurs && !stillOurs()) {
        lost = true
        break
      }

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
        watch(event.delta)
      } else if (event.type === "reasoning") {
        if (reasoningIndex === null) {
          appender.flush()
          store.change((d) => {
            d.turns[turnIndex].blocks.push(reasoningBlock(""))
          })
          reasoningIndex = store.doc().turns[turnIndex].blocks.length - 1
        }
        appender.append(blockPath(reasoningIndex), event.delta)
        watch(event.delta)
      } else if (event.type === "call") {
        calls.push(event)
      } else if (event.type === "usage") {
        const priced = { ...event, ...costOf(event, opts.prices) }
        store.change((d) => addUsage(d, priced))
        emit({ type: "usage", ...priced })
      } else if (event.type === "stop") {
        stopReason = event.reason
      }
    }
  } catch (err) {
    // Which turn to take back, should this be an interruption: the person may
    // have steered meanwhile, so it is not necessarily the last.
    if (err && typeof err === "object") err.turnId = turn.id
    interrupted = isInterruption(err)
    throw err
  } finally {
    appender.flush()
    // The stream is over and this runner saw it end — finished, stopped by
    // the person, or failed — so what is there is what happened. Not when it
    // was cut off by the network (the turn is taken back), nor when another
    // runner has the session (it is that runner's to settle).
    if (!lost && !interrupted && (!stillOurs || stillOurs())) {
      store.change((d) => {
        const t = d.turns?.[turnIndex]
        if (t?.id === turn.id && t.streaming) delete t.streaming
      })
    }
  }

  if (lost) return { calls: [], stopReason: "lease-lost", turnIndex, lost: true }

  // Stopped for going round in circles. Whatever was streamed stays in the
  // transcript — it is what happened — but no call is committed from it.
  if (repeated) return { calls: [], stopReason: "repetition", turnIndex }

  // A call whose arguments did not parse is a call that was cut off mid-JSON.
  //
  // The provider records it. Committed anyway, such a call has `{}` for its
  // input and its tool fails with something beside the point — "Pass at
  // least one op" for an edit whose ops never arrived. The turn's
  // finish_reason is `tool_calls`, not `length`, because the call block did
  // start, so this is the only signal there is.
  const broken = calls.filter((call) => call.parseError)
  if (broken.length) {
    return { calls: [], stopReason: "length", turnIndex, broken }
  }

  // Commit the calls once the stream is complete, so the transcript never shows
  // a half-parsed call. Approval state is decided here, at write time.
  if (calls.length && stillOurs()) {
    store.change((d) => {
      for (const call of calls) {
        const tool = toolset.get(call.name)
        // What the call asks of the person, worked out here, where the tool is
        // known, and kept on the call while it waits: whoever decides about it
        // later has only the document (session/grants.js).
        const ask = tool ? askOf(tool, call.input, { subject: opts.subject ?? null, sensitive: opts.sensitive ?? [] }) : null
        // A question is not approved or refused, it is answered — so it goes
        // in as `asking` and no runner will ever pick it up.
        const status = tool?.asksHuman ? CALL.asking : needsApproval(d, tool, call.input, ask) ? CALL.pending : CALL.approved
        d.turns[turnIndex].blocks.push(
          callBlock(call.name, call.input, {
            id: call.id,
            where: tool?.where ?? WHERE.worker,
            status,
            ask: status === CALL.pending ? ask : null,
            shown: presentCall(tool, call.input, opts.subject ?? null),
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
  const { store, toolset, ctx, privileged, signal, runnerUrl, generation, canRun, emit, stillOurs } = opts

  const runnable = runnableCalls(store.doc())
  if (!runnable.length) return null

  // This run's claim on a call: what it records when it takes one, and what a
  // call must still carry for this run to settle it (session/calls.js move).
  const mine = { runner: runnerUrl, generation }
  const results = []

  for (const call of runnable) {
    if (signal?.aborted) {
      commitResults(store, results)
      return stillOurs() ? finish(store, OUTCOME.aborted, emit) : { outcome: OUTCOME.aborted, reason: "lease lost" }
    }
    if (!stillOurs()) {
      // What already ran, ran: record it. Its calls are marked done, and a
      // call marked done with no result is one no runner will ever answer.
      commitResults(store, results)
      return { outcome: OUTCOME.aborted, reason: "lease lost" }
    }

    const tool = toolset.get(call.tool)
    const where = callNeeds(call, tool)

    // A call this runner cannot execute parks the session rather than failing
    // it: a host-tier call waits for a tab, it does not error. What it needs
    // is written on the call, so the runner that can run it is the one that
    // sees work in it — a plugin the worker cannot load here was recorded as
    // a worker call by whichever runner made it (kernel/placement.js callNeeds).
    if (!canRun(where)) {
      commitResults(store, results)
      if (call.where !== where) {
        store.change((d) => {
          const found = findCall(d, call.id)
          if (found) found.block.where = where
        })
      }
      return finish(store, OUTCOME.parked, emit, `needs ${where}`)
    }

    // Claim the call before running it. A runner that took over mid-flight
    // sees a live claim and leaves it alone; this is what keeps a takeover
    // from double-executing a side effect.
    let claimed = false
    store.change((d) => {
      claimed = move(findCall(d, call.id)?.block, "claim", mine)
    })
    if (!claimed) continue

    emit({ type: "call-start", tool: call.tool, input: call.input })
    // `events` is the session's, under this tool's name, so news it delivers
    // later says where it came from (kernel/events.js).
    const events = ctx.events?.forTool(call.tool)
    // `recall` reads this conversation's own transcript through the store, the
    // same way in every runner and whatever else the context lacks: it is the
    // one thing of the session's a research step may read. What only this
    // tool may have — the capability to write a plan or this session — is
    // added for this call alone, so no other tool ever holds it.
    // `hasTool`: which tools this session has, so a result can point to one
    // that is here (web_fetch to web_capture) and never to one that is not.
    const outcome = await runTool(tool, call.input, { ...ctx, ...privileged(tool), signal, events, recall: storeRecall(store), hasTool: (id) => !!toolset.get(id) })

    // The network went away under it. A tool says so only when its call had
    // no effect (net/network.js), so the call goes back to waiting to run, exactly
    // as it was before it was claimed, and runs again when the network is
    // back. What ran before it in this batch stands.
    if (outcome.interrupted && signal?.aborted) {
      // Stopped by the person as well: that is what it was, and it is said as
      // any stopped call is.
      Object.assign(outcome, { output: `Error: ${outcome.reason}`, isError: true, summary: `${call.tool} stopped` })
    } else if (outcome.interrupted) {
      store.change((d) => {
        move(findCall(d, call.id)?.block, "release", mine)
      })
      emit({ type: "call-end", tool: call.tool, summary: "interrupted: no network", isError: false })
      commitResults(store, results)
      return reconnect(store, { message: outcome.reason }, emit)
    }
    emit({ type: "call-end", tool: call.tool, summary: outcome.summary, isError: outcome.isError })

    // What a result has added to it before it is written, the result being
    // where the agent is looking: the first use of a package brings its usage
    // guide along (knowledge/guides.js surfaceGuides). A hook answers as a
    // tool does, with text or `{ text, facts }`, and is shown what the
    // session's results have said so far, this turn's included: that is all
    // the memory it has, so it holds for whichever runner takes the next call.
    for (const after of opts.afterCall ?? []) {
      const earlier = [...landed(store.doc()), ...results].map((result) => result.facts).filter(Boolean)
      const more = await after(ctx, call, tool, outcome, earlier)
      const text = typeof more === "string" ? more : more?.text
      if (text) outcome.output = `${outcome.output}\n\n${text}`
      if (more?.facts) outcome.facts = { ...outcome.facts, ...JSON.parse(JSON.stringify(more.facts)) }
    }

    // Only while the claim is still this run's: a runner that took the session
    // over meanwhile may have closed the call as interrupted, and that stands.
    store.change((d) => {
      move(findCall(d, call.id)?.block, outcome.isError ? "fail" : "succeed", mine)
    })

    results.push(
      resultBlock(call.id, outcome.output, {
        isError: outcome.isError,
        summary: outcome.summary,
        image: outcome.image ?? null,
        doc: outcome.doc ?? null,
        file: outcome.file ?? null,
        facts: outcome.facts ?? null,
      })
    )

    // Anything the call created goes on the session's list of what it made, so
    // it stays reachable after the transcript has scrolled past it.
    const made = [outcome.doc, ...(outcome.made ?? [])].filter((ref) => ref?.url)
    if (made.length) {
      store.change((d) => {
        for (const ref of made) recordArtifact(d, ref)
      })
    }
  }

  commitResults(store, results)
  return null
}

/** This conversation's turns, as they are when asked: what session_recall reads. */
export function storeRecall(store) {
  const recall = () => store.doc()?.turns ?? []
  /** Does this result travel in full in the next request? */
  recall.isWhole = (resultId) => {
    const doc = store.doc()
    const results = (doc?.turns ?? []).flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "result"))
    return resultsToKeepWhole(results, doc?.config ?? {}).has(resultId)
  }
  /** Have this result travel in full from now on (see pinResult). */
  recall.pin = (resultId) => {
    let outcome = null
    store.change((d) => {
      outcome = pinResult(d, resultId)
    })
    return outcome
  }
  return recall
}

function commitResults(store, results) {
  if (!results.length) return
  // A call already answered — closed as interrupted by a runner that took
  // over while it ran — keeps the answer it has; a second is never written.
  // (Two can still meet in a merge; toRequest sends one of them.)
  const doc = store.doc()
  const fresh = results.filter((r) => !findResult(doc, r.callId))
  results.length = 0
  if (fresh.length) appendTurn(store, makeTurn("tool", fresh))
}

// ---------------------------------------------------------------- helpers

/**
 * Approve every pending call the session's grants now cover.
 *
 * Only ever loosens: a call that still needs a human is left exactly as it is.
 * Decided from the document alone — what each call asks is on the call — so
 * a view or a workflow's driver, which have no toolset, release the same
 * calls a runner would.
 */
export function releaseNowPermitted({ store }) {
  const doc = store.doc()
  const freed = callsAwaitingApproval(doc).filter((call) => covered(doc, call))
  if (!freed.length) return 0

  store.change((d) => {
    for (const call of freed) move(findCall(d, call.id)?.block, "approve")
  })
  return freed.length
}

/** Take back a turn by id: a half-streamed one an interruption cut off. */
function dropTurn(store, turnId) {
  if (!turnId) return
  store.change((d) => {
    const i = (d.turns ?? []).findIndex((t) => t.id === turnId)
    if (i >= 0 && d.turns[i].role === "assistant") d.turns.splice(i, 1)
  })
}

/**
 * Stop for the network, saying so on the session and nowhere else. `since` is
 * when the network first went, kept across attempts so the person sees how
 * long it has been; `attempts` counts them for the same reason.
 */
function reconnect(store, err, emit) {
  const reason = String(err?.message ?? err ?? "the network went away")
  store.change((d) => markReconnecting(d, reason))
  emit?.({ type: "finish", outcome: OUTCOME.reconnecting, reason })
  return { outcome: OUTCOME.reconnecting, reason }
}

/** Remove a just-appended assistant turn that never received anything. */
function dropTrailingEmptyTurn(store) {
  store.change((d) => {
    const last = d.turns?.[d.turns.length - 1]
    if (last && last.role === "assistant" && (last.blocks ?? []).length === 0) d.turns.pop()
  })
}

/** Ask the model to go on, as the harness: a notice in a user-role turn (session/blocks.js). */
function nudge(store, text) {
  appendTurn(store, makeTurn("user", [noticeBlock("nudge", text)]))
}

/**
 * End the run as failed, saying why. The notice is what makes the session's
 * status an error, and what keeps a runner from taking it up again until
 * someone speaks to it (session/status.js).
 */
function fail(store, text, outcome, emit, reason = text) {
  appendTurn(store, makeTurn("assistant", [noticeBlock(STOP.error, text)]))
  return finish(store, outcome, emit, reason)
}

function appendTurn(store, turn) {
  store.change((d) => {
    if (!d.turns) d.turns = []
    d.turns.push(turn)
  })
}

/** Did this turn end with neither words nor a call — nothing a person or a workflow can use? */
export function saidNothing(turn) {
  const blocks = turn?.blocks ?? []
  return !blocks.some((b) => (b.type === "text" && String(b.text ?? "").trim()) || b.type === "call")
}

/**
 * Did thinking take most of this turn's output? Its words, its calls and any
 * call that was cut off (`broken`, which never became a block) are weighed
 * against its reasoning, by length.
 */
export function mostlyThinking(turn, broken = []) {
  let thought = 0
  let rest = 0
  for (const b of turn?.blocks ?? []) {
    if (b.type === "reasoning") thought += String(b.text ?? "").length
    else if (b.type === "text") rest += String(b.text ?? "").length
    else if (b.type === "call") rest += JSON.stringify(b.input ?? {}).length
  }
  for (const call of broken ?? []) rest += call.argsLength ?? 0
  return thought > 0 && thought >= rest
}

/** Effort levels from most thinking to least. */
const EFFORTS = ["xhigh", "high", "medium", "low", "minimal"]

/**
 * Less thinking than `current`: one effort level lower where the model takes
 * effort levels, else a cap of a quarter of the output budget on its
 * reasoning tokens (halving any cap already set).
 */
export function quieterReasoning(current, capabilities, maxTokens) {
  const efforts = capabilities?.efforts
  if (efforts === null || efforts === undefined || (Array.isArray(efforts) && efforts.length)) {
    const allowed = Array.isArray(efforts) && efforts.length ? EFFORTS.filter((e) => efforts.includes(e)) : EFFORTS
    const from = EFFORTS.indexOf(current?.effort ?? capabilities?.defaultEffort ?? "high")
    const lower = allowed.find((e) => EFFORTS.indexOf(e) > (from < 0 ? 1 : from))
    if (lower) return { effort: lower }
  }
  const cap = current?.max_tokens ? Math.floor(current.max_tokens / 2) : Math.floor(maxTokens / 4)
  return { max_tokens: Math.max(512, cap) }
}

/**
 * Has this session spent the budget its config gives it (dollars, as
 * OpenRouter reports them)? `{ spent, limit }` when it has, else null. Most
 * sessions have none; a workflow step always does.
 */
export function spentBudget(doc) {
  const limit = doc?.config?.budget
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null
  const spent = doc?.usage?.cost ?? 0
  return spent >= limit ? { spent, limit } : null
}

/**
 * Stop for the budget: say so in a notice, which records it too, so whoever
 * gave the budget — a workflow's orchestrator — can decide what happens next
 * (session/status.js stopOf). No runner picks the session up again until
 * someone speaks to it.
 */
function stopForBudget(store, { spent, limit }, emit) {
  store.change((d) => {
    d.turns.push(makeTurn("assistant", [noticeBlock(STOP.budget, `Stopped: this session has spent its ${dollars(limit)} budget (${dollars(spent)}). It carries on only if it is given more.`, { spent, limit })]))
  })
  return finish(store, OUTCOME.budgetExhausted, emit, "budget")
}

function finish(store, outcome, emit, reason = null) {
  // Any end but the network's own says it is back, or no longer matters.
  if (store.doc().reconnecting) store.change((d) => (d.reconnecting = null))
  emit?.({ type: "finish", outcome, reason })
  return { outcome, reason }
}

// ---------------------------------------------------------------- approvals

/**
 * Record a human decision on a pending call.
 *
 * `decision` is one of:
 *   "once" | "deny"                 — answer this call and nothing else
 *   "always"                        — and grant exactly what this call is about
 *   { grant: "<grant key>" }        — and grant a chosen scope
 *
 * The object form is what makes broad authority possible: the UI offers the
 * scopes from `grantOffers` — this page, this directory, this site, anything —
 * and hands back the key the human picked, rather than the loop assuming the
 * narrowest one. Grants are stored on the session document, so any participant
 * can approve and every approval is in the history.
 */
export function decide(store, callId, decision) {
  store.change((d) => {
    const found = findCall(d, callId)
    if (!found) return
    const block = found.block
    if (block.status !== CALL.pending) return

    if (decision === "deny") {
      move(block, "deny")
      // The refusal is the call's result, the same as any other outcome. With
      // no result, no runner sees work in the session and the model never
      // learns it was refused; and a tool turn after the call is what makes
      // the session work for a runner again (kernel/runner.js needsWork).
      if (!d.turns) d.turns = []
      d.turns.push(makeTurn("tool", [resultBlock(callId, DENIED_RESULT, { isError: true, summary: "declined" })]))
      return
    }
    move(block, "approve")

    // A call that asks every time, or does not say what it asks, takes no
    // grant: the yes is for this call.
    if (!block.ask || block.ask.always) return
    // Scoped to what this call is about unless a wider scope was chosen, so
    // "yes" means yes to this rather than to everything the tool could touch.
    const key = decision && typeof decision === "object" ? decision.grant : decision === "always" ? ownGrant(block) : null
    if (!key) return
    if (!d.grants) d.grants = {}
    d.grants[key] = true
  })

  // A grant just given may already cover other calls still waiting. It has to
  // happen HERE rather than in the loop: `needsWork` stands down while anything
  // awaits approval, so a runner would never get a turn in which to notice.
  // Answering "yes, docs.python.org" left the turn's other two docs.python.org
  // fetches sitting pending, and the session stuck.
  releaseNowPermitted({ store })
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
    if (!move(found.block, "answer")) return
    if (!d.turns) d.turns = []
    d.turns.push(
      makeTurn("tool", [resultBlock(callId, text, { summary: `answered: ${text.slice(0, 40)}` })], { author })
    )
    recorded = true
  })
  return recorded
}

/** Add a human message and mark the session ready to run. */
/**
 * Append what the person said. `context` (see `contextBlock`) records what
 * they had open; it goes first, so the model reads where they were before what
 * they asked. A context with nothing in it is left out rather than recorded.
 */
export function say(store, text, author = null, context = null, attachments = []) {
  const located = !!(context?.focused?.url || context?.open?.length)
  store.change((d) => {
    if (!d.turns) d.turns = []
    const blocks = located ? [contextBlock(context), textBlock(text)] : [textBlock(text)]
    for (const attachment of attachments ?? []) {
      blocks.push(attachmentBlock(attachment))
      // A file kept from the computer or a paste is something this session
      // made: it is listed with the rest, so it can be found again.
      if (attachment.kept) recordArtifact(d, { url: attachment.url, name: attachment.name, kind: "file" })
    }
    // Speaking to a session that was stopped is deciding it should carry on:
    // a user turn after the stop is what ends it (session/status.js stopOf).
    d.turns.push(makeTurn("user", blocks, { author }))
  })
}

export { unansweredCalls }
