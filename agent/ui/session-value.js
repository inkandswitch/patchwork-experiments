/**
 * What the session view shows, as plain data.
 *
 * `sessionValue(doc, local)` is a pure function of the session document and
 * the few things only this view knows. Every decision about what the view
 * shows is made here; the DOM code that draws it (ui/session-view.js and the
 * pieces it connects) copies the value onto the page and decides nothing.
 *
 *   local = {
 *     mode          "full" | "panel"
 *     hasKey        a model key is stored for the session's provider
 *     keysSettled   the account's LLM settings have answered, or failed to
 *     runner        "worker" | "tab" | "pending": which runner this tab has
 *     elsewhere     another runner holds a live lease, as this tab judges it
 *                   (liveness is the observer's call, on its own clock)
 *     voiceStatus   what dictation is doing, or null when it is off
 *     place         where the session stands in its workflow (ui/standing.js
 *                   `current()`), or null
 *     waiting       what workflow steps wait on a person for (ui/waiting.js)
 *     subjectTitle  the subject document's title, null until it is known
 *     workflowTitle the workflow's title, null until it is known
 *   }
 */

import { STATUS, unknownBlocks, versionStanding } from "../session/schema.js"
import { callsAwaitingApproval, questionsAwaitingAnswer } from "../session/calls.js"
import { sessionTitle } from "../session/title.js"
import { formatCost } from "../session/usage.js"
import { statusOf } from "../session/status.js"
import { workflowOf } from "../workflow/plan.js"
import { waitingIn } from "../workflow/waiting.js"
import { gateOf } from "./standing.js"

export const PLACEHOLDER = "Ask for a change…"

/**
 * The hint line beside the composer: the first row that applies says it.
 *
 * Each row reads the hint's facts (`hintFacts`), not the document, so the
 * order is the whole of the decision and a test can walk it.
 */
export const HINTS = [
  // Dictation's status wins while it is on: it is what you are doing now.
  { name: "voice", when: (f) => f.voice != null, says: (f) => f.voice },
  // No runner takes a session of another version (kernel/runner.js turnFor),
  // so it must say why nothing happens in it.
  { name: "earlier", when: (f) => f.version === "earlier", says: () => "This session is from an earlier version of the agent and does not run. Start a new one to carry on." },
  { name: "outdated", when: (f) => f.outdated || f.version === "newer", says: () => "Waiting for a newer version of the agent: something in this session needs it" },
  { name: "no-key-elsewhere", when: (f) => !f.hasKey && f.elsewhere, says: () => "Running in another browser — this one has no API key" },
  { name: "no-key", when: (f) => !f.hasKey, says: () => "Add an API key to start" },
  { name: "asking", when: (f) => f.asking > 0, says: (f) => (f.asking === 1 ? "Waiting on your answer" : `Waiting on ${f.asking} answers`) },
  { name: "pending", when: (f) => f.pending > 0, says: (f) => `${f.pending} call${f.pending === 1 ? " needs" : "s need"} approval` },
  { name: "elsewhere", when: (f) => f.elsewhere, says: () => "Another runner is working on this session" },
  { name: "parked", when: (f) => f.status === STATUS.parked, says: () => "Waiting for a tab to run a page tool" },
  {
    name: "reconnecting",
    when: (f) => f.status === STATUS.reconnecting,
    says: (f) => `Waiting for the network — carries on when it is back (${f.reason ?? "no connection"})`,
  },
  { name: "running", when: (f) => f.status === STATUS.running, says: () => "Working… Enter to steer, Stop to interrupt" },
]

/** The facts the hint is decided from. */
export function hintFacts(doc, local) {
  return {
    voice: local.voiceStatus ?? null,
    version: versionStanding(doc),
    outdated: unknownBlocks(doc).length > 0,
    hasKey: !!local.hasKey,
    elsewhere: !!local.elsewhere,
    asking: questionsAwaitingAnswer(doc).length,
    pending: callsAwaitingApproval(doc).length,
    status: statusOf(doc),
    reason: doc.reconnecting?.reason ?? null,
  }
}

export function hintOf(facts) {
  return HINTS.find((row) => row.when(facts))?.says(facts) ?? ""
}

/**
 * The header's label: what this session IS, not what it is docked beside.
 *
 * Not the subject's title: in a sidebar that is the document you are already
 * looking at, and the one row of chrome the session gets would be spent
 * telling you something you can see. Once the agent names its own work, that
 * name belongs here; the subject is in the tooltip, which is where "and which
 * document is this about" belongs.
 */
function titleLine(doc, subjectTitle) {
  const named = sessionTitle(doc)
  if (named) return { text: named, tooltip: doc.subject && subjectTitle ? `${named} — on ${subjectTitle}` : named }
  if (doc.subject) return { text: subjectTitle ?? "Agent", tooltip: subjectTitle ? `on ${subjectTitle}` : "" }
  return { text: "Agent", tooltip: "" }
}

/** What this session has spent, as OpenRouter reports it, and how that was counted. */
function costLine(usage) {
  const text = formatCost(usage)
  if (!text) return null
  const cached = usage.cached ? ` (${usage.cached.toLocaleString("en")} from cache)` : ""
  const counted = usage.costEstimated ? "partly estimated from list prices" : "as charged by OpenRouter"
  return {
    text,
    tooltip: `${(usage.in ?? 0).toLocaleString("en")} tokens in${cached}, ${(usage.out ?? 0).toLocaleString("en")} out over ${usage.turns ?? 0} requests · ${counted}`,
  }
}

/** The workflow this session started, or is a step of: one click to its view. */
function workflowLink(doc, title) {
  const found = workflowOf(doc)
  if (!found) return null
  const step = found.role === "step"
  return {
    url: found.url,
    label: step ? "↑ Workflow" : "Workflow",
    tooltip: step
      ? title
        ? `Step ${found.stepId ?? ""} of “${title}” — open the workflow`
        : "Open the workflow this is a step of"
      : title
        ? `Open the workflow “${title}”`
        : "Open the workflow this session started",
  }
}

/**
 * The model, short, and the effort it runs at when one is set:
 * "~anthropic/claude-opus-latest" -> "claude-opus-latest".
 */
function modelLabel(config) {
  const effort = config?.params?.reasoning?.effort
  return (config?.model ?? "no model").split("/").pop() + (effort ? ` · ${effort}` : "")
}

/**
 * What the view shows:
 *
 *   runner        which runner this tab has, for the root's data-runner
 *   status        the session's status, for the dot and its tooltip
 *   title         { text, tooltip } for the header
 *   cost          { text, tooltip }, or null before anything is spent
 *   model         the model button's label
 *   workflow      { url, label, tooltip } of the workflow link, or null
 *   place         where the session stands in its workflow, for the standing line
 *   hint          the line beside the composer
 *   placeholder   the composer's
 *   gate          what a message to a step that is not running needs, or null
 *   canSend, canStop
 *   openSettings  the settings panel opens itself
 *   strip         waiting items for the strip above the transcript
 *   inline        { session, workflows }: spent budgets for the transcript's end
 *   side          the document the pop-out's second pane shows, or null
 */
export function sessionValue(doc, local) {
  const status = statusOf(doc)
  const gate = gateOf(local.place ?? null)
  const waiting = local.waiting ?? []
  return {
    runner: local.runner,
    status,
    title: titleLine(doc, local.subjectTitle ?? null),
    cost: costLine(doc.usage),
    model: modelLabel(doc.config),
    workflow: workflowLink(doc, local.workflowTitle ?? null),
    place: local.place ?? null,
    hint: hintOf(hintFacts(doc, local)),
    placeholder: gate?.placeholder ?? PLACEHOLDER,
    // A message to a step that is not running needs a choice before it goes.
    gate,
    canSend: !!local.hasKey,
    canStop: status === STATUS.running || status === STATUS.reconnecting,
    // Not before the account has had its say: the key is usually there, and
    // opening the panel only to have it found a moment later is just noise.
    openSettings: !!local.keysSettled && !local.hasKey && !doc.turns?.length,
    // What steps wait on a person for, above the transcript. A workflow's own
    // spent budget is answered inline in this conversation instead, with the
    // session's own: at the end of the transcript, as a permission is.
    strip: waiting.filter((item) => !(item.kind === "budget" && item.scope !== "session")),
    inline: {
      session: waitingIn(doc).filter((item) => item.kind === "budget"),
      workflows: waiting.filter((item) => item.kind === "budget" && item.scope !== "session"),
    },
    // The pop-out's second pane shows the subject document.
    side: local.mode === "full" ? (doc.subject ?? null) : null,
  }
}
