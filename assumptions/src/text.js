/**
 * The register in words: one content model, rendered as text for the agent
 * and (by view.js, from the same parts) as HTML for people.
 *
 * Every entry becomes an ordered list of parts once — id, value, bounds,
 * status, evidence, judgements, uses, flags, cite — and the figure line is
 * those parts joined. A figure line is complete on its own: it can be read
 * aloud, pasted or quoted without losing what the number means, because the
 * qualifier (≤, ≥, typical) is part of the value and absence is written out.
 *
 * Output for the agent is bounded: a read with no filter is the summary,
 * the judgements and problems, and one line per group.
 */

import { render } from "./formula.js"
import { groupOf, intendedUse, sortProblems } from "./register.js"
import { RANK } from "./support.js"
import { observedUse } from "./uses.js"
import { useCounts, usesOf } from "./where.js"
import { citeString, formatBounds, formatNumber, formatValue, isNumeric } from "./values.js"

const LEVEL_ORDER = ["none", "weak", "supported", "corroborated", "chosen"]
const KIND_RANK = { fact: 0, decision: 0, result: 1, requirement: 2 }

// ---------------------------------------------------------------- parts

/** Words for what a result rests on: "rests on 1 weak, 2 supported". */
export function restsOnText(restsOn = {}) {
  const parts = LEVEL_ORDER.filter((l) => restsOn[l]).map((l) => `${restsOn[l]} ${l}`)
  return parts.length ? `rests on ${parts.join(", ")}` : "rests on nothing"
}

function statusOf(entry, ev) {
  const kind = entry.kind ?? "fact"
  switch (entry.basis) {
    case "claims":
      return `${kind}, ${ev.support?.level ?? "none"}${ev.support?.conflicting ? ", conflicting" : ""}`
    case "estimate":
      return `${kind}, ${ev.support?.level ?? "weak"}: estimate${ev.support?.conflicting ? ", conflicting" : ""}`
    case "unknown":
      return `${kind}, none: unknown`
    case "choice":
      return `${kind}, chosen`
    case "formula":
      return ev.broken ? `${kind}, formula, broken` : `${kind}, formula, ${ev.support?.level ?? "weak"}`
    case "model":
      return `${kind}, model, ${ev.support?.level ?? "weak"}${ev.stale ? ", stale" : ""}`
    case "check":
      return `${kind}, ${ev.outcome?.result ?? "unchecked"}`
  }
  return kind
}

function evidenceOf(id, entry, ev) {
  switch (entry.basis) {
    case "claims": {
      const used = (entry.claims ?? []).filter((c) => (ev.used ?? []).includes(c.key))
      if (!used.length) return (entry.claims ?? []).length ? "every claim set aside" : "no claims"
      const c = used[0]
      const name = [c.subject, c.sourceKind].filter(Boolean).join(" ") || String(c.source ?? "a source")
      return `${name}${used.length > 1 ? ` + ${used.length - 1} more` : ""}${c.verified ? "" : " (quote not verified)"}`
    }
    case "estimate":
      return entry.estimate?.reasoning ? `"${entry.estimate.reasoning}"` : "no reasoning given"
    case "unknown":
      return entry.unknown?.settle ? `settle by: ${entry.unknown.settle}` : "nobody knows yet"
    case "choice":
      return (entry.choice?.alternatives ?? []).length ? `over ${(entry.choice.alternatives).map((a) => (typeof a.value === "string" ? a.value : JSON.stringify(a.value))).join(", ")}` : entry.choice?.rationale ? `"${entry.choice.rationale}"` : "no rationale given"
    case "formula":
      return ev.broken ? ev.broken : restsOnText(ev.confidence?.restsOn)
    case "model":
      return `${entry.model?.name ?? "a model"}; ${restsOnText(ev.confidence?.restsOn ?? {})}`
    case "check":
      return entry.check ?? ""
  }
  return ""
}

function judgementsOf(entry, ev) {
  const people = (entry.judgements ?? []).filter((j) => j.by?.kind === "person")
  if (!people.length) return ""
  const disagreeing = ev.support?.conflicts?.some((c) => people.some((j) => j.key === c.from))
  return `${people.length} judgement${people.length === 1 ? "" : "s"}${disagreeing ? ", CONFLICT" : ""}`
}

function usesTextOf(id, entry, evaluation, scan, counts) {
  const observed = observedUse(id, entry, evaluation.readers, scan)
  if (observed == null) return "not yet scanned"
  const c = counts.get(id) ?? { model: 0, prose: 0 }
  const inRegister = [...(evaluation.readers.get(id) ?? [])].filter((r) => r !== id).length
  if (observed === "nowhere") return intendedUse(entry) === "unused" ? "deliberately unused" : "not used"
  const bits = []
  if (inRegister) bits.push(`${inRegister} in register`)
  if (c.model) bits.push(`${c.model} model`)
  if (c.prose) bits.push(`${c.prose} prose`)
  return bits.join(", ") || (entry.basis === "check" ? "checked" : "used")
}

/**
 * The parts of one entry, in reading order: [{ part, text }]. view.js
 * renders these same parts as cells; the text figure line joins them.
 */
export function entryParts(id, entry, evaluation, { scan = null, counts = useCounts(scan), problems = [] } = {}) {
  const ev = evaluation.byId.get(id) ?? {}
  const value = entry.basis === "check" ? null : ev.value ?? null
  const flags = [...new Set(problems.filter((p) => p.id === id).map((p) => p.kind))]
  return [
    { part: "id", text: id },
    { part: "value", text: entry.basis === "check" ? "" : formatValue(value, entry.unit) },
    { part: "bounds", text: entry.basis === "check" ? "" : formatBounds(value) },
    { part: "status", text: statusOf(entry, ev) },
    { part: "evidence", text: evidenceOf(id, entry, ev) },
    { part: "judgements", text: judgementsOf(entry, ev) },
    { part: "uses", text: usesTextOf(id, entry, evaluation, scan, counts) },
    { part: "flags", text: flags.join(" ") },
    { part: "cite", text: entry.basis === "check" || value == null ? "" : `cite: ${citeString(id, value, entry.unit)}` },
  ]
}

/** The figure line: "cell_cap_Ah = 280 Ah · fact, supported · EVE LF280K datasheet · 3 model · cite: 280 Ah (`cell_cap_Ah`)". */
export function figureLine(parts) {
  const get = (name) => parts.find((p) => p.part === name)?.text ?? ""
  const value = get("value")
  const bounds = get("bounds")
  let head = get("id")
  if (value) head += /^[≤≥]/.test(value) ? ` ${value}` : ` = ${value}`
  if (bounds) head += bounds.startsWith("(") ? ` ${bounds}` : `, ${bounds}`
  const rest = ["status", "evidence", "judgements", "uses", "flags", "cite"].map(get).filter(Boolean)
  return [head, ...rest].join(" · ")
}

// ---------------------------------------------------------------- summary

function ago(time) {
  if (!time) return null
  const minutes = Math.round((Date.now() - Date.parse(time)) / 60000)
  if (!Number.isFinite(minutes)) return null
  if (minutes < 2) return "just now"
  if (minutes < 120) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`
}

/** All problems: the register's own and the scan's. */
export function allProblems(evaluation, extra = []) {
  return sortProblems([...evaluation.problems, ...extra])
}

/** The one sentence that states the whole register. */
export function summaryLine(doc, evaluation, problems, { title = true } = {}) {
  const entries = doc?.entries ?? {}
  const ids = Object.keys(entries)
  const outcomes = {}
  for (const id of ids) {
    const r = evaluation.byId.get(id)?.outcome?.result
    if (r) outcomes[r] = (outcomes[r] ?? 0) + 1
  }
  const attention = new Set(problems.map((p) => p.id)).size
  const unknowns = ids.filter((id) => entries[id].basis === "unknown").length
  const unused = ids.filter((id) => intendedUse(entries[id]) === "unused").length
  const req = ["holds", "fails", "depends", "n/a", "broken"].filter((k) => outcomes[k]).map((k) => `${outcomes[k]} ${k === "holds" ? "hold" : k === "fails" ? "fail" : k === "depends" ? "depend" : k}`)
  const bits = [
    ...(title ? [doc?.title || "Assumptions"] : []),
    `${ids.length} entr${ids.length === 1 ? "y" : "ies"}`,
    attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "nothing needs attention",
  ]
  if (req.length) bits.push(`requirements: ${req.join(", ")}`)
  if (unknowns) bits.push(`${unknowns} unknown${unknowns === 1 ? "" : "s"}`)
  if (unused) bits.push(`${unused} deliberately unused`)
  bits.push(doc?.scan ? `scanned ${ago(doc.scan.time) ?? "earlier"}` : "not yet scanned")
  return bits.join(" · ")
}

/** Ids in a group, in the order a calculation sheet reads: facts and decisions, then results by derivation, then requirements. */
export function sheetOrder(evaluation, entries, ids) {
  const position = new Map(evaluation.order.map((id, i) => [id, i]))
  return [...ids].sort((a, b) => KIND_RANK[entries[a].kind ?? "fact"] - KIND_RANK[entries[b].kind ?? "fact"] || (entries[a].kind === "result" ? position.get(a) - position.get(b) : 0) || (a < b ? -1 : 1))
}

/** A group's header: "cell: 9 entries · 7 supported, 2 weak · 1 needs attention". */
export function groupLine(group, ids, entries, evaluation, problems) {
  const counts = {}
  for (const id of ids) {
    if (entries[id].kind === "result" || entries[id].basis === "check") continue
    const level = evaluation.byId.get(id)?.support?.level
    if (level) counts[level] = (counts[level] ?? 0) + 1
  }
  const mix = [...LEVEL_ORDER].reverse().filter((l) => counts[l]).map((l) => `${counts[l]} ${l}`).join(", ")
  const attention = new Set(problems.filter((p) => ids.includes(p.id)).map((p) => p.id)).size
  return [`${group}: ${ids.length} entr${ids.length === 1 ? "y" : "ies"}`, mix, attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "nothing needs attention"].filter(Boolean).join(" · ")
}

// ---------------------------------------------------------------- blocks

function judgementLines(doc, evaluation) {
  if (!evaluation.judgements.length) return []
  const lines = ["JUDGEMENTS TO ANSWER"]
  for (const { id, judgement: j } of evaluation.judgements) {
    const entry = doc.entries[id]
    const ev = evaluation.byId.get(id)
    const conflict = ev.support?.conflicts?.some((c) => c.from === j.key)
    const on = j.on ? ` on claim ${j.on}` : ""
    const what = j.verdict === "value" && j.value != null ? ` gives ${formatValue(j.value, entry.unit)}` : j.verdict && j.verdict !== "disagrees" ? ` (${j.verdict})` : ""
    lines.push(`  ${id} = ${formatValue(ev.value, entry.unit)} · ${conflict ? "CONFLICT, " : ""}judgement by ${j.by?.who ?? "a person"}${on}${what}: "${j.says ?? ""}"`)
    if (j.path) lines.push(`    path: ${j.path}`)
    lines.push(`    answer: assumptions_set with \`answers\`: [{ id: "${id}", judgement: "${j.key}", says }], after changing the value or with why it stands`)
  }
  return [...lines, ""]
}

function problemLines(problems, limit) {
  if (!problems.length) return []
  const lines = ["NEEDS ATTENTION"]
  for (const p of problems.slice(0, limit)) {
    lines.push(`  ${p.kind.padEnd(8)} ${p.text}`)
    if (p.fix) lines.push(`           fix: ${p.fix}`)
  }
  if (problems.length > limit) lines.push(`  …and ${problems.length - limit} more; assumptions_check lists them all`)
  return [...lines, ""]
}

/** Words for a result's confidence: "at least 7.1–12.8 kA; 71% of width from busbar_R_contact_mOhm (estimate); rests on 1 unstated spread". */
export function confidenceText(entry, ev, evaluation) {
  const c = ev.confidence
  if (!c) return ""
  const bits = []
  if (c.stated && isNumeric(c.stated) && c.atLeast) bits.push(`at least ${formatValue(c.stated, entry.unit)}`)
  if (c.unboundedBy?.length) bits.push(`unbounded because of ${c.unboundedBy.join(", ")}`)
  for (const s of c.shares?.slice(0, 2) ?? []) {
    const leaf = evaluation?.byId.get(s.id)
    bits.push(`${Math.round(s.share * 100)}% of width from ${s.id}${leaf?.support?.level ? ` (${leaf.support.level})` : ""}`)
  }
  if (c.unstated?.length) bits.push(`${c.unstated.length} unstated spread${c.unstated.length === 1 ? "" : "s"} (${c.unstated.join(", ")})`)
  if (c.unknowns?.length) bits.push(`${c.unknowns.length} unknown${c.unknowns.length === 1 ? "" : "s"} (${c.unknowns.join(", ")})`)
  bits.push(restsOnText(c.restsOn))
  return bits.join("; ")
}

/** The formula with values in, as a hand calculation: "a / b = 58.4 V / 6.09 mΩ = 9.59 kA". */
export function traceText(id, entry, evaluation) {
  const p = evaluation.parsed.get(id)
  const ev = evaluation.byId.get(id)
  if (!p?.formula) return entry.formula ?? ""
  const entries = new Proxy({}, { get: (_, key) => evaluation.byId.get(key) })
  const symbols = render(p.formula.ast)
  const values = render(p.formula.ast, (input) => {
    const v = entries[input]?.value
    return v == null ? `${input}?` : formatValue(v, evaluation.units?.get(input) ?? "")
  })
  return `${id} = ${symbols} = ${values} = ${ev.broken ? `(${ev.broken})` : `${formatValue(ev.value, entry.unit)}${formatBounds(ev.value) ? ` ${formatBounds(ev.value)}` : ""}`}`
}

/** The panel's five sections, as text. */
export function detailText(id, doc, evaluation, problems) {
  const entry = doc.entries[id]
  if (!entry) return `No entry '${id}'.`
  const ev = evaluation.byId.get(id)
  evaluation.units ??= new Map(Object.entries(doc.entries).map(([k, e]) => [k, e.unit ?? ""]))
  const lines = [figureLine(entryParts(id, entry, evaluation, { scan: doc.scan, problems }))]
  if (entry.label) lines.push(`  label: ${entry.label}`)
  if (entry.note) lines.push(`  note: ${entry.note}`)

  lines.push("  BASIS")
  switch (entry.basis) {
    case "claims": {
      const aside = new Map((entry.judgements ?? []).filter((j) => j.on).map((j) => [j.on, j]))
      for (const c of entry.claims ?? []) {
        const picked = (ev.used ?? []).includes(c.key)
        const set = aside.get(c.key)
        lines.push(`    ${c.key}${picked ? " (used)" : ""}${set && set.verdict !== "agrees" ? ` (${set.verdict}: ${set.says ?? ""})` : ""}: ${[c.sourceKind, c.subject].filter(Boolean).join(", ") || "source"} — ${c.source ?? "no source"}`)
        if (c.quote) lines.push(`      "${c.quote}" · read as ${c.reading ?? "?"}${c.factor && c.factor !== 1 ? ` · × ${c.factor}` : ""} · ${c.verified ? "found in the kept source" : "not verified"}${c.section ? ` · under "${c.section}"` : ""}`)
        if (c.conditions) lines.push(`      conditions: ${c.conditions}`)
      }
      if (entry.pick) lines.push(`    pick: ${entry.pick.rule}${entry.pick.claim ? ` ${entry.pick.claim}` : ""}${entry.pick.reason ? ` — ${entry.pick.reason}` : ""}`)
      break
    }
    case "estimate":
      lines.push(`    estimate: ${formatValue(entry.estimate?.value, entry.unit)} — ${entry.estimate?.reasoning ?? "no reasoning"}`)
      break
    case "unknown":
      lines.push(`    unknown${entry.unknown?.range ? `, range ${formatValue(entry.unknown.range, entry.unit)}` : ""}${entry.unknown?.settle ? `; settle by ${entry.unknown.settle}` : ""}`)
      break
    case "choice":
      lines.push(`    chosen: ${formatValue(entry.choice?.value, entry.unit)}${entry.choice?.rationale ? ` — ${entry.choice.rationale}` : ""}`)
      for (const a of entry.choice?.alternatives ?? []) lines.push(`    over ${formatValue(a.value, entry.unit)}${a.note ? ` — ${a.note}` : ""}`)
      break
    case "formula":
      lines.push(`    ${traceText(id, entry, evaluation)}`)
      if (ev.confidence) lines.push(`    ${confidenceText(entry, ev, evaluation)}`)
      break
    case "model":
      lines.push(`    ${entry.model?.name ?? "model"} (${entry.model?.url ?? "no url"}), tolerance ${entry.model?.tolerance ?? 0}`)
      for (const [input, v] of Object.entries(entry.model?.inputs ?? {})) lines.push(`    ran with ${input} = ${formatValue(v, doc.entries[input]?.unit)}`)
      break
    case "check": {
      const o = ev.outcome ?? {}
      lines.push(`    ${entry.check}${entry.appliesIf ? ` · applies if ${entry.appliesIf} (${o.applies})` : ""}`)
      lines.push(`    over bounds: ${o.result} · over stated spreads: ${o.stated} · at nominal: ${o.nominal ?? "no nominal"}`)
      if (o.lhs || o.rhs) lines.push(`    ${o.lhs ? formatValue(o.lhs) : "unbounded"} ${o.op} ${o.rhs ? formatValue(o.rhs) : "unbounded"}`)
      for (const s of o.settle ?? []) lines.push(`    ${s.id} ${s.why}${s.settles ? `; pinning it settles this (${s.settles})` : ""}`)
      break
    }
  }

  lines.push("  RESTS ON AND FEEDS")
  const leaves = [...(ev.leaves ?? [])].filter((l) => l !== id).sort((a, b) => RANK[evaluation.byId.get(a)?.support?.level ?? "weak"] - RANK[evaluation.byId.get(b)?.support?.level ?? "weak"] || (a < b ? -1 : 1))
  if (leaves.length) lines.push(`    rests on: ${leaves.map((l) => `${l} (${evaluation.byId.get(l)?.support?.level ?? "?"})`).join(", ")}`)
  const feeds = [...(evaluation.readers.get(id) ?? [])].filter((r) => r !== id).sort()
  lines.push(`    feeds: ${feeds.length ? feeds.join(", ") : "nothing in the register"}`)

  lines.push("  USED IN")
  const uses = usesOf(doc.scan, id)
  if (!doc.scan) lines.push("    not yet scanned")
  else if (!uses.length) lines.push("    no document")
  for (const u of uses.slice(0, 12)) lines.push(`    ${u.use} · ${u.doc}${u.part ? ` ${u.part}` : ""}:${u.line}  ${u.text}`)
  if (uses.length > 12) lines.push(`    …and ${uses.length - 12} more; assumptions_where with \`id\` lists them all`)

  lines.push("  JUDGEMENTS")
  const judgements = entry.judgements ?? []
  if (!judgements.length) lines.push("    no judgements")
  for (const j of judgements) {
    lines.push(`    ${j.key} · ${j.by?.kind === "person" ? j.by.who ?? "a person" : "the agent"}${j.on ? ` on ${j.on}` : ""}: ${j.verdict}${j.value != null ? ` ${formatValue(j.value, entry.unit)}` : ""}${j.says ? ` — "${j.says}"` : ""}`)
    if (j.answer) lines.push(`      answered: "${j.answer.says}"`)
  }
  lines.push("    history: the register's document history (who changed it, when, and why)")
  return lines.join("\n")
}

// ---------------------------------------------------------------- reads

export const PAGE = 40

/**
 * What assumptions_read returns. With no filter: the summary, judgements,
 * problems, and one line per group. With `prefix` or `ids`: figure lines,
 * PAGE at a time; with `detail`, the five sections for each id.
 */
export function readText(doc, evaluation, extraProblems = [], { ids = null, prefix = null, detail = false, page = 1 } = {}) {
  const entries = doc.entries ?? {}
  const problems = allProblems(evaluation, extraProblems)
  const lines = [summaryLine(doc, evaluation, problems), ""]
  lines.push(...judgementLines(doc, evaluation))
  lines.push(...problemLines(problems, ids || prefix ? 8 : 20))

  if (ids?.length && detail) {
    for (const id of ids) lines.push(detailText(id, doc, evaluation, problems), "")
    return lines.join("\n").trimEnd()
  }
  let chosen = null
  if (ids?.length) chosen = ids.filter((id) => entries[id])
  else if (prefix) chosen = Object.keys(entries).filter((id) => id.startsWith(prefix))
  if (!chosen) {
    const groups = new Map()
    for (const id of Object.keys(entries).sort()) groups.set(groupOf(id), [...(groups.get(groupOf(id)) ?? []), id])
    for (const [group, members] of groups) lines.push(groupLine(group, members, entries, evaluation, problems))
    lines.push("", "Ask for a group with `prefix` (\"cell_\"), or entries with `ids` (and `detail: true` for their sources, trace and uses).")
    return lines.join("\n").trimEnd()
  }
  if (ids?.length) {
    const missing = ids.filter((id) => !entries[id])
    if (missing.length) lines.push(`No entries ${missing.join(", ")}.`)
  }
  const counts = useCounts(doc.scan)
  const ordered = []
  const byGroup = new Map()
  for (const id of chosen) byGroup.set(groupOf(id), [...(byGroup.get(groupOf(id)) ?? []), id])
  for (const [, members] of [...byGroup].sort(([a], [b]) => (a < b ? -1 : 1))) ordered.push(...sheetOrder(evaluation, entries, members))
  const start = (Math.max(1, page) - 1) * PAGE
  for (const id of ordered.slice(start, start + PAGE)) lines.push(`  ${figureLine(entryParts(id, entries[id], evaluation, { scan: doc.scan, counts, problems }))}`)
  if (ordered.length > start + PAGE) lines.push(`  …${ordered.length - start - PAGE} more: ask for \`page\`: ${Math.max(1, page) + 1}`)
  return lines.join("\n").trimEnd()
}

/** What assumptions_check returns: everything to act on, in queue order, and where effort pays. */
export function checkText(doc, evaluation, extraProblems, { constants = [], drift = [], exports = [], pinned = null, heads = [] } = {}) {
  const entries = doc.entries ?? {}
  const problems = allProblems(evaluation, extraProblems)
  const lines = [summaryLine(doc, evaluation, problems), ""]
  lines.push(...judgementLines(doc, evaluation))
  lines.push(...problemLines(problems, 60))

  const pays = []
  for (const id of Object.keys(entries).sort()) {
    const o = evaluation.byId.get(id)?.outcome
    if (o?.result !== "depends") continue
    for (const s of o.settle ?? []) pays.push(`  ${id}: ${s.id} ${s.why}${s.settles ? `; narrowing it settles ${id} (${s.settles})` : ""}`)
  }
  if (pays.length) lines.push("WHERE EFFORT PAYS (the measurement or source that would settle each requirement that depends)", ...pays.slice(0, 20), "")

  const unknowns = Object.keys(entries).filter((id) => entries[id].basis === "unknown").sort()
  if (unknowns.length) lines.push(`UNKNOWNS (${unknowns.length}): ${unknowns.join(", ")}. They compute like any value; each is a to-do, not a stop.`, "")

  if (constants.length) {
    lines.push(`CONSTANTS IN MODEL CODE (${constants.length}): numbers the register should hold`)
    for (const c of constants.slice(0, 30)) lines.push(`  ${c.doc}${c.part ? ` ${c.part}` : ""}:${c.line}  ${c.name} = ${c.value}${c.comment ? `  # ${c.comment}` : ""}`)
    if (constants.length > 30) lines.push(`  …and ${constants.length - 30} more`)
    lines.push("")
  }
  if (drift.length) {
    lines.push("DRIFTED COPIES: register names assigned a different number")
    for (const d of drift.slice(0, 30)) lines.push(`  ${d.doc}${d.part ? ` ${d.part}` : ""}:${d.line}  ${d.name} = ${d.written ?? d.value}, register says ${formatNumber(d.register)}`)
    lines.push("")
  }
  if (exports.length) lines.push(`Exports of this register: ${exports.map((e) => `${e.doc} (${e.url})`).join(", ")}`, "")
  lines.push("Problems are things to fix or to explain. Weak support, estimates and unknowns are reported, never blockers.")
  if (pinned) lines.push(`Checked at ${heads.join(",")}. Link the register as it stood: ${pinned}`)
  return lines.join("\n").trimEnd()
}
