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
 *   grants       one value, `true`, where there were two that meant the
 *                same; and a grant on a target is kept under the group its
 *                tool is in ("web", "files"), where some were kept under the
 *                tool's own id.
 *
 *   results      the result a runner wrote for a call it found cut off says
 *                that it is one (`placeholder`), where it was told by its wording.
 *   denied calls a call a person refused has a result saying so, as every
 *                other outcome does. Some from long ago had none.
 *
 * A call that was waiting for approval keeps waiting, and can be allowed once
 * or denied. It does not say what it asks (a call block's `ask`, written with
 * the call from now on), so no grant is offered for it and none answers it.
 */

import { DENIED_RESULT } from "../session/request.js"
import { INTERRUPTED } from "../session/recovery.js"

/** The group each tool's grants on a target are kept under, for those in one. */
const GROUPS = { web_fetch: "web", web_search: "web", web_capture: "web", web_import: "web", http_request: "web", fs_write: "files", fs_edit: "files", fs_delete: "files", source_file: "files" }

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

  for (const turn of doc.turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "result" && block.summary === "interrupted" && String(block.output ?? "") === INTERRUPTED) block.placeholder = true
    }
  }

  // A refused call with no result gets the one a refusal writes, in a tool
  // turn right after the turn the call is in.
  const answered = new Set()
  for (const turn of doc.turns ?? []) for (const block of turn.blocks ?? []) if (block.type === "result") answered.add(block.callId)
  for (let i = (doc.turns ?? []).length - 1; i >= 0; i--) {
    const bare = (doc.turns[i].blocks ?? []).filter((block) => block.type === "call" && block.status === "denied" && !answered.has(block.id))
    if (!bare.length) continue
    const results = bare.map((call) => ({ type: "result", id: `r_migrated_${call.id}`, callId: call.id, output: DENIED_RESULT, isError: true, image: null, doc: null, file: null, summary: "declined" }))
    const next = doc.turns[i + 1]
    if (next?.role === "tool") next.blocks.push(...results)
    else doc.turns.splice(i + 1, 0, { id: `t_migrated_${doc.turns[i].id}`, role: "tool", at: doc.turns[i].at ?? now, author: null, blocks: results })
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

  for (const [key, held] of Object.entries(doc.grants ?? {})) {
    const at = key.indexOf("@")
    const group = at > 0 ? GROUPS[key.slice(0, at)] : null
    delete doc.grants[key]
    if (held) doc.grants[group ? `${group}${key.slice(at)}` : key] = true
  }

  for (const key of ["status", "halted", "stopped"]) if (key in doc) delete doc[key]
  doc.schemaVersion = 2
  return true
}
