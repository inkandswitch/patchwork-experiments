/**
 * A burst: one task's run of one session, from "there is work" until the
 * session waits on a person, has nothing to do, is stopped, or has a call
 * only a page can run.
 *
 * It is handed what a task's code is handed, `{ repo, signal, run, taskUrl,
 * settled, progress, log }`, and what its host gives it to run a session
 * (`runBurst`'s options). It imports nothing of the task system: what it must
 * know of its task's runs it asks `taskRuns`.
 *
 * What it promises:
 *   - It writes only after `settled` resolves, only while its signal is not
 *     aborted, and never under a stop, through a guarded store
 *     (kernel/store.js guardedStore); the loop and the privileged writers
 *     are built on that store alone. Its own values are written through
 *     `changeOwn`, each checked inside its change: its reply's mark taken
 *     off (on a cancel, or under a stop, keeping the text), one change per
 *     call, and clearing `burst` at its end.
 *   - Before it writes anything it looks: no work, a stop in force, a
 *     foreign `burst` (`held`), a step session its plan does not name
 *     (`not-the-step`), or `settled` rejecting, and it ends having written
 *     nothing.
 *   - At the top of every turn it looks again (`held`, `not-the-step`), then
 *     settles what other runs left (session/recovery.js settleDebris) in one
 *     change, before any request.
 *   - A stop written anywhere aborts its loop's signal as soon as its copy
 *     has it.
 *   - Its result is `{ outcome, heads, own }`: how it ended, the session's
 *     heads at the end, and the hashes of its tools' writes, which it also
 *     reports as `progress({ own })` as they grow.
 */

import { STOP, stopOf, stoppedFromOutside } from "../session/status.js"
import { hasDebris, settleDebris, markReconnecting } from "../session/recovery.js"
import { makeTurn, noticeBlock } from "../session/blocks.js"
import { WHERE } from "../session/schema.js"
import { needsWork, prepareRun, fullContext } from "./runner.js"
import { run as runLoop, OUTCOME } from "./loop.js"
import { guardedStore, handleStore } from "./store.js"
import { asInterruption, reconnectDelay, onOnline } from "../net/network.js"
import { Automerge, AutomergeRepo } from "../host/modules.js"

/** How a burst ends, beyond the loop's own outcomes (kernel/loop.js OUTCOME) and a task's abort reasons. */
export const BURST = {
  nothing: "nothing", // no work for it: written nothing
  held: "held", // `burst` names a run that is not of its task: written nothing more
  notTheStep: "not-the-step", // a step session its plan does not name
  stopped: "stopped", // a stop is in force
}

/** The reasons a task's signal aborts with (tasks/src/job-context.ts). */
const TASK_REASONS = new Set(["cancelled", "yielded", "stopping"])

/** How long a burst waits for its copy of the session to have the heads it was asked at. */
export const HEADS_WAIT_MS = 30_000

/** The turns a burst's loop takes before it chains into another. */
const MAX_TURNS = 24

/**
 * Run one burst of a session.
 *
 * @param {object} ctx  what a task is handed: `{ repo, signal, run, taskUrl, settled, progress, log }`
 * @param {object} opts
 * @param {string} opts.session          the session's url
 * @param {string[]} [opts.heads]        the heads the asker saw: waited for, at most HEADS_WAIT_MS
 * @param {()=>Promise<string[]>|string[]} opts.taskRuns  the ids of this task's runs, read now
 * @param {()=>Promise<object>} opts.getProvider
 * @param {string|null} [opts.key]
 * @param {object} [opts.context]        the host's tool context; `repo` is the task's
 * @param {object[]} [opts.builtins]
 * @param {()=>Promise<object[]>} [opts.plugins]
 * @param {(doc:object)=>Promise<object>} [opts.buildToolset]
 * @param {Function[]} [opts.sections]
 * @param {Function[]} [opts.afterCall]
 * @param {string} [opts.system]
 * @param {(where:string)=>boolean} [opts.canRun]  default: worker calls only
 * @param {Function} [opts.getModelInfo]
 * @param {Function} [opts.onEvent]
 * @param {Function} [opts.splice]       automerge's splice, for streamed text
 * @param {(attempt:number, signal:AbortSignal)=>Promise<void>} [opts.waitForNetwork]
 * @param {number} [opts.flushMs]
 */
export async function runBurst(ctx, opts) {
  const { repo, signal, run } = ctx
  const canRun = opts.canRun ?? ((where) => where === WHERE.worker)
  const handle = await repo.find(opts.session)
  await untilHeads(handle, opts.heads, signal)
  const store = handleStore(handle, opts.splice ?? Automerge.splice)

  // The loop's signal: the task's, and a stop coming into force.
  const controller = new AbortController()
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onAbort = () => abort(signal.reason)
  if (signal.aborted) onAbort()
  else signal.addEventListener("abort", onAbort, { once: true })
  const heedStop = () => {
    if (stoppedFromOutside(handle.doc())) abort(BURST.stopped)
  }
  handle.on("change", heedStop)

  // Made before `settled` is awaited, so it knows the moment it resolves.
  const guarded = guardedStore(store, { signal: controller.signal, settled: ctx.settled })

  const own = []
  const record = (hashes) => {
    const fresh = (hashes ?? []).filter((hash) => !own.includes(hash))
    if (!fresh.length) return
    own.push(...fresh)
    ctx.progress?.({ own: [...own] })
  }

  const ended = (outcome, reason = null) => {
    if (reason) ctx.log?.(`${outcome}: ${reason}`)
    return { outcome, heads: [...(handle.heads?.() ?? [])], own: [...own] }
  }
  // Another run has the task (`yielded`), or will have it (`stopping`): this
  // one is no longer the session's. A cancel ends only this burst, which
  // still closes what it was writing.
  const stillOurs = () => !(signal.aborted && signal.reason !== "cancelled")

  try {
    // ---- Looking, before anything is written.
    if (signal.aborted) return ended(String(signal.reason))
    if (stopOf(store.doc())) return ended(BURST.stopped)
    const first = await standBack()
    if (first.ended) return ended(first.ended)
    if (!hasWork(store.doc(), first.runs)) return ended(BURST.nothing)
    try {
      await ctx.settled
    } catch (err) {
      return ended(signal.aborted ? String(signal.reason) : "yielded", String(err?.message ?? err))
    }

    // ---- Working.
    const result = await work()
    const outcome = signal.aborted && TASK_REASONS.has(signal.reason) ? signal.reason : stopOf(store.doc()) && result.outcome === OUTCOME.aborted ? BURST.stopped : result.outcome

    // Its end: `burst` cleared while it names this run or another of its
    // task, except when another run has the task now.
    if (outcome !== "yielded") {
      const runs = new Set(await taskRuns())
      guarded.changeOwn((d) => {
        const named = d.burst?.run ?? null
        if (named != null && (named === run || runs.has(named))) d.burst = null
      })
    }
    return ended(outcome, result.reason)
  } finally {
    handle.off?.("change", heedStop)
    signal.removeEventListener?.("abort", onAbort)
  }

  async function taskRuns() {
    return [...((await opts.taskRuns()) ?? [])]
  }

  /**
   * The look at every turn boundary (and before the first): one read of the
   * task document, and of the plan for a step session. `held` when `burst`
   * names a run its task does not list; `not-the-step` when the plan's step
   * does not name this session. Writes nothing.
   */
  async function standBack() {
    const runs = new Set(await taskRuns())
    const doc = store.doc()
    const named = doc?.burst?.run ?? null
    if (named != null && named !== run && !runs.has(named)) return { ended: BURST.held }
    const step = doc?.workflow
    if (step?.planUrl && step?.stepId) {
      const plan = (await repo.find(step.planUrl)).doc()
      const named = (plan?.steps ?? []).find((s) => s.id === step.stepId)?.sessionUrl
      if (bare(named) !== bare(opts.session)) return { ended: BURST.notTheStep }
    }
    return { runs }
  }

  /** Work for this run: what needsWork says, its debris judged against this run, or `burst` left naming an earlier run of its task. */
  function hasWork(doc, runs) {
    const named = doc?.burst?.run ?? null
    if (named != null && named !== run && runs.has(named)) return true
    return needsWork(doc, canRun, null, (d) => hasDebris(d, run))
  }

  async function work() {
    let prepared = null
    let reconnects = 0
    for (;;) {
      let result
      try {
        prepared ??= await prepare()
        result = await runLoop({
          store: guarded,
          provider: prepared.provider,
          toolset: prepared.toolset,
          modelInfo: prepared.modelInfo,
          ctx: prepared.ctx,
          privileged: prepared.privileged,
          sections: opts.sections ?? [],
          afterCall: opts.afterCall ?? [],
          sessionUrl: opts.session,
          runnerUrl: run,
          generation: null,
          signal: controller.signal,
          canRun,
          key: opts.key ?? null,
          system: opts.system,
          onEvent: opts.onEvent ?? null,
          flushMs: opts.flushMs,
          maxTurns: MAX_TURNS,
          stillOurs,
          checkMark: true,
          oneChangePerCall: true,
          boundary: () => boundary(prepared.toolset),
        })
      } catch (err) {
        result = failed(err)
      }
      if (controller.signal.aborted) return result
      if (result.outcome === OUTCOME.reconnecting) {
        await (opts.waitForNetwork ?? waitForNetwork)(++reconnects, controller.signal)
        continue
      }
      reconnects = 0
      // Out of turns, not of budget: the burst goes on.
      if (result.outcome === OUTCOME.budgetExhausted && result.reason == null) continue
      return result
    }
  }

  async function prepare() {
    const base = { ...(opts.context ?? {}), repo }
    const fullCtx = fullContext(base, guarded, { record })
    const built = await prepareRun(store.doc(), { ctx: base, store: guarded, fullCtx, builtins: opts.builtins ?? [], plugins: opts.plugins ?? (async () => []), buildToolset: opts.buildToolset ?? null })
    const provider = await opts.getProvider()
    let modelInfo = null
    if (opts.getModelInfo) {
      try {
        const config = store.doc()?.config ?? {}
        modelInfo = await opts.getModelInfo(config.model ?? null, config.providerId ?? "openrouter")
      } catch {
        modelInfo = null
      }
    }
    return { ...built, provider, modelInfo }
  }

  /** The loop's look at the top of a turn: stand back, or settle what other runs left. */
  async function boundary(toolset) {
    const look = await standBack()
    if (look.ended) return { outcome: look.ended, reason: null }
    let settled
    const ran = guarded.change((d) => {
      settled = settleDebris(d, run, { ownRun: (other) => look.runs.has(other), rerun: (call) => toolset.get(call.tool)?.risk === "read" })
    })
    if (!ran) return { outcome: OUTCOME.aborted, reason: controller.signal.aborted ? String(controller.signal.reason) : "not settled" }
    if (settled === null) return { outcome: BURST.held, reason: null }
    return null
  }

  /** What escaped the loop, said in the session as the loop says its own failures; the network's is waited out. */
  function failed(err) {
    const message = String(err?.message ?? err)
    if (controller.signal.aborted) return { outcome: OUTCOME.aborted, reason: message }
    const interruption = asInterruption(err, "Could not start the run")
    if (interruption) {
      guarded.change((d) => markReconnecting(d, interruption.message))
      return { outcome: OUTCOME.reconnecting, reason: interruption.message }
    }
    guarded.change((d) => {
      if (!d.turns) d.turns = []
      d.turns.push(makeTurn("assistant", [noticeBlock(STOP.error, message)]))
      if (d.reconnecting != null) d.reconnecting = null
    })
    return { outcome: OUTCOME.error, reason: message }
  }
}

/** A url without its heads. */
const bare = (url) => (url == null ? null : String(url).split("#")[0])

/** Wait for the network: the backoff for this attempt, or until it says it is back, or the signal. */
function waitForNetwork(attempt, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      unlisten()
      signal?.removeEventListener?.("abort", done)
      resolve()
    }
    const timer = setTimeout(done, reconnectDelay(attempt))
    const unlisten = onOnline(done)
    signal?.addEventListener?.("abort", done, { once: true })
  })
}

/** Wait, at most HEADS_WAIT_MS, until this copy of the session has `heads` (url-encoded, as a handle gives them). */
async function untilHeads(handle, heads, signal, ms = HEADS_WAIT_MS) {
  if (!Array.isArray(heads) || !heads.length) return
  const has = () => {
    try {
      return Automerge.hasHeads(handle.doc(), AutomergeRepo.decodeHeads(heads))
    } catch {
      return true // heads it cannot read are no reason to wait
    }
  }
  if (has() || signal?.aborted) return
  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      handle.off?.("change", check)
      signal?.removeEventListener?.("abort", done)
      resolve()
    }
    const check = () => {
      if (has()) done()
    }
    const timer = setTimeout(done, ms)
    handle.on("change", check)
    signal?.addEventListener?.("abort", done, { once: true })
  })
}
