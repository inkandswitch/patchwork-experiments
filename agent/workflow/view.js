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

import { states, STATE, PLAN, DEFAULT_LIMITS } from "./plan.js"
import { drivePlanHere, getDriver } from "./driver.js"
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

const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

export function WorkflowView(handle, element, { repo = globalThis.repo } = {}) {
  ensureStyles()
  const root = el("div", "patchwork-agent agent-workflow")
  element.append(root)

  const sessions = new Map() // sessionUrl -> { handle, off }
  let disposed = false

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
      const onChange = () => render()
      h.on("change", onChange)
      entry.off = () => h.off("change", onChange)
      render()
    }, () => {})
  }

  function sessionDoc(url) {
    return sessions.get(url)?.handle?.doc() ?? null
  }

  function stepCard(step, state) {
    const card = el("article", "agent-wf-step")
    card.dataset.state = state

    const head = el("div", "agent-wf-step-head")
    head.append(el("span", "agent-wf-chip", STATE_LABEL[state] ?? state), el("strong", null, step.title))
    card.append(head)

    const meta = el("div", "agent-wf-meta")
    meta.append(
      el("span", "agent-wf-badge", WHERE_LABEL[step.where] ?? step.where),
      el("span", "agent-wf-badge", `${step.tier} · ${shortModel(step.model ?? handle.doc()?.tiers?.[step.tier])}`)
    )
    if (step.after?.length) meta.append(el("span", "agent-wf-after", `after ${step.after.join(", ")}`))
    card.append(meta)
    if (step.why) card.append(el("p", "agent-wf-why", step.why))

    const session = step.sessionUrl ? sessionDoc(step.sessionUrl) : null
    if (session && (state === STATE.running || state === STATE.needsInput)) {
      const turns = session.turns?.length ?? 0
      const used = (session.usage?.in ?? 0) + (session.usage?.out ?? 0)
      card.append(el("p", "agent-wf-activity", `${session.status} · ${turns} turns · ${tokens(used)} tokens`))
    }

    // What it waits on you for, answerable here without opening the session.
    if (state === STATE.needsInput) {
      const childHandle = sessions.get(step.sessionUrl)?.handle
      for (const item of waitingIn(session)) {
        card.append(renderWaitingItem({ ...item, handle: childHandle, stepTitle: step.title }, { showStep: false }))
      }
    }

    if (step.result && state === STATE.done) {
      const details = el("details", "agent-wf-result")
      details.append(el("summary", null, step.result.split("\n").find((l) => l.trim()) ?? "result"))
      details.append(el("pre", null, step.result))
      card.append(details)
    }
    if (step.error && state === STATE.failed) card.append(el("p", "agent-wf-error", step.error))

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

  function render() {
    if (disposed) return
    const plan = handle.doc()
    root.replaceChildren()
    if (!plan?.steps) {
      root.append(el("p", "agent-hint", "This workflow has no plan yet."))
      return
    }
    for (const step of plan.steps) watch(step.sessionUrl)

    const statuses = Object.fromEntries(plan.steps.filter((s) => s.sessionUrl).map((s) => [s.sessionUrl, sessionDoc(s.sessionUrl)?.status ?? null]))
    const derived = states(plan, statuses)
    const count = (state) => plan.steps.filter((s) => derived.get(s.id) === state).length

    const header = el("header", "agent-wf-header")
    const titleRow = el("div", "cluster")
    const status = el("span", "agent-wf-chip", plan.status)
    status.dataset.state = plan.status === PLAN.running ? STATE.running : plan.status === PLAN.done ? STATE.done : STATE.cancelled
    titleRow.append(el("h2", null, plan.title), status)
    header.append(titleRow, el("p", "agent-wf-goal", plan.goal))

    const used = (plan.usage?.in ?? 0) + (plan.usage?.out ?? 0)
    const limit = plan.limits?.tokens ?? DEFAULT_LIMITS.tokens
    const summary = el("p", "agent-wf-summary")
    summary.textContent = [
      `${count(STATE.done)}/${plan.steps.length} done`,
      count(STATE.running) + count(STATE.needsInput) ? `${count(STATE.running) + count(STATE.needsInput)} running` : null,
      count(STATE.needsInput) ? `${count(STATE.needsInput)} need you` : null,
      count(STATE.failed) ? `${count(STATE.failed)} failed` : null,
      count(STATE.blocked) ? `${count(STATE.blocked)} blocked` : null,
      `${tokens(used)} of ${tokens(limit)} tokens`,
      `up to ${plan.limits?.parallel ?? DEFAULT_LIMITS.parallel} at once`,
    ]
      .filter(Boolean)
      .join(" · ")
    header.append(summary)

    const actions = el("div", "cluster")
    if (plan.sessionUrl) {
      const orchestrator = el("button", null, "Open orchestrator")
      orchestrator.addEventListener("click", (event) => {
        event.preventDefault()
        openDoc(plan.sessionUrl)
      })
      actions.append(orchestrator)
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
    root.append(header)

    const board = el("div", "agent-wf-board")
    stages(plan.steps).forEach((stage, i) => {
      const column = el("section", "agent-wf-stage")
      column.append(el("h3", null, i === 0 ? "Start" : `Stage ${i + 1}`))
      for (const step of stage) column.append(stepCard(step, derived.get(step.id)))
      board.append(column)
    })
    root.append(board)
  }

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
