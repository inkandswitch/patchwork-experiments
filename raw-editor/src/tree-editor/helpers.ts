import type { CollectionKey } from "./types";

export function isCollection(
  value: unknown
): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function toPathString(path: CollectionKey[]): string {
  if (path.length === 0) return "";
  return path
    .map((p) => String(p).replace(/\\/g, "\\\\").replace(/\//g, "\\/"))
    .join("/");
}

export function serializeForClipboard(data: unknown): string {
  return JSON.stringify(
    data,
    (_key, value) => {
      if (value instanceof Uint8Array) return Array.from(value);
      return value;
    },
    2
  );
}

export function containsUint8Array(value: unknown): boolean {
  if (value instanceof Uint8Array) return true;
  if (Array.isArray(value)) return value.some(containsUint8Array);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsUint8Array);
  }
  return false;
}
