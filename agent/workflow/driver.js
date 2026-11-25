/**
 * Running a workflow plan.
 *
 * The plan (plan.js) decides what may run; this makes it happen. Each step
 * becomes an agent session of its own — a full transcript you can open, steer
 * and approve in — started on the tier's model and run by an ordinary runner.
 * The driver watches those sessions, writes each one's result back into the
 * plan when it finishes, starts whatever that made ready, and tells the
 * orchestrating session what came in. A tick reads the plan and its step
 * sessions, decides what to do from those alone (decide.js), and does it.
 *
 * The driver holds a lease on the plan document, exactly as a runner holds one
 * on a session, so two tabs with the plan open cannot both start the same
 * step: liveness judged on its own clock, and a fresh claim believed only
 * after CONFIRM_MS, as a runner's is (kernel/runner.js). Nothing about the run lives
 * only in memory: close the tab and reopen the plan, and a new driver picks up
 * where the document says things are.
 *
 * Driving and running are separate. One browser drives — starts steps, files
 * their results — but every browser with the plan open starts runners for its
 * running steps, and each step's session lease decides which browser runs it.
 * So steps spread over the browsers that have a key, and none runs twice.
 */

import { claimLease, holdsLease, LeaseWatch } from "../session/lease.js"
import { initSession, CALL } from "../session/schema.js"
import { STOP, stopOf, statusOf } from "../session/status.js"
import { makeTurn, textBlock, noticeBlock, lastTurn } from "../session/blocks.js"
import { liftBudget } from "../session/usage.js"
import { unansweredCalls } from "../session/calls.js"
import { heldElsewhere, needsWork, HEARTBEAT_MS, STALE_AFTER_MS, CONFIRM_MS } from "../kernel/runner.js"
import { AutomergeRepo } from "../host/modules.js"
import { PLAN, PLAN_VERSION, STEP, stepPrompt, reopenPrompt, states, STATE, REQUEST_TOOL_ID, budgetOf, notStarted, startBudget, staleInputs, openRequests, reopenSteps, beginStep, finishStep, failStep, cancelStep, settlePlan, stopPlan, pausePlan, told, tell, finishedKey, endKey, pauseKey, budgetKey, staleKey, questionKey, requestKey } from "./plan.js"
import { decide } from "./decide.js"
import { scopeOf, webScope, sameScope, initLedger } from "../kernel/scope.js"
import { KERNEL_TYPES } from "../kernel/kernel-repo.js"
import { documentIdOf } from "../documents/doc-urls.js"
import { treeNode, treeEntries, treeLink } from "../documents/tree.js"
import { releaseNowPermitted } from "../kernel/loop.js"
import { handleStore } from "../kernel/store.js"
import { waitingIn } from "./waiting.js"
import { checkStepTools } from "./step-tools.js"

const { stringifyAutomergeUrl } = AutomergeRepo

/** How long a burst of changes is gathered before the tick it asks for. */
export const SETTLE_MS = 150

/**
 * Where a step's session stands, read off its document.
 *
 *   { state: "running" | "done" | "failed", result?, waiting? }
 *
 * Done means the agent has stopped with nothing left to do and said something
 * last; that last message is the result. "Stopped" is read off the document,
 * all of it, so no gap between writes can pass for it:
 *   - no call anywhere is unanswered: a status that dropped to idle while a
 *     call was still running (or waiting) used to read as done, and the step
 *     was filed while its session went on editing;
 *   - no reply is still streaming;
 *   - no live runner holds the session (`live`, the driver's own judgement of a
 *     lease; a runner drops its lease when it finishes, so a held one is work).
 *
 * An empty last message is not an empty result: the result is then the last
 * thing the session said in words. That costs nothing and cannot come back
 * empty a second time, which asking it to report again could.
 */
export function sessionOutcome(doc, { live = null } = {}) {
  if (!doc) return { state: "running" }
  const stop = stopOf(doc)
  if (stop?.kind === STOP.error) return { state: "failed" }
  // Out of budget is not done: it stopped part-way, and the orchestrator
  // decides whether it goes on.
  if (stop?.kind === STOP.budget) return { state: "running", outOfBudget: { spent: stop.data?.spent ?? null, limit: stop.data?.limit ?? null, at: stop.at } }
  if (waitingIn(doc).length) return { state: "running", waiting: true }
  if (doc.reconnecting || needsWork(doc)) return { state: "running" }
  if (unansweredCalls(doc).length || (doc.turns ?? []).some((t) => t.streaming)) return { state: "running" }
  if (doc.lease && live?.(doc.lease)) return { state: "running" }
  const last = lastTurn(doc)
  if (!last || last.role !== "assistant") return { state: "running" }
  const textOf = (turn) =>
    (turn.blocks ?? [])
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("\n")
      .trim()
  const text = textOf(last)
  if (text) return { state: "done", result: text }
  for (let i = doc.turns.length - 1; i >= 0; i--) {
    const turn = doc.turns[i]
    const earlier = turn.role === "assistant" ? textOf(turn) : ""
    if (earlier) return { state: "done", result: `(the step's last message was empty; the last thing it said was:)\n${earlier}` }
  }
  return { state: "done", result: EMPTY_RESULT }
}

/** A step that never said anything in words. */
export const EMPTY_RESULT = "(the step finished without saying anything)"

/** One driver per plan per page. */
const drivers = new Map()

/**
 * Start driving a plan, or return the driver already doing so here.
 *
 *   repo           the page's repo
 *   startSession   (handle) => { runner, ctx } — runs a step's session (default: a tab runner)
 *   notify         (planUrl) => channel with notify(render)/close(), to wake the orchestrator
 */
export async function ensureDriver(planUrl, opts) {
  const existing = drivers.get(planUrl)
  if (existing) {
    existing.kick()
    return existing
  }
  const handle = await opts.repo.find(planUrl)
  const driver = new WorkflowDriver({ ...opts, handle })
  drivers.set(planUrl, driver)
  driver.start()
  return driver
}

export function getDriver(planUrl) {
  return drivers.get(planUrl) ?? null
}

/** Tests only. */
export function _resetDrivers() {
  for (const driver of drivers.values()) driver.stop()
  drivers.clear()
}

export class WorkflowDriver {
  constructor({ repo, handle, startSession, notify = null, tools = null, now = () => Date.now(), heartbeatMs = HEARTBEAT_MS, settleMs = SETTLE_MS, confirmMs = CONFIRM_MS }) {
    this.repo = repo
    this.handle = handle
    this.startSession = startSession
    this.notify = notify
    // Every tool the runner that started this has, as `{ builtins, plugins }`,
    // for checking a step's prompt before it starts (step-tools.js). Without
    // it that is not done.
    this.tools = tools
    this.now = now
    this.heartbeatMs = heartbeatMs
    this.settleMs = settleMs
    this.soon = null
    this.runnerUrl = `workflow-${Math.random().toString(36).slice(2, 10)}`
    this.generation = null
    // Whose the plan is, judged on this page's clock alone (session/lease.js).
    this.watch = new LeaseWatch({ now: () => this.now(), staleAfterMs: STALE_AFTER_MS })
    this.live = (lease) => this.watch.live(lease)
    this.confirmMs = confirmMs
    this.claimedAt = null
    this.confirming = null
    this.watched = new Map() // sessionUrl -> unsubscribe
    this.reasons = new Map() // sessionUrl -> why its runner stopped, from its events
    this.listening = new Set() // sessionUrls whose runner events we hear
    this.waiting = [] // what running steps wait on a person for, as of the last tick
    this.outOfBudget = [] // which running steps are stopped for their own budgets, likewise
    this.channel = null
    this.ticking = null
    this.busy = false
    this.again = false
    this.stopped = false
    this.onPlanChange = () => this.kickSoon()
  }

  start() {
    this.handle.on("change", this.onPlanChange)
    this.timer = setInterval(() => {
      this.beat()
      this.kick()
    }, this.heartbeatMs)
    this.kick()
  }

  stop() {
    this.stopped = true
    clearInterval(this.timer)
    clearTimeout(this.soon)
    clearTimeout(this.confirming)
    this.handle.off("change", this.onPlanChange)
    for (const off of this.watched.values()) off()
    this.watched.clear()
    drivers.delete(this.handle.url)
  }

  /**
   * Tick shortly, once, however many changes ask for it meanwhile.
   *
   * Changes arrive in bursts — a step streaming its answer changes its session
   * many times a second, and the driver's own writes change the plan — and a
   * tick for each is wasted work at best.
   */
  kickSoon() {
    if (this.stopped || this.soon) return
    this.soon = setTimeout(() => {
      this.soon = null
      this.kick()
    }, this.settleMs)
  }

  /** Run a tick, or ask the one in progress to go round once more. */
  kick() {
    if (this.stopped) return this.ticking
    // Set before anything runs. A tick writes to the plan synchronously, the
    // write fires the plan's change event, and that calls kick() again — before
    // an assignment of the promise below would have happened. Guarding on the
    // promise let five ticks run at once, and each started the same step.
    if (this.busy) {
      this.again = true
      return this.ticking
    }
    this.busy = true
    this.ticking = (async () => {
      try {
        do {
          this.again = false
          await this.tick()
        } while (this.again && !this.stopped)
      } finally {
        this.busy = false
        this.ticking = null
      }
    })()
    return this.ticking
  }

  /**
   * Is this driver the one entitled to act on the plan right now? Claims the
   * lease if it is free, and otherwise writes nothing.
   *
   * It used to renew the lease here, on every tick — and every write to the
   * plan schedules a tick, so a driver with nothing to do rewrote the plan as
   * fast as the clock moved and locked up the tab. Renewal is beat()'s job,
   * on the heartbeat timer, as it is for a session's runner.
   */
  hold() {
    const plan = this.handle.doc()
    if (!plan) return false
    if (heldElsewhere(plan, this.runnerUrl, this.live)) return false
    if (this.generation === null || !holdsLease(plan, this.runnerUrl, this.generation)) {
      this.handle.change((d) => { this.generation = claimLease(d, this.runnerUrl, this.now()).generation })
      this.claimedAt = this.now()
    }
    // A claim another page made at the same moment may yet win the merge;
    // act on ours only once it has had time to arrive (CONFIRM_MS).
    const left = this.claimedAt + this.confirmMs - this.now()
    if (left <= 0) return true
    if (!this.confirming) {
      this.confirming = setTimeout(() => {
        this.confirming = null
        this.kick()
      }, left)
    }
    return false
  }

  /** Renew the lease. Called by the heartbeat timer, never by a tick. */
  beat() {
    if (this.stopped || this.generation === null) return
    if (!holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return
    this.handle.change((d) => { d.lease.at = this.now() })
  }

  /** Read what is there, decide what to do (decide.js), and do it. */
  async tick() {
    if (this.stopped || !current(this.handle.doc())) return
    if (!this.hold()) return this.help()
    const plan = this.handle.doc()
    const observations = plan.status === PLAN.running ? await this.observe(plan) : {}
    await this.perform(decide(plan, observations, this.now()))
  }

  /**
   * What decide() needs to know beyond the plan, read off the documents as
   * plain values: each step session's state, and what the orchestrator has
   * spent (read, not watched: its every streamed token would wake a tick).
   */
  async observe(plan) {
    const sessions = {}
    for (const step of plan.steps) {
      if (!step.sessionUrl) continue
      const doc = (await this.session(step.sessionUrl))?.doc()
      const seen = { status: doc ? statusOf(doc) : null, usage: doc?.usage ?? null, requests: requestCalls(doc).map((call) => ({ id: call.id, input: call.input ?? {} })) }
      if (step.status === STEP.running) {
        seen.outcome = sessionOutcome(doc, { live: this.live })
        if (seen.outcome.waiting) seen.waiting = waitingIn(doc)
        if (step.access === "web" && doc) seen.scopeOk = confinedAs(doc, webScope(this.handle.url, step.id))
      }
      sessions[step.sessionUrl] = seen
    }
    const orchestrator = plan.sessionUrl ? await this.repo.find(plan.sessionUrl).then((h) => h.doc(), () => null) : null
    return { sessions, orchestratorCost: orchestrator?.usage?.cost, reasons: Object.fromEntries(this.reasons) }
  }

  /** Do what decide() said, in order. Writes to the plan go through write(), which holds to the lease. */
  async perform(actions) {
    for (const action of actions) {
      if (this.stopped) return
      switch (action.type) {
        case "cancel":
          await this.stopSteps(action.stepIds, action.reason)
          break
        case "finish":
          this.write((d) => finishStep(d, action.stepId, { result: action.result, now: action.at }))
          break
        case "fail":
          this.write((d) => failStep(d, action.stepId, { error: action.error, now: action.at }))
          break
        case "requests":
          this.write((d) => {
            if (!d.requests) d.requests = []
            const have = new Set(d.requests.map((r) => r.id))
            for (const r of action.requests) if (!have.has(r.id)) d.requests.push(r)
          })
          break
        case "waiting":
          this.waiting = action.waiting
          this.outOfBudget = action.outOfBudget
          break
        case "orchestratorFrom":
          this.write((d) => { d.orchestratorFrom = action.cost })
          break
        case "usage":
          this.write((d) => { d.usage = action.usage })
          break
        case "shareGrants":
          await this.shareGrants()
          break
        case "fileSources":
          await this.fileSources()
          break
        case "run":
          await this.run(action.sessionUrl)
          break
        case "ledger":
          await this.openLedger()
          break
        case "start":
        case "continue": {
          if (!holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return
          const step = this.handle.doc().steps.find((s) => s.id === action.stepId)
          if (step?.status !== STEP.pending) break
          if (step.sessionUrl) await this.continueStep(step)
          else await this.begin(step.id)
          break
        }
        case "pause":
          this.write((d) => pausePlan(d, { stopped: action.stopped, now: action.at }))
          break
        case "settle":
          this.write((d) => settlePlan(d, action.at))
          break
        case "report":
          this.report(await this.ledger())
          break
      }
    }
  }

  /**
   * What a page that is not driving the plan does: keep a runner here for
   * each running step, so this browser can take any step nobody is running.
   * Writes nothing to the plan; the step's own lease decides who runs it.
   */
  async help() {
    const plan = this.handle.doc()
    if (this.stopped || !current(plan) || plan.status !== PLAN.running) return
    for (const step of plan.steps ?? []) {
      if (step.status === STEP.running && step.sessionUrl) await this.run(step.sessionUrl)
    }
  }

  /**
   * A permission given anywhere in the workflow holds everywhere in it.
   *
   * A workflow is one job: granting "any site" to one step and leaving its
   * siblings blocked on the same question was the opposite of what the person
   * meant. Grants are merged from the orchestrator and every full-access step,
   * written to each of them that lacks one, and each one's waiting calls that
   * are now allowed are released.
   *
   * Research steps take no part, either way. Their standing "any site" is safe
   * only because they can read nothing of the person's, and must not spread
   * to sessions that can; and they need nothing from the others, since they
   * fetch without asking and can do nothing else.
   *
   * Grants only accumulate and a session is written only when it lacks one, so
   * this settles: run twice, the second time writes nothing.
   */
  async shareGrants() {
    const plan = this.handle.doc()
    const members = [plan.sessionUrl, ...plan.steps.filter((s) => s.access !== "web").map((s) => s.sessionUrl)].filter(Boolean)
    const sessions = []
    for (const url of members) {
      const handle = await this.session(url)
      if (handle?.doc()) sessions.push(handle)
    }

    const merged = {}
    for (const handle of sessions) {
      for (const [key, held] of Object.entries(handle.doc().grants ?? {})) {
        if (held) merged[key] = true
      }
    }

    for (const handle of sessions) {
      const doc = handle.doc()
      const missing = Object.keys(merged).filter((key) => !doc.grants?.[key])
      if (missing.length) {
        handle.change((d) => {
          if (!d.grants) d.grants = {}
          for (const key of missing) d.grants[key] = true
        })
      }
      if (missing.length || this.unreleased(handle)) releaseNowPermitted({ store: handleStore(handle, null) })
    }
  }

  /**
   * Open the plan's ledger, the document its research steps keep into and
   * read from (kernel/scope.js), and name it in the plan. Under the lease,
   * and only while the plan names none, so a plan has one ledger whichever
   * page drives it.
   */
  async openLedger() {
    if (this.handle.doc().ledgerUrl || !holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return
    const ledger = await this.repo.create2()
    ledger.change(initLedger)
    this.write((d) => {
      if (!d.ledgerUrl) d.ledgerUrl = ledger.url
    })
  }

  /**
   * The plan's ledger, watched like a step's session: what a research step
   * keeps wakes the driver, to file it. Null while the plan has none.
   */
  async ledger() {
    const url = this.handle.doc()?.ledgerUrl
    return url ? this.session(url) : null
  }

  /**
   * File what the research steps kept into the plan's Sources folder.
   *
   * The folder is for people. The ledger is what research steps may read; the
   * folder grants them nothing, so linking a document into it by hand changes
   * nothing about what they can reach. The ledger is read, never written, and
   * the plan is written only to mark what was filed. A kept source is
   * linked at the version that was fetched, a finding live, since a person may
   * go on editing it. An entry is filed once it says what it is, and marked
   * in `sourcesFiled`; one already in the folder is only marked, so a driver
   * that lost the plan between the two writes leaves nothing to duplicate.
   * Run twice, the second time writes nothing.
   */
  async fileSources() {
    const plan = this.handle.doc()
    if (!plan.sourcesFolderUrl) return
    const filed = plan.sourcesFiled ?? {}
    const due = Object.entries((await this.ledger())?.doc()?.sources ?? {}).filter(([id, e]) => !filed[id] && e?.what != null)
    if (!due.length || !holdsLease(plan, this.runnerUrl, this.generation)) return

    let folder
    try {
      folder = await this.repo.find(plan.sourcesFolderUrl)
    } catch {
      return
    }
    const node = treeNode(folder)
    const present = new Set(treeEntries(node).map((entry) => documentIdOf(entry?.url)))
    // A search's results page is kept, as the record of how a step found what
    // it read, but it is not a source: the folder is for what a person
    // reviewing the work checks claims against.
    const fresh = due
      .filter(([id, e]) => !present.has(id) && e.engine !== "search")
      .map(([id, e]) => ({
        name: e.name ?? (e.kind === "finding" ? "finding" : "source"),
        // Filed as what it is, so the folder opens a web-snapshot in its own
        // view, and a file in the File tool — but never as a session or a
        // plan, which only the agent runtime makes.
        type: KERNEL_TYPES.includes(e.type) ? "file" : e.type ?? "file",
        url: e.kind === "finding" ? stringifyAutomergeUrl({ documentId: id }) : stringifyAutomergeUrl({ documentId: id, heads: [...e.heads] }),
      }))
    for (const entry of fresh) treeLink(node, entry)
    this.write((d) => {
      if (!d.sourcesFiled) d.sourcesFiled = {}
      for (const [id] of due) d.sourcesFiled[id] = true
    })
  }

  /** Does this session have calls waiting on a permission? (Release is cheap; this keeps idle ticks write-free.) */
  unreleased(handle) {
    return (handle.doc()?.turns ?? []).some((t) => (t.blocks ?? []).some((b) => b.type === "call" && b.status === "pending"))
  }

  /** Write to the plan, if this driver still holds it. */
  write(fn) {
    if (!holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return false
    this.handle.change(fn)
    return true
  }

  /** A document the driver reads — a step's session, the plan's ledger — watched so a change to it wakes the driver. */
  async session(url) {
    try {
      const handle = await this.repo.find(url)
      if (!this.watched.has(url)) {
        const onChange = () => this.kickSoon()
        handle.on("change", onChange)
        this.watched.set(url, () => handle.off("change", onChange))
      }
      return handle
    } catch {
      return null
    }
  }

  /** Make sure a step's session has a runner here. */
  async run(sessionUrl) {
    const handle = await this.session(sessionUrl)
    if (!handle) return
    try {
      const entry = await this.startSession(handle)
      // Every heartbeat comes through here; listen once, not once per beat.
      if (entry?.listen && !this.listening.has(sessionUrl)) {
        this.listening.add(sessionUrl)
        entry.listen((event) => {
          if (event?.type === "error" || (event?.type === "finish" && event.outcome === "error")) {
            this.reasons.set(sessionUrl, String(event.error ?? event.reason ?? "error"))
          }
        })
      }
    } catch (err) {
      this.reasons.set(sessionUrl, `Could not start the step's session: ${err?.message ?? err}`)
    }
  }

  /** Start one step: its session, its first message, its runner. */
  async begin(stepId) {
    const plan = this.handle.doc()
    const step = plan.steps.find((s) => s.id === stepId)
    if (!step || step.status !== STEP.pending || step.sessionUrl) return

    // A step whose prompt names a tool it would not get is moved to the page
    // or failed now, said once, rather than left to find out by searching.
    if (await this.misplaced(step)) return

    const web = step.access === "web"
    // A research step keeps into its plan's ledger, which decide() has the
    // driver open first; without one its session would refuse to run.
    if (web && !plan.ledgerUrl) return
    const orchestrator = plan.sessionUrl ? (await this.session(plan.sessionUrl))?.doc() : null
    const child = await this.repo.create2()
    child.change((d) => {
      initSession(d, {
        title: `${plan.title} · ${step.title}`,
        // The step's own document, which tools that take a url default to;
        // else the workflow's. A research step is about no document of the
        // person's.
        subject: web ? null : step.subject ?? plan.subject ?? null,
        config: {
          providerId: orchestrator?.config?.providerId ?? "openrouter",
          model: plan.tiers?.[step.tier],
          params: { maxTokens: orchestrator?.config?.params?.maxTokens ?? 16000 },
          // Workflows do not nest: a step never orchestrates.
          workflows: { enabled: false },
          // What it may spend before it stops and waits on the orchestrator.
          // From here on the session's is the step's budget (plan.js stepBudget).
          budget: startBudget(step),
        },
      })
      d.workflow = { planUrl: this.handle.url, stepId: step.id, orchestratorUrl: plan.sessionUrl ?? null }
      if (web) {
        // In the same change as the session itself, so it never exists
        // unconfined. The scope decides its tools and everything it can reach
        // (kernel/scope.js); it has no list of tools to edit. It may fetch any site:
        // it can reach none of the person's documents, so there is nothing of
        // theirs to leak, and it gets nothing the orchestrator was granted.
        d.scope = webScope(this.handle.url, step.id)
        d.grants = { [WEB_GRANT]: true }
      } else {
        // A worker step gets every tool that runs without the page, built-in
        // or plugin, decided by whichever runner builds its toolset — so it
        // can run anywhere a repo is (kernel/placement.js). Neither kind can start a
        // workflow of its own: a step is not offered the tools for it
        // (session/capabilities.js).
        if (step.where === "worker") d.tools = { where: "worker" }
        // What the person already allowed the orchestrator carries into its
        // steps; asking again for each one would put the same question in front
        // of them once per step.
        d.grants = { ...(orchestrator?.grants ?? {}) }
      }
      d.turns.push(makeTurn("user", [textBlock(stepPrompt(plan, step))]))
    })

    this.write((d) => beginStep(d, step.id, { session: { url: child.url, model: plan.tiers?.[step.tier] ?? null }, now: this.now() }))
    // Started only if the plan now names this session for the step — not
    // merely because the write was allowed.
    if (this.handle.doc().steps.find((x) => x.id === step.id)?.sessionUrl === child.url) await this.run(child.url)
  }

  /**
   * Check a step's prompt against the tools it would get (step-tools.js), and
   * act on the answer: a worker step that needs the page is moved there, to
   * start when the page is free; one that cannot work as written fails with
   * the reason, which the orchestrator is told like any failure. True when
   * the step is not to start now.
   */
  async misplaced(step) {
    let verdict = null
    try {
      if (!this.tools) return false
      verdict = checkStepTools(step, await this.tools())
    } catch {
      return false // no catalogue is no check, not no step
    }
    if (!verdict) return false
    this.write((d) => {
      const s = d.steps.find((x) => x.id === step.id)
      if (s.status !== STEP.pending) return
      if (verdict.where) {
        s.where = verdict.where
        s.moved = verdict.why
      } else {
        failStep(d, step.id, { error: verdict.fail, now: this.now() })
      }
    })
    if (verdict.where) this.kick()
    return true
  }

  /**
   * Carry on a reopened step in its own session: it is told why, and handed
   * what it depends on as that now stands (plan.js reopenPrompt). Whatever
   * stopped it is undone — failed, cancelled, out of its budget — since it has
   * new work: as much again as it started with, on top of what it has spent.
   */
  async continueStep(step) {
    const plan = this.handle.doc()
    const handle = await this.session(step.sessionUrl)
    if (!handle?.doc()) return
    const message = reopenPrompt(plan, step)
    handle.change((d) => {
      d.reconnecting = null
      if ((d.usage?.cost ?? 0) >= (d.config?.budget ?? Infinity) || stopOf(d)?.kind === STOP.budget) liftBudget(d, startBudget(step))
      // Its new instructions, which also end whatever stop it was under
      // (session/status.js stopOf).
      d.turns.push(makeTurn("user", [textBlock(message)]))
    })
    this.reasons.delete(step.sessionUrl)
    this.write((d) => beginStep(d, step.id, { now: this.now() }))
    if (this.handle.doc().steps.find((x) => x.id === step.id)?.status === STEP.running) await this.run(step.sessionUrl)
  }

  /**
   * Stop these sessions from outside, and keep them stopped: their lease is
   * taken away, so a runner on one stands down at its next look, and a notice
   * says they are halted, so none takes one up again — not even one whose
   * last call landed after the stop (kernel/runner.js needsWork). Spoken to,
   * or continued by a reopen, they carry on.
   */
  async haltSessions(urls, reason) {
    for (const url of urls) {
      try {
        const session = await this.repo.find(url)
        session.change((d) => {
          if (d.lease) d.lease = null
          if (d.reconnecting != null) d.reconnecting = null
          if (stopOf(d)?.kind !== STOP.halted) d.turns.push(makeTurn("assistant", [noticeBlock(STOP.halted, String(reason ?? "Stopped by its workflow."))]))
        })
        ;(await this.startSession(session))?.runner?.interrupt?.()
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * Reopen closed steps (plan.js reopenSteps), stopping any running step a
   * cascade reaches, then tick so the ready ones continue. Throws, changing
   * nothing, if a named step cannot be reopened.
   */
  async reopen(ids, opts = {}) {
    let result
    this.handle.change((d) => {
      result = reopenSteps(d, ids, { now: this.now(), ...opts })
    })
    if (result.interrupt.length) await this.haltSessions(result.interrupt, "reopened: something it is built on changed")
    await this.kick()
    return result
  }

  /** Cancel steps (all unfinished ones when none are named), interrupting their sessions. */
  async cancel(stepIds = null) {
    await this.stopSteps(stepIds)
    await this.kick()
  }

  /**
   * Cancel steps without ticking: what cancel does, and what a tick does
   * itself when it finds a step that must stop. `reason`, when given, is kept
   * on each step for the views to show.
   */
  async stopSteps(stepIds = null, reason = null) {
    const plan = this.handle.doc()
    const targets = plan.steps.filter(
      (s) => (stepIds ? stepIds.includes(s.id) : true) && (s.status === STEP.pending || s.status === STEP.running)
    )
    // Through the document, not only the runner in this tab: the one doing
    // the work may be in another tab, or gone with a reload — then an
    // interrupt here reached nothing and the session said "running" for good.
    await this.haltSessions(
      targets.filter((s) => s.status === STEP.running && s.sessionUrl).map((s) => s.sessionUrl),
      reason ?? "cancelled by its workflow"
    )
    this.handle.change((d) => {
      for (const t of targets) cancelStep(d, t.id, { reason, now: this.now() })
      if (!stepIds) stopPlan(d, this.now())
    })
  }

  /**
   * Tell the orchestrator what it has not heard: steps that finished, and
   * questions steps are asking. A step waiting for a permission does not wake
   * it — only the person can grant one, and they see it in the views — but
   * the news it does get says so. `ledger` is the plan's ledger handle, for
   * what research steps kept.
   */
  report(ledger = null) {
    if (!this.notify) return
    // What has been told is recorded in the plan, not in this driver: a reload,
    // or another tab's driver taking over, tells nothing twice.
    const plan = this.handle.doc()
    if (!hasNews(untold(plan, this.waiting, this.outOfBudget))) return
    this.channel ??= this.notify(this.handle.url, plan.title)
    this.channel?.notify(() => {
      // Read at delivery: a question answered meanwhile is no longer news.
      const now = this.handle.doc()
      const news = untold(now, this.waiting, this.outOfBudget)
      if (!hasNews(news)) return ""
      const recorded = this.write((d) => {
        for (const key of news.keys) tell(d, key)
      })
      // A driver that has lost the plan leaves the telling to the one holding it.
      if (!recorded) return ""
      if (news.end) setTimeout(() => { this.channel?.close(); this.channel = null }, 0)
      return describeProgress(now, news.finished, this.waiting, news.budgets, { stale: news.stale, requests: news.requests, ledger: ledger?.doc() ?? null })
    })
  }
}

/**
 * Is a research step's session confined exactly as its plan says? A scope is
 * written when the step starts and nothing in the agent may change it
 * (kernel/kernel-repo.js), so one that is gone, malformed or different was
 * changed by hand, and the step stops rather than run on with more than
 * research should have.
 */
function confinedAs(doc, scope) {
  try {
    return sameScope(scopeOf(doc), scope)
  } catch {
    return false
  }
}

/** A plan this driver reads: of this version. */
const current = (plan) => !!plan && (plan.schemaVersion ?? 1) === PLAN_VERSION

/**
 * What the orchestrator has not been told, as of `plan`, `waiting` (what
 * running steps wait on a person for) and `outOfBudget` (the steps stopped for
 * their own budgets): each kind of news, and the keys that record all of it
 * told (plan.js tell). A step waiting for a permission does not wake it —
 * only the person can grant one, and they see it in the views — but the news
 * it does get says so.
 */
export function untold(plan, waiting = [], outOfBudget = []) {
  const finished = (plan.steps ?? []).filter((s) => [STEP.done, STEP.failed].includes(s.status) && !told(plan, finishedKey(s)))
  const questions = waiting.filter((w) => w.kind === "question" && !told(plan, questionKey(w.callId)))
  const end = plan.status !== PLAN.running && !told(plan, endKey(plan))
  const paused = !!plan.paused && !told(plan, pauseKey(plan))
  const budgets = (outOfBudget ?? []).filter((b) => !told(plan, budgetKey(plan, b.stepId, b.at)))
  const stale = staleSteps(plan).filter((s) => !told(plan, staleKey(plan, s)))
  const requests = openRequests(plan).filter((r) => !told(plan, requestKey(r)))
  const keys = [
    ...finished.map(finishedKey),
    ...questions.map((q) => questionKey(q.callId)),
    ...(end ? [endKey(plan)] : []),
    ...(paused ? [pauseKey(plan)] : []),
    ...budgets.map((b) => budgetKey(plan, b.stepId, b.at)),
    ...stale.map((s) => staleKey(plan, s)),
    ...requests.map(requestKey),
  ]
  return { finished, questions, end, paused, budgets, stale, requests, keys }
}

const hasNews = (news) => news.keys.length > 0

/** The workflow_request calls in a step's session that went through: each is a request. */
export function requestCalls(doc) {
  const calls = []
  for (const turn of doc?.turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "call" && block.tool === REQUEST_TOOL_ID && block.status === CALL.done) calls.push(block)
    }
  }
  return calls
}

/** Done steps whose inputs have changed since they were built on them. */
export function staleSteps(plan) {
  const derived = states(plan)
  return (plan.steps ?? []).filter((s) => derived.get(s.id) === STATE.stale)
}

/** The news the orchestrator wakes to. `ledger` is the plan's ledger document, when it has one. */
export function describeProgress(plan, news, waiting = [], outOfBudget = [], { stale = [], requests = [], ledger = null } = {}) {
  const derived = states(plan)
  const count = (state) => [...derived.values()].filter((s) => s === state).length
  const lines = [`Workflow "${plan.title}" (${plan.paused ? "paused" : plan.status === PLAN.running ? "running" : plan.status}).`]
  if (plan.paused?.reason === "budget") {
    const waitingSteps = notStarted(plan)
    lines.push(
      "",
      "## Paused: the budget is spent",
      `The workflow has spent $${plan.paused.spent.toFixed(2)} of its $${plan.paused.limit.toFixed(2)} cap (steps and your own turns together), so ${waitingSteps.length} step${waitingSteps.length === 1 ? "" : "s"} will not start: ${waitingSteps.map((s) => `${s.title} (${s.id})`).join(", ") || "none"}${plan.paused.stopped?.length ? `; stopped part-way for their own budgets: ${plan.paused.stopped.join(", ")}` : ""}.`,
      "Only the person can raise the cap: the workflow view and your session both offer them Resume. Tell them briefly where things stand — what is done, what is waiting — and do not start the waiting work yourself. When they resume, you are told about any step stopped part-way and decide it then."
    )
  }
  for (const step of news) {
    lines.push(
      "",
      `## ${step.status === STEP.done ? "Done" : "Failed"}: ${step.title} (${step.id})`,
      step.status === STEP.done ? step.result ?? "" : step.error ?? "",
      `Session: ${step.sessionUrl}`
    )
    if (step.access === "web") lines.push(`It ${keptLine(plan, ledger, step.id)}`)
  }
  const title = (id) => plan.steps.find((s) => s.id === id)?.title ?? id
  const money = budgetOf(plan)
  for (const b of outOfBudget) {
    lines.push(
      "",
      `## Out of budget: ${title(b.stepId)} (${b.stepId})`,
      `It has spent $${Number(b.spent).toFixed(2)} of its $${Number(b.limit).toFixed(2)} and stopped part-way; what it kept and wrote so far is still there. The person has not been asked: you set this budget, so the decision is yours. Look at its session: did it make progress, and what is left?`,
      money.remaining > 0
        ? `The workflow has $${money.remaining.toFixed(2)} left under its $${money.limit.toFixed(2)} cap ($${money.spent.toFixed(2)} spent, your own turns included). Extend it out of that with workflow_budget { step, add, why } — you need no one's leave while it fits — or stop it (workflow_stop; what depends on it will not run), or do the rest differently (workflow_add_steps). Always give a reason.`
        : `The workflow's cap is reached ($${money.spent.toFixed(2)} of $${money.limit.toFixed(2)}, your own turns included), so the person is being asked to raise it; you are told once they do. Until then do not start work, and tell them briefly what is blocked.`
    )
  }
  for (const q of waiting.filter((w) => w.kind === "question")) {
    lines.push(
      "",
      `## Question from step ${title(q.stepId)} (${q.stepId})`,
      q.question,
      ...(q.options.length ? [`Options: ${q.options.map((o) => o.label).join(" / ")}`] : []),
      "Answer it with workflow_answer if you know the answer from the work so far. If it is the person's call, ask them (ask_user) and pass their answer on."
    )
  }
  for (const r of requests) {
    const asks = [
      r.add?.length ? `add ${r.add.map((st) => `${st.title} (${st.id}${st.after?.length ? `, after ${st.after.join(", ")}` : ""})`).join("; ")}` : null,
      r.reopen?.length ? `reopen ${r.reopen.map((id) => `${title(id)} (${id})`).join(", ")}` : null,
    ].filter(Boolean)
    lines.push(
      "",
      `## Request from step ${title(r.stepId)} (${r.stepId}): ${asks.join(", and ")}`,
      r.why,
      `Decide with workflow_decide { request: "${r.id}", accept: true | false }. Accepting adds and reopens exactly what it asks${r.reopen?.length ? "; say whether to `cascade` the reopening to what is built on it" : ""}. The workflow does not finish while a request is open.`
    )
  }
  for (const st of stale) {
    const changed = staleInputs(plan, st)
    lines.push(
      "",
      `## Out of date: ${st.title} (${st.id})`,
      `It was built on ${changed.map((id) => `${title(id)} (${id})`).join(", ")}, which ${changed.length === 1 ? "has" : "have"} been reopened or changed since. Steps waiting on it are held. Reopen it (workflow_reopen) to revise its result, or keep it (workflow_keep) if it still stands.`
    )
  }
  const approvals = waiting.filter((w) => w.kind === "approval")
  if (approvals.length) {
    lines.push(
      "",
      `Waiting on the person's permission: ${approvals.map((a) => `${title(a.stepId)} wants to run ${a.tool}`).join("; ")}. Only they can grant it; they see it in your view and the workflow's.`
    )
  }
  if (Object.keys(ledger?.sources ?? {}).length) lines.push("", `The research steps have ${keptLine(plan, ledger)}`)
  lines.push(
    "",
    `Steps: ${count(STATE.done)} done, ${count(STATE.running) + count(STATE.needsInput)} running, ${count(STATE.ready) + count(STATE.waiting)} to come, ${count(STATE.failed)} failed, ${count(STATE.blocked)} blocked, ${count(STATE.cancelled)} cancelled${count(STATE.stale) ? `, ${count(STATE.stale)} out of date` : ""}.`
  )
  if (plan.status === PLAN.running) {
    lines.push(
      "If these results call for more work, add steps (workflow_add_steps) or change what waiting steps depend on (workflow_edit_steps). If something shows an earlier result was wrong, reopen that step (workflow_reopen) — a failed or cancelled one too. Otherwise wait — you will hear when more finish."
    )
  } else {
    lines.push(
      "The workflow is over. Bring the results together for the person — or, if a result shows more is needed, reopen a step or add steps, and it runs again."
    )
  }
  return lines.join("\n")
}

/** What the research steps have kept, as a plan's ledger document says: every one of them, or one. */
export function keptCounts(ledger, stepId = null) {
  const counts = { sources: 0, findings: 0 }
  for (const entry of Object.values(ledger?.sources ?? {})) {
    if (entry?.what == null || (stepId && entry.by !== stepId)) continue
    if (entry.kind === "finding") counts.findings++
    else counts.sources++
  }
  return counts
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "kept 3 sources and 1 finding — Sources: automerge:…", for the news. */
function keptLine(plan, ledger, stepId = null) {
  const { sources, findings } = keptCounts(ledger, stepId)
  const where = plan.sourcesFolderUrl ? ` — Sources: ${plan.sourcesFolderUrl}` : ""
  return `kept ${plural(sources, "source", "sources")} and ${plural(findings, "finding", "findings")}${where}`
}

/** The grant that lets a web-only step fetch anything. */
export const WEB_GRANT = "web@*"
