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

import { decide, answerQuestion } from "../loop.js"
import { handleStore } from "../store.js"
import { describeCall } from "./calls.js"
import { waitingIn } from "../workflow/waiting.js"
import { STEP } from "../workflow/plan.js"

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

  if (showStep) node.append(el("p", "agent-waiting-step", `${item.stepTitle}${item.planTitle ? ` · ${item.planTitle}` : ""}`))

  const actions = el("div", "cluster")
  if (item.kind === "approval") {
    const { verb, detail } = describeCall({ tool: item.tool, input: item.input }, null, { subject })
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
    actions.append(allow, deny)
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

/** The strip above the orchestrator's transcript. Empty, it is hidden. */
export function renderWaiting(container, items, options = {}) {
  container.replaceChildren()
  container.hidden = !items.length
  if (!items.length) return
  container.append(el("p", "agent-waiting-title", `Waiting on you in workflow steps (${items.length})`))
  for (const item of items) container.append(renderWaitingItem(item, options))
}
