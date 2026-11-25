/**
 * A session's place in its workflow, shown in the session's own view.
 *
 * Three kinds of session have one (workflow/standing.js decides what each
 * means; this draws it and keeps it live):
 *
 *   a step         its step's state, kept up with the plan as it changes
 *   an orchestrator the workflow it started, at a glance
 *   a side thread  the step it is about, and how that step now stands
 *
 * For a step that is not running, it also draws the choice a message needs
 * before it is sent: ask in a side thread, or reopen the step with it.
 */

import { workflowOf } from "../workflow/plan.js"
import { stepStanding, planGlance, glanceText } from "../workflow/standing.js"
import { asideOf } from "../workflow/aside.js"
import { statusOf } from "../session/status.js"

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

/** What this session's place is read from: { role, planUrl, stepId, stepSessionUrl } or null. */
export function placeOf(doc) {
  const aside = asideOf(doc)
  if (aside?.planUrl) return { role: "aside", planUrl: aside.planUrl, stepId: aside.stepId, stepSessionUrl: aside.sessionUrl }
  const found = workflowOf(doc)
  if (!found) return null
  return found.role === "step" ? { role: "step", planUrl: found.url, stepId: found.stepId } : { role: "orchestrator", planUrl: found.url }
}

/**
 * Keep up with the plan this session belongs to. `onChange` is called when
 * the plan changes; `current()` says where the session stands now, or null
 * while the plan is not yet loaded or there is none.
 */
export function watchStanding({ repo, handle, onChange }) {
  let planUrl = null
  let plan = null
  let off = null
  let disposed = false

  function follow(url) {
    if (url === planUrl) return
    off?.()
    off = null
    plan = null
    planUrl = url
    if (!url || !repo) return
    Promise.resolve(repo.find(url))
      .then((h) => {
        if (disposed || planUrl !== url) return
        plan = h
        const changed = () => onChange()
        h.on("change", changed)
        off = () => h.off("change", changed)
        onChange()
      })
      .catch(() => {})
  }

  return {
    /** Read the session afresh: it may have become a step, or a side thread. */
    refresh(doc) {
      follow(placeOf(doc)?.planUrl ?? null)
    },
    current() {
      const doc = handle.doc()
      const place = placeOf(doc)
      const p = plan?.doc()
      if (!place || !p) return null
      if (place.role === "orchestrator") return { ...place, title: p.title ?? "Workflow", glance: planGlance(p) }
      const sessions = place.role === "step" ? { [handle.url]: doc ? statusOf(doc) : null } : {}
      const step = (p.steps ?? []).find((s) => s.id === place.stepId)
      return { ...place, title: p.title ?? "Workflow", stepTitle: step?.title ?? place.stepId, standing: stepStanding(p, place.stepId, sessions) }
    },
    planHandle: () => plan,
    dispose() {
      disposed = true
      off?.()
    },
  }
}

/** Draw the line under the header. */
export function renderStandingLine(line, now, { openDoc }) {
  line.replaceChildren()
  line.hidden = !now
  if (!now) return
  if (now.role === "orchestrator") {
    line.dataset.state = now.glance.status
    line.append(el("strong", null, `“${now.title}”`), el("span", null, glanceText(now.glance)))
    return
  }
  const s = now.standing
  line.dataset.state = s.state ?? "removed"
  if (now.role === "aside") {
    const back = el("a", "agent-standing-link", "the step's own thread")
    back.href = "#"
    back.dataset.docUrl = now.stepSessionUrl
    back.addEventListener("click", (event) => {
      event.preventDefault()
      openDoc(now.stepSessionUrl)
    })
    line.append(
      el("span", "agent-standing-chip", "side thread"),
      el("span", null, `A question about step “${now.stepTitle}” of “${now.title}”, which is now ${s.label}. Nothing here changes the step — `),
      back
    )
    return
  }
  line.append(el("span", "agent-standing-chip", s.label), el("span", null, `Step “${now.stepTitle}” of “${now.title}”`))
  if (s.run > 1) line.append(el("span", "agent-standing-run", `run ${s.run}`))
  if (s.detail) line.append(el("span", "agent-standing-detail", s.detail))
  if (s.plan) line.append(el("span", "agent-standing-plan", s.plan))
}

/** The composer's hint and placeholder for a step that takes no messages directly, or null. */
export function gateOf(now) {
  if (now?.role !== "step" || now.standing.steer) return null
  const s = now.standing
  return { reopen: s.reopen, later: s.later, label: s.label, placeholder: s.reopen ? `This step is ${s.label}: ask about it, or reopen it…` : `This step is ${s.label}: ask about it…` }
}

/**
 * The choice a message to a gated step needs, drawn into `row`. `pick` is
 * called with "ask", "reopen" or "reopen-later"; "cancel" puts things back.
 */
export function renderChoices(row, gate, { pick, attachments = false }) {
  row.replaceChildren()
  const button = (label, value, { primary = false, disabled = false, title = "" } = {}) => {
    const b = el("button", null, label)
    if (primary) b.dataset.variant = "primary"
    b.disabled = disabled
    if (title) b.title = title
    b.addEventListener("click", (event) => {
      event.preventDefault()
      pick(value)
    })
    return b
  }
  row.append(el("span", "agent-choices-say", `This step is ${gate.label}. Send this as:`))
  row.append(button("A question, in a side thread", "ask", { primary: true, title: "Asked of a copy of this conversation. The step and its result stay as they are." }))
  if (gate.reopen) {
    const why = attachments ? "Attachments go with a question only" : ""
    row.append(button("Reopen the step with it", "reopen", { disabled: attachments, title: why || "The step carries on in this conversation, told your message; its new result replaces the old one, and the steps that used it show as out of date." }))
    if (gate.later.length) {
      const n = gate.later.length
      row.append(button(`Reopen it and the ${n} step${n === 1 ? "" : "s"} after`, "reopen-later", { disabled: attachments, title: why || `Also reopens ${gate.later.join(", ")}, which are built on it.` }))
    }
  }
  row.append(button("Cancel", "cancel"))
}
