import type { CollectionKey } from "./types"

export const isCollection = (
  value: unknown
): value is Record<string, unknown> | unknown[] =>
  value !== null && typeof value === "object"

export const toPathString = (path: CollectionKey[]): string =>
  path.map((p) => (p === "" ? "\0" : p)).join(".")

export function displayValue(
  value: unknown,
  showQuotes: boolean
): string {
  if (value === null) return "null"
  if (typeof value === "string")
    return showQuotes ? `"${value}"` : value
  return String(value)
}

export function valueTypeClass(value: unknown): string {
  if (value === null) return "te-null"
  switch (typeof value) {
    case "string":
      return "te-string"
    case "number":
      return "te-number"
    case "boolean":
      return "te-boolean"
    default:
      return "te-invalid"
  }
}

export function coerceValue(raw: string, originalType: string): unknown {
  if (originalType === "number") {
    const n = Number(raw)
    return isNaN(n) ? 0 : n
  }
  if (originalType === "boolean") return raw === "true"
  if (originalType === "null" && raw === "null") return null
  return raw
}

export function stringifyPath(path: CollectionKey[]): string {
  return path.reduce<string>((str, part) => {
    if (typeof part === "number") return `${str}[${part}]`
    return str === "" ? String(part) : `${str}.${String(part)}`
  }, "")
}
