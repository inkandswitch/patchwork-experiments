/**
 * A session document from version 1 to version 2, inside a change.
 *
 * Run once over the sessions that exist (migrate.mjs), then deleted: the
 * agent reads version 2 only (kernel/runner.js leaves anything else alone).
 *
 * What changed between the two:
 *
 *   status       gone. It is read off the document (session/status.js).
 *   halted       gone. A session is halted by a notice in its transcript.
 *   stopped      gone. A session out of budget says so in a notice.
 *   lease        one a workflow took to stop a step ("…-cancel") is dropped.
 *   "⚠ …" turns  what the harness said as the agent is a notice block.
 *   "(…)" turns  what it said as the person, to prompt the model, is one too.
 *   tools        `disabled` no longer lists the workflow tools: a step is
 *                not offered them because it is a step.
 */

const WORKFLOW_TOOLS = ["workflow_start", "workflow_add_steps", "workflow_edit_steps", "workflow_status", "workflow_stop", "workflow_reopen", "workflow_keep", "workflow_decide", "workflow_answer", "workflow_budget"]

/** What the harness said in a user-role turn, by how each began. */
const PROMPTS = [
  [/^\(Your previous message was cut off by the output limit/, "nudge"],
  [/^\(Your .* call was cut off before its arguments finished/, "nudge"],
  [/^\(You were repeating yourself, so your turn was stopped\.\)/, "nudge"],
  [/^\(You stopped without saying anything or calling a tool\.\)/, "nudge"],
  [/^\[Your budget is now \$[\d.]+\. Carry on from where you stopped\.\]$/, "budget"],
]

const BUDGET = /^Stopped: this session has spent its \$([\d.]+) budget \(\$([\d.]+)\)/

/** The one text block of a turn the harness wrote, or null: such a turn holds nothing else. */
function onlyText(turn) {
  const blocks = turn?.blocks ?? []
  return blocks.length === 1 && blocks[0].type === "text" ? String(blocks[0].text ?? "") : null
}

const notice = (block, kind, text, data = null) => {
  block.type = "notice"
  block.kind = kind
  block.text = text
  block.data = data
}

/** Returns whether the document was changed. */
export function migrateSession(doc, { now = Date.now() } = {}) {
  if (doc?.["@patchwork"]?.type !== "agent-session") return false
  if ((doc.schemaVersion ?? 1) >= 2) return false

  for (const turn of doc.turns ?? []) {
    const text = onlyText(turn)
    if (text === null) continue
    const block = turn.blocks[0]
    if (turn.role === "assistant" && text.startsWith("⚠ ")) {
      const said = text.slice(2)
      const budget = BUDGET.exec(said)
      if (budget) notice(block, "budget", said, { spent: Number(budget[2]), limit: Number(budget[1]) })
      else if (said.startsWith("Stopped while waiting for the network")) notice(block, "stopped", said)
      else notice(block, "error", said)
    } else if (turn.role === "user") {
      const found = PROMPTS.find(([pattern]) => pattern.test(text))
      if (found) notice(block, found[1], text)
    }
  }

  // Halted, and not spoken to since: the notice goes last, where the stop it
  // records is in force (session/status.js stopOf).
  if (doc.halted) {
    if (!doc.turns) doc.turns = []
    doc.turns.push({
      id: `t_migrated_${now.toString(36)}`,
      role: "assistant",
      at: doc.halted.at ?? now,
      author: null,
      blocks: [{ type: "notice", id: `b_migrated_${now.toString(36)}`, kind: "halted", text: String(doc.halted.reason ?? "Stopped by its workflow."), data: null }],
    })
  }
  if (doc.lease?.runner?.endsWith?.("-cancel")) doc.lease = null

  if (Array.isArray(doc.tools?.disabled)) {
    const kept = [...doc.tools.disabled].filter((id) => !WORKFLOW_TOOLS.includes(id))
    if (kept.length) doc.tools.disabled = kept
    else delete doc.tools.disabled
    if (!Object.keys(doc.tools).length) delete doc.tools
  }

  for (const key of ["status", "halted", "stopped"]) if (key in doc) delete doc[key]
  doc.schemaVersion = 2
  return true
}
