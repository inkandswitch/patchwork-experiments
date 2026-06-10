export function assignAutomergeFields<T extends object>(
  target: T,
  source: Partial<T>,
  options?: { skip?: (keyof T)[] },
): void {
  const skip = new Set(options?.skip ?? []);

  for (const key of Object.keys(source) as (keyof T)[]) {
    if (skip.has(key)) continue;

    const value = source[key];
    if (value === undefined) continue;

    if (value === null || value === "") {
      delete target[key];
      continue;
    }

    target[key] = value as T[keyof T];
  }
}

export function setAutomergeString(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  if (value) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

/** Build plain objects for Automerge — strips undefined keys recursively one level deep on arrays. */
export function omitUndefined<T extends object>(obj: T): T {
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? omitUndefined(item as object)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
