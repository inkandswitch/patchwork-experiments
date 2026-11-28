/**
 * Turns and the blocks they hold: how each is made, and how to walk them.
 *
 * Every constructor returns a plain object with no `undefined` in it, ready to
 * be written into a document.
 */

import { Automerge } from "../host/modules.js"
import { CALL, WHERE, makeId } from "./schema.js"

const { ImmutableString } = Automerge

export function makeTurn(role, blocks = [], opts = {}) {
  return {
    id: opts.id ?? makeId("t"),
    role,
    at: opts.at ?? Date.now(),
    author: opts.author ?? null,
    blocks,
  }
}

export function textBlock(text, opts = {}) {
  return { type: "text", id: opts.id ?? makeId("b"), text }
}

/**
 * Something a person attached to a message: a document dropped in from the
 * sidebar, or an image pasted or dropped, kept as a file document. An image
 * also carries what the model is shown (`image`, a data URL fitted as a
 * screenshot is), so the request needs nothing but this document.
 */
export function attachmentBlock({ url, name = null, docType = null, mimeType = null, image = null }, opts = {}) {
  return { type: "attachment", id: opts.id ?? makeId("b"), url: String(url), name, docType, mimeType, image: image ? frozen(image) : null }
}

/**
 * What the person had in front of them when they spoke.
 *
 * An ambient session is about no one document: it is summoned from anywhere,
 * and "this" means whatever was focused at the moment of asking — which is
 * different on every message. So each message carries its own snapshot, kept
 * in the transcript beside the words it explains, rather than a live value the
 * runner reads later and that has moved on by the time the model is called.
 *
 * `views` are `{ url, title, toolId }`; every field is present (null when
 * unknown) because automerge will not store `undefined`.
 */
export function contextBlock({ focused = null, open = [] } = {}, opts = {}) {
  const view = (v) => ({ url: String(v.url), title: v.title ?? null, toolId: v.toolId ?? null })
  return {
    type: "context",
    id: opts.id ?? makeId("b"),
    focused: focused?.url ? view(focused) : null,
    open: (open ?? []).filter((v) => v?.url && v.url !== focused?.url).map(view),
  }
}

/** A context block as the model reads it. */
export function describeContext(block) {
  const line = (v) => {
    const name = v.title ? `"${v.title}"` : "untitled"
    return `${name} — ${v.url}${v.toolId ? ` (in ${v.toolId})` : ""}`
  }
  const lines = ["[Workspace when this message was sent]"]
  lines.push(block.focused ? `Focused: ${line(block.focused)}` : "Focused: nothing")
  if (block.open?.length) {
    lines.push("Also open:")
    for (const v of block.open) lines.push(`- ${line(v)}`)
  }
  return lines.join("\n")
}

/**
 * Something a tool noticed after its call was over: `source` is the tool id,
 * `label` what it was watching, `count` how many notices were folded into it.
 */
export function eventBlock(source, text, opts = {}) {
  return {
    type: "event",
    id: opts.id ?? makeId("b"),
    source: String(source),
    label: opts.label ?? null,
    text: String(text),
    count: opts.count ?? 1,
    at: opts.at ?? Date.now(),
  }
}

/** An event block as the model reads it. */
export function describeEvent(block) {
  const watching = block.label ? `, watching ${block.label}` : ""
  return `[Event from ${block.source}${watching}. Not a message from the user: you asked to be woken when this happened.]\n${block.text ?? ""}`
}

/**
 * Something the harness says, in a turn of its own: not the model's words and
 * not a person's. What code later needs to know about one is its `kind` and
 * `data`, never its wording.
 *
 * In an assistant-role turn a notice ends the run, and the session waits to
 * be spoken to (status.js STOP has the kinds, and `stopOf` reads them back).
 * In a user-role turn it asks the model to go on: "nudge" after a reply that
 * was cut off, went in circles or said nothing, "budget" when a budget is
 * lifted.
 */
export function noticeBlock(kind, text, data = null, opts = {}) {
  return { type: "notice", id: opts.id ?? makeId("b"), kind: String(kind), text: String(text), data: data ?? null }
}

/** A notice as the model reads it: flagged, where it stands among the model's own turns. */
export function describeNotice(block, role) {
  return role === "assistant" ? `⚠ ${block.text ?? ""}` : (block.text ?? "")
}

export function reasoningBlock(text, opts = {}) {
  return { type: "reasoning", id: opts.id ?? makeId("b"), text }
}

export function callBlock(tool, input, opts = {}) {
  return {
    type: "call",
    id: opts.id ?? makeId("c"),
    tool,
    input: input ?? {},
    where: opts.where ?? WHERE.worker,
    status: opts.status ?? CALL.pending,
    // What it asks of the person, for a call that waits on their yes (grants.js askOf).
    ask: opts.ask ?? null,
    // How it reads in the log, `{ verb, detail }`, when its tool says (kernel/tool.js presentCall).
    shown: opts.shown ?? null,
    runner: opts.runner ?? null,
  }
}

/**
 * A summary that supersedes the turns before it.
 *
 * Compaction here is non-destructive, which is the advantage of keeping the
 * transcript in a document: the superseded turns stay exactly where they are,
 * still readable in the panel and still in history. Only the *request* skips
 * them. Nothing is thrown away to save context.
 */
export function summaryBlock(text, upToTurnId, opts = {}) {
  return { type: "summary", id: opts.id ?? makeId("s"), text, upToTurnId }
}

/**
 * Content written to the document once and never edited again.
 *
 * A plain string in automerge is a text CRDT: per-character structure, so two
 * people can edit the same sentence and have it merge. A tool result is not
 * that. One runner writes it whole and nothing ever edits it — but it is by far
 * the largest thing in the document, carrying screenshots as data URLs and
 * fetched pages as text.
 *
 * Getting this wrong is not marginal. Measured on this version of automerge,
 * twelve 200kB screenshots — 2.4MB of real content — stored as plain strings:
 * 374MB resident, ~1s to write each, ~900ms to load. The same content as
 * ImmutableStrings: 9MB, 13ms, 14ms. Roughly 155 bytes of CRDT metadata per
 * character. That is the difference between a session that works and a tab that
 * runs the browser out of memory, which is what a session holding a few dozen
 * screenshots was doing.
 *
 * Readers coerce with String(), and toRequest hands plain strings to the
 * providers, so nothing downstream needs to know.
 */
const frozen = (text) => new ImmutableString(String(text))

/**
 * What a provider asks to have back, exactly as it gave it, the next time this
 * reply is sent: OpenAI's encrypted reasoning and message phases
 * (providers/chatgpt.js). Kept on the reply's turn, not as a block: it shows
 * nothing, and a version of the agent that does not know it sends the turn
 * from its blocks as before. Only the provider that wrote it reads it, and
 * only while it still describes the turn (chatgpt.js carryFits). Frozen, as
 * a result's output is: it is one opaque string, never edited.
 */
export function carryOf(providerId, data) {
  return { provider: String(providerId), data: frozen(JSON.stringify(data)) }
}

/** A turn's carry as its provider reads it, or null when there is none or it does not parse. */
export function readCarry(turn) {
  const carry = turn?.carry
  if (!carry?.provider || carry.data == null) return null
  try {
    return { provider: String(carry.provider), data: JSON.parse(String(carry.data)) }
  } catch {
    return null
  }
}

export function resultBlock(callId, output, opts = {}) {
  return {
    type: "result",
    id: opts.id ?? makeId("r"),
    callId,
    output: frozen(output ?? ""),
    isError: opts.isError ?? false,
    // A data URL, when the tool answered with a picture. The single biggest
    // thing in any session document, so it is stored frozen — see above.
    image: opts.image ? frozen(opts.image) : null,
    // { url, name, bytes, mimeType } when the tool put its content in a
    // document — a fetched page, an imported file — so the transcript can link
    // to it and a person can open it instead of reading a wall of text.
    doc: opts.doc ?? null,
    // { url, name, mimeType } when the tool handed the model a file to read
    // itself (a PDF). A reference: the bytes are loaded for each request,
    // so a datasheet never sits in this synced document.
    file: opts.file ?? null,
    // The tool's own one-line description of what it did. Computed once, when
    // the call runs, because the transcript needs it on every render and the
    // raw output's first line is a poor substitute (a JSON result renders as
    // the single character "{").
    summary: opts.summary ?? null,
    // What the call did, as plain data its tool gave for code to read
    // (kernel/tool.js runTool): a view opened, the plugins it used.
    facts: opts.facts ?? null,
    // True on a result written for a call whose own result may still arrive:
    // a runner's for a call it found cut off (INTERRUPTED), or one closed not
    // run by the message after a Stop (NOT_RUN, recovery.js speak). Where a
    // call has both, its own is what is sent and shown.
    placeholder: opts.placeholder ?? false,
  }
}

export function lastTurn(doc) {
  const turns = doc.turns ?? []
  return turns.length ? turns[turns.length - 1] : null
}

/** Every block in the session, flattened, with its position. */
export function* eachBlock(doc) {
  const turns = doc.turns ?? []
  for (let ti = 0; ti < turns.length; ti++) {
    const blocks = turns[ti].blocks ?? []
    for (let bi = 0; bi < blocks.length; bi++) {
      yield { turnIndex: ti, blockIndex: bi, turn: turns[ti], block: blocks[bi] }
    }
  }
}
