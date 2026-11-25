/**
 * Values: a nominal and bounds, either part optional, or text.
 *
 *   { nominal: 5.42, min: 5.12, max: 5.72 }   "5.42 ± 0.3"
 *   { max: 0.25 }                             "≤ 0.25": an upper bound and nothing else
 *   { min: 6000 }                             "≥ 6000"
 *   { nominal: 3.2, typ: true }               "Typical 3.2": spread unstated
 *   { min: 0.4, max: 1.4 }                    "0.4–1.4": no nominal anyone chose
 *   { nominal: 1000, exact: true }            a definition: no spread at all
 *   "REC 2Q"                                  text
 *
 * `dp` records the decimal places a source wrote, so a value shows the digits
 * its quote shows; `sf` records significant figures for a computed result.
 * Neither takes part in equality.
 *
 * A side that is missing is unbounded. A nominal without bounds and without
 * `exact` has an *unstated* spread: an unknown width, never treated as exact.
 * So every numeric value has two intervals:
 *
 *   sound    unstated sides are unbounded. Checks are decided on this one, so
 *            "holds" means it holds whatever the unstated spreads turn out to be.
 *   stated   unstated sides collapse to the nominal: the width the sources
 *            actually gave. A result's stated width is "at least this wide".
 *
 * Nothing in this file touches a document; Infinity never goes into one.
 */

export function isText(value) {
  return typeof value === "string"
}

export function isNumeric(value) {
  return value != null && typeof value === "object" && ("nominal" in value || "min" in value || "max" in value)
}

const finite = (n) => typeof n === "number" && Number.isFinite(n)

// ---------------------------------------------------------------- reading figures

const UPPER = /^(?:≤|<=|<|=<|max\.?|maximum|up to|at most|not more than|no more than)$/i
const LOWER = /^(?:≥|>=|>|=>|min\.?|minimum|at least|not less than|no less than)$/i
const TYP = /^(?:typ\.?|typical(?:ly)?|~|≈|approx\.?|approximately|about|nominal|nom\.?)$/i

const NUMBER = String.raw`[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?|[-+−]?\.\d+`
const PREFIX = String.raw`(≤|<=|=<|≥|>=|=>|<|>|~|≈|max\.?|maximum|min\.?|minimum|typ\.?|typical(?:ly)?|approx\.?|approximately|about|nominal|nom\.?|up to|at most|at least|not more than|no more than|not less than|no less than)`
// No bare "min" after a number: "30 min" is as often minutes as a minimum.
const SUFFIX = String.raw`(max\.?|maximum|minimum|typ\.?|typical|exact(?:ly)?)`
const SEP = String.raw`\s*(?:–|—|-|~|to|\.\.)\s*`
const TOL = String.raw`\s*(?:±|\+/-|\+-|\+\/−)\s*`

function toNumber(text) {
  return Number(String(text).replace(/−/g, "-").replace(/,(?=\d{3}\b)/g, ""))
}

/** Decimal places as written: "5.42" → 2, "6,000" → 0, "1e-3" → 3. */
export function decimalsOf(text) {
  const t = String(text).replace(/,(?=\d{3}\b)/g, "")
  const exp = t.match(/[eE]([-+]?\d+)$/)
  const mantissa = t.replace(/[eE][-+]?\d+$/, "")
  const dot = mantissa.indexOf(".")
  const dp = dot < 0 ? 0 : mantissa.length - dot - 1
  return Math.max(0, dp - (exp ? Number(exp[1]) : 0))
}

/**
 * Every figure written in a piece of text, with the shape its qualifiers
 * give it: [{ value, written: [numbers as written], index, text }].
 * "≤0.25 mΩ" reads as { max: 0.25 }; "5.42± 0.3 kg" as { nominal, min, max };
 * "0.4–1.4" as { min, max }; "3.2 V typ" as { nominal, typ }.
 */
export function readFigures(text) {
  const source = String(text ?? "").normalize("NFKC")
  const pattern = new RegExp(
    String.raw`(?:${PREFIX}\s*)?(${NUMBER})(?:(${TOL})(${NUMBER})|(${SEP})(${NUMBER})(?:\s*\((${NUMBER})\))?|\s*[A-Za-zΩµμ°%/·.²³]{0,8}\s*\((${NUMBER})${SEP}(${NUMBER})\))?(?:\s*[A-Za-zΩµμ°%/·.²³]{0,8}\s*${SUFFIX}\b)?`,
    "gi",
  )
  const out = []
  for (const m of source.matchAll(pattern)) {
    const [whole, prefix, first, , tol, sep, second, nominalText, boundLo, boundHi] = m
    const suffix = whole.match(new RegExp(String.raw`${SUFFIX}\s*$`, "i"))?.[1] ?? null
    // A range separator "-" glued to a number is as often a minus sign or a
    // hyphenated code ("LF280K-3"): only read it as a range with digits both sides.
    const value = {}
    const written = [first]
    const a = toNumber(first)
    if (tol != null) {
      const t = toNumber(tol)
      Object.assign(value, { nominal: a, min: round(a - t), max: round(a + t), dp: Math.max(decimalsOf(first), decimalsOf(tol)) })
      written.push(tol)
    } else if (boundLo != null) {
      // "5.42 (5.12–5.72)": a nominal with its bounds, the way the register writes one.
      const lo = toNumber(boundLo)
      const hi = toNumber(boundHi)
      if (lo > a || hi < a) continue
      Object.assign(value, { nominal: a, min: lo, max: hi, dp: Math.max(decimalsOf(first), decimalsOf(boundLo), decimalsOf(boundHi)) })
      written.push(boundLo, boundHi)
    } else if (second != null && sep != null) {
      const b = toNumber(second)
      if (b < a) continue
      Object.assign(value, { min: a, max: b, dp: Math.max(decimalsOf(first), decimalsOf(second)) })
      written.push(second)
      if (nominalText != null) {
        value.nominal = toNumber(nominalText)
        written.push(nominalText)
      }
    } else {
      const marker = prefix ?? suffix
      if (marker && UPPER.test(marker)) Object.assign(value, { max: a, dp: decimalsOf(first) })
      else if (marker && LOWER.test(marker)) Object.assign(value, { min: a, dp: decimalsOf(first) })
      else if (marker && /^exact/i.test(marker)) Object.assign(value, { nominal: a, exact: true, dp: decimalsOf(first) })
      else Object.assign(value, { nominal: a, dp: decimalsOf(first), ...(marker && TYP.test(marker) ? { typ: true } : {}) })
    }
    out.push({ value, written, index: m.index, text: whole.trim() })
  }
  return out
}

/** Floating-point noise off a computed bound: 5.42 - 0.3 is 5.12, not 5.119999999999999. */
function round(n) {
  return Number(n.toPrecision(12))
}

// ---------------------------------------------------------------- normalising

/**
 * Check and normalise a value as a person or a tool gave it. Returns
 * { value } or { problem }. Accepts a number, a figure written as text
 * ("5.42 ± 0.3", "≤ 0.25", "0.4–1.4 (0.9)", "3.2 typ"), an object
 * { nominal?, tol?, min?, max?, exact?, typ? }, or text that is not a figure.
 */
export function parseValue(raw) {
  if (raw == null || raw === "") return { problem: "A value is required." }
  if (typeof raw === "number") return finite(raw) ? { value: { nominal: raw, dp: decimalsOf(String(raw)) } } : { problem: "The value is not a finite number." }
  if (typeof raw === "string") {
    const text = raw.trim()
    const figures = readFigures(text)
    // A figure only if the text is that one figure (with a unit, perhaps):
    // "REC 2Q" and "LF280K" stay text.
    if (figures.length === 1 && figures[0].index === 0 && /^[\s\p{L}Ωµμ°%/·.²³]*$/u.test(text.slice(figures[0].text.length))) {
      return parseValue(figures[0].value)
    }
    return { value: text }
  }
  if (typeof raw === "object") {
    const pick = (key) => (raw[key] == null || raw[key] === "" ? undefined : Number(raw[key]))
    const nominal = pick("nominal")
    const tol = pick("tol")
    let min = pick("min")
    let max = pick("max")
    for (const [key, n] of Object.entries({ nominal, tol, min, max })) {
      if (n !== undefined && !finite(n)) return { problem: `${key} is not a finite number.` }
    }
    if (tol !== undefined) {
      if (nominal === undefined) return { problem: "A tolerance needs a nominal." }
      if (tol < 0) return { problem: "A tolerance is not negative." }
      if (min !== undefined || max !== undefined) return { problem: "Give a tolerance or bounds, not both." }
      min = round(nominal - tol)
      max = round(nominal + tol)
    }
    if (nominal === undefined && min === undefined && max === undefined) return { problem: "A value has a nominal, a min, or a max." }
    if (min !== undefined && max !== undefined && min > max) return { problem: `The bounds are upside down: min ${min} > max ${max}.` }
    if (nominal !== undefined && ((min !== undefined && nominal < min) || (max !== undefined && nominal > max))) {
      return { problem: `The nominal ${nominal} lies outside its bounds.` }
    }
    const value = {}
    if (nominal !== undefined) value.nominal = nominal
    if (min !== undefined) value.min = min
    if (max !== undefined) value.max = max
    // Bounds that pin the nominal exactly say it has no spread.
    if (nominal !== undefined && value.min === nominal && value.max === nominal) {
      delete value.min
      delete value.max
      value.exact = true
    }
    if (raw.exact) {
      if (nominal === undefined || min !== undefined || max !== undefined) return { problem: "Only a bare nominal can be exact." }
      value.exact = true
    }
    if (raw.typ && nominal !== undefined && !value.exact) value.typ = true
    // Precision as written: given, or the most decimals among the numbers as typed.
    if (raw.dp != null && Number.isInteger(Number(raw.dp))) value.dp = Number(raw.dp)
    else if (raw.sf == null) value.dp = Math.max(...[raw.nominal, raw.tol, raw.min, raw.max].filter((n) => n != null && n !== "").map((n) => decimalsOf(String(n))))
    if (raw.sf != null && Number.isInteger(Number(raw.sf))) value.sf = Number(raw.sf)
    return { value }
  }
  return { problem: "A value is a number, a figure such as '5.42 ± 0.3' or '≤ 0.25', bounds { nominal?, min?, max? }, or text." }
}

/** A value multiplied by a conversion factor (bounds swap if the factor is negative). */
export function scaleValue(value, factor = 1) {
  if (!isNumeric(value) || factor === 1) return value
  const out = {}
  const sf = sigFigsOf(value)
  if (sf != null && sf !== Infinity) out.sf = sf
  if (value.nominal !== undefined) out.nominal = round(value.nominal * factor)
  const lo = value.min !== undefined ? round(value.min * factor) : undefined
  const hi = value.max !== undefined ? round(value.max * factor) : undefined
  if (factor >= 0) {
    if (lo !== undefined) out.min = lo
    if (hi !== undefined) out.max = hi
  } else {
    if (hi !== undefined) out.min = hi
    if (lo !== undefined) out.max = lo
  }
  if (value.exact) out.exact = true
  if (value.typ) out.typ = true
  return out
}

/** A plain copy, holding only what equality looks at plus display precision. */
export function plainValue(value) {
  if (value == null) return null
  if (isText(value)) return value
  const out = {}
  for (const key of ["nominal", "min", "max", "exact", "typ", "dp", "sf"]) if (value[key] !== undefined && value[key] !== false) out[key] = value[key]
  return out
}

/** Equality of what a value says: text, or nominal, min, max and exact. Display precision is ignored. */
export function sameValue(a, b) {
  if (a == null || b == null) return a == null && b == null
  if (isText(a) || isText(b)) return a === b
  return a.nominal === b.nominal && a.min === b.min && a.max === b.max && Boolean(a.exact) === Boolean(b.exact)
}

/**
 * Has a value moved further than a relative tolerance? Each of nominal, min
 * and max is compared where both have it; one having a field the other
 * lacks is a move. Tolerance 0 means any change.
 */
export function moved(was, now, tolerance = 0) {
  if (was == null || now == null) return !(was == null && now == null)
  if (isText(was) || isText(now)) return was !== now
  for (const key of ["nominal", "min", "max"]) {
    const a = was[key]
    const b = now[key]
    if ((a === undefined) !== (b === undefined)) return true
    if (a === undefined) continue
    if (Math.abs(a - b) > tolerance * Math.max(Math.abs(a), Math.abs(b))) return true
  }
  return Boolean(was.exact) !== Boolean(now.exact)
}

// ---------------------------------------------------------------- intervals of a value

/** Which sides of a value's spread are unstated: "both", "lower", "upper" or null. */
export function unstatedSides(value) {
  if (!isNumeric(value) || value.nominal === undefined || value.exact) return null
  const lower = value.min === undefined
  const upper = value.max === undefined
  return lower && upper ? "both" : lower ? "lower" : upper ? "upper" : null
}

/** [lo, hi] with unstated sides unbounded. */
export function soundInterval(value) {
  if (!isNumeric(value)) return null
  const lo = value.min ?? (value.exact ? value.nominal : -Infinity)
  const hi = value.max ?? (value.exact ? value.nominal : Infinity)
  return [lo, hi]
}

/** [lo, hi] with unstated sides at the nominal: only the spread the sources stated. */
export function statedInterval(value) {
  if (!isNumeric(value)) return null
  const lo = value.min ?? value.nominal ?? -Infinity
  const hi = value.max ?? value.nominal ?? Infinity
  return [lo, hi]
}

/** Do two values' sound intervals overlap? Text overlaps only itself. */
export function overlaps(a, b) {
  if (isText(a) || isText(b)) return a === b
  const [alo, ahi] = soundInterval(a)
  const [blo, bhi] = soundInterval(b)
  return alo <= bhi && blo <= ahi
}

/** A value from computed parts; infinite sides are left out. */
export function valueFrom({ nominal, lo, hi, sf }) {
  const out = {}
  if (finite(nominal)) out.nominal = nominal
  if (finite(lo)) out.min = lo
  if (finite(hi)) out.max = hi
  if (finite(nominal) && lo === nominal && hi === nominal) {
    delete out.min
    delete out.max
    out.exact = true
  }
  if (sf != null) out.sf = sf
  return "nominal" in out || "min" in out || "max" in out ? out : null
}

// ---------------------------------------------------------------- writing values

/** A number at its written precision: decimal places if known, else significant figures, else up to 6 s.f. */
export function formatNumber(n, { dp, sf } = {}) {
  if (!finite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "—"
  if (dp != null) return n.toFixed(Math.min(dp, 12)).replace(/^-/, "−")
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return n.toExponential(Math.max(0, (sf ?? 4) - 1)).replace(/\.?0+e/, "e").replace(/^-/, "−")
  const text = sf != null ? Number(n.toPrecision(sf)).toString() : String(Number(n.toPrecision(6)))
  return text.replace(/^-/, "−")
}

function withUnit(text, unit) {
  return unit ? `${text} ${unit}` : text
}

/**
 * The value as it is written in a figure line: "5.42 kg", "≤ 0.25 mΩ",
 * "≥ 6000 cycle", "3.2 V typical", "0.4–1.4 L/Ah", "REC 2Q". The qualifier
 * is part of the number. Bounds around a nominal are written by formatBounds.
 */
export function formatValue(value, unit = "") {
  if (value == null) return "no value"
  if (!isText(value) && !isNumeric(value)) return "unbounded"
  if (isText(value)) return `"${value}"`
  const p = { dp: value.dp, sf: value.sf }
  const f = (n) => formatNumber(n, p)
  if (value.nominal !== undefined) return withUnit(f(value.nominal), unit) + (value.typ ? " typical" : "")
  if (value.min !== undefined && value.max !== undefined) return withUnit(`${f(value.min)}–${f(value.max)}`, unit)
  if (value.max !== undefined) return withUnit(`≤ ${f(value.max)}`, unit)
  return withUnit(`≥ ${f(value.min)}`, unit)
}

/**
 * What a figure line says about a nominal's spread: "(5.12–5.72)",
 * "(≥ 5.12, no upper bound)", "no bounds", "exact". Empty when the value
 * text already says it all (a range or a one-sided bound without a nominal).
 */
export function formatBounds(value) {
  if (!isNumeric(value) || value.nominal === undefined) return ""
  if (value.exact) return "exact"
  // Rounding must never make two different bounds read the same.
  const collapses = value.min !== undefined && value.max !== undefined && value.min !== value.max && formatNumber(value.min, value) === formatNumber(value.max, value)
  const p = collapses ? {} : { dp: value.dp, sf: value.sf }
  const f = (n) => formatNumber(n, p)
  if (value.min !== undefined && value.max !== undefined) return `(${f(value.min)}–${f(value.max)})`
  if (value.min !== undefined) return `(≥ ${f(value.min)}, no upper bound)`
  if (value.max !== undefined) return `(≤ ${f(value.max)}, no lower bound)`
  return "no bounds"
}

/** How the register read a figure: "upper bound 0.25 mΩ", "5.42 kg ± 0.3", "3.65 V, exact". */
export function describeReading(value, unit = "") {
  if (isText(value)) return `text "${value}"`
  const p = { dp: value.dp, sf: value.sf }
  const f = (n) => formatNumber(n, p)
  const u = unit ? ` ${unit}` : ""
  if (value.nominal === undefined) {
    if (value.min !== undefined && value.max !== undefined) return `range ${f(value.min)}–${f(value.max)}${u}`
    return value.max !== undefined ? `upper bound ${f(value.max)}${u}` : `lower bound ${f(value.min)}${u}`
  }
  if (value.exact) return `${f(value.nominal)}${u}, exact`
  const bounds = formatBounds(value)
  return `${f(value.nominal)}${u}${value.typ ? " typical" : ""}${bounds && bounds !== "no bounds" ? ` ${bounds}` : ", spread not stated"}`
}

/**
 * The canonical way to write an entry in a sentence: "9.59 kA (`pack_Isc_kA`)",
 * "≤ 0.25 mΩ (`cell_R_ac_mOhm`)". The prose check accepts exactly the numbers
 * this contains, so pasting it passes by construction.
 */
export function citeString(id, value, unit = "") {
  if (value == null) return `\`${id}\``
  return `${formatValue(value, unit)} (\`${id}\`)`
}

/** Significant figures a written or computed value carries, for the fewest-s.f. rule. */
export function sigFigsOf(value) {
  if (!isNumeric(value)) return null
  if (value.sf != null) return value.sf
  if (value.exact) return Infinity
  const n = value.nominal ?? value.max ?? value.min
  if (value.dp == null || !finite(n)) return null
  const digits = Math.abs(n).toFixed(value.dp).replace(".", "").replace(/^0+/, "")
  return Math.max(1, digits.length)
}
