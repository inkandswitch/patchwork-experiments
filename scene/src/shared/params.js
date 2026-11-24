// A provider's params, as its ParamSpecs describe them (README.md, "Writing
// a provider"): what a form shows, what build() and a template's create() are
// handed. Pure, plain data.

/** JSON.stringify with object keys sorted at every level. */
export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (ArrayBuffer.isView(value)) return stableStringify(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Params with every ParamSpec default filled in (existing values win). */
export function withDefaults(specs, params) {
  const out = {};
  for (const spec of specs ?? []) {
    if (spec?.key && spec.default !== undefined) out[spec.key] = spec.default;
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const clampNum = (v, spec) => {
  let n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n)) return null;
  if (spec.kind === "integer") n = Math.round(n);
  if (Number.isFinite(spec.min)) n = Math.max(spec.min, n);
  if (Number.isFinite(spec.max)) n = Math.min(spec.max, n);
  return n;
};

/** Convert a raw value to the spec's type (clamped to min/max), or null if it isn't one. */
export function coerceParam(spec, raw) {
  switch (spec?.kind) {
    case "number":
    case "integer":
      return clampNum(raw, spec);
    case "boolean":
      return !!raw;
    case "enum": {
      const opt = (spec.options ?? []).find((o) => String(o.value) === String(raw));
      return opt ? opt.value : null;
    }
    case "color":
      return /^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw).toLowerCase() : null;
    default:
      return String(raw ?? "");
  }
}

/**
 * What build() is handed: every default filled in, and every value that has a
 * ParamSpec coerced to its kind and clamped to its min/max; one that can't be
 * coerced falls back to the default. Values arrive from forms, agents, other
 * tools and merges, so a provider can trust its metadata instead of re-clamping.
 * Keys without a spec pass through untouched.
 */
export function effectiveParams(specs, params) {
  const out = withDefaults(specs, params);
  for (const spec of specs ?? []) {
    if (!spec?.key || !(spec.key in out)) continue;
    const v = coerceParam(spec, out[spec.key]);
    if (v != null) out[spec.key] = v;
    else if (spec.default !== undefined) out[spec.key] = spec.default;
    else delete out[spec.key];
  }
  return out;
}

/**
 * Exactly the params a spec list describes: effectiveParams's values (each
 * coerced to its spec, a default where one is missing or can't be), with
 * every key that has no spec dropped. What a template's create() is handed
 * (EDITOR.md, "Templates"): a template runs once, from a form or for another
 * tool, so nothing it wasn't declared to take reaches it. A spec counts
 * only with a string key, as the start screen's form draws it (templatesOf,
 * parts/add.js): create gets exactly what the form offers.
 */
export function paramsBySpec(specs, given) {
  const all = effectiveParams(specs, given);
  const out = {};
  for (const spec of specs ?? []) if (typeof spec?.key === "string" && Object.hasOwn(all, spec.key)) out[spec.key] = all[spec.key];
  return out;
}

/** Just the defaults, for seeding a new render doc. */
export function defaultParams(specs) {
  return withDefaults(specs, {});
}

/** Keys whose values differ between two param objects. */
export function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => stableStringify(a?.[k]) !== stableStringify(b?.[k]));
}
