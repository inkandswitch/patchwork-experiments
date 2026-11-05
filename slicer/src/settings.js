// Settings: defaults, coercion, the old names, and the key a slice is recorded
// against. Pure; no automerge, no DOM.

import { FILAMENTS, SETTINGS } from "./settings-spec.js";

export { FILAMENTS, SETTINGS };

export const SPEC_BY_KEY = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.key, s])));

export const DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])));

/**
 * Names other writers have used for the same setting. bambu-slicer's
 * `printSpeed` was one speed for everything; it becomes the wall speed.
 * The old patchwork-slicer's names (walls, infill) only ever lived in
 * localStorage, but an agent or a hand-edit may still use them.
 */
export const ALIASES = Object.freeze({ printSpeed: "wallSpeed", walls: "wallLoops", infill: "infillDensity" });

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

/** A value made to fit its spec, or `undefined` if it can't be. */
export function coerce(spec, value) {
  if (!spec || value === undefined || value === null) return undefined;
  switch (spec.kind) {
    case "number":
    case "integer": {
      let n = typeof value === "string" ? Number(value.trim()) : Number(value);
      if (typeof value === "boolean" || !Number.isFinite(n)) return undefined;
      if (spec.kind === "integer") n = Math.round(n);
      if (spec.min != null) n = Math.max(spec.min, n);
      if (spec.max != null) n = Math.min(spec.max, n);
      return n;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      return undefined;
    case "enum": {
      const hit = spec.options.find((o) => o.value === value || String(o.value).toLowerCase() === String(value).toLowerCase());
      return hit ? hit.value : undefined;
    }
    case "string":
      return typeof value === "string" ? value : String(value);
    default:
      return undefined;
  }
}

/**
 * Every setting, filled from defaults, coerced and clamped. Unknown keys are
 * dropped (they can't affect a slice). A canonical key wins over an alias.
 * @param {object} [raw]     doc.settings as stored (any writer, any age)
 * @param {object} [legacy]  top-level fields of an old bambu-slicer doc (`printer`)
 */
export function normalizeSettings(raw, legacy = null) {
  const out = { ...DEFAULT_SETTINGS };
  const src = raw && typeof raw === "object" ? raw : {};
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (src[key] === undefined && src[alias] !== undefined) {
      const v = coerce(SPEC_BY_KEY[key], src[alias]);
      if (v !== undefined) out[key] = v;
    }
  }
  if (legacy && src.printer === undefined && typeof legacy.printer === "string" && legacy.printer) out.printer = legacy.printer;
  for (const spec of SETTINGS) {
    const v = coerce(spec, src[spec.key]);
    if (v !== undefined) out[spec.key] = v;
  }
  return out;
}

/** The key a slice is recorded against: the effective settings, stable JSON. */
export function settingsKey(settings) {
  return stableStringify(normalizeSettings(settings));
}

/**
 * The writes for setting one key. Choosing a filament also writes its preset
 * temperatures and fan, in the same change, so the doc shows what will print.
 * Nothing else is ever written as a side effect (layer height does not touch
 * the first layer height).
 * @returns {object | null} { key: value, ... } or null if the value doesn't fit
 */
export function settingWrites(key, value) {
  const spec = SPEC_BY_KEY[ALIASES[key] ?? key];
  if (!spec) return null;
  const v = coerce(spec, value);
  if (v === undefined) return null;
  const writes = { [spec.key]: v };
  if (spec.key === "filament") {
    const f = FILAMENTS[v];
    writes.nozzleTemp = f.nozzleTemp;
    writes.bedTemp = f.bedTemp;
    writes.fanSpeed = f.fanSpeed;
  }
  return writes;
}

/**
 * Writes for a batch of settings (an agent call, a "make slice job"): each one
 * through settingWrites, except that temperatures or fan given explicitly
 * beat the filament preset whatever order they come in.
 * @returns {{ writes: object, rejected: string[] }}
 */
export function settingsWrites(patch) {
  const writes = {};
  const rejected = [];
  const entries = Object.entries(patch ?? {}).filter(([, v]) => v !== undefined);
  // filament first, so explicit temperatures overwrite its preset
  entries.sort(([a], [b]) => (a === "filament" ? -1 : b === "filament" ? 1 : 0));
  for (const [k, v] of entries) {
    const w = settingWrites(k, v);
    if (w) Object.assign(writes, k === "filament" || (ALIASES[k] ?? k) === "filament" ? w : { [ALIASES[k] ?? k]: w[ALIASES[k] ?? k] });
    else rejected.push(k);
  }
  return { writes, rejected };
}

export function filamentDensity(name) {
  return FILAMENTS[name]?.density ?? FILAMENTS.PLA.density;
}
