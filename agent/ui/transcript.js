/**
 * Rendering the transcript.
 *
 * Built with DOM calls rather than innerHTML: every string here is model
 * output, tool output, or something a person typed, and none of it should ever
 * be parsed as markup.
 *
 * The narrow column drives the decisions — a tool call is one line until you
 * open it, reasoning is a duration until you open it, and only prose and
 * approvals get full width.
 */

import { CALL, callTarget } from "../session.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** Map every result to the call it answers, so results render inside calls. */
function indexResults(doc) {
  const byCallId = new Map()
  for (const turn of doc.turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "result") byCallId.set(block.callId, block)
    }
  }
  return byCallId
}

const VERBS = {
  doc_read: "read",
  doc_edit: "edit",
  doc_create: "create",
  doc_history: "history",
  fs_list: "list",
  fs_read: "read",
  fs_grep: "grep",
  fs_write: "write",
  registry_list: "registry",
  plugin_source: "source",
  dom_snapshot: "look",
  web_search: "search",
  web_fetch: "fetch",
}

/** The one-line description of a call: a verb and the thing it acted on. */
export function callSummary(block, result) {
  const verb = VERBS[block.tool] ?? block.tool
  const input = block.input ?? {}
  const target =
    input.path && Array.isArray(input.path)
      ? `/${input.path.join("/")}`
      : input.path ?? input.pattern ?? input.datatype ?? input.selector ?? input.id ?? input.url ?? ""

  // A full automerge URL is 50 characters of base58 and tells a reader nothing.
  // The interesting part of a call is what it touched *within* the document.
  const detail = /^automerge:/.test(String(target))
    ? "this document"
    : String(target).slice(0, 60)

  if (block.status === CALL.running) return { verb, detail, note: "running…" }
  if (block.status === CALL.pending) return { verb, detail, note: "needs approval" }
  if (block.status === CALL.denied) return { verb, detail, note: "declined" }

  if (result?.isError) {
    const firstLine = String(result.output ?? "").split("\n")[0]
    return { verb, detail, note: firstLine.replace(/^Error:\s*/, "").slice(0, 80) }
  }
  if (result) {
    // Prefer the tool's own summary; fall back to the first line only for
    // results written before summaries were recorded.
    if (result.summary) return { verb, detail, note: result.summary }
    const firstLine = String(result.output ?? "").split("\n")[0]
    return { verb, detail, note: firstLine.slice(0, 60) }
  }
  return { verb, detail, note: "" }
}

function renderCall(block, result, state, handlers) {
  const details = el("details", "agent-call")
  details.dataset.status = result?.isError ? "error" : block.status
  details.open = state.open.has(block.id) || !!result?.isError

  details.addEventListener("toggle", () => {
    if (details.open) state.open.add(block.id)
    else state.open.delete(block.id)
  })

  const { verb, detail, note } = callSummary(block, result)
  const summary = el("summary")
  summary.append(el("span", "agent-call-verb", verb))
  if (detail) summary.append(el("span", "agent-call-detail", detail))
  if (note) summary.append(el("span", "agent-call-detail", note))
  details.append(summary)

  const body = el("pre")
  const input = JSON.stringify(block.input ?? {}, null, 2)
  body.textContent = result ? `${input}\n\n→\n${result.output ?? ""}` : input
  details.append(body)

  if (block.status === CALL.pending) details.append(renderApproval(block, handlers, state.subject))

  return details
}

function renderApproval(block, handlers, subject) {
  const card = el("div", "agent-approval")
  const target = callTarget(block, subject)
  card.append(el("div", "agent-approval-title", `Run ${block.tool}?`))
  if (target) {
    card.append(el("div", "agent-approval-detail", `on ${String(target).replace(/^automerge:/, "doc ")}`))
  }

  const detail = el("div", "agent-approval-detail")
  detail.textContent = JSON.stringify(block.input ?? {}, null, 2).slice(0, 600)
  card.append(detail)

  const row = el("div", "cluster")
  const button = (label, scope, variant) => {
    const b = el("button", null, label)
    if (variant) b.dataset.variant = variant
    b.addEventListener("click", (event) => {
      event.preventDefault()
      handlers.decide(block.id, scope)
    })
    return b
  }

  // "This session" used to mean "this tool, on anything". It now means this
  // tool on this document, and the label says so.
  row.append(
    button("Allow once", "once", "primary"),
    button(target ? "Always for this doc" : "This session", "session"),
    button("Deny", "deny", "danger")
  )
  card.append(row)
  return card
}

function renderReasoning(block, state) {
  const details = el("details", "agent-reasoning")
  details.open = state.open.has(block.id)
  details.addEventListener("toggle", () => {
    if (details.open) state.open.add(block.id)
    else state.open.delete(block.id)
  })

  const words = String(block.text ?? "").trim().split(/\s+/).filter(Boolean).length
  details.append(el("summary", null, `thought for ${words} word${words === 1 ? "" : "s"}`))
  details.append(el("div", "agent-reasoning-body", block.text ?? ""))
  return details
}

/**
 * Render the whole transcript into `container`.
 *
 * Scroll position is preserved unless the view was already pinned to the
 * bottom, in which case it follows the stream down — the behaviour you want
 * while watching and while reading back.
 */
export function renderTranscript(container, doc, state, handlers) {
  const pinnedToBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 60
  const previousScroll = container.scrollTop

  container.replaceChildren()

  const results = indexResults(doc)
  const turns = doc.turns ?? []

  if (!turns.length) {
    container.append(
      el(
        "div",
        "agent-empty",
        doc.subject
          ? "Ask for a change to this document, or a question about it."
          : "Ask a question, or point this session at a document."
      )
    )
    return
  }

  for (const turn of turns) {
    if (turn.role === "tool") continue // results render inside their call

    if (turn.role === "user") {
      const node = el("div", "agent-turn")
      node.dataset.role = "user"
      const author = state.names.get(turn.author)
      if (author) node.append(el("div", "agent-author", author))
      for (const block of turn.blocks ?? []) {
        if (block.type === "text") node.append(el("div", "agent-text", block.text ?? ""))
      }
      container.append(node)
      continue
    }

    const node = el("div", "agent-turn")
    node.dataset.role = turn.role
    node.className = "agent-turn flow"

    for (const block of turn.blocks ?? []) {
      if (block.type === "text") {
        if (block.text) node.append(el("div", "agent-text", block.text))
      } else if (block.type === "reasoning") {
        if (block.text) node.append(renderReasoning(block, state))
      } else if (block.type === "call") {
        node.append(renderCall(block, results.get(block.id), state, handlers))
      }
    }

    if (node.childElementCount) container.append(node)
  }

  container.scrollTop = pinnedToBottom ? container.scrollHeight : previousScroll
}
