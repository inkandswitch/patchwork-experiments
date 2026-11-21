/**
 * The workflow view: the plan, and what every step is doing.
 *
 * Steps are laid out in stages by dependency depth — everything in a stage can
 * run side by side once the stage before it is done — and each one shows its
 * state, where it runs, which model and why, what its session is up to, and its
 * result. Every step links to its session, where its whole transcript is, and
 * where a step waiting on a person is answered.
 *
 * Opening the view also drives the plan if nothing else is: a workflow left
 * running when its tab closed resumes when anyone opens it again.
 */

import { states, STATE, PLAN, DEFAULT_LIMITS, budgetOf, stepBudget, staleInputs, reopenSteps } from "./plan.js"
import { budgetWaiting } from "./waiting.js"
import { renderBudgetItem } from "../ui/waiting.js"
import { formatCost, STATUS, sessionTitle } from "../session.js"
import { activityOf } from "../ui/attention.js"
import { drivePlanHere, getDriver, keptCounts } from "./driver.js"
import { waitingIn } from "./waiting.js"
import { renderWaitingItem } from "../ui/waiting.js"

const STYLE_MARK = "data-patchwork-agent-styles"
function ensureStyles() {
  if (typeof document === "undefined") return
  try {
    const href = new URL("../styles.css", import.meta.url).href
    if ([...document.querySelectorAll(`link[${STYLE_MARK}]`)].some((link) => link.href === href)) return
    const link = document.createElement("link")
    link.setAttribute(STYLE_MARK, "")
    link.rel = "stylesheet"
    link.href = href
    document.head.appendChild(link)
  } catch {
    /* tests: no external stylesheets */
  }
}

const STATE_LABEL = {
  [STATE.waiting]: "waiting",
  [STATE.ready]: "ready",
  [STATE.blocked]: "blocked",
  [STATE.running]: "running",
  [STATE.needsInput]: "needs you",
  [STATE.done]: "done",
  [STATE.stale]: "out of date",
  [STATE.failed]: "failed",
  [STATE.cancelled]: "cancelled",
}

const WHERE_LABEL = { host: "frontend", worker: "worker" }

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** Dependency depth: a step's stage is one past the deepest thing it waits for. */
export function stages(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const depth = new Map()
  const of = (step, seen = new Set()) => {
    if (depth.has(step.id)) return depth.get(step.id)
    if (seen.has(step.id)) return 0
    seen.add(step.id)
    const d = Math.max(-1, ...(step.after ?? []).map((id) => (byId.has(id) ? of(byId.get(id), seen) : -1))) + 1
    depth.set(step.id, d)
    return d
  }
  const out = []
  for (const step of steps) {
    const d = of(step)
    ;(out[d] ??= []).push(step)
  }
  return out.filter(Boolean)
}

/** "~anthropic/claude-opus-latest" -> "claude-opus-latest". */
const shortModel = (model) => String(model ?? "").split("/").pop()

/** Dollars as a card shows them. */
const dollars = (n) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * What a node has spent, against its budget when it has one: on every card,
 * so where the money goes is read off the board, not added up from sessions.
 */
function moneyChip(spent, limit = null, estimated = false) {
  const chip = el("span", "agent-wf-money", limit == null ? `${dollars(spent)} spent` : `${dollars(spent)} / ${dollars(limit)}`)
  chip.title = limit == null ? "Spent so far" : `Spent so far, of a ${dollars(limit)} budget${estimated ? " (partly estimated)" : ""}`
  if (limit != null && spent >= limit) chip.dataset.over = "true"
  return chip
}

/** A goal longer than this is folded to a few lines. */
const GOAL_FOLD = 240

const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

export function WorkflowView(handle, element, { repo = globalThis.repo } = {}) {
  ensureStyles()
  const root = el("div", "patchwork-agent agent-workflow")
  element.append(root)

  const sessions = new Map() // sessionUrl -> { handle, off }
  let disposed = false
  let frame = null

  /**
   * One render per frame, however many changes arrive: a step streaming its
   * answer changes its session many times a second, and rebuilding the board
   * for each one is wasted work on a page that is already busy.
   */
  function renderSoon() {
    if (disposed || frame !== null) return
    const schedule = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16))
    frame = schedule(() => {
      frame = null
      render()
    })
  }

  const openDoc = (url) =>
    root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }))

  /** Watch a step's session, so its status shows live. */
  function watch(url) {
    if (!url || sessions.has(url) || !repo) return
    const entry = { handle: null, off: () => {} }
    sessions.set(url, entry)
    repo.find(url).then((h) => {
      if (disposed) return
      entry.handle = h
      const onChange = () => renderSoon()
      h.on("change", onChange)
      entry.off = () => h.off("change", onChange)
      render()
    }, () => {})
  }

  function sessionDoc(url) {
    return sessions.get(url)?.handle?.doc() ?? null
  }

  /** The orchestrating session, as a node on the board. */
  function orchestratorCard(plan) {
    const url = plan.sessionUrl
    const doc = sessionDoc(url)
    const waits = waitingIn(doc)
    const state = waits.length
      ? STATE.needsInput
      : doc?.status === STATUS.running || doc?.status === STATUS.reconnecting
        ? STATE.running
        : doc?.status === STATUS.error
          ? STATE.failed
          : plan.status === PLAN.running
            ? STATE.waiting
            : STATE.done
    const label =
      doc?.status === STATUS.reconnecting
        ? "reconnecting"
        : { [STATE.needsInput]: "needs you", [STATE.running]: "working", [STATE.failed]: "stopped", [STATE.waiting]: "waiting for steps", [STATE.done]: "idle" }[state]

    const card = el("article", "agent-wf-step agent-wf-orchestrator")
    card.dataset.state = state
    const head = el("div", "agent-wf-step-head")
    head.append(el("span", "agent-wf-chip", label), el("strong", null, (doc && sessionTitle(doc)) || "Orchestrator"), moneyChip(doc?.usage?.cost ?? 0, null, doc?.usage?.costEstimated))
    card.append(head)

    if (doc) {
      const activity = activityOf(doc)
      const spent = formatCost(doc.usage)
      card.append(el("p", "agent-wf-activity", [activity, `${doc.turns?.length ?? 0} turns`, spent].filter(Boolean).join(" · ")))
    }
    // What it waits on you for, answerable here.
    const orchestratorHandle = sessions.get(url)?.handle
    for (const item of waits) {
      card.append(renderWaitingItem({ ...item, handle: orchestratorHandle, stepTitle: "Orchestrator" }, { showStep: false }))
    }
    const open = el("button", "agent-wf-open", waits.length ? "Answer in its session" : "Open session")
    open.addEventListener("click", (event) => {
      event.preventDefault()
      openDoc(url)
    })
    card.append(open)
    return card
  }

  function stepCard(step, state) {
    const card = el("article", "agent-wf-step")
    card.dataset.state = state

    const head = el("div", "agent-wf-step-head")
    const stepSession = step.sessionUrl ? sessionDoc(step.sessionUrl) : null
    // A step's budget is its session's once it has one (lifted budgets land
    // there first), else the one it will start with.
    const limit = stepSession?.config?.budget ?? stepBudget(step)
    head.append(el("span", "agent-wf-chip", STATE_LABEL[state] ?? state), el("strong", null, step.title), moneyChip(stepSession?.usage?.cost ?? 0, limit, stepSession?.usage?.costEstimated))
    card.append(head)

    const meta = el("div", "agent-wf-meta")
    meta.append(
      el("span", "agent-wf-badge", `${WHERE_LABEL[step.where] ?? step.where}${step.access === "web" ? " · web only" : ""}`),
      el("span", "agent-wf-badge", `${step.tier} · ${shortModel(step.model ?? handle.doc()?.tiers?.[step.tier])}`)
    )
    if (step.after?.length) meta.append(el("span", "agent-wf-after", `after ${step.after.join(", ")}`))
    // A step reopened has run before; how many times is part of its story.
    const runs = (step.previous?.length ?? 0) + (step.status === "pending" ? 0 : 1)
    if (runs > 1) meta.append(el("span", "agent-wf-badge", `run ${runs}`))
    card.append(meta)
    if (step.access === "web") {
      const { sources, findings } = keptCounts(handle.doc(), step.id)
      if (sources || findings) card.append(el("p", "agent-wf-kept", `kept ${sources} source${sources === 1 ? "" : "s"} · ${findings} finding${findings === 1 ? "" : "s"}`))
    }
    if (step.why) card.append(el("p", "agent-wf-why", step.why))

    const session = step.sessionUrl ? sessionDoc(step.sessionUrl) : null
    if (session && (state === STATE.running || state === STATE.needsInput)) {
      const turns = session.turns?.length ?? 0
      const used = (session.usage?.in ?? 0) + (session.usage?.out ?? 0)
      const spent = formatCost(session.usage)
      const status = session.status === STATUS.reconnecting ? "waiting for the network" : session.status
      card.append(el("p", "agent-wf-activity", `${status} · ${turns} turns · ${tokens(used)} tokens${spent ? ` · ${spent}` : ""}`))
    }

    // What it waits on you for, answerable here without opening the session.
    if (state === STATE.needsInput) {
      const childHandle = sessions.get(step.sessionUrl)?.handle
      for (const item of waitingIn(session)) {
        card.append(renderWaitingItem({ ...item, handle: childHandle, stepTitle: step.title }, { showStep: false }))
      }
    }

    if (step.reopen) card.append(el("p", "agent-wf-why", `Reopened: ${step.reopen.note}`))
    if (state === STATE.stale) {
      card.append(el("p", "agent-wf-stale", `Out of date: built on ${staleInputs(handle.doc(), step).join(", ")} as it was before. Steps waiting on it are held until the orchestrator reopens or keeps it.`))
    }
    if (step.result && (state === STATE.done || state === STATE.stale)) {
      const details = el("details", "agent-wf-result")
      details.append(el("summary", null, step.result.split("\n").find((l) => l.trim()) ?? "result"))
      details.append(el("pre", null, step.result))
      card.append(details)
    }
    if (step.error && (state === STATE.failed || state === STATE.cancelled)) card.append(el("p", "agent-wf-error", step.error))

    // What it asked the orchestrator for, and what became of it.
    for (const r of (handle.doc().requests ?? []).filter((x) => x.stepId === step.id)) {
      const asks = [r.add?.length ? `add ${r.add.map((x) => x.id).join(", ")}` : null, r.reopen?.length ? `reopen ${r.reopen.join(", ")}` : null].filter(Boolean).join(" and ")
      const line = el("p", "agent-wf-request", `Asks to ${asks}: ${r.why}`)
      line.dataset.status = r.status
      line.append(el("span", "agent-wf-chip", r.status === "open" ? "waiting on the orchestrator" : r.status))
      card.append(line)
    }

    // A person can resume a step that failed or was cancelled, as it was:
    // reopening a finished one, or with a note, is the orchestrator's.
    if (repo && (state === STATE.failed || state === STATE.cancelled)) {
      const resume = el("button", "agent-wf-open", "Resume")
      resume.addEventListener("click", async (event) => {
        event.preventDefault()
        handle.change((d) => reopenSteps(d, [step.id], { note: "Resumed by the person: carry on from where you were.", cascade: false, by: "person" }))
        const driver = getDriver(handle.url) ?? (await drivePlanHere(handle.url, { repo }))
        driver.kick()
      })
      card.append(resume)
    }

    if (step.sessionUrl) {
      const open = el("button", "agent-wf-open", state === STATE.needsInput ? "Answer in its session" : "Open session")
      open.addEventListener("click", (event) => {
        event.preventDefault()
        openDoc(step.sessionUrl)
      })
      card.append(open)
    }
    return card
  }

  /**
   * Rebuild the view, keeping the person's place.
   *
   * Built off the page and swapped in at once: emptying the root first
   * collapsed it for a moment, the browser clamped the scroll to the top, and
   * a person reading further down was thrown back up every time a step's
   * session changed — several times a second while one streamed. A render
   * also waits while something in the view is being typed into, so an answer
   * half-written in a step's card is not wiped.
   */
  function render() {
    if (disposed) return
    if (typing()) {
      held = true
      return
    }
    held = false
    const top = root.scrollTop
    const left = root.querySelector(".agent-wf-board")?.scrollLeft ?? 0
    const out = document.createDocumentFragment()
    build(out)
    root.replaceChildren(out)
    root.scrollTop = top
    const board = root.querySelector(".agent-wf-board")
    if (board) board.scrollLeft = left
  }

  /** Is the person typing into this view? */
  function typing() {
    const active = root.ownerDocument?.activeElement
    return !!active && root.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
  }
  // A render held for typing happens when the typing stops.
  let held = false
  const onFocusOut = () => {
    if (held) setTimeout(() => !typing() && render(), 0)
  }
  root.addEventListener("focusout", onFocusOut)

  // The goal folds to a few lines; whether it is open survives re-renders.
  let goalOpen = false

  function build(out) {
    const plan = handle.doc()
    if (!plan?.steps) {
      out.append(el("p", "agent-hint", "This workflow has no plan yet."))
      return
    }
    for (const step of plan.steps) watch(step.sessionUrl)

    // Waiting on a person is read off the calls, not the status field: a
    // status reset to idle hid a step's pending permissions from this view.
    const statusOf = (doc) => (waitingIn(doc).length ? STATUS.awaitingApproval : doc?.status ?? null)
    const statuses = Object.fromEntries(plan.steps.filter((s) => s.sessionUrl).map((s) => [s.sessionUrl, statusOf(sessionDoc(s.sessionUrl))]))
    if (plan.sessionUrl) watch(plan.sessionUrl)
    const derived = states(plan, statuses)
    const count = (state) => plan.steps.filter((s) => derived.get(s.id) === state).length

    const header = el("header", "agent-wf-header")
    const titleRow = el("div", "cluster")
    const status = el("span", "agent-wf-chip", plan.paused ? "paused" : plan.status)
    status.dataset.state = plan.paused ? STATE.needsInput : plan.status === PLAN.running ? STATE.running : plan.status === PLAN.done ? STATE.done : STATE.cancelled
    titleRow.append(el("h2", null, plan.title), status)
    const goal = el("p", "agent-wf-goal", plan.goal)
    goal.dataset.open = String(goalOpen)
    header.append(titleRow, goal)
    // Long goals — a whole brief — pushed the board off the screen.
    if (String(plan.goal ?? "").length > GOAL_FOLD) {
      const toggle = el("button", "agent-wf-goal-toggle", goalOpen ? "Show less" : "Show the whole goal")
      toggle.addEventListener("click", (event) => {
        event.preventDefault()
        goalOpen = !goalOpen
        render()
      })
      header.append(toggle)
    }

    const budget = budgetOf(plan)
    const summary = el("p", "agent-wf-summary")
    summary.textContent = [
      `${count(STATE.done)}/${plan.steps.length} done`,
      count(STATE.running) + count(STATE.needsInput) ? `${count(STATE.running) + count(STATE.needsInput)} running` : null,
      count(STATE.needsInput) ? `${count(STATE.needsInput)} need you` : null,
      count(STATE.failed) ? `${count(STATE.failed)} failed` : null,
      count(STATE.blocked) ? `${count(STATE.blocked)} blocked` : null,
      `$${budget.spent.toFixed(2)} of $${budget.limit.toFixed(2)} budget${plan.usage?.costEstimated ? " (partly estimated)" : ""}`,
      `up to ${plan.limits?.parallel ?? DEFAULT_LIMITS.parallel} at once`,
    ]
      .filter(Boolean)
      .join(" · ")
    header.append(summary)

    const actions = el("div", "cluster")
    if (plan.sourcesFolderUrl) {
      // What the research steps kept, filed for people. Shown once there is
      // something in it; the count is the ledger's, which the folder follows.
      const { sources, findings } = keptCounts(plan)
      if (sources + findings) {
        const kept = el("button", "agent-wf-sources", `Sources (${sources + findings})`)
        kept.addEventListener("click", (event) => {
          event.preventDefault()
          openDoc(plan.sourcesFolderUrl)
        })
        actions.append(kept)
      }
    }
    if (plan.status === PLAN.running) {
      const stop = el("button", null, "Stop workflow")
      stop.dataset.variant = "danger"
      stop.addEventListener("click", async (event) => {
        event.preventDefault()
        const driver = getDriver(handle.url) ?? (await drivePlanHere(handle.url, { repo }))
        await driver.cancel()
      })
      actions.append(stop)
    }
    header.append(actions)
    // Paused for its budget: say so first, with Resume.
    const paused = budgetWaiting(plan, handle.url, handle)
    if (paused) {
      const banner = renderBudgetItem({ ...paused, repo }, { showStep: false })
      banner.classList.add("agent-wf-paused")
      header.append(banner)
    }
    out.append(header)

    const board = el("div", "agent-wf-board")
    // The orchestrator is part of the work, not a link beside it: what it is
    // doing, and anything it waits on you for, on the board with its steps.
    if (plan.sessionUrl) {
      const column = el("section", "agent-wf-stage")
      column.append(el("h3", null, "Orchestrator"), orchestratorCard(plan))
      board.append(column)
    }
    stages(plan.steps).forEach((stage, i) => {
      const column = el("section", "agent-wf-stage")
      column.append(el("h3", null, i === 0 ? "Start" : `Stage ${i + 1}`))
      for (const step of stage) column.append(stepCard(step, derived.get(step.id)))
      board.append(column)
    })
    out.append(board)
  }

  // The plan itself changes rarely, and a test or a person acting on it wants
  // to see the result at once; it renders straight away.
  const onChange = () => render()
  handle.on("change", onChange)
  render()

  // Drive it if nothing else is. The plan's lease keeps this from fighting a
  // driver already running it in another tab.
  if (repo && handle.doc()?.status === PLAN.running) drivePlanHere(handle.url, { repo }).catch(() => {})

  return () => {
    disposed = true
    handle.off("change", onChange)
    for (const entry of sessions.values()) entry.off()
    root.remove()
  }
}
