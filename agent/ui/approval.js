/**
 * A call waiting for a person's yes, and the answers they can give it.
 *
 * Two places ask. The call's own card in the transcript asks in full: what it
 * is about, its exact input, and every standing grant it can be given. A
 * waiting item — a workflow step's call answered from elsewhere: the
 * orchestrator's strip, the workflow board, the pop-over — asks in brief:
 * what it wants to do, and the two broadest grants. Both are one value,
 * `approvalOf`, drawn by one function, `drawApproval`.
 *
 * What a call asks was worked out when it was written and kept on it
 * (`call.ask`, session/grants.js); nothing here needs its tool.
 */

import { grantOffers } from "../session/grants.js"
import { describeCall } from "./calls.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const ALWAYS_ASKS = "This one asks every time — it can carry your credentials or change something at the other end."

/**
 * The card for a call waiting for approval, as data.
 *
 *   call     a call block, or a waiting item ({ tool, input, shown, ask })
 *   brief    the waiting item's form rather than the transcript's
 *   subject  the session's subject, which a brief description calls "this document"
 *
 * Returns { lines: [{ tag, className, text }], answers, scopes, note }, where
 * each answer and scope is { label, decision, variant, title } and `decision`
 * is what `decide` is given: "once", "deny" or { grant: key }.
 */
export function approvalOf(call, { brief = false, subject = null } = {}) {
  const offers = grantOffers(call).map((offer) => ({ label: offer.label, decision: { grant: offer.key }, variant: null, title: offer.detail }))
  const once = { label: "Allow once", decision: "once", variant: "primary", title: null }
  if (brief) {
    const { verb, detail } = describeCall({ tool: call.tool, input: call.input, shown: call.shown }, null, { subject })
    return {
      lines: [{ tag: "p", className: null, text: `Wants to ${verb}${detail ? ` ${detail}` : ""}` }],
      // The broader answers, as the call's own card offers them: this site,
      // any site. A grant releases every other call in the session it covers,
      // and a workflow spreads it to its other sessions (workflow/driver.js).
      answers: [once, ...offers.slice(-2).map((offer) => ({ ...offer, label: `Allow ${offer.label}` })), { label: "Deny", decision: "deny", variant: null, title: null }],
      scopes: [],
      note: null,
    }
  }
  // What the call is about, as it said when it was written (session/grants.js).
  const target = call.ask?.target ?? null
  return {
    lines: [
      { tag: "div", className: "agent-approval-title", text: `Run ${call.tool}?` },
      ...(target ? [{ tag: "div", className: "agent-approval-detail", text: `on ${String(target).replace(/^automerge:/, "doc ")}` }] : []),
      { tag: "div", className: "agent-approval-detail", text: JSON.stringify(call.input ?? {}, null, 2).slice(0, 600) },
    ],
    answers: [once, { label: "Deny", decision: "deny", variant: "danger", title: null }],
    // The standing grants, from narrowest to broadest. Answering every fetch
    // individually is what makes an agent tedious to work with, so the useful
    // scopes are one click away: this page, this section, this whole site.
    scopes: offers,
    // Offering a standing grant for a call that will ask again anyway is worse
    // than offering nothing: the grant would be kept and the call asked about
    // all the same. Say so instead. (grantOffers offers none for such a call.)
    note: call.ask?.always ? ALWAYS_ASKS : null,
  }
}

/**
 * Draw an approval. `decide(decision)` is called with the answer chosen.
 * Returns the nodes to put in a card, and `actions`, the row of answers, for
 * a card that has more to offer beside them.
 */
export function drawApproval(approval, decide) {
  const button = ({ label, decision, variant, title }) => {
    const b = el("button", null, label)
    if (variant) b.dataset.variant = variant
    if (title) b.title = title
    b.addEventListener("click", (event) => {
      event.preventDefault()
      decide(decision)
    })
    return b
  }
  const nodes = approval.lines.map(({ tag, className, text }) => el(tag, className, text))
  const actions = el("div", "cluster")
  actions.append(...approval.answers.map(button))
  nodes.push(actions)
  if (approval.note) nodes.push(el("div", "agent-approval-note", approval.note))
  else if (approval.scopes.length) {
    const scopes = el("div", "agent-approval-scopes")
    scopes.append(el("span", "agent-approval-label", "Always allow:"), ...approval.scopes.map(button))
    nodes.push(scopes)
  }
  return { nodes, actions }
}
