/**
 * The assumptions register: every number a task's models compute with, in one
 * place, each saying where it came from.
 *
 * Pure functions over the document — no repo, no DOM — so the view, the agent
 * tools and the tests all mean the same thing by "value", "stale" and "used".
 *
 * The document:
 *
 *   title      what the register is for
 *   scope      the folder whose documents use these entries (where-used and
 *              unbound-constant checks look there), or null
 *   entries    { [id]: Entry }
 *   variants   { [name]: { note, entries: { [id]: partial Entry } } } — an
 *              alternative world: "cold day", "2 mm aerogel", "gas at the
 *              high end". A variant overrides fields of base entries and may
 *              hold results of its own (results depend on the variant).
 *
 * An Entry:
 *
 *   label      a few words for a person
 *   unit       free text: "L/Ah", "W/m·K", "kg"
 *   value      a number, a range { min, max, nominal? }, or text (a part
 *              number, a chemistry)
 *   kind       fact        — about the world; the design does not control it
 *              decision    — a choice the design makes (barrier thickness)
 *              requirement — a limit the design must meet
 *              result      — produced by a model from other entries
 *   status     verified    — source + quote, and the quote was found in it
 *              cited       — has a source, quote not checked (or a web URL)
 *              estimated   — no source: an engineering estimate
 *              chosen      — a decision with no source
 *              derived     — a result
 *   source, quote, note
 *   inputs     (results) { [id]: the input's value when this was produced }
 *   by         (results) { name, url } of the model that produced it
 *   at         ISO time it was last set
 *
 * Ids are identifiers — `cell_vent_gas_L_per_Ah` — so that the same token
 * appears in Python, OpenSCAD, JSON and prose, and "where is this used" is a
 * word search that cannot miss a use. The part before the first underscore
 * groups entries in the view. `_min` and `_max` are reserved: a range exports
 * as `id_min` and `id_max` beside `id`.
 */

export const ASSUMPTIONS = "assumptions"

export const KINDS = ["fact", "decision", "requirement", "result"]
export const STATUSES = ["verified", "cited", "estimated", "chosen", "derived"]

const ID = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/

/** Why `id` cannot be an entry id, or null if it can. */
export function idProblem(id) {
  const text = String(id ?? "")
  if (!text) return "An id is required."
  if (text.length > 64) return `'${text}' is longer than 64 characters.`
  if (!ID.test(text)) {
    return `'${text}' is not a usable id: letters, digits and underscores, starting with a letter, with at least one underscore to group it (cell_capacity_Ah, barrier_k_W_mK).`
  }
  if (/_(min|max)$/.test(text)) return `'${text}' ends in _min or _max, which are kept for the two ends of a range.`
  return null
}

/** The group an id belongs to: its first segment. */
export function groupOf(id) {
  return String(id).split("_")[0]
}

// ---------------------------------------------------------------- values

/** Is this a range value? */
export function isRange(value) {
  return value != null && typeof value === "object" && "min" in value && "max" in value
}

/**
 * Check and normalise a value as given by a person or a tool. Returns
 * { value } or { problem }. Numbers given as numeric strings become numbers.
 */
export function parseValue(raw) {
  if (raw == null || raw === "") return { problem: "A value is required." }
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw } : { problem: "The value is not a finite number." }
  if (typeof raw === "string") {
    const text = raw.trim()
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return { value: Number(text) }
    // "0.4..1.4" or "0.4 – 1.4", optionally "(0.9)" for the nominal
    const range = text.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(?:\.\.|–|—|to)\s*([-+]?[\d.]+(?:e[-+]?\d+)?)(?:\s*\(\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*\))?$/i)
    if (range) return parseValue({ min: Number(range[1]), max: Number(range[2]), ...(range[3] != null ? { nominal: Number(range[3]) } : {}) })
    return { value: text }
  }
  if (typeof raw === "object" && "min" in raw && "max" in raw) {
    const min = Number(raw.min)
    const max = Number(raw.max)
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { problem: "A range needs numeric min and max." }
    if (min > max) return { problem: `The range is upside down: min ${min} > max ${max}.` }
    const out = { min, max }
    if (raw.nominal != null && raw.nominal !== "") {
      const nominal = Number(raw.nominal)
      if (!Number.isFinite(nominal)) return { problem: "The nominal value is not a number." }
      if (nominal < min || nominal > max) return { problem: `The nominal ${nominal} lies outside ${min}..${max}.` }
      out.nominal = nominal
    }
    return { value: out }
  }
  return { problem: "A value is a number, a range { min, max, nominal? }, or text." }
}

/** A value for reading: "0.4–1.4 (0.9) L/Ah". */
export function formatValue(value, unit) {
  let text
  if (value == null) text = "—"
  else if (isRange(value)) text = `${num(value.min)}–${num(value.max)}${value.nominal != null ? ` (${num(value.nominal)})` : ""}`
  else if (typeof value === "number") text = num(value)
  else text = String(value)
  return unit ? `${text} ${unit}` : text
}

function num(n) {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(3).replace(/\.?0+e/, "e")
  return String(Number(n.toPrecision(6)))
}

/** Structural equality for values (numbers, strings, ranges). */
export function sameValue(a, b) {
  if (isRange(a) || isRange(b)) {
    return isRange(a) && isRange(b) && a.min === b.min && a.max === b.max && (a.nominal ?? null) === (b.nominal ?? null)
  }
  return a === b
}

/** A plain copy of a value, safe to keep as a snapshot inside another entry. */
export function plainValue(value) {
  if (isRange(value)) return value.nominal != null ? { min: value.min, max: value.max, nominal: value.nominal } : { min: value.min, max: value.max }
  return value ?? null
}

// ---------------------------------------------------------------- status

/**
 * The status an entry has, from what it carries. Never taken on trust from
 * whoever wrote it: `quoteFound` is true only when the caller looked the quote
 * up in the source and found it.
 */
export function statusFor({ kind, source, quote }, { quoteFound = false } = {}) {
  if (kind === "result") return "derived"
  if (source && quote && quoteFound) return "verified"
  if (source) return "cited"
  return kind === "decision" ? "chosen" : "estimated"
}

/** Whitespace- and case-insensitive containment, the way citations are checked. */
export function quoteIn(text, quote) {
  const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  const needle = squash(quote)
  return needle.length > 0 && squash(text).includes(needle)
}

// ---------------------------------------------------------------- variants

/** The variant names, base first as null. */
export function variantNames(doc) {
  return Object.keys(doc?.variants ?? {})
}

/** One entry as it stands in a variant (null = base): base fields overridden by the variant's. */
export function resolveEntry(doc, id, variant = null) {
  const base = doc?.entries?.[id] ?? null
  const over = variant ? doc?.variants?.[variant]?.entries?.[id] ?? null : null
  if (!base && !over) return null
  return { ...(base ?? {}), ...(over ?? {}), id, overridden: Boolean(over) }
}

/** Every entry as it stands in a variant, sorted by id. */
export function resolveAll(doc, variant = null) {
  const ids = new Set(Object.keys(doc?.entries ?? {}))
  if (variant) for (const id of Object.keys(doc?.variants?.[variant]?.entries ?? {})) ids.add(id)
  return [...ids].sort().map((id) => resolveEntry(doc, id, variant))
}

// ---------------------------------------------------------------- staleness

/**
 * Which results are stale in a variant, and why.
 *
 * A result is stale when an input it was produced from is gone, has a
 * different value now, or is itself a stale result. Coupled models make
 * cycles (mass → drag → energy → battery → mass); a cycle is not stale in
 * itself — only a recorded input that disagrees with the current value is —
 * so the walk keeps a visited set and settles. Returns
 * Map<id, [{ input, reason }]>, with only the stale results in it.
 */
export function staleness(doc, variant = null) {
  const entries = new Map(resolveAll(doc, variant).map((e) => [e.id, e]))
  const direct = new Map()
  for (const entry of entries.values()) {
    if (entry.kind !== "result") continue
    const reasons = []
    for (const [input, recorded] of Object.entries(entry.inputs ?? {})) {
      const now = entries.get(input)
      if (!now) reasons.push({ input, reason: "gone" })
      else if (!sameValue(now.value, recorded)) reasons.push({ input, reason: "changed", was: recorded, now: now.value })
    }
    if (reasons.length) direct.set(entry.id, reasons)
  }

  // Propagate: a result that rests on a stale result is stale too. Monotone
  // over a finite set, so it reaches a fixed point.
  const stale = new Map(direct)
  let grew = true
  while (grew) {
    grew = false
    for (const entry of entries.values()) {
      if (entry.kind !== "result" || stale.has(entry.id)) continue
      const upstream = Object.keys(entry.inputs ?? {}).filter((input) => stale.has(input))
      if (upstream.length) {
        stale.set(entry.id, upstream.map((input) => ({ input, reason: "stale" })))
        grew = true
      }
    }
  }
  return stale
}

/** The entries whose value an entry's results were produced from, transitively — its trust base. */
export function trustBase(doc, id, variant = null) {
  const leaves = new Set()
  const seen = new Set()
  const walk = (at) => {
    if (seen.has(at)) return
    seen.add(at)
    const entry = resolveEntry(doc, at, variant)
    if (!entry) return
    if (entry.kind !== "result") return void leaves.add(at)
    for (const input of Object.keys(entry.inputs ?? {})) walk(input)
  }
  walk(id)
  return [...leaves].sort()
}

// ---------------------------------------------------------------- export

export const GENERATED_MARK = "GENERATED from assumptions register"

/** The names a value exports as, and their values. Text values export as strings. */
export function exportedNames(id, value) {
  if (isRange(value)) {
    const out = [[`${id}_min`, value.min], [`${id}_max`, value.max]]
    if (value.nominal != null) out.unshift([id, value.nominal])
    return out
  }
  return [[id, value]]
}

/**
 * The register as a file a model reads: JSON, Python or OpenSCAD. Each name
 * is the entry id (ranges add `_min`/`_max`; the bare id is the nominal, and
 * is left out when a range has none, so a model cannot silently read a
 * midpoint nobody chose).
 */
export function renderExport(doc, { format = "json", variant = null, registerUrl = "" } = {}) {
  const entries = resolveAll(doc, variant)
  const pairs = entries.flatMap((entry) => exportedNames(entry.id, plainValue(entry.value)).map(([name, value]) => ({ name, value, entry })))
  const where = `${registerUrl || "(this register)"}${variant ? `, variant "${variant}"` : ""}`
  const header = `${GENERATED_MARK} ${where}. Edit the register, not this file; export again after a change.`

  if (format === "json") {
    const values = Object.fromEntries(pairs.map(({ name, value }) => [name, value]))
    return JSON.stringify({ _generated: header, ...values }, null, 2) + "\n"
  }
  const literal = (value) => (typeof value === "string" ? JSON.stringify(value) : num(value))
  const comment = format === "python" ? "#" : "//"
  const lines = [`${comment} ${header}`]
  for (const { name, value, entry } of pairs) {
    const about = [entry.label, entry.unit && `[${entry.unit}]`, entry.status].filter(Boolean).join(" ")
    lines.push(`${name} = ${literal(value)}${format === "scad" ? ";" : ""}  ${comment} ${about}`)
  }
  return lines.join("\n") + "\n"
}

export const EXPORT_FORMATS = {
  json: { extension: "json", mimeType: "application/json" },
  python: { extension: "py", mimeType: "text/x-python" },
  scad: { extension: "scad", mimeType: "application/x-openscad" },
}

// ---------------------------------------------------------------- uses

/** Every exported name of every entry, mapped back to its id. */
export function nameIndex(doc) {
  const index = new Map()
  for (const id of Object.keys(doc?.entries ?? {})) {
    index.set(id, id)
    index.set(`${id}_min`, id)
    index.set(`${id}_max`, id)
  }
  for (const variant of Object.values(doc?.variants ?? {})) {
    for (const id of Object.keys(variant?.entries ?? {})) {
      index.set(id, id)
      index.set(`${id}_min`, id)
      index.set(`${id}_max`, id)
    }
  }
  return index
}

/**
 * Where entries are used in one text: Map<id, [{ line, text }]>. A use is the
 * id (or id_min / id_max) as a whole word, so `cell_mass_kg` does not match
 * inside `cell_mass_kg_total`.
 */
export function usesIn(text, index) {
  const found = new Map()
  const lines = String(text ?? "").split("\n")
  lines.forEach((line, i) => {
    for (const match of line.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
      const id = index.get(match[0])
      if (!id) continue
      const list = found.get(id) ?? []
      if (!list.length || list.at(-1).line !== i + 1) list.push({ line: i + 1, text: line.trim().slice(0, 160) })
      found.set(id, list)
    }
  })
  return found
}

/**
 * Numbers written straight into model code instead of read from the register:
 * `R_DC25 = 0.50e-3` in a notebook, `barrier = 3;` in OpenSCAD. Only plain
 * `name = <number>` assignments are flagged — a formula is the model's own
 * business, a bare constant is a world fact that has escaped the register.
 * Names the register exports are not flagged (they were pasted, but they
 * agree with the register by name; their value is checked by `driftIn`).
 */
export function unboundIn(text, index, { ignore = /^(i|j|k|n|_|dt|t|x|y|z)$/ } = {}) {
  const found = []
  const flag = (i, line, name, literal, comment) => {
    if (index.has(name) || ignore.test(name)) return
    if (Number(literal) === 0 || Number(literal) === 1) return // counters, flags, identities
    found.push({ line: i + 1, name, value: Number(literal), comment: (comment ?? "").trim(), text: line.trim().slice(0, 160) })
  }
  String(text ?? "").split("\n").forEach((line, i) => {
    const match = line.match(/^\s*(?:let\s+|const\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*;?\s*(?:(?:#|\/\/)(.*))?$/i)
    if (match) return flag(i, line, match[1], match[2], match[3])
    // A constants table in code — `"barrier_rho_kg_m3": 200.0,` in a Python
    // dict — is the same escape with different punctuation. Quoted keys only:
    // a bare `key: 2` is as often an option as a world fact.
    const comment = line.match(/(?:#|\/\/)(.*)$/)?.[1]
    for (const pair of line.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(?=[,}\s]|$)/gi)) {
      flag(i, line, pair[1], pair[2], comment)
    }
  })
  return found
}

/** Register names assigned a literal that disagrees with the register: a pasted copy that has drifted. */
export function driftIn(text, doc, variant = null) {
  const current = new Map()
  for (const entry of resolveAll(doc, variant)) {
    for (const [name, value] of exportedNames(entry.id, plainValue(entry.value))) current.set(name, { id: entry.id, value })
  }
  const found = []
  String(text ?? "").split("\n").forEach((line, i) => {
    const match = line.match(/^\s*(?:let\s+|const\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*;?/i)
    if (!match) return
    const known = current.get(match[1])
    if (known && typeof known.value === "number" && Number(match[2]) !== known.value) {
      found.push({ line: i + 1, name: match[1], id: known.id, written: Number(match[2]), register: known.value })
    }
  })
  return found
}
