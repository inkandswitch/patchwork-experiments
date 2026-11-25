/**
 * Support: how much evidence stands behind a leaf value. Never a yes/no, and
 * never set by hand: it is a function of the evidence alone (tested over
 * every small combination).
 *
 *   corroborated   two or more independent sources agree, at least one of
 *                  them primary with its quote verified (or a measurement)
 *   supported      one primary source with its quote verified, or a measurement
 *   weak           an unverified or secondary source, an estimate, or a
 *                  judgement on its own
 *   none           an unknown
 *
 * A decision is `chosen`: exact by definition, so it is outside the scale.
 *
 * Conflict lowers support. A claim or a person's judgement whose bounds
 * don't overlap the value, and that nobody has set aside with a reason,
 * marks the value conflicting and caps it at weak.
 *
 * Independence is by origin: two editions of one datasheet count once, and
 * so does a page copying it. Claims of unknown origin count once between them.
 * A person's judgement is its own origin. The agent's own estimates are never
 * a source, so they corroborate nothing.
 */

import { overlaps } from "./values.js"

export const LEVELS = ["none", "weak", "supported", "corroborated"]
/** Ordering for "weakest": chosen ranks above everything, since a decision is exact. */
export const RANK = { none: 0, weak: 1, supported: 2, corroborated: 3, chosen: 4 }

export const PRIMARY_KINDS = ["datasheet", "standard", "test-report", "paper", "measurement", "definition"]
export const SECONDARY_KINDS = ["standard-summary", "retailer", "article", "calculation", "other"]
export const SOURCE_KINDS = [...PRIMARY_KINDS, ...SECONDARY_KINDS]

/** Verdicts a judgement on a claim can give that take the claim out of the evidence. */
export const SET_ASIDE = ["set-aside", "superseded", "not-applicable", "misread"]

export function weakest(levels) {
  let low = null
  for (const level of levels) if (low === null || RANK[level] < RANK[low]) low = level
  return low
}

/** The claims set aside: by a judgement on them, or by the pick's reason when they were weighed at the pick. */
export function setAsideClaims(entry) {
  const out = new Map()
  for (const j of entry.judgements ?? []) {
    if (j.on && SET_ASIDE.includes(j.verdict)) out.set(j.on, { by: j.by, says: j.says })
  }
  const pick = entry.pick
  if (pick?.rule === "one" && pick.reason) {
    for (const key of pick.considered ?? []) {
      if (key !== pick.claim && !out.has(key)) out.set(key, { by: pick.by ?? { kind: "agent" }, says: pick.reason })
    }
  }
  return out
}

/**
 * Support for a leaf. `entry` is the stored entry; `value` its value now (in
 * the entry's unit); `claimValues` maps a claim's key to its value in the
 * entry's unit (stated × factor).
 */
export function supportFor(entry, value, claimValues = new Map()) {
  if (entry.basis === "choice") return { level: "chosen", conflicting: false, conflicts: [], sources: 0 }
  const aside = setAsideClaims(entry)
  const sources = []
  const conflicts = []

  for (const claim of entry.claims ?? []) {
    if (aside.has(claim.key)) continue
    const v = claimValues.get(claim.key)
    if (v == null) continue
    const source = {
      from: claim.key,
      origin: claim.origin ? `origin:${String(claim.origin).trim().toLowerCase()}` : null,
      primary: claim.sourceKind === "measurement" || (PRIMARY_KINDS.includes(claim.sourceKind) && claim.verified === true),
    }
    if (value == null || overlaps(v, value)) sources.push(source)
    else conflicts.push({ from: claim.key, says: `claim ${claim.key} gives a value that doesn't overlap` })
  }

  for (const j of entry.judgements ?? []) {
    if (j.on || j.by?.kind !== "person") continue
    if ((entry.judgements ?? []).some((other) => other.on === j.key && SET_ASIDE.includes(other.verdict) && other.by?.kind === "person")) continue
    const origin = `person:${j.by.who ?? j.by.contact ?? "someone"}`
    if (j.verdict === "agrees") sources.push({ from: j.key, origin, primary: false })
    else if (j.verdict === "disagrees") conflicts.push({ from: j.key, says: j.says ?? "a person disagrees" })
    else if (j.value != null) {
      if (value == null || overlaps(j.value, value)) sources.push({ from: j.key, origin, primary: false })
      else conflicts.push({ from: j.key, says: j.says ?? "a person's value doesn't overlap" })
    }
  }

  const origins = new Set(sources.map((s) => s.origin).filter(Boolean))
  const independent = origins.size + (sources.some((s) => !s.origin) ? 1 : 0)
  const primary = sources.some((s) => s.primary)

  let level
  if (entry.basis === "unknown") level = "none"
  else if (entry.basis === "claims") level = !sources.length ? "none" : primary && independent >= 2 ? "corroborated" : primary ? "supported" : "weak"
  else level = "weak" // an estimate, or a model result (whose level the register derives from its inputs)

  const conflicting = conflicts.length > 0
  if (conflicting && RANK[level] > RANK.weak) level = "weak"
  return { level, conflicting, conflicts, sources: independent }
}
