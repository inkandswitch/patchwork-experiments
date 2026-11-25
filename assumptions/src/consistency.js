/**
 * Is a stored result still what it says it is? The check any consumer can
 * run with nothing but the register document: no evaluator, no history.
 *
 * Every formula result stores `derived: { how, inputs, at }`: the formula it
 * was computed with and the value of each input it used. The result is
 * consistent when the formula is still the entry's formula and every input
 * still has the value recorded, and every input is itself consistent.
 * Those are equality tests on a few fields.
 *
 * This only says whether a result is *out of date*. Whether the stored
 * arithmetic is right is the register module's check, which it runs when it
 * loads and repairs on the spot.
 *
 * Self-contained on purpose: another tool can copy this file and know which
 * register values it may trust without loading the register package.
 */

function same(a, b) {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "string" || typeof b === "string") return a === b
  return a.nominal === b.nominal && a.min === b.min && a.max === b.max && Boolean(a.exact) === Boolean(b.exact)
}

/**
 * The ids of stored results that are out of date, each with why:
 * Map<id, string>. An empty map means every stored result is consistent.
 */
export function outOfDate(doc) {
  const entries = doc?.entries ?? {}
  const out = new Map()
  const direct = (id) => {
    const entry = entries[id]
    const derived = entry?.derived
    if (entry?.basis !== "formula") return null
    if (!derived) return entry.broken ? null : "never computed"
    if (String(entry.formula ?? "").trim() !== derived.how) return "its formula changed"
    for (const [input, used] of Object.entries(derived.inputs ?? {})) {
      if (!(input in entries)) return `${input} is gone`
      if (!same(entries[input].value ?? null, used)) return `${input} changed`
    }
    return null
  }
  for (const id of Object.keys(entries)) {
    const why = direct(id)
    if (why) out.set(id, why)
  }
  // Out of date upstream is out of date here too. Monotone over a finite set.
  let grew = true
  while (grew) {
    grew = false
    for (const id of Object.keys(entries)) {
      if (out.has(id)) continue
      const upstream = Object.keys(entries[id]?.derived?.inputs ?? {}).find((input) => out.has(input))
      if (upstream) {
        out.set(id, `${upstream} is out of date`)
        grew = true
      }
    }
  }
  return out
}
