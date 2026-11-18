/**
 * Citations: a claim tied to the place in a document it came from.
 *
 * A citation is an ordinary markdown link to the document, whose title is the
 * passage the claim rests on, word for word:
 *
 *     The pack is rated at 280 Ah [datasheet](automerge:abc "Rated capacity: 280Ah").
 *
 * Anything that renders markdown shows it as a link with the words on hover;
 * the transcript also checks that the words are really in that document, and
 * says so. A quote may skip what lies between two parts of a passage with an
 * ellipsis ("Rated capacity … at 0.2C"); the parts must appear in that order.
 *
 * What is compared is the text a person reads, not its spelling: case,
 * whitespace, typographic quotes and dashes, and markdown emphasis and link
 * syntax are set aside on both sides, so a quote of a heading or a bolded
 * figure matches. Nothing else is: a paraphrase is not a quote.
 */

import { readable } from "./tools/sources.js"

/** Shortest a quote may be, once normalised, to count as checking anything. */
export const MIN_QUOTE = 12

/** Characters read as another: typographic quotes, dashes and spaces as plain ones. */
const SAME_AS = new Map([
  ["‘", "'"], ["’", "'"], ["‚", "'"], ["‛", "'"], ["′", "'"],
  ["“", '"'], ["”", '"'], ["„", '"'], ["‟", '"'], ["″", '"'],
  ["‐", "-"], ["‑", "-"], ["‒", "-"], ["–", "-"], ["—", "-"], ["―", "-"], ["−", "-"],
  [" ", " "], [" ", " "], [" ", " "], [" ", " "], [" ", " "],
])

/** Markdown that is spelling, not text: emphasis and code marks. */
const MARKUP = new Set(["*", "_", "`"])

/**
 * Text as it reads, with a map back to where each of its characters came from.
 *
 *   { text, from }   from[i] is the offset in `source` of text[i]
 *
 * Link syntax keeps its words and drops its destination: `[words](url)` reads
 * as "words".
 */
export function normalise(source) {
  // Blank a link's brackets and destination where they stand, so its words
  // keep their offsets.
  const input = String(source ?? "").replace(/\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (whole, words) => `\u0000${words}${"\u0000".repeat(whole.length - words.length - 1)}`)
  let text = ""
  const from = []
  let space = true // at the start, as after a space: leading space is dropped
  for (let i = 0; i < input.length; i++) {
    let ch = input[i]
    if (ch === "\u0000" || MARKUP.has(ch)) continue
    ch = SAME_AS.get(ch) ?? ch
    if (/\s/.test(ch)) {
      if (space) continue
      space = true
      text += " "
      from.push(i)
      continue
    }
    space = false
    // Lower case can be longer than the letter ("İ"): every character of it maps back to i.
    for (const lower of ch.toLowerCase()) {
      text += lower
      from.push(i)
    }
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1)
    from.pop()
  }
  return { text, from }
}

/** A quote's parts: split at an ellipsis, each normalised, empty ones dropped. */
export function quoteParts(quote) {
  return String(quote ?? "")
    .split(/…|\.\.\.|\[\.\.\.\]|\[…\]/)
    .map((part) => normalise(part).text)
    .filter(Boolean)
}

/**
 * Where a quote is in a text: `{ at, end }` as offsets into the text itself, or
 * a reason it is not there.
 *
 *   { found: true, at, end }
 *   { found: false, reason: "short" | "missing", part? }
 *
 * Each part is looked for after the one before; the first occurrence that
 * lets the rest follow is the one reported, so it is the earliest place the
 * whole quote can be.
 */
export function locateQuote(text, quote) {
  const parts = quoteParts(quote)
  const length = parts.reduce((n, part) => n + part.length, 0)
  if (!parts.length || length < MIN_QUOTE) return { found: false, reason: "short" }
  const hay = normalise(text)

  // The first part's first occurrence is the earliest start, and the best one:
  // each later part is looked for as early as it can be, and a part missing
  // after an early position is missing after every later one.
  const start = hay.text.indexOf(parts[0])
  if (start < 0) return { found: false, reason: "missing", part: parts[0] }
  let at = start + parts[0].length
  for (const part of parts.slice(1)) {
    const next = hay.text.indexOf(part, at)
    if (next < 0) return { found: false, reason: "missing", part }
    at = next + part.length
  }
  return { found: true, at: hay.from[start], end: hay.from[at - 1] + 1 }
}

/**
 * The citations in a piece of markdown: every link to a document that carries
 * a quote as its title.
 *
 *   [{ label, url, quote }]
 */
export function citationsIn(markdown) {
  const out = []
  const pattern = /\[([^\]\n]*)\]\((automerge:[^)\s]+)\s+"([^"\n]+)"\)/g
  for (const match of String(markdown ?? "").matchAll(pattern)) out.push({ label: match[1], url: match[2], quote: match[3] })
  return out
}

/**
 * The text a document offers to be quoted from: a kept source's readable
 * text, a file's content, or else every string in it, one per line.
 */
export function quotableText(doc) {
  if (!doc) return null
  const kept = readable(doc)
  if (typeof kept === "string" && kept) return kept
  const strings = []
  const walk = (value, depth) => {
    if (depth > 12 || value == null) return
    if (typeof value === "string") strings.push(value)
    else if (typeof value?.toString === "function" && value.constructor?.name === "ImmutableString") strings.push(String(value))
    else if (Array.isArray(value)) for (const item of value) walk(item, depth + 1)
    else if (typeof value === "object" && !(value instanceof Uint8Array)) for (const [key, item] of Object.entries(value)) if (!key.startsWith("@")) walk(item, depth + 1)
  }
  walk(doc, 0)
  return strings.length ? strings.join("\n") : null
}

/**
 * Check one citation against its document.
 *
 *   { status: "found", at, end } | { status: "short" | "missing" | "unreadable", part? }
 *
 * `find` is how a document is loaded: (url) => Promise<doc | null>.
 */
export async function checkCitation({ url, quote }, find) {
  let doc
  try {
    doc = await find(url)
  } catch {
    doc = null
  }
  const text = quotableText(doc)
  if (text == null) return { status: "unreadable" }
  const located = locateQuote(text, quote)
  if (located.found) return { status: "found", at: located.at, end: located.end }
  return { status: located.reason, ...(located.part ? { part: located.part } : {}) }
}
