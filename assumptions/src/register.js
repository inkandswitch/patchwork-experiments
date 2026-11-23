/**
 * The assumptions register: every number a task's models compute with, each
 * with exactly one basis that says where its value comes from.
 *
 * Pure functions over the document, so the view, the agent tools and the
 * tests all mean the same thing by "value", "support", "holds" and "stale".
 *
 * The document:
 *
 *   title, scope   what it's for; the task folder whose documents use it
 *   entries        { [id]: Entry }
 *   scan           the last where-used scan (where.js), or null
 *
 * An Entry, as people and tools write it:
 *
 *   label, unit, note
 *   kind        fact | decision | requirement | result
 *   basis       claims    value from the picked claim (or lowest / highest /
 *                         envelope of them)
 *               estimate  { value, reasoning }
 *               unknown   { range?, settle? }: a named gap, maybe with a range
 *               choice    { value, rationale, alternatives }
 *               formula   arithmetic over other entries
 *               model     { url, name, tolerance, inputs, value, ran, ranAt }:
 *                         an external model's output, with its inputs' values
 *                         and each document it read ({ [url]: { heads, code } })
 *                         recorded when the run was
 *               check     a predicate over entries, with `appliesIf`
 *   claims      [{ key, source, quote, stated, factor, subject, conditions,
 *                  sourceKind, origin, verified, reading, section, context, seen, lost, by, at }]
 *               seen: the kept source's { heads, text } its quote was last
 *               looked for in; lost: "missing" (not there any more) or
 *               "unavailable" (couldn't open it), else null
 *   pick        { rule: one | lowest | highest | envelope, claim, reason, considered }
 *   about       a decision's id: the claims' subjects must name its value
 *   use         { intent: model | reference | unused, note }
 *   judgements  [{ key, by, at, on, verdict, says, value, answer }]
 *
 * And as the register writes it back (materialize), so a consumer can read a
 * number without running any of this:
 *
 *   value       the value now: a Value, text, or null
 *   support     leaves: { level, conflicting, sources }
 *   derived     formula results: { how, inputs: { [id]: Value }, at }
 *   confidence  results: what the value rests on and what makes it wide
 *   outcome     requirements with a check
 *   stale       what moved under a result: an input, or the code of a document
 *               a model run read
 *
 * Formulas form a DAG (a cycle is refused); only model results close loops.
 * So evaluation always terminates, and staleness is a monotone fixed point.
 */

import { checkInterval, checkNominal, evalInterval, evalNominal, parse } from "./formula.js"
import { RANK, setAsideClaims, supportFor, weakest } from "./support.js"
import {
  isNumeric,
  isText,
  moved,
  plainValue,
  sameValue,
  scaleValue,
  sigFigsOf,
  soundInterval,
  statedInterval,
  unstatedSides,
  valueFrom,
} from "./values.js"

export const ASSUMPTIONS = "assumptions"
export const KINDS = ["fact", "decision", "requirement", "result"]
export const BASES = ["claims", "estimate", "unknown", "choice", "formula", "model", "check"]
export const USES = ["model", "reference", "unused"]
export const PICK_RULES = ["one", "lowest", "highest", "envelope"]

const ID = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/

/** Why `id` cannot be an entry id, or null if it can. */
export function idProblem(id) {
  const text = String(id ?? "")
  if (!text) return "An id is required."
  if (text.length > 64) return `'${text}' is longer than 64 characters.`
  if (!ID.test(text)) {
    return `'${text}' is not a usable id: letters, digits and underscores, starting with a letter, with at least one underscore to group it (cell_capacity_Ah, barrier_k_W_mK).`
  }
  return null
}

/**
 * Exported names two entries would both write: an entry's bounds export as
 * `id_min` and `id_max`, so `pack_V` and `pack_V_max` can't both be entries.
 * Returns Map<name, [ids]> of the clashes.
 */
export function nameClashes(entries) {
  const owners = new Map()
  for (const id of Object.keys(entries ?? {})) {
    for (const name of [id, `${id}_min`, `${id}_max`]) owners.set(name, [...(owners.get(name) ?? []), id])
  }
  return new Map([...owners].filter(([, ids]) => ids.length > 1))
}

/** The group an id belongs to: its first segment. */
export function groupOf(id) {
  return String(id).split("_")[0]
}

/** The kind an entry has by default for its basis. */
export function defaultKind(basis) {
  return basis === "choice" ? "decision" : basis === "check" ? "requirement" : basis === "formula" || basis === "model" ? "result" : "fact"
}

/** The use an entry is meant for when nobody said: requirements are context for prose, everything else is computed with. */
export function intendedUse(entry) {
  return entry?.use?.intent ?? (entry?.kind === "requirement" && entry?.basis !== "check" ? "reference" : "model")
}

// ---------------------------------------------------------------- claims

/** A claim's value in the entry's unit: as stated, times its factor. */
export function claimValue(claim) {
  return scaleValue(claim?.stated ?? null, Number(claim?.factor ?? 1))
}

/** Text form of a figure for subject matching and comparisons. */
const normal = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")

const representative = (v) => (isNumeric(v) ? v.nominal ?? v.min ?? v.max : NaN)

/**
 * The value a claims-basis entry takes from its claims. Claims a judgement
 * set aside don't take part. Returns { value, used: [keys], problem? }. With
 * claims that disagree and no pick, the value is their envelope, provisionally,
 * so nothing downstream stops; the problem says a pick is needed.
 */
export function pickValue(entry) {
  const judgedAside = new Set((entry.judgements ?? []).filter((j) => j.on && ["set-aside", "superseded", "not-applicable", "misread"].includes(j.verdict)).map((j) => j.on))
  const claims = (entry.claims ?? []).filter((c) => !judgedAside.has(c.key) && c.stated != null)
  if (!claims.length) return { value: null, used: [], problem: (entry.claims ?? []).length ? "every claim has been set aside" : "it has no claims" }
  const values = claims.map((c) => ({ key: c.key, value: claimValue(c) }))
  const allSame = values.every((v) => sameValue(v.value, values[0].value))
  const rule = entry.pick?.rule ?? (allSame ? "one" : null)
  if (rule === "one") {
    const key = entry.pick?.claim ?? (allSame ? values[0].key : null)
    const chosen = values.find((v) => v.key === key)
    if (chosen) return { value: chosen.value, used: [chosen.key] }
    if (allSame) return { value: values[0].value, used: values.map((v) => v.key) }
    return { ...envelope(values), problem: entry.pick?.claim ? `its picked claim ${entry.pick.claim} has been set aside` : "its claims disagree and none is picked" }
  }
  if (!rule) return { ...envelope(values), problem: "its claims disagree and none is picked" }
  if (values.some((v) => isText(v.value))) return { value: values[0].value, used: [values[0].key], problem: `'${rule}' needs numeric claims` }
  if (rule === "envelope") return envelope(values)
  const sorted = [...values].sort((a, b) => representative(a.value) - representative(b.value))
  const chosen = rule === "lowest" ? sorted[0] : sorted.at(-1)
  return { value: chosen.value, used: [chosen.key] }
}

function envelope(values) {
  const numeric = values.filter((v) => isNumeric(v.value))
  if (!numeric.length) return { value: values[0]?.value ?? null, used: values.map((v) => v.key) }
  const lows = numeric.map((v) => soundInterval(v.value)[0])
  const highs = numeric.map((v) => soundInterval(v.value)[1])
  const dp = Math.max(...numeric.map((v) => v.value.dp ?? 0))
  const bounds = valueFrom({ lo: Math.min(...lows), hi: Math.max(...highs) })
  return { value: bounds ? { ...bounds, dp } : null, used: numeric.map((v) => v.key) }
}

// ---------------------------------------------------------------- parsing every expression

function parseAll(entries) {
  const parsed = new Map()
  for (const [id, entry] of Object.entries(entries)) {
    const out = {}
    const attempt = (field, kind) => {
      if (!entry[field]) return
      try {
        const p = parse(entry[field])
        if (p.kind !== kind) throw new SyntaxError(kind === "number" ? "a formula is arithmetic, not a comparison" : "a check is a comparison, such as a <= b")
        out[field] = p
      } catch (error) {
        out.error = `${field}: ${error.message}`
      }
    }
    if (entry.basis === "formula") attempt("formula", "number")
    if (entry.basis === "check") {
      attempt("check", "boolean")
      if (!entry.check && !out.error) out.error = "check: a requirement checked by the register needs a check"
    }
    attempt("appliesIf", "boolean")
    parsed.set(id, out)
  }
  return parsed
}

/** The ids each entry reads: for formulas (value edges) and for everything (use edges). */
export function readsOf(entry, parsedEntry) {
  const ids = new Set()
  if (parsedEntry?.formula) for (const id of parsedEntry.formula.ids) ids.add(id)
  if (parsedEntry?.check) for (const id of parsedEntry.check.ids) ids.add(id)
  if (parsedEntry?.appliesIf) for (const id of parsedEntry.appliesIf.ids) ids.add(id)
  if (entry?.basis === "model") for (const id of Object.keys(entry.model?.inputs ?? {})) ids.add(id)
  if (entry?.about) ids.add(entry.about)
  return ids
}

/**
 * The formulas that would form a cycle: every id on one. A formula is on a
 * cycle exactly when its strongly connected component (over formula edges)
 * has more than one member, or it names itself (Tarjan's algorithm).
 */
export function formulaCycles(entries, parsed = parseAll(entries)) {
  const ids = Object.keys(entries).filter((id) => entries[id]?.basis === "formula").sort()
  const next = (id) => (parsed.get(id)?.formula?.ids ?? []).filter((n) => entries[n]?.basis === "formula")
  const index = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const onCycle = new Set()
  let counter = 0
  const connect = (id) => {
    index.set(id, counter)
    low.set(id, counter)
    counter++
    stack.push(id)
    onStack.add(id)
    for (const n of next(id)) {
      if (!index.has(n)) {
        connect(n)
        low.set(id, Math.min(low.get(id), low.get(n)))
      } else if (onStack.has(n)) low.set(id, Math.min(low.get(id), index.get(n)))
    }
    if (low.get(id) === index.get(id)) {
      const component = []
      let member
      do {
        member = stack.pop()
        onStack.delete(member)
        component.push(member)
      } while (member !== id)
      if (component.length > 1 || next(id).includes(id)) for (const m of component) onCycle.add(m)
    }
  }
  for (const id of ids) if (!index.has(id)) connect(id)
  return onCycle
}

// ---------------------------------------------------------------- evaluation

const WHOLE = [-Infinity, Infinity]

function leafEvaluation(id, entry) {
  const ev = { id, leaves: new Set([id]), unstated: new Set(), unknowns: new Set() }
  let value = null
  let claimValues = new Map()
  switch (entry.basis) {
    case "claims": {
      const picked = pickValue(entry)
      value = picked.value
      ev.used = picked.used
      if (picked.problem) ev.pickProblem = picked.problem
      claimValues = new Map((entry.claims ?? []).filter((c) => c.stated != null).map((c) => [c.key, claimValue(c)]))
      break
    }
    case "estimate":
      value = entry.estimate?.value ?? null
      break
    case "unknown":
      value = entry.unknown?.range ?? null
      ev.unknowns.add(id)
      break
    case "choice":
      value = entry.choice?.value ?? null
      if (isNumeric(value) && value.nominal !== undefined && value.min === undefined && value.max === undefined) value = { ...value, exact: true }
      break
    case "model":
      value = entry.model?.value ?? null
      break
  }
  ev.value = value == null ? null : plainValue(value)
  ev.text = isText(value)
  ev.nominal = isNumeric(value) ? value.nominal : undefined
  ev.sound = isNumeric(value) ? soundInterval(value) : value == null ? WHOLE : null
  ev.stated = isNumeric(value) ? statedInterval(value) : value == null ? WHOLE : null
  if (isNumeric(value) && unstatedSides(value)) ev.unstated.add(id)
  if (entry.basis !== "model") ev.support = supportFor(entry, ev.value, claimValues)
  return ev
}

function makeComputer(entries, parsed, cycles) {
  const evaluateWith = (overrides = null) => {
    const memo = new Map()
    const get = (id) => {
      if (memo.has(id)) return memo.get(id)
      const entry = entries[id]
      let ev
      if (!entry) ev = { id, missing: true, broken: `no entry '${id}'` }
      else if (overrides?.has(id)) ev = overrides.get(id)
      else if (entry.basis === "check") ev = { id, isCheck: true, leaves: new Set(), unstated: new Set(), unknowns: new Set() }
      else if (entry.basis === "formula") ev = formulaEvaluation(id, entry)
      else ev = leafEvaluation(id, entry)
      memo.set(id, ev)
      return ev
    }
    const formulaEvaluation = (id, entry) => {
      const p = parsed.get(id)
      const ev = { id, leaves: new Set(), unstated: new Set(), unknowns: new Set(), value: null, nominal: undefined, sound: null, stated: null }
      if (p?.error) return { ...ev, broken: p.error }
      if (cycles.has(id)) return { ...ev, broken: "its formula is part of a cycle" }
      const inputs = p.formula.ids.map(get)
      const bad = inputs.find((i) => i.broken || i.text || i.isCheck)
      if (bad) return { ...ev, broken: bad.isCheck ? `${bad.id} is a check, not a value` : bad.broken ? (bad.missing ? bad.broken : `${bad.id} has no value`) : `${bad.id} is text, not a number` }
      for (const input of inputs) {
        for (const leaf of input.leaves) ev.leaves.add(leaf)
        for (const leaf of input.unstated) ev.unstated.add(leaf)
        for (const leaf of input.unknowns) ev.unknowns.add(leaf)
      }
      ev.nominal = evalNominal(p.formula.ast, (i) => get(i).nominal)
      ev.sound = evalInterval(p.formula.ast, (i) => get(i).sound ?? WHOLE)
      ev.stated = evalInterval(p.formula.ast, (i) => get(i).stated ?? WHOLE)
      if ([...ev.sound, ...ev.stated].some(Number.isNaN)) return { ...ev, broken: "its inputs take it outside where it is defined (a square root or power of a negative number)" }
      const precision = precisionOf(p.formula.ast, get)
      ev.value = valueFrom({ nominal: ev.nominal, lo: ev.sound[0], hi: ev.sound[1], sf: precision?.sf })
      if (ev.value && precision?.dp != null) ev.value.dp = precision.dp
      return ev
    }
    return get
  }
  return evaluateWith
}

/**
 * How precisely a formula's result is known, by the hand-calculation rule:
 * sums and differences keep the fewest decimal places, products, quotients
 * and functions the fewest significant figures. Literals and exact values
 * don't limit it. Returns { dp } or { sf }, or null when nothing limits it,
 * or undefined when an input's precision is unknown.
 */
function precisionOf(node, get) {
  const magnitude = (n) => {
    const v = evalNominal(n, (i) => get(i).nominal ?? get(i).sound?.find(Number.isFinite))
    return v === undefined || v === 0 ? undefined : Math.floor(Math.log10(Math.abs(v)))
  }
  const asDp = (p, n) => (p == null ? p : p.dp != null ? p.dp : magnitude(n) === undefined ? undefined : p.sf - 1 - magnitude(n))
  const asSf = (p, n) => (p == null ? p : p.sf != null ? p.sf : magnitude(n) === undefined ? undefined : p.dp + magnitude(n) + 1)
  const min = (xs) => {
    if (xs.some((x) => x === undefined)) return undefined
    const known = xs.filter((x) => x != null)
    return known.length ? Math.min(...known) : null
  }
  switch (node.t) {
    case "num":
      return null
    case "id": {
      const v = get(node.id).value
      if (!isNumeric(v) || v.exact) return null
      if (v.dp != null) return { dp: v.dp }
      if (v.sf != null) return { sf: v.sf }
      return undefined
    }
    case "neg":
      return precisionOf(node.a, get)
    case "bin": {
      const a = precisionOf(node.a, get)
      const b = precisionOf(node.b, get)
      if (a === undefined || b === undefined) return undefined
      if (node.op === "+" || node.op === "-") {
        const dp = min([asDp(a, node.a), asDp(b, node.b)])
        return dp == null ? dp : dp >= 0 ? { dp } : { sf: Math.max(1, asSf({ dp }, node)) }
      }
      const sf = min([asSf(a, node.a), asSf(b, node.b)])
      return sf == null ? sf : { sf: Math.max(1, sf) }
    }
    case "call": {
      const ps = node.args.map((n) => precisionOf(n, get))
      if (ps.some((p) => p === undefined)) return undefined
      const sf = min(ps.map((p, i) => asSf(p, node.args[i])))
      return sf == null ? sf : { sf: Math.max(1, sf) }
    }
  }
  return undefined
}

/** A leaf pinned to one point, for "how much does this leaf matter". */
function pinned(ev) {
  const [lo, hi] = ev.sound ?? WHOLE
  const p = ev.nominal ?? (Number.isFinite(lo) && !Number.isFinite(hi) ? lo : !Number.isFinite(lo) && Number.isFinite(hi) ? hi : Number.isFinite(lo) && lo === hi ? lo : undefined)
  if (p === undefined) return null
  return { ...ev, nominal: p, sound: [p, p], stated: [p, p], unstated: new Set(), unknowns: new Set() }
}

const width = ([lo, hi]) => hi - lo

/** Why a leaf is uncertain, in words. */
function leafWhy(ev, entry) {
  if (entry?.basis === "unknown") return ev.value ? "is unknown (a range is given)" : "is unknown"
  if (ev.unstated?.size) return "has a spread nobody stated"
  const [lo, hi] = ev.sound ?? WHOLE
  if (!Number.isFinite(lo)) return "has no lower bound"
  if (!Number.isFinite(hi)) return "has no upper bound"
  if (entry?.basis === "estimate") return "is an estimate"
  if (entry?.basis === "model") return "is a model result"
  return `is ${ev.support?.level ?? "a value"}`
}

/**
 * Evaluate the whole register. Returns
 *
 *   byId      Map<id, evaluation>: value, nominal, sound, stated, leaves,
 *             support, confidence, outcome, stale, broken
 *   order     ids in derivation order (inputs before what is made from them)
 *   problems  [{ kind, id, text, fix }], in queue order
 *   judgements [{ id, judgement }] people's judgements nobody has answered
 *   readers   Map<id, Set<id>>: which entries read each id
 */
export function evaluate(doc) {
  const entries = doc?.entries ?? {}
  const parsed = parseAll(entries)
  const cycles = formulaCycles(entries, parsed)
  const evaluateWith = makeComputer(entries, parsed, cycles)
  const get = evaluateWith()
  const ids = Object.keys(entries).sort()
  const byId = new Map()
  for (const id of ids) byId.set(id, get(id))

  // Who reads whom.
  const readers = new Map(ids.map((id) => [id, new Set()]))
  for (const id of ids) for (const read of readsOf(entries[id], parsed.get(id))) readers.get(read)?.add(id)

  // Model results take the weakest support of what their inputs rest on.
  const levelOf = (id) => {
    const ev = byId.get(id)
    return ev?.support?.level ?? null
  }
  const modelLevel = (id, seen = new Set()) => {
    if (seen.has(id)) return null
    seen.add(id)
    const entry = entries[id]
    const levels = []
    for (const input of Object.keys(entry.model?.inputs ?? {})) {
      const ev = byId.get(input)
      if (!ev || ev.broken) continue
      if (entries[input]?.basis === "model") levels.push(modelLevel(input, seen))
      else for (const leaf of ev.leaves ?? []) levels.push(entries[leaf]?.basis === "model" ? modelLevel(leaf, seen) : levelOf(leaf))
    }
    return weakest(levels.filter(Boolean)) ?? "weak"
  }
  for (const id of ids) {
    if (entries[id].basis !== "model") continue
    const ev = byId.get(id)
    ev.support = { level: modelLevel(id), conflicting: false, conflicts: [], sources: 0 }
  }

  // Staleness: a model result whose recorded input moved beyond its
  // tolerance, or a document whose run read has different code now (by the
  // scan, once it is newer than the run), and everything that rests on a
  // stale entry.
  const stale = new Map()
  const scan = doc?.scan ?? null
  for (const id of ids) {
    const entry = entries[id]
    if (entry.basis !== "model") continue
    const reasons = []
    const tolerance = Number(entry.model?.tolerance ?? 0)
    for (const [input, recorded] of Object.entries(entry.model?.inputs ?? {})) {
      const now = byId.get(input)
      if (!now || now.missing) reasons.push({ input, reason: "gone" })
      else if (moved(recorded, now.value, tolerance)) reasons.push({ input, reason: "moved", was: recorded, now: now.value })
    }
    if (scan?.time && entry.model?.ranAt && scan.time >= entry.model.ranAt) {
      for (const [url, run] of Object.entries(entry.model?.ran ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const now = scan.docs?.[url]
        if (!now) continue
        if (now.missing) reasons.push({ doc: url, path: now.path || null, reason: "unavailable" })
        else if (now.code !== undefined && now.code !== run.code) reasons.push({ doc: url, path: now.path || null, reason: "changed" })
      }
    }
    if (reasons.length) stale.set(id, reasons)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const id of ids) {
      if (stale.has(id)) continue
      const upstream = [...readsOf(entries[id], parsed.get(id))].filter((input) => stale.has(input) && input !== entries[id].about)
      if (upstream.length) {
        stale.set(id, upstream.map((input) => ({ input, reason: "stale" })))
        grew = true
      }
    }
  }
  for (const [id, reasons] of stale) byId.get(id).stale = reasons

  // Results: support from their leaves, and what makes them wide.
  for (const id of ids) {
    const entry = entries[id]
    const ev = byId.get(id)
    if (entry.basis === "formula" && !ev.broken) {
      ev.support = { level: weakest([...ev.leaves].map((leaf) => byId.get(leaf)?.support?.level).filter(Boolean)) ?? "weak", conflicting: false, conflicts: [], sources: 0, derived: true }
      ev.confidence = confidenceOf(id, ev, { entries, byId, evaluateWith })
    } else if (entry.basis === "model") {
      ev.confidence = confidenceOf(id, ev, { entries, byId, evaluateWith })
    }
  }

  // Requirements.
  for (const id of ids) {
    const entry = entries[id]
    if (entry.basis !== "check") continue
    const ev = byId.get(id)
    ev.outcome = outcomeOf(id, parsed.get(id), { entries, byId, evaluateWith })
    // A requirement rests on what its inputs rest on.
    for (const name of [...(parsed.get(id)?.check?.ids ?? []), ...(parsed.get(id)?.appliesIf?.ids ?? [])]) {
      const input = byId.get(name)
      for (const leaf of input?.leaves ?? []) ev.leaves.add(leaf)
      for (const leaf of input?.unstated ?? []) ev.unstated.add(leaf)
      for (const leaf of input?.unknowns ?? []) ev.unknowns.add(leaf)
    }
  }

  const order = derivationOrder(ids, entries, parsed)
  const problems = problemsOf({ ids, entries, byId, parsed, order, scan })
  const judgements = []
  for (const id of ids) {
    for (const j of entries[id].judgements ?? []) {
      if (j.by?.kind === "person" && j.verdict !== "agrees" && !j.answer) judgements.push({ id, judgement: j })
    }
  }
  return { byId, order, problems, judgements, readers, parsed }
}

/** Inputs before what is made from them; ties by id. */
export function derivationOrder(ids, entries, parsed) {
  const done = new Set()
  const out = []
  const visit = (id, path = new Set()) => {
    if (done.has(id) || path.has(id) || !entries[id]) return
    path.add(id)
    const p = parsed.get(id)
    const deps = entries[id].basis === "model" ? Object.keys(entries[id].model?.inputs ?? {}) : [...readsOf(entries[id], p)]
    for (const dep of deps.sort()) visit(dep, path)
    path.delete(id)
    done.add(id)
    out.push(id)
  }
  for (const id of ids) visit(id)
  return out
}

function confidenceOf(id, ev, { entries, byId, evaluateWith }) {
  const leaves = [...ev.leaves].filter((leaf) => leaf !== id || entries[id].basis === "model")
  const restsOn = {}
  for (const leaf of leaves) {
    const level = byId.get(leaf)?.support?.level ?? "weak"
    restsOn[level] = (restsOn[level] ?? 0) + 1
  }
  const stated = ev.stated ?? WHOLE
  const total = width(stated)
  const contributions = []
  const unboundedBy = []
  if (entries[id].basis === "formula") {
    for (const leaf of leaves.slice(0, 32)) {
      const pin = pinned(byId.get(leaf))
      if (!pin) {
        unboundedBy.push(leaf)
        continue
      }
      const after = evaluateWith(new Map([[leaf, pin]]))(id)
      const w = width(after.stated ?? WHOLE)
      if (!Number.isFinite(total) && Number.isFinite(w)) unboundedBy.push(leaf)
      else if (Number.isFinite(total) && total > 0) contributions.push({ id: leaf, part: Math.max(0, total - w) })
    }
  }
  const sum = contributions.reduce((s, c) => s + c.part, 0)
  const shares = sum > 0
    ? contributions.filter((c) => c.part > 0).map((c) => ({ id: c.id, share: Number((c.part / sum).toFixed(3)) })).sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1)).slice(0, 6)
    : []
  return {
    level: ev.support?.level ?? "weak",
    restsOn,
    shares,
    unstated: [...ev.unstated].sort(),
    unknowns: [...ev.unknowns].sort(),
    unboundedBy: unboundedBy.sort(),
    stated: valueFrom({ lo: stated[0], hi: stated[1] }),
    atLeast: ev.unstated.size > 0 || ev.unknowns.size > 0,
  }
}

function outcomeOf(id, p, { entries, byId, evaluateWith }) {
  if (p?.error) return { result: "broken", why: p.error }
  const names = new Set([...p.check.ids, ...(p.appliesIf?.ids ?? [])])
  for (const name of names) {
    const ev = byId.get(name)
    if (!ev || ev.broken || ev.text || ev.isCheck) return { result: "broken", why: ev?.isCheck ? `${name} is a check, not a value` : ev?.broken ?? (ev?.text ? `${name} is text, not a number` : `no entry '${name}'`) }
  }
  const run = (get) => {
    const sound = (i) => get(i).sound ?? WHOLE
    const statedGet = (i) => get(i).stated ?? WHOLE
    const nominal = (i) => get(i).nominal
    const applies = p.appliesIf ? checkInterval(p.appliesIf.ast, sound) : "holds"
    return {
      applies,
      bounds: checkInterval(p.check.ast, sound),
      stated: checkInterval(p.check.ast, statedGet),
      nominal: checkNominal(p.check.ast, nominal),
      appliesNominal: p.appliesIf ? checkNominal(p.appliesIf.ast, nominal) : true,
      sides: p.check.ast.t === "cmp" ? sidesOf(p.check.ast, get) : null,
    }
  }
  const base = run((i) => byId.get(i))
  const out = {
    result: base.applies === "fails" ? "n/a" : base.bounds,
    nominal: base.appliesNominal === false ? "n/a" : base.nominal === null ? null : base.nominal ? "holds" : "fails",
    stated: base.applies === "fails" ? "n/a" : base.stated,
    applies: base.applies,
    op: p.check.ast.t === "cmp" ? p.check.ast.op : null,
    lhs: base.sides?.lhs ?? null,
    rhs: base.sides?.rhs ?? null,
    settle: [],
  }
  if (out.result !== "depends") return out

  // Which leaf would settle it: pin each in turn and see.
  const leaves = new Set()
  for (const name of p.check.ids) for (const leaf of byId.get(name)?.leaves ?? []) leaves.add(leaf)
  const side = out.op === "<" || out.op === "<=" ? "hi" : out.op === ">" || out.op === ">=" ? "lo" : null
  const before = base.sides?.diff ?? null
  const ranked = []
  for (const leaf of [...leaves].sort().slice(0, 32)) {
    const ev = byId.get(leaf)
    const pin = pinned(ev)
    const why = leafWhy(ev, entries[leaf])
    if (!pin) {
      ranked.push({ id: leaf, settles: null, gain: Infinity, why })
      continue
    }
    const get = evaluateWith(new Map([[leaf, pin]]))
    const after = run(get)
    const settles = after.applies !== "fails" && after.bounds !== "depends" ? after.bounds : null
    let gain = 0
    if (before && after.sides?.diff && side) {
      const [b, a] = side === "hi" ? [before[1], after.sides.diff[1]] : [-before[0], -after.sides.diff[0]]
      gain = !Number.isFinite(b) && Number.isFinite(a) ? Infinity : Number.isFinite(b - a) ? b - a : 0
    }
    ranked.push({ id: leaf, settles, gain, why })
  }
  ranked.sort((a, b) => (b.settles ? 1 : 0) - (a.settles ? 1 : 0) || b.gain - a.gain || (a.id < b.id ? -1 : 1))
  // No single leaf may settle it (two unbounded inputs, say): then name the
  // leaves whose own spread is open, which is where narrowing has to start.
  const helpful = ranked.filter((r) => r.settles || r.gain > 0)
  const open = ranked.filter((r) => {
    const [lo, hi] = byId.get(r.id)?.sound ?? WHOLE
    return !Number.isFinite(lo) || !Number.isFinite(hi)
  })
  out.settle = (helpful.length ? helpful : open).slice(0, 3).map(({ id: leaf, settles, why }) => ({ id: leaf, settles, why }))
  return out
}

function sidesOf(ast, get) {
  const side = (node) => ({
    nominal: evalNominal(node, (i) => get(i).nominal),
    sound: evalInterval(node, (i) => get(i).sound ?? WHOLE),
  })
  const lhs = side(ast.a)
  const rhs = side(ast.b)
  const diff = [lhs.sound[0] - rhs.sound[1], lhs.sound[1] - rhs.sound[0]].map((n, i) => (Number.isNaN(n) ? (i ? Infinity : -Infinity) : n))
  const asValue = (s) => valueFrom({ nominal: s.nominal, lo: s.sound[0], hi: s.sound[1] })
  return { lhs: asValue(lhs), rhs: asValue(rhs), diff }
}

// ---------------------------------------------------------------- problems

export const PROBLEM_ORDER = ["FAILS", "BROKEN", "CONFLICT", "PICK", "SUBJECT", "SOURCE", "STALE", "PROSE", "UNUSED?", "DEPENDS"]

function problemsOf({ ids, entries, byId, scan }) {
  const problems = []
  const add = (kind, id, text, fix) => problems.push({ kind, id, text, fix })
  for (const id of ids) {
    const entry = entries[id]
    const ev = byId.get(id)
    if (ev.broken && !ev.missing) add("BROKEN", id, `${id}: ${ev.broken}`, `fix the formula with assumptions_set (\`formula\`), or add the entry it names`)
    if (ev.outcome?.result === "broken") add("BROKEN", id, `${id}: ${ev.outcome.why}`, `fix the check with assumptions_set (\`check\`), or add the entry it names`)
    if (ev.outcome?.result === "fails") add("FAILS", id, `${id}: ${entry.check} is false over every value its inputs can take`, `change a decision it rests on, or add evidence that moves an input, with assumptions_set`)
    if (ev.outcome?.result === "depends") {
      const lead = ev.outcome.settle[0]
      add(
        "DEPENDS",
        id,
        `${id}: ${entry.check} holds for some values of its inputs and not others${ev.outcome.nominal ? ` (${ev.outcome.nominal} at nominal)` : ""}${lead ? `; ${lead.id} ${lead.why}` : ""}`,
        lead ? `narrow ${lead.id}: add a claim with stated bounds, or a measurement, with assumptions_set (\`claims\`)` : `add bounds to its inputs with assumptions_set`,
      )
    }
    for (const c of entry.claims ?? []) {
      if (!c.lost) continue
      const path = scan?.sources?.[c.source]?.path
      const name = path ? `"${path}"` : "its source"
      if (c.lost === "missing") add("SOURCE", id, `${id}: claim ${c.key}'s quote is no longer in ${name}, which changed since the quote was found`, `find the figure in the new version and set the claim again with assumptions_set (\`claims\`), or add a judgement setting it aside`)
      else add("SOURCE", id, `${id}: claim ${c.key}'s source ${name} can't be opened to check its quote`, `open it or reconnect; the claim keeps its last check until then`)
    }
    if (ev.pickProblem) add("PICK", id, `${id}: ${ev.pickProblem}`, `choose with assumptions_set (\`pick\`: one, lowest, highest or envelope, with a \`reason\`)`)
    if (ev.support?.conflicting) {
      for (const c of ev.support.conflicts) add("CONFLICT", id, `${id}: ${c.says}`, `weigh it with assumptions_set: change the \`pick\` with a \`reason\`, or answer the judgement (\`answers\`)`)
    }
    if (ev.stale && entry.basis === "model") {
      const since = ev.stale.filter((s) => s.reason !== "unavailable")
      const lost = ev.stale.filter((s) => s.reason === "unavailable")
      const what = [since.length ? `${since.map(staleReason).join(", ")} since the model ran` : null, ...lost.map(staleReason)].filter(Boolean).join("; ")
      add("STALE", id, `${id}: ${what}`, `re-run ${entry.model?.name ?? "the model"} and record its output: Record a run on the entry, or assumptions_set (\`model\`)`)
    }
    if (entry.about) {
      const decision = entries[entry.about]
      if (!decision) add("BROKEN", id, `${id}: \`about\` names no entry '${entry.about}'`, `fix \`about\` with assumptions_set`)
      else if (decision.basis !== "choice") add("BROKEN", id, `${id}: \`about\` names ${entry.about}, which is not a decision`, `fix \`about\` with assumptions_set`)
      else if (entry.basis === "claims") {
        const chosen = decision.choice?.value
        const wanted = normal(isText(chosen) ? chosen : JSON.stringify(chosen))
        for (const key of ev.used ?? []) {
          const claim = (entry.claims ?? []).find((c) => c.key === key)
          if (claim?.subject && wanted && !normal(claim.subject).includes(wanted)) {
            add("SUBJECT", id, `${id}: its claim ${key} is about "${claim.subject}"; it is about ${entry.about} = ${isText(chosen) ? `"${chosen}"` : JSON.stringify(chosen)}`, `add a claim about ${isText(chosen) ? chosen : entry.about} with assumptions_set (\`claims\`), or change ${entry.about}`)
          }
        }
      }
    }
  }
  return sortProblems(problems)
}

/** One reason a result is stale, in words: "cable_ampacity_A moved", 'the code in "thermal.ipynb" changed'. */
export function staleReason(s) {
  const name = s.path ? `"${s.path}"` : "a document the run read"
  if (s.reason === "changed") return `the code in ${name} changed`
  if (s.reason === "unavailable") return `${name}, which the run read, can't be opened to check`
  return s.reason === "moved" ? `${s.input} moved` : `${s.input} ${s.reason}`
}

export function sortProblems(problems) {
  return [...problems].sort((a, b) => PROBLEM_ORDER.indexOf(a.kind) - PROBLEM_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---------------------------------------------------------------- writing results back

/**
 * What the register writes on each entry so consumers can read it without
 * this module: value, support, derived, confidence, outcome, stale. `at` is
 * the heads the register was evaluated at.
 */
export function memoOf(id, entry, ev, { at = [], byId } = {}) {
  const memo = { value: ev.value ?? null }
  if (entry.basis === "formula") {
    memo.derived = ev.broken
      ? null
      : {
          how: String(entry.formula ?? "").trim(),
          inputs: Object.fromEntries(parse(entry.formula).ids.sort().map((i) => [i, plainValue(byId.get(i)?.value ?? null)])),
          at: [...at],
        }
  }
  if (ev.support && !ev.support.derived && entry.basis !== "model" && entry.basis !== "formula") {
    memo.support = { level: ev.support.level, conflicting: ev.support.conflicting, sources: ev.support.sources }
  }
  if (ev.confidence) memo.confidence = ev.confidence
  if (ev.outcome) memo.outcome = ev.outcome
  memo.stale = ev.stale ? ev.stale.map((s) => (s.doc ? { doc: s.doc, path: s.path, reason: s.reason } : { input: s.input, reason: s.reason })) : null
  if (ev.broken && !ev.missing) memo.broken = ev.broken
  else memo.broken = null
  return clean(memo)
}

/** A JSON-safe copy: no undefined, no Infinity, no NaN. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      if (typeof v === "number" && !Number.isFinite(v)) continue
      out[k] = clean(v)
    }
    return out
  }
  return value
}

const MEMO_FIELDS = ["value", "support", "derived", "confidence", "outcome", "stale", "broken"]

/**
 * Bring every entry's written-back fields in line with an evaluation, inside
 * a change. Only fields that differ are written, so a register that is
 * already correct produces no change at all. Returns the ids it rewrote.
 */
export function materialize(d, evaluation, { at = [] } = {}) {
  const rewrote = []
  for (const [id, entry] of Object.entries(d.entries ?? {})) {
    const ev = evaluation.byId.get(id)
    if (!ev) continue
    const memo = memoOf(id, entry, ev, { at, byId: evaluation.byId })
    let changed = false
    for (const field of MEMO_FIELDS) {
      const want = memo[field] ?? null
      const have = entry[field] ?? null
      if (field === "derived" && want && have && sameDerived(have, want)) continue
      if (JSON.stringify(stable(have)) === JSON.stringify(stable(want))) continue
      entry[field] = want === null ? null : structuredClone(want)
      changed = true
    }
    if (changed) rewrote.push(id)
  }
  return rewrote
}

/** Derived records match when what they were computed from matches; `at` alone moving is no reason to rewrite. */
function sameDerived(a, b) {
  return a.how === b.how && JSON.stringify(stable(a.inputs)) === JSON.stringify(stable(b.inputs))
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]))
  return value
}

/** Every person's claim and judgement on an entry, by key: what a change must not drop without a why. */
export function peoplesMarks(entry) {
  return [
    ...(entry?.claims ?? []).filter((c) => c.by?.kind === "person").map((c) => c.key),
    ...(entry?.judgements ?? []).filter((j) => j.by?.kind === "person").map((j) => j.key),
  ]
}

export { RANK, setAsideClaims }
