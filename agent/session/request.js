/**
 * The request a provider is sent: a session's transcript in provider-neutral
 * form, with old results tapered and images and files limited.
 */

import { describeContext, describeEvent, describeNotice } from "./blocks.js"
import { CALL } from "./schema.js"
import { isInterruptedResult } from "./recovery.js"

/**
 * Build the provider-neutral request from the session.
 *
 * This is the one place the transcript becomes a model input, and it is
 * deliberately lossy in exactly two ways:
 *
 *   - reasoning blocks are dropped. Replaying another model's chain of thought
 *     back at it is not portable, and this transcript is model-agnostic by
 *     decision — a session can change models halfway through.
 *   - a call with no result yet becomes a result saying so, because a dangling
 *     tool call with no answer is a protocol error for most providers.
 */
/**
 * How many screenshots to carry in a request.
 *
 * Images are expensive on every subsequent turn, not just the one that took
 * them, so only the most recent few travel. Older ones keep their text and lose
 * the picture, with a note saying so — the agent can always take another.
 */
export const MAX_IMAGES_IN_REQUEST = 2

/**
 * Which large tool results still travel in full, and which go as a one-line
 * stand-in (taperedResult).
 *
 * A transcript is almost all tool results, and every one is re-sent on every
 * turn — measured, 97% of a real session's weight. So old large results are
 * shortened. But how they are shortened matters as much as how much:
 *
 *   - It used to keep only the newest 40,000 characters of large results.
 *     That is about four file reads: an agent working across a handful of
 *     files lost each one a few turns after reading it, recalled it, lost the
 *     recall, and recalled the recall — one real step read the same three files
 *     four to seven times each.
 *   - The line between kept and shortened moved on every turn, so the request
 *     changed in the middle on every turn, and prompt caching — which bills a
 *     repeated prefix at a tenth of the price — could never get past it.
 *
 * So results are now shortened in batches. Large results stay whole until they
 * pass HIGH characters in all; then the oldest are shortened, in one go, until
 * what stays whole is under LOW. Between batches nothing earlier in the
 * request changes. The decision is a fold over the results in order, so it
 * depends on nothing but the transcript, and a result once shortened stays
 * shortened (each prefix's choice is contained in the next one's).
 *
 * A small result always travels whole, and so does a pinned one (a result the
 * agent asked to have back).
 */
export const TAPER_ABOVE = 2000

export const RESULTS_HIGH = 160_000

export const RESULTS_LOW = 80_000

/** How much pinned text travels in full at most; past it, the oldest pins are let go. */
const PIN_BUDGET = 60_000

/**
 * Pin a result so it travels in full, inside a change. Pins are numbered in
 * order, and when what is pinned passes PIN_BUDGET the oldest are released —
 * so asking for things back never grows a conversation without bound.
 * Returns { pinned, released: [result ids] }.
 */
export function pinResult(doc, resultId, { budget = PIN_BUDGET } = {}) {
  const results = (doc.turns ?? []).flatMap((t) => (t.blocks ?? []).filter((b) => b.type === "result"))
  const target = results.find((b) => b.id === resultId)
  if (!target) return { pinned: false, released: [] }
  doc.pinSeq = (doc.pinSeq ?? 0) + 1
  target.pinned = doc.pinSeq
  const pins = results.filter((b) => b.pinned).sort((a, b) => a.pinned - b.pinned)
  let total = pins.reduce((sum, b) => sum + String(b.output ?? "").length, 0)
  const released = []
  for (const pin of pins) {
    if (total <= budget || pin === target) break
    delete pin.pinned
    total -= String(pin.output ?? "").length
    released.push(pin.id)
  }
  return { pinned: true, released }
}

export function resultsToKeepWhole(results, config = {}) {
  const taperAbove = config.taperAbove ?? TAPER_ABOVE
  const high = config.resultsHigh ?? RESULTS_HIGH
  const low = Math.min(config.resultsLow ?? RESULTS_LOW, high)
  const size = (block) => String(block.output ?? "").length

  const whole = [] // large results still whole, oldest first
  let wholeChars = 0
  const shortened = new Set()
  for (const block of results) {
    if (size(block) <= taperAbove || block.pinned) continue
    whole.push(block)
    wholeChars += size(block)
    if (wholeChars <= high) continue
    // A batch: down to LOW, but never the result just added — it is what the
    // agent asked for this turn.
    while (wholeChars > low && whole.length > 1) {
      const oldest = whole.shift()
      shortened.add(oldest.id)
      wholeChars -= size(oldest)
    }
  }

  const keep = new Set()
  for (const block of results) if (!shortened.has(block.id)) keep.add(block.id)
  return keep
}

/**
 * The stand-in for a result that is no longer carried in full.
 *
 * Has to say three things or it is worse than nothing: what the call was, that
 * this is an elision rather than the whole answer, and how to get the rest.
 */
export function taperedResult(block) {
  const size = String(block.output ?? "").length
  const what = block.summary || "an earlier tool result"
  // When the content is a kept source, reading it there is cheaper than
  // either route below, and its offsets are stable, so that comes first. Any
  // other document a call made is only pointed at.
  const url = block.doc?.url
  const saved = !url
    ? ""
    : block.doc.kind === "source"
      ? ` The content is kept at ${url}: read it with source_read {source:"${url}", offset:0}, or search it with find.`
      : ` It made ${url}.`
  // Two routes, and the difference between them matters: one is free and gives
  // exactly what this call said, the other does the work again and gives what
  // is true now.
  return (
    `[Not re-sent in full: ${what}. ${size} characters elided.${saved}` +
    ` Use session_recall with callId ${block.callId} for what it said,` +
    ` or make the call again for the current state.]`
  )
}

/**
 * What the model is told when a person refuses a call.
 *
 * A statement of fact, not an instruction. The policy — do not retry, say what
 * you wanted it for — belongs in the system prompt, where it is said once;
 * repeating it per denial per turn is what made the agent fixate on declining.
 */
export const DENIED_RESULT =
  "Declined by the user. Do not retry it. Carry on with everything that does not depend on it, and say in one line what you could not do."

/**
 * Mark the images a request would carry as refused by the provider, so no later
 * request carries them. The picture stays in the document — only the sending
 * stops; the agent can always take another.
 */
export function rejectSentImages(doc, { maxImages = MAX_IMAGES_IN_REQUEST } = {}) {
  const sent = []
  for (const turn of doc.turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if ((block.type === "result" || block.type === "attachment") && block.image && !block.imageRejected) sent.push(block)
    }
  }
  for (const block of sent.slice(-maxImages)) block.imageRejected = true
}

export function toRequest(doc, { system = "", maxImages = MAX_IMAGES_IN_REQUEST } = {}) {
  const messages = []
  const turns = doc.turns ?? []
  const confined = doc.scope != null

  // Find which result blocks still get to carry their image, and which calls
  // have an answer at all.
  const withImages = []
  const results = []
  const answered = new Set()
  const sent = theResultOfEachCall(turns)
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      // What a person attached shares the images-in-a-request budget with
      // screenshots: the newest are sent, older ones only named.
      if (block.type === "attachment") {
        if (block.image && !block.imageRejected) withImages.push(block.id)
        continue
      }
      if (block.type !== "result" || sent.get(block.callId) !== block.id) continue
      answered.add(block.callId)
      results.push(block)
      if (block.image && !block.imageRejected) withImages.push(block.id)
    }
  }
  const keepImages = new Set(withImages.slice(-maxImages))
  // Files handed to the model (a PDF a tool read, or one attached): only the
  // newest goes with a request; each can be read again on demand.
  const withFiles = []
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "result" && block.file?.url && sent.get(block.callId) === block.id) withFiles.push(block.id)
      if (block.type === "attachment" && isPdfAttachment(block)) withFiles.push(block.id)
    }
  }
  const keepFiles = new Set(withFiles.slice(-MAX_FILES_IN_REQUEST))
  const keepWhole = resultsToKeepWhole(results, doc.config ?? {})

  // A summary supersedes everything up to the turn it names. Only the most
  // recent one matters — an older summary is itself inside the range a newer
  // one covers.
  let startIndex = 0
  let summaryText = null
  for (let i = turns.length - 1; i >= 0 && summaryText === null; i--) {
    for (const block of turns[i].blocks ?? []) {
      if (block.type !== "summary") continue
      summaryText = block.text
      const supersededUpTo = turns.findIndex((t) => t.id === block.upToTurnId)
      startIndex = supersededUpTo >= 0 ? supersededUpTo + 1 : i + 1
      break
    }
  }

  if (summaryText) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: `[Summary of the earlier conversation]\n${summaryText}` }],
    })
  }

  for (const turn of turns.slice(startIndex)) {
    const content = []

    for (const block of turn.blocks ?? []) {
      if (block.type === "text") {
        if (block.text) content.push({ type: "text", text: block.text })
      } else if (block.type === "context") {
        // What a person had open is the names and URLs of their documents. A
        // research step must never hold those (kernel/scope.js), and the view adds
        // this note on its own, unasked, so it is not sent to one.
        if (!confined) content.push({ type: "text", text: describeContext(block) })
      } else if (block.type === "event") {
        content.push({ type: "text", text: describeEvent(block) })
      } else if (block.type === "notice") {
        content.push({ type: "text", text: describeNotice(block, turn.role) })
      } else if (block.type === "attachment") {
        const what = [block.docType, block.mimeType].filter(Boolean).join(", ")
        const shown = block.image && keepImages.has(block.id)
        content.push({
          type: "text",
          text: `[Attached: ${block.name ?? "a document"}${what ? ` (${what})` : ""} — ${block.url}${block.image && !shown ? "; an image, not re-sent — doc_read it to look again" : ""}]`,
        })
        if (shown) content.push({ type: "image", image: String(block.image) })
        if (isPdfAttachment(block)) {
          if (keepFiles.has(block.id)) content.push({ type: "file", url: block.url, name: block.name ?? "document.pdf", mimeType: "application/pdf" })
          else content.push({ type: "text", text: "[That PDF is not re-sent: doc_read it to read it again.]" })
        }
      } else if (block.type === "call") {
        content.push({ type: "call", id: block.id, name: block.tool, input: block.input ?? {} })
        // A denial is the call's RESULT, in the place the call happened.
        //
        // It used to be skipped here and re-announced as a trailing user
        // message instead — every denial in the conversation, re-sent on every
        // turn, appended after everything else. So the last thing the model read
        // before writing was "this was declined, ask what they would like
        // instead", N times over, and it did exactly that: reported the decline
        // again and again instead of getting on with the rest of the work.
        //
        // As a result it is stated once, in order, attached to the call it
        // belongs to — the same shape as every other outcome the model already
        // knows how to read.
        // Denials are recorded as results when they happen. Sessions from
        // before that still have bare denied calls, and a call with no result
        // is a protocol error for most providers, so synthesize one.
        if (block.status === CALL.denied && !answered.has(block.id)) {
          content.push({ type: "result", callId: block.id, output: DENIED_RESULT, isError: true })
        }
      } else if (block.type === "result") {
        // One result per call, whatever the document holds (theResultOfEachCall).
        if (sent.get(block.callId) !== block.id) continue
        const part = {
          type: "result",
          callId: block.callId,
          // Plain strings from here on. This is the boundary with the
          // providers, and an ImmutableString is not a string to a `typeof`
          // check or to JSON.stringify.
          output: keepWhole.has(block.id) ? String(block.output ?? "") : taperedResult(block),
          isError: !!block.isError,
        }
        if (block.file?.url) {
          if (keepFiles.has(block.id)) part.file = { url: block.file.url, name: block.file.name ?? null, mimeType: block.file.mimeType ?? null }
          else part.output = `${part.output}\n[The file is not re-sent: read it again if you need it.]`
        }
        if (block.image) {
          if (keepImages.has(block.id)) part.image = String(block.image)
          else part.output = `${part.output}\n[screenshot from earlier, not re-sent — take another if you need to look again]`
        }
        content.push(part)
      }
      // reasoning: intentionally dropped, see above
    }

    if (!content.length) continue
    messages.push({ role: turn.role, content })
  }

  return { system, messages }
}

/**
 * The one result each call is answered with in a request.
 *
 * A provider refuses a call with two results, and a document can hold two:
 * a runner taking a session over closes a call it thinks was cut off, while
 * the runner it displaced finishes the call and writes what it found; or two
 * runners each record a result before their writes meet. Both are writes to a
 * shared document, so nothing can stop them both landing. What is sent is
 * decided here instead: a real result over the takeover's "interrupted" note,
 * since it says what actually happened, and otherwise the first.
 * Returns callId -> the id of its result block.
 */
function theResultOfEachCall(turns) {
  const chosen = new Map()
  for (const turn of turns ?? []) {
    for (const block of turn.blocks ?? []) {
      if (block.type !== "result") continue
      const held = chosen.get(block.callId)
      if (!held || (isInterruptedResult(held) && !isInterruptedResult(block))) chosen.set(block.callId, block)
    }
  }
  // By id: a document hands out a fresh object for a block on every read.
  return new Map([...chosen].map(([callId, block]) => [callId, block.id]))
}

/** How many files (PDFs) go with one request: the newest. */
const MAX_FILES_IN_REQUEST = 1

function isPdfAttachment(block) {
  return /application\/pdf/i.test(String(block.mimeType ?? "")) || /\.pdf$/i.test(String(block.name ?? ""))
}

/**
 * Rough size of what would be sent, in tokens.
 *
 * Four characters per token is crude, but it is provider-neutral and free,
 * which a real tokenizer is neither. It only has to be good enough to decide
 * *when* to compact.
 */
export function estimateTokens(doc, system = "") {
  const request = toRequest(doc, { system })
  return Math.ceil((system.length + JSON.stringify(request.messages).length) / 4)
}
