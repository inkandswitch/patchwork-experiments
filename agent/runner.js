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
  holdsLease,
  leaseIsLive,
  LeaseWatch,
  lastTurn,
  runnableCalls,
  callsAwaitingApproval,
  questionsAwaitingAnswer,
  orphanedCalls,
  resolveOrphans,
  unknownBlocks,
  makeTurn,
  textBlock,
  markReconnecting,
} from "./session.js"
import { run, OUTCOME } from "./loop.js"
import { scopeOf, assertScopeAgrees, confine, scopedToolset, kernelRepo, ScopeRefusal } from "./scope.js"
import { WORKFLOW_TOOL_IDS } from "./workflow/plan.js"
import { urlsIn } from "./doc-urls.js"
import { rememberOwn } from "./own-changes.js"
import { asInterruption, reconnectDelay, onOnline } from "./network.js"

/**
 * The document URLs this conversation has seen — its subject, what it made,
 * and every URL in its turns — for mending one a model mistyped. Read only
 * when a URL fails its checksum; kept until the conversation grows.
 */
const knownCache = new WeakMap()
export function knownUrls(store) {
  const doc = store?.doc?.()
  if (!doc) return []
  const turns = doc.turns?.length ?? 0
  const cached = knownCache.get(store)
  if (cached?.turns === turns) return cached.urls
  const text = JSON.stringify({ subject: doc.subject ?? null, made: doc.made ?? [], turns: (doc.turns ?? []).map((t) => (t.blocks ?? []).map((b) => (b.image ? { ...b, image: null } : b))) })
  // Newest first, so a suggestion favours what was mentioned last.
  const urls = urlsIn(text).reverse()
  knownCache.set(store, { turns, urls })
  return urls
}

export const HEARTBEAT_MS = 5000
export const STALE_AFTER_MS = 15000

/**
 * How long a runner waits after claiming a session before it believes the
 * claim. A claim is a write to a document other browsers share; two that
 * claim within one round trip of each other both think they won until the
 * writes meet. The merge picks one of them, the same one everywhere, and the
 * other sees it lost and stands down. This is how long the meeting is given.
 * It overlaps building the run, so it costs little on top.
 *
 * Safe while it is more than twice the time a change takes to reach the other
 * browser: a rival claims only before ours reaches it (under one delay after
 * ours), and its claim reaches us one delay later still. Sync through the
 * server takes a few hundred milliseconds; two seconds covers under one. A
 * claim slower than that can still win late, and the runner it displaces
 * stops at its next look at the lease, mid-stream included (loop.js).
 */
export const CONFIRM_MS = 2000

/** How long a runner already busy with N other sessions waits, per session, before taking one more: time for an idler browser to take it first. */
export const DEFER_PER_BUSY_MS = 1000

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
export function needsWork(doc, canRun = () => true, live = null) {
  if (!doc) return false
  // A call whose runner died mid-flight has to be closed out before anything
  // else can happen — whatever else the session is waiting on.
  if (orphanedCalls(doc, live ? { live } : {}).length) return true
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
    // A runner that cannot call the model must not take the session from one
    // that can: it would claim, fail for want of a key, and mark the session
    // errored for everyone. A runner given a key source runs only while it
    // yields a key; one given none (tests, mock providers) needs none.
    this.hasKey = opts.getKey ? () => !!opts.getKey() : () => true
    // (modelId, providerId) => catalogue entry | null. Optional: without it
    // the loop sends whatever the session's config says and caps nothing.
    this.getModelInfo = opts.getModelInfo ?? null
    this.canRun = opts.canRun ?? ((where) => where === "worker")
    this.onEvent = opts.onEvent ?? (() => {})
    this.now = opts.now ?? (() => Date.now())
    this.system = opts.system ?? undefined
    // Whether another runner's lease is live, judged by this runner's clock
    // alone (session.js LeaseWatch). Every lease decision here goes through it.
    this.watch = new LeaseWatch({ now: () => this.now(), staleAfterMs: STALE_AFTER_MS })
    this.live = (lease) => this.watch.live(lease)
    this.confirmMs = opts.confirmMs ?? CONFIRM_MS
    // How long to hold back before taking a free session, so a browser with
    // less on its plate gets it first. Zero unless the host says otherwise.
    this.deferMs = opts.deferMs ?? (() => 0)
    this.wantedSince = null
    this.later = null

    this.running = false
    this.stopped = false
    this.controller = null
    this.heartbeat = null

    // Waiting for the network (network.js). A run that ended for it is tried
    // again after a backoff, or at once when the host says the network is
    // back. Kept by this runner, judged by its clock: another runner — a
    // machine whose network works — is free to take the session meanwhile.
    this.onOnline = opts.onOnline ?? onOnline
    this.reconnects = 0
    this.resumeAt = 0
    this.retry = null
    this.unlisten = null
  }

  /** Begin watching for work. Returns a stop function. */
  start() {
    this.stopped = false
    // The poll as well as the heartbeat: a holder that dies goes quiet, and
    // quiet makes no change to hear, so only looking again notices it.
    this.heartbeat = setInterval(() => {
      this.beat()
      if (!this.running) this.tick()
    }, HEARTBEAT_MS)
    this.unlisten = this.onOnline(() => this.resume())
    this.tick()
    this.restoreWatches()
    return () => this.stop()
  }

  /** The network is back, or may be: try now rather than at the end of the backoff. */
  resume() {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.resumeAt = 0
    this.tick()
  }

  /** How a run ended decides whether to wait for the network before the next. */
  afterRun(outcome) {
    if (outcome !== OUTCOME.reconnecting) {
      this.reconnects = 0
      this.resumeAt = 0
      return
    }
    this.reconnects++
    const delay = reconnectDelay(this.reconnects)
    this.resumeAt = this.now() + delay
    if (this.retry) clearTimeout(this.retry)
    this.retry = this.stopped ? null : setTimeout(() => this.resume(), delay)
    this.onEvent({ type: "reconnecting", attempt: this.reconnects, delay })
  }

  /**
   * Listen again to every watch the session has (tools/watch.js), reporting
   * first what changed while no runner was. Only a runner that can wake the
   * session does this. Loaded late, as privileges are: the tool registry
   * imports modules that import this one.
   */
  restoreWatches() {
    const events = this.ctx.events
    if (!events || !this.store?.doc()?.watches) return
    import("./tools/watch.js")
      .then(({ restoreWatches }) => restoreWatches({ repo: this.fullCtx.repo, events, store: this.store }))
      .then((results) => {
        for (const r of results ?? []) if (!r.ok) this.onEvent({ type: "watch-error", id: r.id, error: r.error })
      })
      .catch(() => {})
  }

  stop() {
    this.stopped = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    if (this.later) clearTimeout(this.later)
    this.later = null
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.unlisten?.()
    this.unlisten = null
    this.interrupt()
  }

  /**
   * Take no more work, finish what is under way, then stop. How a runner made
   * by an older version of this code hands over to a newer one (runners.js):
   * stopping it outright would cut a turn off half-way. `onDone` is told when
   * it has stopped.
   */
  retire(onDone = null) {
    this.retired = true
    this.onRetired = onDone
    if (!this.running) this.finishRetiring()
  }

  finishRetiring() {
    if (this.stopped) return
    this.stop()
    try {
      this.onRetired?.()
    } catch {
      /* the hand-over goes ahead regardless */
    }
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
    // Sampled on every tick, work or none, so the watch sees each heartbeat.
    this.live(doc?.lease)
    if (this.retired || !needsWork(doc, this.canRun, this.live) || !this.hasKey()) {
      this.wantedSince = null
      return
    }
    // Waiting out a backoff for the network: its timer, or the network coming
    // back, ticks again. Every other tick meanwhile — the poll, a change —
    // would only be another request into no network.
    if (this.resumeAt > this.now()) return
    // Something in the session this version cannot read: a newer version of
    // the agent wrote it. Leave it to a runner that can, rather than send the
    // model the session without it.
    const unknown = unknownBlocks(doc)
    if (unknown.length) {
      this.wantedSince = null
      this.onEvent({ type: "outdated", unknown })
      return
    }

    if (!canClaim(doc, this.runnerUrl, { live: this.live })) {
      // Someone else is on it. The poll in start() looks again, and their
      // heartbeat going quiet brings us back.
      this.wantedSince = null
      return
    }

    // Already ours: carry on. Otherwise a runner busy elsewhere gives an idler
    // one the first chance — that is how a workflow's steps spread over the
    // browsers that have it open.
    const wasOurs = doc.lease?.runner === this.runnerUrl
    if (!wasOurs) {
      const defer = this.deferMs()
      if (defer > 0) {
        const t = this.now()
        this.wantedSince ??= t
        const left = this.wantedSince + defer - t
        if (left > 0) return this.tickLater(left)
      }
    }
    this.wantedSince = null

    // Mark ourselves busy BEFORE the first write. Claiming the lease *is* a
    // change to the session document, and the document's change handler calls
    // tick() — so a guard set after the write is set too late, and tick()
    // re-enters itself synchronously until the stack runs out.
    this.running = true
    this.controller = new AbortController()
    this.onEvent({ type: "start" })

    let generation = null
    try {
      this.store.change((d) => {
        generation = claimLease(d, this.runnerUrl, this.now()).generation
      })
      // Believe a fresh claim only once any rival's has had time to meet it
      // (CONFIRM_MS); the wait runs alongside building the run.
      const confirmed = wasOurs || !this.confirmMs ? null : new Promise((resolve) => setTimeout(resolve, this.confirmMs))

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

      await confirmed
      if (this.stopped || !holdsLease(this.store.doc(), this.runnerUrl, generation)) {
        // Another runner's claim won the merge. It runs the session; we wrote
        // nothing but the claim.
        const lost = { outcome: OUTCOME.aborted, reason: "another runner has this session" }
        this.onEvent({ type: "done", ...lost })
        return lost
      }

      // Ours for certain now. Anything the previous runner was in the middle
      // of will never finish: say so, so the model can check and carry on.
      // Not before: a claim that loses must not close a live runner's calls.
      if (orphanedCalls(this.store.doc(), { live: this.live }).length) {
        this.store.change((d) => {
          resolveOrphans(d, { live: this.live })
        })
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

      this.afterRun(result?.outcome)
      this.onEvent({ type: "done", ...result })
      return result
    } catch (err) {
      // A runner that lost the session to another says nothing in it.
      if (generation !== null && !holdsLease(this.store.doc(), this.runnerUrl, generation)) {
        this.onEvent({ type: "error", error: String(err?.message ?? err) })
        return { outcome: OUTCOME.aborted, reason: "lease lost" }
      }
      // The network went before the run could start — the provider's module,
      // the catalogue, a plan to check the scope against. Waited out like any
      // other interruption, not recorded as the session failing.
      const interruption = asInterruption(err, "Could not start the run")
      if (interruption) {
        try {
          this.store.change((d) => markReconnecting(d, interruption.message))
        } catch {
          /* the document is unwritable; the backoff below still applies */
        }
        this.afterRun(OUTCOME.reconnecting)
        return { outcome: OUTCOME.reconnecting, reason: interruption.message }
      }
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
      if (this.retired) this.finishRetiring()
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
    if (needsWork(doc, this.canRun, this.live)) return
    this.store.change((d) => {
      d.lease = null
    })
  }

  /** Tick once more in `ms`, however many times this is asked meanwhile. */
  tickLater(ms) {
    if (this.later || this.stopped) return
    this.later = setTimeout(() => {
      this.later = null
      this.tick()
    }, ms)
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
    // Every write through it is noted as this session's (own-changes.js), so
    // a watch can tell the session's own edits from everyone else's.
    repo: kernelRepo(base.repo, { known: () => knownUrls(store), record: (hashes) => rememberOwn(store?.url, hashes) }),
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
 *   watches    only the `watches` map in it, writable, for doc_watch
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
  const { watchesWriter } = await import("./tools/watch.js")
  const watches = { watches: watchesWriter(store) }
  const given = new Map([...WORKFLOW_TOOL_IDS.map((id) => [builtin(id), workflows]), [builtin("session_title"), session], [builtin("doc_watch"), watches]])
  return (tool) => given.get(tool) ?? null
}

/**
 * Is some *other* runner working on this session right now?
 *
 * `live` is a runner's own judgement (its LeaseWatch), which is right across
 * machines; without one, the lease's stamp is compared with this clock, which
 * is only right when the clocks agree, and is for display.
 */
export function heldElsewhere(doc, runnerUrl, live = null) {
  const lease = doc?.lease
  if (!lease || lease.runner === runnerUrl) return false
  return live ? live(lease) : leaseIsLive(lease, { staleAfterMs: STALE_AFTER_MS })
}
