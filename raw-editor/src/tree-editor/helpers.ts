import type { CollectionKey } from "./types"

export function isCollection(
  value: unknown
): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true
  if (value === null || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export const toPathString = (path: CollectionKey[]): string =>
  path.map((p) => (p === "" ? "\0" : p)).join(".")
