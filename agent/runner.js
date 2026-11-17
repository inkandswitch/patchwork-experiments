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
 *
 * It is also the one place every runner decides what a session's tools may
 * reach, from the session document alone (scope.js): a research step gets its
 * confined toolset and context, and every other session gets a repo that
 * cannot rewrite or make sessions or plans, with the two legitimate writers
 * handed explicit capabilities instead, and nothing else handed them.
 */

import {
  STATUS,
  canClaim,
  claimLease,
  leaseIsLive,
  lastTurn,
  runnableCalls,
  callsAwaitingApproval,
  questionsAwaitingAnswer,
  orphanedCalls,
  resolveOrphans,
  makeTurn,
  textBlock,
} from "./session.js"
import { run, OUTCOME } from "./loop.js"
import { scopeOf, assertScopeAgrees, confine, scopedToolset, kernelRepo, ScopeRefusal } from "./scope.js"
import { WORKFLOW_TOOL_IDS } from "./workflow/plan.js"

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
  // A call whose runner died mid-flight has to be closed out before anything
  // else can happen — whatever else the session is waiting on.
  if (orphanedCalls(doc).length) return true
  if (callsAwaitingApproval(doc).length) return false
  // A question the agent asked is work for a person, not for a runner.
  if (questionsAwaitingAnswer(doc).length) return false

  const runnable = runnableCalls(doc)
  if (runnable.length) return runnable.some((call) => canRun(call.where ?? "worker"))

  const last = lastTurn(doc)
  if (!last) return false

  // A trailing *tool* turn means results landed and nobody took them back to
  // the model. In a healthy run that never persists — the loop goes straight
  // round again — so seeing it means either an answered question, or a runner
  // that died between committing results and its next turn. Both want the same
  // thing: prompt the model. Before this, an answered question sat there and a
  // half-finished turn was stranded looking idle.
  return last.role === "user" || last.role === "tool"
}

export class SessionRunner {
  constructor(opts) {
    this.store = opts.store
    this.runnerUrl = opts.runnerUrl ?? `runner-${Math.random().toString(36).slice(2, 10)}`
    // The context as the runner's host built it, with the repo as it is. Tools
    // never see this object: they get `fullCtx` or a confined one (prepare).
    this.ctx = opts.ctx ?? {}
    this.fullCtx = fullContext(this.ctx, this.store)
    this.privileged = null
    this.buildToolset = opts.buildToolset
    // This runner's plugin tools, for a research step to admit the ones that
    // declare `scoped: true` (scope.js admitScoped). Only a runner with a
    // plugin registry — a tab — passes it; a worker or node runner has none,
    // and its research steps get the built-ins alone.
    this.pluginTools = opts.pluginTools ?? null
    // Told every toolset a run gets, scoped or not, so a view can ask it about calls.
    this.onToolset = opts.onToolset ?? null
    this.getProvider = opts.getProvider
    this.getKey = opts.getKey ?? (() => null)
    // (modelId, providerId) => catalogue entry | null. Optional: without it
    // the loop sends whatever the session's config says and caps nothing.
    this.getModelInfo = opts.getModelInfo ?? null
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

    // Mark ourselves busy BEFORE the first write. Claiming the lease *is* a
    // change to the session document, and the document's change handler calls
    // tick() — so a guard set after the write is set too late, and tick()
    // re-enters itself synchronously until the stack runs out.
    this.running = true
    this.controller = new AbortController()
    this.onEvent({ type: "start" })

    try {
      let generation
      this.store.change((d) => {
        generation = claimLease(d, this.runnerUrl, this.now()).generation
        // Taking over: anything the previous runner was in the middle of will
        // never finish. Say so, so the model can check and carry on.
        resolveOrphans(d, { now: this.now(), staleAfterMs: STALE_AFTER_MS })
      })

      const provider = await this.getProvider()
      const { toolset, ctx, privileged } = await this.prepare(this.store.doc())

      // What the catalogue knows about this model. A failure here is not a
      // reason to not run: the loop treats null as "no opinion".
      let modelInfo = null
      if (this.getModelInfo) {
        try {
          const config = this.store.doc()?.config ?? {}
          modelInfo = await this.getModelInfo(config.model ?? null, config.providerId ?? "openrouter")
        } catch {
          modelInfo = null
        }
      }

      const result = await run({
        store: this.store,
        provider,
        toolset,
        modelInfo,
        ctx,
        privileged,
        // The session's own URL keeps its prompt cache on one provider. It is
        // the runner's to give, since a research step's context has no URL in it.
        sessionUrl: this.ctx.sessionUrl ?? null,
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
      // constructed, a toolset that failed to build) lands here. Recording the
      // error is best-effort: if the document itself is what failed, the write
      // fails too, and losing the runner to that would be the worse outcome.
      try {
        this.store.change((d) => {
          d.status = STATUS.error
          // A refused scope is said in the transcript, as the loop says its
          // own errors: the person sees why, and the session stops asking to
          // be run until someone does something about it.
          if (err instanceof ScopeRefusal) d.turns.push(makeTurn("assistant", [textBlock(`⚠ ${err.message}`)]))
        })
      } catch {
        /* the document is unwritable; the event below is all we can report */
      }
      this.onEvent({ type: "error", error: String(err?.message ?? err) })
      return { outcome: OUTCOME.error, reason: String(err?.message ?? err) }
    } finally {
      this.running = false
      this.controller = null
      this.releaseIfIdle()
    }
  }

  /**
   * What this run's tools get, decided by the session's scope and nothing
   * else: a toolset, the context they share, and what only some of them get
   * beyond it (`privileged`, which a research step's tools never have). A
   * malformed scope, or one that disagrees with the plan, throws, and the
   * session does not run.
   *
   * A research step's plugins are this runner's, looked up afresh for every
   * run like the rest of this, and they get the same confined context as
   * the step's built-ins: the one `confine` builds.
   */
  async prepare(doc) {
    const scope = scopeOf(doc)
    await assertScopeAgrees(doc, scope, this.ctx.repo)
    const prepared = scope
      ? { toolset: await scopedToolset({ plugins: await this.scopedPlugins() }), ctx: await confine(this.ctx, scope), privileged: () => null }
      : { toolset: await this.buildToolset(doc), ctx: this.fullCtx, privileged: (this.privileged ??= await privileges(this.ctx, this.store)) }
    this.onToolset?.(prepared.toolset)
    return prepared
  }

  /** This runner's plugin tools, or none; a registry that fails to load is no plugins, not no run. */
  async scopedPlugins() {
    if (typeof this.pluginTools !== "function") return []
    try {
      return (await this.pluginTools()) ?? []
    } catch {
      return []
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

/**
 * A full-access session's tool context: the host's own context, read live —
 * a view swaps `element` while a run is under way, and notes cache their
 * folder on it — with three fields put over it.
 *
 *   repo              kernelRepo: works as the repo does, except that nothing
 *                     it hands out can change or make a session or a plan
 *   session           this conversation's own document, to read, through the
 *                     store
 *   startStepSession  absent: starting a step's session is a workflow tool's
 *                     capability (`privileges`), not every tool's
 *
 * Every tool of the session gets this, plugins included, so nothing in it
 * writes a session or a plan.
 */
export function fullContext(base, store) {
  const overrides = {
    repo: kernelRepo(base.repo),
    session: { url: store?.url ?? null, doc: () => store.doc() },
    startStepSession: undefined,
  }
  return new Proxy(base, {
    get: (target, key) => (key in overrides ? overrides[key] : Reflect.get(target, key)),
    has: (target, key) => key in overrides || key in target,
    set: (target, key, value) => (key in overrides ? false : Reflect.set(target, key, value)),
    ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(overrides)])],
    getOwnPropertyDescriptor: (target, key) =>
      key in overrides
        ? { value: overrides[key], enumerable: true, configurable: true, writable: false }
        : Reflect.getOwnPropertyDescriptor(target, key),
  })
}

/**
 * What only some of a full session's tools get beyond its context: the two
 * capabilities that write sessions and plans, each to the built-in tools of
 * its one module.
 *
 *   workflows  the real repo and the step-session starter, for the workflow
 *              tools, which write plans and drive step sessions
 *   session    this conversation's own document, writable, for session_title
 *
 * By identity with the built-in, not by id: a plugin cannot take a built-in's
 * id, and a tool that is not the built-in gets nothing whatever it is called.
 * Loaded late, as scopedToolset is: the tool registry imports the workflow
 * driver, which imports this module.
 */
export async function privileges(base, store) {
  const { BUILTIN_TOOLS } = await import("./tools/index.js")
  const builtin = (id) => BUILTIN_TOOLS.find((t) => t.id === id)
  const workflows = { workflows: { repo: base.repo ?? null, startSession: base.startStepSession ?? null } }
  const session = { session: { url: store?.url ?? null, doc: () => store.doc(), change: (fn) => store.change(fn) } }
  const given = new Map([...WORKFLOW_TOOL_IDS.map((id) => [builtin(id), workflows]), [builtin("session_title"), session]])
  return (tool) => given.get(tool) ?? null
}

/** Is some *other* runner working on this session right now? */
export function heldElsewhere(doc, runnerUrl, now = Date.now()) {
  const lease = doc?.lease
  if (!lease || lease.runner === runnerUrl) return false
  return leaseIsLive(lease, { now, staleAfterMs: STALE_AFTER_MS })
}
