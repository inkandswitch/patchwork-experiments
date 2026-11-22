/**
 * The prose check: does a line that cites an entry say the entry's number?
 *
 * For a prose line that cites an id, the numbers on that line are compared
 * with the entry's value, at the precision they're written to. A line that
 * cites two ids needs a match for each. The qualifier is part of the
 * number: a bare "0.25" doesn't match "≤ 0.25", and a range needs both
 * ends. So the cite string the register hands out ("≤ 0.25 mΩ (`id`)")
 * passes by construction, and the same string with its qualifier dropped
 * fails (tested over every value shape).
 *
 * Heuristic, so it only ever flags; it never stops anything.
 */

import { decimalsOf, isNumeric, readFigures } from "./values.js"

/** How far a written number may be from a value and still be that value, rounded. */
function tolerance(written) {
  const text = String(written).replace(/,(?=\d{3}\b)/g, "").replace(/^[-+−]/, "")
  const dp = decimalsOf(text)
  if (dp > 0 || /[eE]/.test(text)) return 0.5 * 10 ** -dp
  const zeros = text.match(/0*$/)[0].length
  return 0.5 * 10 ** Math.min(zeros, Math.max(0, text.length - 1))
}

const near = (written, n, v) => v !== undefined && Math.abs(n - v) <= tolerance(written) * (1 + 1e-9) + 1e-12

/** Does one figure on a line say this value? */
export function figureSays(figure, value) {
  if (!isNumeric(value)) return false
  const f = figure.value
  const w = figure.written
  const nominal = f.nominal !== undefined && f.min === undefined && f.max === undefined
  if (value.nominal === undefined) {
    if (value.min !== undefined && value.max !== undefined) return f.min !== undefined && f.max !== undefined && near(w[0], f.min, value.min) && near(w[1], f.max, value.max)
    if (value.max !== undefined) return f.nominal === undefined && f.min === undefined && f.max !== undefined && near(w[0], f.max, value.max)
    return f.nominal === undefined && f.max === undefined && f.min !== undefined && near(w[0], f.min, value.min)
  }
  if (f.nominal !== undefined && near(w[0], f.nominal, value.nominal)) return true
  if (f.min !== undefined && f.max !== undefined && f.nominal === undefined) return near(w[0], f.min, value.min) && near(w[1], f.max, value.max)
  if (!nominal && f.max !== undefined && f.min === undefined) return near(w[0], f.max, value.max)
  if (!nominal && f.min !== undefined && f.max === undefined) return near(w[0], f.min, value.min)
  return false
}

/** The figures on a line once ids and code spans are taken out (an id like h2_LFL has digits of its own). */
export function lineFigures(line) {
  const text = String(line ?? "").replace(/`[^`]*`/g, " ").replace(/\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g, " ")
  return readFigures(text)
}

/**
 * Check one line against the entries it cites. `cites` is [{ id, value }].
 * Returns the ids the line cites without saying their number, each with what
 * the line does say: [{ id, says: ["8.9", …] }].
 */
export function proseDisagreements(line, cites) {
  const figures = lineFigures(line)
  const out = []
  for (const { id, value } of cites) {
    if (!isNumeric(value)) continue
    if (figures.some((f) => figureSays(f, value))) continue
    out.push({ id, says: figures.map((f) => f.text) })
  }
  return out
}
