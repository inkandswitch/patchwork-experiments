/**
 * Running a workflow plan.
 *
 * The plan (plan.js) decides what may run; this makes it happen. Each step
 * becomes an agent session of its own — a full transcript you can open, steer
 * and approve in — started on the tier's model and run by an ordinary runner.
 * The driver watches those sessions, writes each one's result back into the
 * plan when it finishes, starts whatever that made ready, and tells the
 * orchestrating session what came in.
 *
 * The driver holds a lease on the plan document, exactly as a runner holds one
 * on a session, so two tabs with the plan open cannot both start the same
 * step. Nothing about the run lives only in memory: close the tab and reopen
 * the plan, and a new driver picks up where the document says things are.
 */

import { claimLease, holdsLease, initSession, makeTurn, textBlock, lastTurn, STATUS } from "../session.js"
import { heldElsewhere, needsWork, HEARTBEAT_MS } from "../runner.js"
import { PLAN, STEP, toStart, isSettled, stepPrompt, states, STATE, WORKFLOW_TOOL_IDS, WEB_TOOL_IDS } from "./plan.js"
import { releaseNowPermitted } from "../loop.js"
import { handleStore } from "../store.js"
import { waitingIn } from "./waiting.js"

export { WORKFLOW_TOOL_IDS } from "./plan.js"

/** How long a burst of changes is gathered before the tick it asks for. */
export const SETTLE_MS = 150

/** How much of a step's result the plan keeps. The whole thing is its session's last message. */
export const RESULT_KEPT = 8000

/**
 * Where a step's session stands, read off its document.
 *
 *   { state: "running" | "done" | "failed", result?, waiting? }
 *
 * Done means the agent has stopped with nothing left to do and said something
 * last; that last message is the result.
 */
export function sessionOutcome(doc) {
  if (!doc) return { state: "running" }
  if (doc.status === STATUS.error) return { state: "failed" }
  const waiting = doc.status === STATUS.awaitingApproval || doc.status === STATUS.awaitingAnswer
  if (doc.status !== STATUS.idle || needsWork(doc)) return { state: "running", waiting }
  const last = lastTurn(doc)
  if (!last || last.role !== "assistant") return { state: "running" }
  const text = (last.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n")
    .trim()
  return { state: "done", result: text || "(the step finished without saying anything)" }
}

/** What a plan's step sessions cost, summed. */
function sumUsage(usages) {
  const sum = { in: 0, out: 0 }
  for (const u of usages) {
    sum.in += u?.in ?? 0
    sum.out += u?.out ?? 0
    // Cost only once some step has one, so an unknown is not shown as free.
    if (typeof u?.cost === "number") sum.cost = (sum.cost ?? 0) + u.cost
    if (u?.costEstimated) sum.costEstimated = true
  }
  return sum
}

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
  constructor({ repo, handle, startSession, notify = null, toolIds = null, toolset = null, sensitive = null, now = () => Date.now(), heartbeatMs = HEARTBEAT_MS, settleMs = SETTLE_MS }) {
    this.repo = repo
    this.handle = handle
    this.startSession = startSession
    this.notify = notify
    this.toolIds = toolIds
    this.toolset = toolset
    // Documents a grant never covers: the account and its module settings.
    this.sensitive = sensitive ?? (() => [globalThis.accountDocHandle?.doc?.()?.moduleSettingsUrl, globalThis.accountDocHandle?.url].filter(Boolean))
    this.now = now
    this.heartbeatMs = heartbeatMs
    this.settleMs = settleMs
    this.soon = null
    this.runnerUrl = `workflow-${Math.random().toString(36).slice(2, 10)}`
    this.generation = null
    this.watched = new Map() // sessionUrl -> unsubscribe
    this.reasons = new Map() // sessionUrl -> why its runner stopped, from its events
    this.listening = new Set() // sessionUrls whose runner events we hear
    this.waiting = [] // what running steps wait on a person for, as of the last tick
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
    if (heldElsewhere(plan, this.runnerUrl, this.now())) return false
    if (this.generation !== null && holdsLease(plan, this.runnerUrl, this.generation)) return true
    this.handle.change((d) => { this.generation = claimLease(d, this.runnerUrl, this.now()).generation })
    return true
  }

  /** Renew the lease. Called by the heartbeat timer, never by a tick. */
  beat() {
    if (this.stopped || this.generation === null) return
    if (!holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return
    this.handle.change((d) => { d.lease.at = this.now() })
  }

  async tick() {
    if (this.stopped || !this.hold()) return
    let plan = this.handle.doc()
    if (plan.status !== PLAN.running) {
      this.report()
      return
    }

    // 1. What have the running steps done?
    const sessions = {}
    const usages = []
    const waiting = []
    for (const step of plan.steps) {
      if (!step.sessionUrl) continue
      const child = await this.session(step.sessionUrl)
      const doc = child?.doc()
      usages.push(doc?.usage)
      sessions[step.sessionUrl] = doc?.status ?? null
      if (step.status !== STEP.running) continue

      const outcome = sessionOutcome(doc)
      if (outcome.state === "running") {
        if (outcome.waiting) for (const item of waitingIn(doc)) waiting.push({ stepId: step.id, ...item })
        continue
      }
      this.write((d) => {
        const s = d.steps.find((x) => x.id === step.id)
        if (s.status !== STEP.running) return
        s.status = outcome.state === "done" ? STEP.done : STEP.failed
        s.finishedAt = this.now()
        if (outcome.state === "done") {
          s.result = outcome.result.length > RESULT_KEPT ? `${outcome.result.slice(0, RESULT_KEPT)}\n…(cut; the rest is in the step's session)` : outcome.result
        } else {
          s.error = this.reasons.get(step.sessionUrl) ?? "Its session stopped with an error. Open it to see what happened."
        }
      })
    }
    this.waiting = waiting
    const usage = sumUsage(usages)
    plan = this.handle.doc()
    const was = plan.usage ?? {}
    if (usage.in !== was.in || usage.out !== was.out || usage.cost !== was.cost || !!usage.costEstimated !== !!was.costEstimated) {
      this.write((d) => { d.usage = usage })
    }

    // 2. One job, one set of permissions.
    await this.shareGrants()

    // 3. Keep running steps running — after a reload their runners are gone.
    plan = this.handle.doc()
    for (const step of plan.steps) {
      if (step.status === STEP.running && step.sessionUrl) await this.run(step.sessionUrl)
    }

    // 4. Start what is ready.
    for (const id of toStart(this.handle.doc(), sessions)) {
      if (this.stopped || !holdsLease(this.handle.doc(), this.runnerUrl, this.generation)) return
      await this.begin(id)
    }

    // 5. Finished?
    plan = this.handle.doc()
    if (plan.status === PLAN.running && isSettled(plan, sessions)) {
      this.write((d) => {
        d.status = PLAN.done
        d.finishedAt = this.now()
      })
    }
    this.report()
  }

  /**
   * A permission given anywhere in the workflow holds everywhere in it.
   *
   * A workflow is one job: granting "any site" to one step and leaving its
   * siblings blocked on the same question was the opposite of what the person
   * meant. Grants are merged from the orchestrator and every full-access step,
   * written to each session that lacks one, and each session's waiting calls
   * that are now allowed are released. Web-only steps receive grants but do not
   * give them: their standing "any site" is safe only because they cannot read
   * anything, and must not spread to sessions that can.
   *
   * Grants only accumulate and a session is written only when it lacks one, so
   * this settles: run twice, the second time writes nothing.
   */
  async shareGrants() {
    const plan = this.handle.doc()
    const members = [{ url: plan.sessionUrl, gives: true }]
    for (const step of plan.steps) if (step.sessionUrl) members.push({ url: step.sessionUrl, gives: step.access !== "web" })
    const sessions = []
    for (const member of members) {
      const handle = member.url ? await this.session(member.url) : null
      if (handle?.doc()) sessions.push({ ...member, handle })
    }

    const merged = {}
    for (const { handle, gives } of sessions) {
      if (!gives) continue
      for (const [key, held] of Object.entries(handle.doc().grants ?? {})) {
        if (held === "always" || (held === "session" && merged[key] !== "always")) merged[key] = held
      }
    }

    for (const { handle } of sessions) {
      const doc = handle.doc()
      const missing = Object.keys(merged).filter((key) => !["session", "always"].includes(doc.grants?.[key]))
      if (missing.length) {
        handle.change((d) => {
          if (!d.grants) d.grants = {}
          for (const key of missing) d.grants[key] = merged[key]
        })
      }
      if (missing.length || this.unreleased(handle)) {
        releaseNowPermitted({
          store: handleStore(handle, null),
          toolset: this.toolset ?? (await builtinToolset()),
          subject: doc.subject ?? null,
          sensitive: this.sensitive(),
        })
      }
    }
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

  /** A step's session handle, watched so its progress wakes the driver. */
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
    if (!step || step.status !== STEP.pending) return

    const orchestrator = plan.sessionUrl ? (await this.session(plan.sessionUrl))?.doc() : null
    const toolIds = this.toolIds ?? (await defaultToolIds())
    const child = await this.repo.create2()
    child.change((d) => {
      initSession(d, {
        title: `${plan.title} · ${step.title}`,
        subject: plan.subject ?? null,
        config: {
          providerId: orchestrator?.config?.providerId ?? "openrouter",
          model: plan.tiers?.[step.tier],
          params: { maxTokens: orchestrator?.config?.params?.maxTokens ?? 16000 },
          // Workflows do not nest: a step never orchestrates.
          workflows: { enabled: false },
        },
      })
      d.workflow = { planUrl: this.handle.url, stepId: step.id, orchestratorUrl: plan.sessionUrl ?? null }
      // A worker step gets only what runs without the page, so it can run
      // anywhere a repo is. Neither kind can start a workflow of its own.
      d.tools =
        step.access === "web"
          ? { enabled: WEB_TOOL_IDS }
          : step.where === "worker"
            ? { enabled: toolIds.worker }
            : { disabled: WORKFLOW_TOOL_IDS }
      // What the person already allowed the orchestrator carries into its steps;
      // asking again for each one would put the same question in front of them
      // once per step. A web-only step may also fetch anything: it can reach
      // none of the person's documents, so there is nothing of theirs to leak.
      d.grants = { ...(orchestrator?.grants ?? {}), ...(step.access === "web" ? { [WEB_GRANT]: "session" } : {}) }
      if (step.access === "web") d.workflow.access = "web"
      d.turns.push(makeTurn("user", [textBlock(stepPrompt(plan, step))]))
    })

    this.write((d) => {
      const s = d.steps.find((x) => x.id === step.id)
      if (s.status !== STEP.pending) return
      s.status = STEP.running
      s.sessionUrl = child.url
      s.startedAt = this.now()
      s.model = plan.tiers?.[step.tier] ?? null
    })
    // Started only if the plan now names this session for the step — not
    // merely because the write was allowed.
    if (this.handle.doc().steps.find((x) => x.id === step.id)?.sessionUrl === child.url) await this.run(child.url)
  }

  /** Cancel steps (all unfinished ones when none are named), interrupting their sessions. */
  async cancel(stepIds = null) {
    const plan = this.handle.doc()
    const targets = plan.steps.filter(
      (s) => (stepIds ? stepIds.includes(s.id) : true) && (s.status === STEP.pending || s.status === STEP.running)
    )
    for (const step of targets) {
      if (step.status !== STEP.running || !step.sessionUrl) continue
      try {
        const session = await this.repo.find(step.sessionUrl)
        // Through the document, not only the runner in this tab: the one doing
        // the work may be in another tab, or gone with a reload — then an
        // interrupt here reached nothing and the session said "running" for
        // good. Taking its lease makes any runner stand down at its next
        // check; marking it idle says it stopped.
        session.change((d) => {
          claimLease(d, `${this.runnerUrl}-cancel`, this.now())
          if (d.status === STATUS.running || d.status === STATUS.parked) d.status = STATUS.idle
        })
        ;(await this.startSession(session))?.runner?.interrupt?.()
      } catch {
        /* already gone */
      }
    }
    this.handle.change((d) => {
      for (const s of d.steps) {
        if (!targets.some((t) => t.id === s.id)) continue
        s.status = STEP.cancelled
        s.finishedAt = this.now()
      }
      if (!stepIds) {
        d.status = PLAN.stopped
        d.finishedAt = this.now()
      }
    })
    await this.kick()
  }

  /**
   * Tell the orchestrator what it has not heard: steps that finished, and
   * questions steps are asking. A step waiting for a permission does not wake
   * it — only the person can grant one, and they see it in the views — but
   * the news it does get says so.
   */
  report() {
    if (!this.notify) return
    // What has been told is recorded in the plan, not in this driver: a reload,
    // or another tab's driver taking over, used to tell the orchestrator every
    // finished step again — one real orchestrator got the same result three
    // times, a paid turn each — and the end of a plan was "news" on every tick
    // after it, for as long as anything was ticking.
    const unreported = (plan) => plan.steps.filter((s) => [STEP.done, STEP.failed].includes(s.status) && !s.reported)
    const unasked = (plan) => this.waiting.filter((w) => w.kind === "question" && !(plan.asked ?? []).includes(w.callId))
    const endUnreported = (plan) => plan.status !== PLAN.running && !plan.reportedEnd
    const plan = this.handle.doc()
    if (!unreported(plan).length && !unasked(plan).length && !endUnreported(plan)) return
    this.channel ??= this.notify(this.handle.url, plan.title)
    this.channel?.notify(() => {
      // Read at delivery: a question answered meanwhile is no longer news.
      const now = this.handle.doc()
      const news = unreported(now)
      const questions = unasked(now)
      const end = endUnreported(now)
      if (!news.length && !questions.length && !end) return ""
      const recorded = this.write((d) => {
        for (const s of d.steps) if (news.some((n) => n.id === s.id)) s.reported = true
        if (questions.length) {
          if (!d.asked) d.asked = []
          for (const q of questions) d.asked.push(q.callId)
        }
        if (end) d.reportedEnd = true
      })
      // A driver that has lost the plan leaves the telling to the one holding it.
      if (!recorded) return ""
      if (end) setTimeout(() => { this.channel?.close(); this.channel = null }, 0)
      return describeProgress(now, news, this.waiting)
    })
  }
}

/** The news the orchestrator wakes to. */
export function describeProgress(plan, news, waiting = []) {
  const derived = states(plan)
  const count = (state) => [...derived.values()].filter((s) => s === state).length
  const lines = [`Workflow "${plan.title}" (${plan.status === PLAN.running ? "running" : plan.status}).`]
  for (const step of news) {
    lines.push(
      "",
      `## ${step.status === STEP.done ? "Done" : "Failed"}: ${step.title} (${step.id})`,
      step.status === STEP.done ? step.result ?? "" : step.error ?? "",
      `Session: ${step.sessionUrl}`
    )
  }
  const title = (id) => plan.steps.find((s) => s.id === id)?.title ?? id
  for (const q of waiting.filter((w) => w.kind === "question")) {
    lines.push(
      "",
      `## Question from step ${title(q.stepId)} (${q.stepId})`,
      q.question,
      ...(q.options.length ? [`Options: ${q.options.map((o) => o.label).join(" / ")}`] : []),
      "Answer it with workflow_answer if you know the answer from the work so far. If it is the person's call, ask them (ask_user) and pass their answer on."
    )
  }
  const approvals = waiting.filter((w) => w.kind === "approval")
  if (approvals.length) {
    lines.push(
      "",
      `Waiting on the person's permission: ${approvals.map((a) => `${title(a.stepId)} wants to run ${a.tool}`).join("; ")}. Only they can grant it; they see it in your view and the workflow's.`
    )
  }
  lines.push(
    "",
    `Steps: ${count(STATE.done)} done, ${count(STATE.running) + count(STATE.needsInput)} running, ${count(STATE.ready) + count(STATE.waiting)} to come, ${count(STATE.failed)} failed, ${count(STATE.blocked)} blocked, ${count(STATE.cancelled)} cancelled.`
  )
  if (plan.status === PLAN.running) {
    lines.push("Add steps with workflow_add_steps if these results call for more work; otherwise wait — you will hear when more finish.")
  } else {
    lines.push("The workflow is over. Bring the results together for the person.")
  }
  return lines.join("\n")
}

/** The grant that lets a web-only step fetch anything. */
export const WEB_GRANT = "web@*"

/** The built-in toolset, loaded late: the toolset imports this module. */
async function builtinToolset() {
  return (await import("../tools/index.js")).builtinToolset()
}

/** Which built-in tools a worker step may have. Loaded late: the toolset imports this module. */
async function defaultToolIds() {
  const { BUILTIN_TOOLS } = await import("../tools/index.js")
  return {
    worker: BUILTIN_TOOLS.filter((t) => t.where === "worker" && !WORKFLOW_TOOL_IDS.includes(t.id)).map((t) => t.id),
  }
}

/**
 * Drive a plan from this page: steps run in this tab's runners, and news goes
 * to the orchestrating session through `events` — the workflow tool's own, or,
 * when the plan's view starts the driver after a reload, the orchestrator's
 * runner here.
 */
export async function drivePlanHere(planUrl, { repo, events = null, startSession = null }) {
  const existing = getDriver(planUrl)
  if (existing) {
    existing.kick()
    return existing
  }
  const { startTabRunner } = await import("../tab-runner.js")
  // A caller with its own way of running sessions (a test, a runner outside
  // the browser) passes it; in a page, steps run in this tab.
  const start =
    startSession ??
    (async (handle) => {
      const entry = await startTabRunner(handle, { repo, subject: handle.doc()?.subject ?? null })
      return { runner: entry?.runner ?? null, listen: (fn) => entry?.listeners?.add(fn) }
    })

  let channels = events
  if (!channels) {
    const plan = (await repo.find(planUrl)).doc()
    if (plan?.sessionUrl) {
      const entry = await startTabRunner(await repo.find(plan.sessionUrl), { repo, subject: plan.subject ?? null })
      channels = entry?.ctx?.events?.forTool("workflow") ?? null
    }
  }

  return ensureDriver(planUrl, {
    repo,
    startSession: start,
    notify: channels ? (url, title) => channels.open(url, { label: `workflow: ${title}` }) : null,
  })
}
