/**
 * Rendering the transcript.
 *
 * Built with DOM calls rather than innerHTML: every string here is model
 * output, tool output, or something a person typed, and none of it should ever
 * be parsed as markup. Prose goes through the markdown renderer, which keeps
 * that rule — see ui/markdown.js.
 *
 * The narrow column drives the decisions — a tool call is one line until you
 * open it, reasoning is a duration until you open it, and only prose,
 * pictures and approvals get full width.
 */

import { CALL, callTarget, grantOffers, questionOptions } from "../session.js"
import { renderMarkdown } from "./markdown.js"
import { describeCall } from "./calls.js"
import { renderCallBody } from "./bodies.js"

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

/**
 * The one-line description of a call.
 *
 * The table of per-tool verbs and details lives in ui/calls.js, which is pure
 * and has an entry for every tool. Kept as an export here because it is what
 * the tests and probes reach for.
 */
export function callSummary(block, result, subject = null) {
  return describeCall(block, result, { subject })
}

function renderCall(block, result, state, handlers) {
  const details = el("details", "agent-call")
  // A refusal is a decision, not a failure: `denied` keeps its own styling even
  // though its result is recorded as an error for the model's benefit.
  details.dataset.status = block.status === CALL.denied ? CALL.denied : result?.isError ? "error" : block.status
  details.open = state.open.has(block.id) || !!result?.isError

  details.addEventListener("toggle", () => {
    if (details.open) state.open.add(block.id)
    else state.open.delete(block.id)
  })

  const { verb, detail, note } = callSummary(block, result, state.subject)
  const summary = el("summary")
  summary.append(el("span", "agent-call-verb", verb))
  if (detail) summary.append(el("span", "agent-call-detail", detail))
  if (note) summary.append(el("span", "agent-call-detail", note))
  details.append(summary)

  details.append(renderCallBody(block, result))

  // Everything below lives OUTSIDE the <details>, because a collapsed call
  // hides it. That was a real bug for approvals: the card asking permission
  // rendered inside the disclosure, so the session looked stuck with no way to
  // unstick it — visible to a querySelector, invisible to a person. A picture
  // is the same argument in a smaller way; a screenshot the agent took to check
  // its work is the thing you most want to see without clicking.
  const attachments = []
  if (block.status === CALL.pending) attachments.push(renderApproval(block, handlers, state.subject))
  if (block.status === CALL.asking) attachments.push(renderQuestion(block, handlers))
  if (result?.image) attachments.push(renderImage(result.image, state))
  // What the call made or opened, live in the transcript when the host can
  // show it — a document in its tool, a package running, the agent's own
  // mount — and a chip that opens it elsewhere when it cannot.
  const view = handlers.view?.(block, result) ?? null
  if (view) attachments.push(view)
  else if (result?.doc) attachments.push(renderDocLink(result.doc, handlers))
  if (!attachments.length) return details

  const wrapper = el("div", "agent-call-group")
  wrapper.append(details, ...attachments)
  return wrapper
}

/**
 * A captured image, shown in the log rather than described in it.
 *
 * Small by default so a long session stays readable, and clicking it toggles
 * full width — the state lives in the same open-set as the disclosure
 * triangles, so a re-render does not close what you just opened.
 */
function renderImage(image_, state) {
  // Stored frozen (see resultBlock), so this is an ImmutableString off the
  // document and a plain string from a test or a fresh call.
  const dataUrl = String(image_ ?? "")
  const key = `image:${dataUrl.length}:${dataUrl.slice(-24)}`
  const figure = el("figure", "agent-shot")
  figure.dataset.size = state.open.has(key) ? "large" : "small"

  const image = el("img")
  image.src = dataUrl
  image.alt = "what the agent captured"
  image.loading = "lazy"
  figure.append(image)

  const caption = el("figcaption", null, state.open.has(key) ? "click to shrink" : "click to enlarge")
  figure.append(caption)

  figure.addEventListener("click", () => {
    const large = figure.dataset.size === "large"
    figure.dataset.size = large ? "small" : "large"
    caption.textContent = large ? "click to enlarge" : "click to shrink"
    if (large) state.open.delete(key)
    else state.open.add(key)
  })
  return figure
}

/** A link to the document a tool put its content in. */
function renderDocLink(ref, handlers) {
  const link = el("a", "agent-doc-chip")
  // A package is the thing you install; it should not look like a text file.
  link.dataset.kind = ref.kind ?? "document"
  link.setAttribute("role", "link")
  link.tabIndex = 0
  link.append(el("span", "agent-doc-chip-name", ref.name ?? "document"))
  if (ref.bytes) link.append(el("span", "agent-doc-chip-size", `${Math.round(ref.bytes / 1000)} kB`))
  const open = (event) => {
    event.preventDefault()
    handlers.openDoc?.(ref.url)
  }
  link.addEventListener("click", open)
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open(event)
  })
  return link
}

function renderApproval(block, handlers, subject) {
  const card = el("div", "agent-approval")
  // The tool knows what its call is about; the view only has the document, so
  // the host answers through a handler and the historical rule is the fallback.
  const { target, kind } = handlers.scopeOf?.(block) ?? { target: callTarget(block, subject), kind: "document" }
  card.append(el("div", "agent-approval-title", `Run ${block.tool}?`))
  if (target) {
    card.append(el("div", "agent-approval-detail", `on ${String(target).replace(/^automerge:/, "doc ")}`))
  }

  const detail = el("div", "agent-approval-detail")
  detail.textContent = JSON.stringify(block.input ?? {}, null, 2).slice(0, 600)
  card.append(detail)

  const button = (label, decision, { variant, title } = {}) => {
    const b = el("button", null, label)
    if (variant) b.dataset.variant = variant
    if (title) b.title = title
    b.addEventListener("click", (event) => {
      event.preventDefault()
      handlers.decide(block.id, decision)
    })
    return b
  }

  const row = el("div", "cluster")
  row.append(button("Allow once", "once", { variant: "primary" }), button("Deny", "deny", { variant: "danger" }))
  card.append(row)

  // Offering a standing grant for a call that will ask again anyway is worse
  // than offering nothing: a real session collected four http_request grants,
  // including "any site", and was asked eleven times regardless, because
  // alwaysAsk is checked before grants are. Say so instead.
  if (handlers.alwaysAsks?.(block)) {
    card.append(
      el(
        "div",
        "agent-approval-note",
        "This one asks every time — it can carry your credentials or change something at the other end."
      )
    )
    return card
  }

  // The standing grants, from narrowest to broadest. Answering every fetch
  // individually is what makes an agent tedious to work with, so the useful
  // scopes are one click away: this page, this section, this whole site.
  const scopes = el("div", "agent-approval-scopes")
  scopes.append(el("span", "agent-approval-label", "Always allow:"))
  for (const offer of grantOffers(block.tool, target, kind ?? "document")) {
    scopes.append(button(offer.label, { grant: offer.key }, { title: offer.detail }))
  }
  card.append(scopes)
  return card
}

/**
 * A question the agent asked, with its answers as buttons.
 *
 * Buttons AND a text box, always: the options are the agent's guess at what the
 * answers are, and being forced to pick one of three wrong ones is worse than
 * being asked in prose. Typing beats clicking when neither fits.
 */
function renderQuestion(block, handlers) {
  const card = el("div", "agent-question")
  const input = block.input ?? {}

  const heading = el("div", "agent-question-title")
  heading.append(renderMarkdown(input.question ?? "", { className: "agent-md" }))
  card.append(heading)

  if (input.context) {
    const context = el("div", "agent-question-context")
    context.append(renderMarkdown(input.context, { className: "agent-md" }))
    card.append(context)
  }

  const send = (text) => {
    const answer = String(text ?? "").trim()
    if (answer) handlers.answer?.(block.id, answer)
  }

  const options = questionOptions(block)
  if (options.length) {
    const row = el("div", "agent-question-options")
    for (const option of options) {
      const button = el("button", null, option.label)
      if (option.detail) button.title = option.detail
      button.addEventListener("click", (event) => {
        event.preventDefault()
        send(option.label)
      })
      row.append(button)
    }
    card.append(row)
  }

  const other = el("div", "agent-question-other")
  const field = document.createElement("input")
  field.type = "text"
  field.placeholder = options.length ? "or say something else…" : "your answer…"
  const submit = el("button", null, "Answer")
  submit.dataset.variant = "primary"

  const fromField = (event) => {
    event.preventDefault()
    send(field.value)
    field.value = ""
  }
  submit.addEventListener("click", fromField)
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") fromField(event)
  })

  other.append(field, submit)
  card.append(other)
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
  const body = el("div", "agent-reasoning-body")
  body.append(prose(block.text ?? ""))
  details.append(body)
  return details
}

/** Model and human prose, rendered as markdown inside a text container. */
function prose(text) {
  const node = el("div", "agent-text")
  node.append(renderMarkdown(text))
  return node
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
        if (block.type === "text") node.append(prose(block.text ?? ""))
      }
      container.append(node)
      continue
    }

    const node = el("div", "agent-turn")
    node.dataset.role = turn.role
    node.className = "agent-turn flow"

    for (const block of turn.blocks ?? []) {
      if (block.type === "text") {
        if (block.text) node.append(prose(block.text))
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
