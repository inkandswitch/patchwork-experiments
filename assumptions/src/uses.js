/**
 * What the register makes of a scan: how each entry is actually used, set
 * against how it is meant to be used, and where prose disagrees with it.
 *
 * Observed use:
 *   model    something computes with it: another entry's formula, check,
 *            applicability or model inputs, or code in the folder. A check
 *            itself counts, since the register computes it.
 *   prose    only prose cites it
 *   nowhere
 *
 * Intended × observed, nine cells, five flagged:
 *
 *                  model      prose                    nowhere
 *   model          fine       no model reads it        unused
 *   reference      fine*      fine                     nothing cites it
 *   unused         used       cited                    fine (with its reason)
 *
 *   * the mark is outdated; assumptions_check corrects it to model quietly.
 */

import { proseDisagreements } from "./prose.js"
import { intendedUse } from "./register.js"
import { citeString, formatValue } from "./values.js"

/** How an entry is observed to be used, or null before any scan. */
export function observedUse(id, entry, readers, scan) {
  if (entry?.basis === "check") return "model"
  if ([...(readers?.get(id) ?? [])].some((r) => r !== id)) return "model"
  if (!scan) return null
  let prose = false
  for (const doc of Object.values(scan.docs ?? {})) {
    for (const hit of doc.hits ?? []) {
      if (hit.id !== id) continue
      if (hit.use === "model") return "model"
      prose = true
    }
  }
  return prose ? "prose" : "nowhere"
}

/** The flag for one cell of the matrix, or null when the cell is fine. */
export function useFlag(intended, observed) {
  if (observed == null) return null
  const cell = `${intended}/${observed}`
  return (
    {
      "model/prose": "no model reads it: wire it into a model, or mark it reference",
      "model/nowhere": "unused: wire it into a model, or mark it unused with a reason",
      "reference/nowhere": "nothing cites it",
      "unused/model": "marked unused, but a model uses it",
      "unused/prose": "marked unused, but prose cites it",
    }[cell] ?? null
  )
}

/** Use flags and prose disagreements, as problems in the register's shape. */
export function scanProblems(doc, evaluation) {
  const entries = doc?.entries ?? {}
  const scan = doc?.scan ?? null
  const problems = []
  for (const id of Object.keys(entries).sort()) {
    const entry = entries[id]
    const flag = useFlag(intendedUse(entry), observedUse(id, entry, evaluation.readers, scan))
    if (flag) {
      const value = evaluation.byId.get(id)?.value
      problems.push({
        kind: "UNUSED?",
        id,
        text: `${id}${value != null ? ` ${formatValue(value, entry.unit)}` : ""}: ${flag}`,
        fix: `read it in a model, or set \`use\` with assumptions_set: "reference", or "unused" with a \`note\``,
      })
    }
  }
  for (const [url, d] of Object.entries(scan?.docs ?? {})) {
    const lines = new Map()
    for (const hit of d.hits ?? []) {
      if (hit.use !== "prose") continue
      const key = `${hit.part}|${hit.line}`
      const line = lines.get(key) ?? { part: hit.part, line: hit.line, text: hit.text, ids: [] }
      line.ids.push(hit.id)
      lines.set(key, line)
    }
    for (const line of lines.values()) {
      const cites = line.ids.map((id) => ({ id, value: evaluation.byId.get(id)?.value ?? null }))
      for (const { id, says } of proseDisagreements(line.text, cites)) {
        const entry = entries[id]
        const value = evaluation.byId.get(id).value
        problems.push({
          kind: "PROSE",
          id,
          url,
          text: `${id} = ${formatValue(value, entry.unit)}: "${d.path}"${line.part ? ` ${line.part}` : ""} line ${line.line} says ${says.length ? says.join(", ") : "no number"}`,
          fix: `write the figure there as ${citeString(id, value, entry.unit)}`,
        })
      }
    }
  }
  return problems
}
