/**
 * The register as a file a model reads: JSON, Python or OpenSCAD, one
 * `id = value` per entry.
 *
 * The bare id is the nominal, written only when there is one; bounds are
 * `id_min` and `id_max`, written only when they exist. A model therefore
 * can't silently read a midpoint nobody chose, or a bound nobody stated.
 * Text values export as strings. An entry with no value yet (an unknown)
 * is listed in a comment, so a model that needs it fails loudly.
 */

import { isNumeric, isText } from "./values.js"

export const GENERATED_MARK = "GENERATED from assumptions register"

export const EXPORT_FORMATS = {
  json: { extension: "json", mimeType: "application/json" },
  python: { extension: "py", mimeType: "text/x-python" },
  scad: { extension: "scad", mimeType: "application/x-openscad" },
}

/** The names a value exports as, and their values. */
export function exportedNames(id, value) {
  if (isText(value)) return [[id, value]]
  if (!isNumeric(value)) return []
  const out = []
  if (value.nominal !== undefined) out.push([id, value.nominal])
  if (value.min !== undefined) out.push([`${id}_min`, value.min])
  if (value.max !== undefined) out.push([`${id}_max`, value.max])
  return out
}

/** The export's text. `entries` are the register's entries with their written-back values. */
export function renderExport(entries, { format = "json", title = "", registerUrl = "" } = {}) {
  const ids = Object.keys(entries ?? {}).sort()
  const header = `${GENERATED_MARK} ${registerUrl || "(this register)"}${title ? ` (${title})` : ""}. Edit the register, not this file; export again after a change.`
  const missing = ids.filter((id) => entries[id].basis !== "check" && exportedNames(id, entries[id].value).length === 0)
  const pairs = ids.flatMap((id) => (entries[id].basis === "check" ? [] : exportedNames(id, entries[id].value).map(([name, value]) => ({ name, value, id }))))

  if (format === "json") {
    const values = Object.fromEntries(pairs.map(({ name, value }) => [name, value]))
    return JSON.stringify({ _generated: header, ...(missing.length ? { _no_value: missing } : {}), ...values }, null, 2) + "\n"
  }
  // Full precision: display rounding never reaches a model.
  const literal = (value) => (typeof value === "string" ? JSON.stringify(value) : String(value))
  const comment = format === "python" ? "#" : "//"
  const lines = [`${comment} ${header}`]
  if (missing.length) lines.push(`${comment} No value yet (unknowns): ${missing.join(", ")}`)
  for (const { name, value, id } of pairs) {
    const entry = entries[id]
    const level = entry.support?.level ?? entry.confidence?.level ?? ""
    const about = [entry.label, entry.unit && `[${entry.unit}]`, level].filter(Boolean).join(" ")
    lines.push(`${name} = ${literal(value)}${format === "scad" ? ";" : ""}${about ? `  ${comment} ${about}` : ""}`)
  }
  return lines.join("\n") + "\n"
}
