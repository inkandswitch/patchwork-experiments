/**
 * Reading a claim against its quote and its source.
 *
 * Two checks, both made when a claim is set, and the claim is refused if
 * either fails:
 *
 *   in the source   the quote is in the kept document (whitespace and case
 *                   ignored). A web source that wasn't kept can't be checked,
 *                   and its claim stays unverified.
 *   in the quote    every number in the stated value is written in the quote,
 *                   and the register's reading of the quote doesn't contradict
 *                   the stated shape. A bare "0.25" stated against "≤0.25" is
 *                   taken as the bound the quote gives; a stated lower bound
 *                   against "≤0.25" is refused.
 *
 * The register keeps what it read: the shape (so the quote's "±" or "≤" can't
 * be dropped), its digits, the quote's context and the nearest heading mark.
 */

import { describeReading, isNumeric, isText, parseValue, readFigures } from "./values.js"

const squash = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()

/** Whitespace- and case-insensitive containment, the way quotes are checked. */
export function quoteIn(text, quote) {
  const needle = squash(quote)
  return needle.length > 0 && squash(text).includes(needle)
}

const FIELDS = ["nominal", "min", "max"]
const numbersOf = (v) => FIELDS.filter((k) => v[k] !== undefined).map((k) => v[k])

/**
 * Reconcile a stated value with what the quote says. Returns { value } (the
 * value to store, in the source's unit, with the quote's shape and digits)
 * or { problem }.
 */
export function readAgainstQuote(stated, quote) {
  const parsed = parseValue(stated)
  if (parsed.problem) return { problem: `stated: ${parsed.problem}` }
  const value = parsed.value
  if (!quote) return { value }
  if (isText(value)) {
    return squash(quote).includes(squash(value)) ? { value } : { problem: `"${value}" is not in the quote.` }
  }
  const figures = readFigures(quote)
  const wanted = numbersOf(value)
  const candidates = figures.filter((f) => wanted.every((n) => numbersOf(f.value).includes(n)))
  if (!candidates.length) {
    const seen = figures.map((f) => f.text).join(", ") || "no numbers"
    return { problem: `the stated ${wanted.join(" and ")} ${wanted.length === 1 ? "is" : "are"} not in the quote (it has ${seen}). Take the stated value from the quote.` }
  }
  // Prefer a figure with exactly the stated shape; else reconcile with the first.
  const exact = candidates.find((f) => FIELDS.every((k) => (f.value[k] === undefined) === (value[k] === undefined)))
  const figure = exact ?? candidates[0]
  const read = figure.value
  const statedShape = shapeOf(value)
  const readShape = shapeOf(read)
  if (exact) return { value: { ...read, ...(value.exact ? { exact: true } : {}), ...(value.typ || read.typ ? { typ: true } : {}) } }
  // A bare nominal: the quote's qualifier wins ("≤0.25" is an upper bound; "5.42 ± 0.3" keeps its spread).
  if (statedShape === "nominal" && (readShape === "upper" || readShape === "lower" || readShape === "nominal+bounds")) return { value: read }
  // A bare number in the quote doesn't contradict a stated bound: "Maximum pack
  // voltage 60 V" carries its qualifier in words the reader can't place.
  if (readShape === "nominal" && !read.typ && !read.exact && (statedShape === "upper" || statedShape === "lower")) return { value: { ...value, dp: read.dp } }
  return {
    problem: `the quote reads as ${describeReading(read)}, but the stated value is ${describeReading(value)}. State it the way the quote gives it.`,
  }
}

function shapeOf(v) {
  if (v.nominal !== undefined) return v.min !== undefined || v.max !== undefined ? "nominal+bounds" : "nominal"
  if (v.min !== undefined && v.max !== undefined) return "range"
  return v.max !== undefined ? "upper" : "lower"
}

/**
 * Where a quote sits in its source: about 200 characters either side, and
 * the nearest heading mark above it (a Markdown `#` line). Datasheets
 * converted from PDF often have weak headings; the context carries the
 * location when the heading can't.
 */
export function locate(sourceText, quote, { radius = 200 } = {}) {
  const text = String(sourceText ?? "")
  if (!text || !quote) return null
  // Find the quote allowing any run of whitespace between its words.
  const words = String(quote).normalize("NFKC").trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const match = new RegExp(words.join("\\s+"), "i").exec(text.normalize("NFKC"))
  if (!match) return null
  const start = match.index
  const end = start + match[0].length
  const before = text.slice(0, start)
  const heading = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1]?.trim() ?? null
  return {
    section: heading,
    context: { before: text.slice(Math.max(0, start - radius), start), quote: text.slice(start, end), after: text.slice(end, end + radius) },
  }
}

/**
 * Check one claim. `sourceText` is the kept document's text, or null when the
 * source is a web page that wasn't kept. Returns { claim } with `stated`,
 * `verified`, `reading`, `section` and `context` filled in, or { problem }.
 */
export function checkClaim(raw, { sourceText = null, unit = "" } = {}) {
  const quote = raw.quote ? String(raw.quote) : null
  if (sourceText != null && quote && !quoteIn(sourceText, quote)) {
    return { problem: `the quote is not in ${raw.source}. Quote it verbatim, as the source has it (a dozen words).` }
  }
  const read = readAgainstQuote(raw.stated, quote)
  if (read.problem) return { problem: read.problem }
  let stated = read.value
  if (raw.sourceKind === "definition" && isNumeric(stated) && stated.nominal !== undefined && stated.min === undefined && stated.max === undefined) {
    stated = { ...stated, exact: true }
    delete stated.typ
  }
  const where = sourceText != null && quote ? locate(sourceText, quote) : null
  return {
    claim: {
      stated,
      verified: Boolean(sourceText != null && quote),
      reading: describeReading(stated, raw.statedUnit ?? unit),
      section: where?.section ?? null,
      context: where?.context ?? null,
    },
  }
}
