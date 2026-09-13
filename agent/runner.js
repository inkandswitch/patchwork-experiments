/**
 * The runner: what turns a session document into a working agent.
 *
 * It claims the session's lease, heartbeats while it works, notices when there
 * is something to do, and drives the loop. It is environment-agnostic on
 * purpose — the same class runs in a tab, in a SharedWorker, or in node, and
 * the only differences are which tiers it can execute (`canRun`) and how it
 * identifies itself (`runnerUrl`).
 *
 * That is what makes takeover work: a cloud runner claiming a session that a
 * browser started is the same code path as a second tab taking over from a
 * closed one.
 */

import {
  STATUS,
  canClaim,
  claimLease,
  leaseIsLive,
  lastTurn,
  runnableCalls,
  callsAwaitingApproval,
} from "./session.js"
import { run, OUTCOME } from "./loop.js"

export const HEARTBEAT_MS = 5000
export const STALE_AFTER_MS = 15000

/**
 * Is there anything for THIS runner to do?
 *
 * Runner-aware on purpose. A worker that cannot run a host-tier call must not
 * consider that call work: it would claim the lease, park the session, notice
 * the resulting change, and park again forever. Asking "is there work I can
 * actually do" makes the handoff fall out — the worker sees none and stands
 * down, the tab sees the host-tier call and takes it.
 *
 * Deliberately conservative otherwise: a session with a pending approval is not
 * work, and neither is one whose last word was the agent's. That is what stops
 * a runner spinning on an errored session — the loop writes its error as an
 * assistant turn, so the next check sees nothing to do until a human speaks.
 */
export function needsWork(doc, canRun = () => true) {
  if (!doc) return false
  if (callsAwaitingApproval(doc).length) return false

  const runnable = runnableCalls(doc)
  if (runnable.length) return runnable.some((call) => canRun(call.where ?? "worker"))

  const last = lastTurn(doc)
  return !!last && last.role === "user"
}

export class SessionRunner {
  constructor(opts) {
    this.store = opts.store
    this.runnerUrl = opts.runnerUrl ?? `runner-${Math.random().toString(36).slice(2, 10)}`
    this.ctx = opts.ctx ?? {}
    this.buildToolset = opts.buildToolset
    this.getProvider = opts.getProvider
    this.getKey = opts.getKey ?? (() => null)
    this.canRun = opts.canRun ?? ((where) => where === "worker")
    this.onEvent = opts.onEvent ?? (() => {})
    this.now = opts.now ?? (() => Date.now())
    this.system = opts.system ?? undefined

    this.running = false
    this.stopped = false
    this.controller = null
    this.heartbeat = null
  }

  /** Begin watching for work. Returns a stop function. */
  start() {
    this.stopped = false
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
    this.tick()
    return () => this.stop()
  }

  stop() {
    this.stopped = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.interrupt()
  }

  /** Ask the current turn to stop after the call in flight. */
  interrupt() {
    this.controller?.abort()
  }

  /** Keep the lease warm while we are working, so nobody takes over. */
  beat() {
    if (!this.running) return
    const doc = this.store.doc()
    if (doc?.lease?.runner !== this.runnerUrl) return
    this.store.change((d) => {
      d.lease.at = this.now()
    })
  }

  /**
   * Run if there is work and we can get the lease. Safe to call often — it is
   * the change handler as well as the poll.
   */
  async tick() {
    if (this.stopped || this.running) return
    const doc = this.store.doc()
    if (!needsWork(doc, this.canRun)) return

    if (!canClaim(doc, this.runnerUrl, { now: this.now(), staleAfterMs: STALE_AFTER_MS })) {
      // Someone else is on it. Their heartbeat going quiet will bring us back.
      return
    }

    let generation
    this.store.change((d) => {
      generation = claimLease(d, this.runnerUrl, this.now()).generation
    })

    this.running = true
    this.controller = new AbortController()
    this.onEvent({ type: "start" })

    try {
      const provider = await this.getProvider()
      const toolset = await this.buildToolset(this.store.doc())

      const result = await run({
        store: this.store,
        provider,
        toolset,
        ctx: this.ctx,
        runnerUrl: this.runnerUrl,
        generation,
        signal: this.controller.signal,
        canRun: this.canRun,
        key: this.getKey(),
        system: this.system,
        onEvent: this.onEvent,
      })

      this.onEvent({ type: "done", ...result })
      return result
    } catch (err) {
      // Anything that escaped the loop (a provider that could not be
      // constructed, a toolset that failed to build) lands here.
      this.store.change((d) => {
        d.status = STATUS.error
      })
      this.onEvent({ type: "error", error: String(err?.message ?? err) })
      return { outcome: OUTCOME.error, reason: String(err?.message ?? err) }
    } finally {
      this.running = false
      this.controller = null
      this.releaseIfIdle()
    }
  }

  /**
   * Drop the lease when we finish, so another runner can pick the session up
   * immediately instead of waiting out a 15-second staleness timeout.
   */
  releaseIfIdle() {
    const doc = this.store.doc()
    if (doc?.lease?.runner !== this.runnerUrl) return
    if (needsWork(doc, this.canRun)) return
    this.store.change((d) => {
      d.lease = null
    })
  }
}

/** Is some *other* runner working on this session right now? */
export function heldElsewhere(doc, runnerUrl, now = Date.now()) {
  const lease = doc?.lease
  if (!lease || lease.runner === runnerUrl) return false
  return leaseIsLive(lease, { now, staleAfterMs: STALE_AFTER_MS })
}
