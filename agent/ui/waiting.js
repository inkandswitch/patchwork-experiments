/**
 * Steps waiting on you, shown where you are looking.
 *
 * A workflow's steps run in sessions nobody has open, so a permission one
 * needs or a question it asks would otherwise wait unseen. The orchestrator's
 * view lists them above its transcript (`watchWaiting` follows the workflows
 * the session started, down to their running steps), and the workflow view
 * shows them on the step's card. Either way they are answered right there:
 * the same decide/answerQuestion a step's own view would use.
 */

import { decide, answerQuestion } from "../kernel/loop.js"
import { grantOffers } from "../session/grants.js"
import { handleStore } from "../kernel/store.js"
import { describeCall } from "./calls.js"
import { waitingIn, budgetWaiting } from "../workflow/waiting.js"
import { STEP, RESUME_AMOUNTS, resumePlan, changePlan } from "../workflow/plan.js"
import { liftBudget, liftAmounts } from "../session/usage.js"
import { drivePlanHere } from "../runners/tab.js"


function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/**
 * Follow a session's workflows and their running steps.
 * `items()` is everything waiting now; `onChange` fires when that may differ.
 */
export function watchWaiting(repo, sessionHandle, onChange) {
  const watched = new Map() // url -> { handle, off }
  let disposed = false

  function watch(url) {
    if (!url || watched.has(url) || !repo) return
    const entry = { handle: null, off: () => {} }
    watched.set(url, entry)
    Promise.resolve(repo.find(url)).then(
      (handle) => {
        if (disposed) return
        entry.handle = handle
        const listener = () => { refresh(); onChange() }
        handle.on("change", listener)
        entry.off = () => handle.off("change", listener)
        refresh()
        onChange()
      },
      () => {}
    )
  }

  const plans = () =>
    (sessionHandle.doc()?.made ?? []).filter((m) => m.kind === "agent-workflow").map((m) => m.url)

  /** Start following anything new: a workflow just started, a step just begun. */
  function refresh() {
    for (const url of plans()) {
      watch(url)
      const plan = watched.get(url)?.handle?.doc()
      for (const step of plan?.steps ?? []) if (step.status === STEP.running) watch(step.sessionUrl)
    }
  }

  function items() {
    const out = []
    for (const url of plans()) {
      const plan = watched.get(url)?.handle?.doc()
      const budget = budgetWaiting(plan, url, watched.get(url)?.handle)
      if (budget) out.push({ ...budget, repo })
      for (const step of plan?.steps ?? []) {
        if (step.status !== STEP.running) continue
        const handle = watched.get(step.sessionUrl)?.handle
        for (const item of waitingIn(handle?.doc())) {
          out.push({ ...item, handle, planTitle: plan.title, stepId: step.id, stepTitle: step.title, sessionUrl: step.sessionUrl })
        }
      }
    }
    return out
  }

  refresh()
  return {
    items,
    refresh,
    dispose() {
      disposed = true
      for (const entry of watched.values()) entry.off()
      watched.clear()
    },
  }
}

/**
 * One waiting item, answerable in place.
 *
 *   item     from watchWaiting, or { ...waitingIn(doc)[i], handle, stepTitle, sessionUrl }
 *   onOpen   (url) => open the step's session
 */
export function renderWaitingItem(item, { onOpen = null, subject = null, splice = null, showStep = true } = {}) {
  const node = el("div", "agent-waiting-item")
  node.dataset.kind = item.kind
  const store = () => handleStore(item.handle, splice)

  if (item.kind === "budget" && item.scope === "session") return renderLiftItem(item, { onOpen, showStep, splice })
  if (item.kind === "budget") return renderBudgetItem(item, { onOpen, showStep })
  if (showStep) node.append(el("p", "agent-waiting-step", `${item.stepTitle}${item.planTitle ? ` · ${item.planTitle}` : ""}`))

  const actions = el("div", "cluster")
  if (item.kind === "approval") {
    const { verb, detail } = describeCall({ tool: item.tool, input: item.input, shown: item.shown }, null, { subject })
    node.append(el("p", null, `Wants to ${verb}${detail ? ` ${detail}` : ""}`))
    const allow = el("button", null, "Allow once")
    allow.dataset.variant = "primary"
    allow.addEventListener("click", (event) => {
      event.preventDefault()
      decide(store(), item.callId, "once")
    })
    const deny = el("button", null, "Deny")
    deny.addEventListener("click", (event) => {
      event.preventDefault()
      decide(store(), item.callId, "deny")
    })
    actions.append(allow)
    // The broader answers, as the call's own card offers them: this site, any
    // site. A grant releases every other call in the session it covers, and a
    // workflow spreads it to its other sessions (workflow/driver.js).
    for (const offer of grantOffers(item).slice(-2)) {
      const grant = el("button", null, `Allow ${offer.label}`)
      grant.title = offer.detail
      grant.addEventListener("click", (event) => {
        event.preventDefault()
        decide(store(), item.callId, { grant: offer.key })
      })
      actions.append(grant)
    }
    actions.append(deny)
  } else {
    node.append(el("p", "agent-waiting-question", item.question))
    for (const option of item.options ?? []) {
      const button = el("button", null, option.label)
      if (option.detail) button.title = option.detail
      button.addEventListener("click", (event) => {
        event.preventDefault()
        answerQuestion(store(), item.callId, option.label)
      })
      actions.append(button)
    }
    const input = document.createElement("input")
    input.type = "text"
    input.placeholder = "Answer…"
    const send = el("button", null, "Answer")
    const submit = () => {
      if (input.value.trim()) answerQuestion(store(), item.callId, input.value)
    }
    send.addEventListener("click", (event) => {
      event.preventDefault()
      submit()
    })
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        submit()
      }
    })
    actions.append(input, send)
  }
  if (onOpen && item.sessionUrl) {
    const open = el("button", null, "Open session")
    open.addEventListener("click", (event) => {
      event.preventDefault()
      onOpen(item.sessionUrl)
    })
    actions.append(open)
  }
  node.append(actions)
  return node
}

/**
 * A workflow paused for its budget: what it spent, what is waiting, and
 * Resume with a little more or a lot more. Resuming is a person's decision,
 * made here or in the workflow view; no agent tool can do it.
 */
export function renderBudgetItem(item, { onOpen = null, showStep = true } = {}) {
  const node = el("div", "agent-waiting-item")
  node.dataset.kind = "budget"
  if (showStep && item.planTitle) node.append(el("p", "agent-waiting-step", item.planTitle))
  node.append(el("p", null, describeBudget(item)))
  const actions = el("div", "cluster")
  for (const amount of RESUME_AMOUNTS) {
    const resume = el("button", null, `Resume with $${amount} more`)
    if (amount === RESUME_AMOUNTS[0]) resume.dataset.variant = "primary"
    resume.addEventListener("click", async (event) => {
      event.preventDefault()
      try {
        if (item.planHandle) changePlan(item.planHandle, (d) => resumePlan(d, amount))
      } catch (err) {
        // A plan of another version is left alone (workflow/plan.js writable), and says why.
        node.replaceChildren(el("p", null, err?.message ?? String(err)))
        return
      }
      // A driver must be running for anything to start: the plan view starts
      // one, and so does this, for a person who never opened it.
      if (item.repo && item.planUrl) {
        drivePlanHere(item.planUrl, { repo: item.repo }).catch(() => {})
      }
    })
    actions.append(resume)
  }
  if (onOpen && item.planUrl) {
    const open = el("button", null, "Open workflow")
    open.addEventListener("click", (event) => {
      event.preventDefault()
      onOpen(item.planUrl)
    })
    actions.append(open)
  }
  node.append(actions)
  return node
}

/**
 * A session — a workflow step, or any session given a budget — that stopped
 * for its budget: what it spent, and Give more, as a permission is answered.
 */
export function renderLiftItem(item, { onOpen = null, showStep = true, splice = null } = {}) {
  const node = el("div", "agent-waiting-item")
  node.dataset.kind = "budget"
  if (showStep && item.stepTitle) node.append(el("p", "agent-waiting-step", `${item.stepTitle}${item.planTitle ? ` · ${item.planTitle}` : ""}`))
  node.append(el("p", null, describeBudget(item)))
  const actions = el("div", "cluster")
  liftAmounts(item.limit).forEach((amount, i) => {
    const give = el("button", null, `Give $${amount.toFixed(2)} more`)
    if (i === 0) give.dataset.variant = "primary"
    give.addEventListener("click", (event) => {
      event.preventDefault()
      handleStore(item.handle, splice).change((d) => liftBudget(d, amount))
    })
    actions.append(give)
  })
  if (onOpen && item.sessionUrl) {
    const open = el("button", null, "Open session")
    open.addEventListener("click", (event) => {
      event.preventDefault()
      onOpen(item.sessionUrl)
    })
    actions.append(open)
  }
  node.append(actions)
  return node
}

/** One line on a spent budget: a session's, or a whole workflow's. */
export function describeBudget({ spent, limit, notStarted, stopped = 0, ask: askFor = null, scope }) {
  if (scope === "session") return `Spent its $${Number(limit).toFixed(2)} budget ($${Number(spent).toFixed(2)}) and stopped part-way. It carries on from there if it is given more.`

  const money = `$${Number(spent).toFixed(2)} of $${Number(limit).toFixed(2)}`
  const blocked = [
    notStarted ? `${notStarted} step${notStarted === 1 ? "" : "s"} waiting to start` : null,
    stopped ? `${stopped} stopped part-way` : null,
  ].filter(Boolean)
  const ask = askFor ? ` The orchestrator wants to give ${askFor.stepTitle ?? askFor.stepId} $${Number(askFor.need).toFixed(2)} more${askFor.why ? `: ${askFor.why}` : ""}.` : ""
  return `The workflow has spent its whole budget (${money}, orchestrator included), so ${blocked.join(" and ") || "nothing more can run"}.${ask} Resume raises the budget to what has been spent plus the amount you pick; the orchestrator then decides how to spend it.`
}

/** The strip above the orchestrator's transcript. Empty, it is hidden. */
export function renderWaiting(container, items, options = {}) {
  container.replaceChildren()
  container.hidden = !items.length
  if (!items.length) return
  container.append(el("p", "agent-waiting-title", `Waiting on you in workflow steps (${items.length})`))
  for (const item of items) container.append(renderWaitingItem(item, options))
}
