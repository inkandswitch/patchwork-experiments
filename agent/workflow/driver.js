/**
 * Running a workflow plan.
 *
 * The plan (plan.js) decides what may run; this makes it happen. Each step
 * becomes an agent session of its own — a full transcript you can open, steer
 * and approve in — started on the tier's model, its work asked for under its
 * key as any session's is (`startSession`: runners/page.js).
 * The driver watches those sessions, writes each one's result back into the
 * plan when it finishes, starts whatever that made ready, and tells the
 * orchestrating session what came in. A tick reads the plan and its step
 * sessions, decides what to do from those alone (decide.js), and does it.
 *
 * Every page with the plan open drives it, and none holds it: there is no
 * lease, no heartbeat and no timer that writes. A tick runs when the plan
 * changes or a watched document does (a step's session, the ledger), and
 * writes only what that change calls for, so a tick with nothing new writes
 * nothing. Each write either recomputes a value whole or sets it only while
 * it is unset (`perform`), so two pages that tick on the same change write
 * the same thing, and a page whose copy lags writes nothing the others undo.
 * What two pages in one crossing can still do twice is listed at `perform`.
 * Nothing about the run lives only in memory: close the tab and reopen the
 * plan, and its driver picks up where the document says things are. A
 * workflow goes on only while some page has the plan open or drives it.
 *
 * A step's burst runs in a pool's worker (kernel/burst.js); its session's
 * `burst` mark keeps two from running it at once, and a burst of a session
 * its plan does not name ends before it writes (`not-the-step`).
 */

import { initSession, CALL } from "../session/schema.js"
import { STOP, stopOf, statusOf } from "../session/status.js"
import { makeTurn, textBlock, lastTurn } from "../session/blocks.js"
import { stopSession, speak } from "../session/recovery.js"
import { liftBudget, dollars } from "../session/usage.js"
import { unansweredCalls } from "../session/calls.js"
import { needsWork } from "../kernel/runner.js"
import { workKey } from "../kernel/burst.js"
import { stopWork as stopTaskWork } from "../host/task-client.js"
import { AutomergeRepo } from "../host/modules.js"
import { PLAN, isCurrent, writable, changePlan, PlanVersionError, STEP, stepPrompt, reopenPrompt, states, STATE, REQUEST_TOOL_ID, budgetOf, notStarted, startBudget, staleInputs, openRequests, reopenSteps, beginStep, finishStep, failStep, cancelStep, settlePlan, stopPlan, pausePlan, told, tell, finishedKey, endKey, pauseKey, budgetKey, stoppedKey, staleKey, questionKey, requestKey, attempt } from "./plan.js"
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

/** How a step's work ended, when that is not news enough to keep: the model finished, or it waits on a person or a page. */
const QUIET = new Set(["idle", "awaiting-approval", "awaiting-answer", "parked", "nothing"])

/**
 * Where a step's session stands, read off its document.
 *
 *   { state: "running" | "done" | "failed", result?, waiting? }
 *
 * Done means the agent has stopped with nothing left to do and said something
 * last; that last message is the result. A stop in force is never done: an
 * error fails the step, and a budget's, a person's or the workflow's leaves it
 * running and waiting. "Stopped" is read off the document,
 * all of it, so no gap between writes can pass for it:
 *   - no call anywhere is unanswered: a status that dropped to idle while a
 *     call was still running (or waiting) used to read as done, and the step
 *     was filed while its session went on editing;
 *   - no reply is still streaming;
 *   - no burst is marked on it (`burst`: a run clears it when it ends, so a
 *     mark that is there is work).
 *
 * An empty last message is not an empty result: the result is then the last
 * thing the session said in words. That costs nothing and cannot come back
 * empty a second time, which asking it to report again could.
 *
 * `run`, when given, is which run of its step the plan has going (plan.js
 * `attempt`). A session is told its run in the same change as the
 * instructions that start it (`workflow.run`, written by begin and
 * continueStep), so a copy that shows an earlier run has not seen this one's
 * instructions yet, and is still running, whatever its last turn says: a
 * page whose session copy lags a reopen never files the step with what the
 * run before said.
 */
export function sessionOutcome(doc, { run = null } = {}) {
  if (!doc) return { state: "running" }
  if (run != null && (doc.workflow?.run ?? 0) < run) return { state: "running" }
  const stop = stopOf(doc)
  if (stop?.kind === STOP.error) return { state: "failed" }
  // Out of budget is not done: it stopped part-way, and the orchestrator
  // decides whether it goes on.
  if (stop?.kind === STOP.budget) return { state: "running", outOfBudget: { spent: stop.data?.spent ?? null, limit: stop.data?.limit ?? null, at: stop.at } }
  // Stopped part-way, by a person or by the workflow, is not done either: it
  // waits for a word, which carries it on, or for workflow_stop. A person's
  // stop is news for the orchestrator, once (decide.js); a workflow's was
  // the workflow's own doing, and a session that still shows it to a driver
  // whose copy lags a reopen is not filed with what it said before.
  if (stop?.kind === STOP.stopped) return { state: "running", waiting: true, stopped: { at: stop.at } }
  if (stop?.kind === STOP.halted) return { state: "running", waiting: true }
  if (waitingIn(doc).length) return { state: "running", waiting: true }
  if (doc.reconnecting || needsWork(doc)) return { state: "running" }
  if (unansweredCalls(doc).length || (doc.turns ?? []).some((t) => t.streaming)) return { state: "running" }
  if (doc.burst != null) return { state: "running" }
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
 *   startSession   (handle) => Promise<{ asked, outcome?, why? }> — asks for a step's work (runners/page.js)
 *   stopWork       (repo, sessionUrl) => Promise<boolean> — stops a session's task on this person's queue
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
  constructor({ repo, handle, startSession, stopWork = null, notify = null, tools = null, now = () => Date.now(), settleMs = SETTLE_MS }) {
    this.repo = repo
    this.handle = handle
    this.startSession = startSession
    this.stopWork = stopWork ?? ((r, url) => stopTaskWork(r, workKey(url)))
    this.notify = notify
    // Every tool the runner that started this has, as `{ builtins, plugins }`,
    // for checking a step's prompt before it starts (step-tools.js). Without
    // it that is not done.
    this.tools = tools
    this.now = now
    this.settleMs = settleMs
    this.soon = null
    this.watched = new Map() // sessionUrl -> unsubscribe
    this.reasons = new Map() // sessionUrl -> how its last asked task ended, when that was not quiet
    this.waiting = [] // what running steps wait on a person for, as of the last tick
    this.outOfBudget = [] // which running steps are stopped for their own budgets, likewise
    this.channel = null
    this.ticking = null
    this.busy = false
    this.again = false
    this.stopped = false
    this.onPlanChange = () => this.kickSoon()
  }

  /** Tick now, and whenever the plan or a watched document changes. No timer. */
  start() {
    this.handle.on("change", this.onPlanChange)
    this.kick()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.soon)
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

  /** Read what is there, decide what to do (decide.js), and do it. */
  async tick() {
    if (this.stopped || !isCurrent(this.handle.doc())) return
    const plan = this.handle.doc()
    const observations = plan.status === PLAN.running ? await this.observe(plan) : {}
    await this.perform(decide(plan, observations, this.now()), plan)
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
        seen.outcome = sessionOutcome(doc, { run: attempt(step) })
        if (seen.outcome.waiting) seen.waiting = waitingIn(doc)
        if (step.access === "web" && doc) seen.scopeOk = confinedAs(doc, webScope(this.handle.url, step.id))
      }
      sessions[step.sessionUrl] = seen
    }
    const orchestrator = plan.sessionUrl ? await this.repo.find(plan.sessionUrl).then((h) => h.doc(), () => null) : null
    return { sessions, orchestratorCost: orchestrator?.usage?.cost, reasons: Object.fromEntries(this.reasons) }
  }

  /**
   * Do what decide() said, in order. Every page with the plan open does
   * this on the same changes, holding nothing, so each write is one of two
   * kinds, and two pages that make it write the same:
   *
   *   recomputed whole   finish, fail, cancel, pause, settle (plan.js
   *                      transitions, each applied only from the state it
   *                      leaves, checked inside the change: finish and fail
   *                      only while the step is on the run its session was
   *                      judged for, pause only while the budget is spent);
   *                      usage (the sum over the step sessions, assigned whole)
   *   set only if unset  sessionUrl (beginStep, only from pending),
   *                      orchestratorFrom, ledgerUrl; requests, told,
   *                      sourcesFiled and the sessions' grants, added by
   *                      key or id and never removed; a reopened step's
   *                      instructions, spoken into its session only when
   *                      its `workflow.run` is behind the step's run
   *
   * What two pages in one crossing (each writing before it has the other's
   * write) can do twice, each accepted:
   *   - begin a step in two sessions: the merge names one in the plan, and
   *     the other's burst ends at its first boundary (`not-the-step`) before
   *     any paid request, unless the merge is slower than a beat;
   *   - open two ledgers: the plan names one, and the other stays empty;
   *   - push one request twice: one request by its id (plan.js
   *     openRequests, decideRequest);
   *   - tell the orchestrator one piece of news once from each page;
   *   - speak a reopened step's instructions into its session twice, and
   *     lift its budget once from each copy (the same value);
   *   - link one kept source into the Sources folder twice;
   *   - file a step done across its reopen: a page that heard neither the
   *     other page's finish nor the orchestrator's reopen that followed it
   *     files it done too, and the merge may keep that over the reopen.
   * A page whose copy lags writes nothing another undoes: every transition
   * is checked against the plan as it is inside the change, and a step is
   * filed done only from a session copy that has its current run's
   * instructions (sessionOutcome `run`).
   */
  async perform(actions, plan) {
    // The run each step's session was judged for: a step reopened while the
    // tick read is not filed with the run before's answer.
    const judged = (id) => attempt(plan.steps.find((s) => s.id === id))
    for (const action of actions) {
      if (this.stopped) return
      switch (action.type) {
        case "cancel":
          await this.stopSteps(action.stepIds, action.reason)
          break
        case "finish":
          this.write((d) => finishStep(d, action.stepId, { result: action.result, run: judged(action.stepId), now: action.at }))
          break
        case "fail":
          this.write((d) => failStep(d, action.stepId, { error: action.error, run: judged(action.stepId), now: action.at }))
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
          this.write((d) => {
            if (d.orchestratorFrom == null) d.orchestratorFrom = action.cost
          })
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
   * read from (kernel/scope.js), and name it in the plan, only while the
   * plan names none, so a plan has one ledger whichever page opens it (two
   * pages in one crossing make two, and the merge names one).
   */
  async openLedger() {
    if (this.handle.doc().ledgerUrl) return
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
   * in `sourcesFiled`; one already in the folder is only marked, so a page
   * closed between the two writes leaves nothing to duplicate.
   * Run twice, the second time writes nothing.
   */
  async fileSources() {
    const plan = this.handle.doc()
    if (!plan.sourcesFolderUrl) return
    const filed = plan.sourcesFiled ?? {}
    const due = Object.entries((await this.ledger())?.doc()?.sources ?? {}).filter(([id, e]) => !filed[id] && e?.what != null)
    if (!due.length) return

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

  /** Write to the plan, if it is of this version. */
  write(fn) {
    try {
      changePlan(this.handle, fn)
    } catch (err) {
      // Changed to another version under a running driver: left alone, as a tick leaves it.
      if (err instanceof PlanVersionError) return false
      throw err
    }
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

  /**
   * Ask for a step's work (`startSession`), without waiting for the task to
   * end: its outcome, when it is not a quiet one (QUIET), is kept as the
   * reason a failed step gives (decide.js), worded without urls.
   */
  async run(sessionUrl) {
    const handle = await this.session(sessionUrl)
    if (!handle) return
    Promise.resolve()
      .then(() => this.startSession(handle))
      .then(
        (answer) => {
          if (!answer?.asked && !answer?.error) return
          if (answer.error) return this.reasons.set(sessionUrl, `Could not ask for the step's work: ${answer.why}`)
          if (QUIET.has(answer.outcome)) this.reasons.delete(sessionUrl)
          else this.reasons.set(sessionUrl, `The step's run ended: ${answer.outcome ?? "with no outcome"}`)
        },
        (err) => this.reasons.set(sessionUrl, `Could not ask for the step's work: ${String(err?.message ?? err).replace(/automerge:\S+/g, "a document")}`)
      )
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
    // Looked at again after the waits: another tick or page may have begun it.
    const fresh = this.handle.doc()?.steps?.find((s) => s.id === stepId)
    if (fresh?.status !== STEP.pending || fresh.sessionUrl) return
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
      // `run`: which run of its step these instructions start (sessionOutcome).
      d.workflow = { planUrl: this.handle.url, stepId: step.id, orchestratorUrl: plan.sessionUrl ?? null, run: attempt(step) }
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
      // This run's instructions are there already (a page that spoke them went
      // away before it began the step in the plan): set only if unset, by run.
      if ((d.workflow?.run ?? 0) >= attempt(step)) return
      d.reconnecting = null
      // Taken over: whatever `burst` named is no run of this step's any more
      // (a page that died mid-call), and its marks are the next burst's to settle.
      if (d.burst != null) d.burst = null
      if ((d.usage?.cost ?? 0) >= (d.config?.budget ?? Infinity) || stopOf(d)?.kind === STOP.budget) liftBudget(d, startBudget(step))
      // In the same change as its instructions: a copy with this run has them.
      if (d.workflow) d.workflow.run = attempt(step)
      // Its new instructions, which also end whatever stop it was under
      // (session/status.js stopOf) and close what that stop left cleared to
      // run (session/recovery.js speak).
      speak(d, makeTurn("user", [textBlock(message)]))
    })
    this.reasons.delete(step.sessionUrl)
    this.write((d) => beginStep(d, step.id, { now: this.now() }))
    if (this.handle.doc().steps.find((x) => x.id === step.id)?.status === STEP.running) await this.run(step.sessionUrl)
  }

  /**
   * Stop these sessions from outside, and keep them stopped
   * (session/recovery.js stopSession): a notice says they are halted, so none
   * is taken up again — not even one whose last call landed after the stop
   * (kernel/runner.js needsWork) — and a burst on one, anywhere, hears it and
   * stops (kernel/burst.js). Then its task on this person's queue is stopped,
   * which only makes it quicker. Spoken to, or continued by a reopen, they
   * carry on.
   */
  async haltSessions(urls, reason) {
    for (const url of urls) {
      try {
        const session = await this.repo.find(url)
        session.change((d) => stopSession(d, STOP.halted, reason ?? null))
      } catch {
        continue /* already gone */
      }
      Promise.resolve()
        .then(() => this.stopWork(this.repo, url))
        .catch(() => {})
    }
  }

  /**
   * Reopen closed steps (plan.js reopenSteps), stopping any running step a
   * cascade reaches, then tick so the ready ones continue. Throws, changing
   * nothing, if a named step cannot be reopened or the plan is of another
   * version.
   */
  async reopen(ids, opts = {}) {
    let result
    changePlan(this.handle, (d) => {
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
   * on each step for the views to show. Throws, changing nothing, if the plan
   * is of another version.
   */
  async stopSteps(stepIds = null, reason = null) {
    const plan = writable(this.handle.doc())
    const targets = plan.steps.filter(
      (s) => (stepIds ? stepIds.includes(s.id) : true) && (s.status === STEP.pending || s.status === STEP.running)
    )
    // Through the document: the burst doing the work may be in any pool,
    // and a stop written into the session reaches it wherever it is.
    await this.haltSessions(
      targets.filter((s) => s.status === STEP.running && s.sessionUrl).map((s) => s.sessionUrl),
      reason ?? "cancelled by its workflow"
    )
    changePlan(this.handle, (d) => {
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
    // or another page's driver, tells nothing twice.
    const plan = this.handle.doc()
    if (!hasNews(untold(plan, this.waiting, this.outOfBudget))) return
    this.channel ??= this.notify(this.handle.url, plan.title)
    this.channel?.notify(() => {
      // Read at delivery: a question answered meanwhile is no longer news.
      const now = this.handle.doc()
      const news = untold(now, this.waiting, this.outOfBudget)
      if (!hasNews(news)) return ""
      // Recorded first, so a page that has this change tells none of it
      // again; two pages in one crossing may each tell it once.
      const recorded = this.write((d) => {
        for (const key of news.keys) tell(d, key)
      })
      if (!recorded) return ""
      if (news.end) setTimeout(() => { this.channel?.close(); this.channel = null }, 0)
      return describeProgress(now, news.finished, this.waiting, news.budgets, { stale: news.stale, requests: news.requests, stopped: news.stopped, ledger: ledger?.doc() ?? null })
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
  const stopped = waiting.filter((w) => w.kind === "stopped" && !told(plan, stoppedKey(w.stepId, w.at)))
  const end = plan.status !== PLAN.running && !told(plan, endKey(plan))
  const paused = !!plan.paused && !told(plan, pauseKey(plan))
  const budgets = (outOfBudget ?? []).filter((b) => !told(plan, budgetKey(plan, b.stepId, b.at)))
  const stale = staleSteps(plan).filter((s) => !told(plan, staleKey(plan, s)))
  const requests = openRequests(plan).filter((r) => !told(plan, requestKey(r)))
  const keys = [
    ...finished.map(finishedKey),
    ...questions.map((q) => questionKey(q.callId)),
    ...stopped.map((s) => stoppedKey(s.stepId, s.at)),
    ...(end ? [endKey(plan)] : []),
    ...(paused ? [pauseKey(plan)] : []),
    ...budgets.map((b) => budgetKey(plan, b.stepId, b.at)),
    ...stale.map((s) => staleKey(plan, s)),
    ...requests.map(requestKey),
  ]
  return { finished, questions, stopped, end, paused, budgets, stale, requests, keys }
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
export function describeProgress(plan, news, waiting = [], outOfBudget = [], { stale = [], requests = [], stopped = [], ledger = null } = {}) {
  const derived = states(plan)
  const count = (state) => [...derived.values()].filter((s) => s === state).length
  const lines = [`Workflow "${plan.title}" (${plan.paused ? "paused" : plan.status === PLAN.running ? "running" : plan.status}).`]
  if (plan.paused?.reason === "budget") {
    const waitingSteps = notStarted(plan)
    lines.push(
      "",
      "## Paused: the budget is spent",
      `The workflow has spent ${dollars(plan.paused.spent)} of its ${dollars(plan.paused.limit)} cap (steps and your own turns together), so ${waitingSteps.length} step${waitingSteps.length === 1 ? "" : "s"} will not start: ${waitingSteps.map((s) => `${s.title} (${s.id})`).join(", ") || "none"}${plan.paused.stopped?.length ? `; stopped part-way for their own budgets: ${plan.paused.stopped.join(", ")}` : ""}.`,
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
      `It has spent ${dollars(b.spent)} of its ${dollars(b.limit)} and stopped part-way; what it kept and wrote so far is still there. The person has not been asked: you set this budget, so the decision is yours. Look at its session: did it make progress, and what is left?`,
      money.remaining > 0
        ? `The workflow has ${dollars(money.remaining)} left under its ${dollars(money.limit)} cap (${dollars(money.spent)} spent, your own turns included). Extend it out of that with workflow_budget { step, add, why } — you need no one's leave while it fits — or stop it (workflow_stop; what depends on it will not run), or do the rest differently (workflow_add_steps). Always give a reason.`
        : `The workflow's cap is reached (${dollars(money.spent)} of ${dollars(money.limit)}, your own turns included), so the person is being asked to raise it; you are told once they do. Until then do not start work, and tell them briefly what is blocked.`
    )
  }
  for (const s of stopped) {
    lines.push(
      "",
      `## Stopped by the person: ${title(s.stepId)} (${s.stepId})`,
      "They stopped it part-way; what it did so far is in its session. It is still running in the plan and waits for them: it carries on when someone speaks to it in its session. Leave it to them, or cancel it with workflow_stop if it is no longer wanted (what depends on it will not run). Do not start its work again elsewhere unless they ask."
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
