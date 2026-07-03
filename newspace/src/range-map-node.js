// Range map — a sketchy:surface node that remaps an incoming number linearly from
// one numeric range to another (a lerp / "map" box, excalidraw-of-numbers style).
//
//   in:number  ──▶  remap  ──▶  out:number
//
// Four persisted number fields define the mapping:
//   inMin, inMax   the source range
//   outMin, outMax the destination range
// plus an optional `clamp` checkbox that pins the result inside [outMin, outMax].
//
// The mapping is the classic remap:
//
//     t = (x - inMin) / (inMax - inMin)          // normalise to 0..1
//     y = outMin + t * (outMax - outMin)         // lerp into the out range
//
// A ZERO-WIDTH input range (inMin === inMax) has no slope to divide by; we treat
// it as "collapse to the start of the out range" (t = 0) rather than dividing by
// zero and emitting NaN/Infinity.
import { numberSchema } from "./ops.js";
import { mountTransformSurface } from "./transform-surface.js";

export const DEFAULTS = { inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: false };

// Coerce anything to a finite number, falling back to `fallback`.
export function num(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Pin `y` into the inclusive interval bounded by a,b (order-independent so an
// inverted out range — outMin > outMax — still clamps correctly).
export function clampTo(y, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (y < lo) return lo;
  if (y > hi) return hi;
  return y;
}

// THE PURE MAPPING. x → remapped number.
//   • identity when in-range === out-range
//   • inverts when out range is reversed (outMin > outMax)
//   • clamps to the out range when `clamp` is set
//   • zero-width in range ⇒ t=0 (no divide-by-zero) ⇒ outMin
export function remap(x, opts = {}) {
  const inMin = num(opts.inMin, DEFAULTS.inMin);
  const inMax = num(opts.inMax, DEFAULTS.inMax);
  const outMin = num(opts.outMin, DEFAULTS.outMin);
  const outMax = num(opts.outMax, DEFAULTS.outMax);
  const clamp = !!opts.clamp;
  const xn = num(x, NaN);
  if (!Number.isFinite(xn)) return outMin;

  const span = inMax - inMin;
  const t = span === 0 ? 0 : (xn - inMin) / span;
  let y = outMin + t * (outMax - outMin);
  if (clamp) y = clampTo(y, outMin, outMax);
  return y;
}

// Merge a config patch over current config, coercing the four numbers and the
// boolean — the single source of truth for "what config does the mapping see".
export function normalizeConfig(config = {}) {
  return {
    inMin: num(config.inMin, DEFAULTS.inMin),
    inMax: num(config.inMax, DEFAULTS.inMax),
    outMin: num(config.outMin, DEFAULTS.outMin),
    outMax: num(config.outMax, DEFAULTS.outMax),
    clamp: !!config.clamp,
  };
}

// The four editable number fields, in display order.
export const FIELDS = [
  { key: "inMin", label: "in min" },
  { key: "inMax", label: "in max" },
  { key: "outMin", label: "out min" },
  { key: "outMax", label: "out max" },
];

export function mountRangeMap({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  return mountTransformSurface({
    className: "ns-range-map",
    schema: numberSchema(),
    normalize: normalizeConfig,
    fields: [...FIELDS, { key: "clamp", label: "clamp", type: "checkbox" }],
    compute: remap,
    invert,
    status: (x, y) => `${num(x, 0)} → ${y}`,
  }, { element, inlets, setOutlet, config, setConfig });
}

// Inverse mapping (used for write-back): given a desired `y` in the out range,
// what `x` in the in range produces it? Returns undefined when the out range has
// zero width (not invertible).
export function invert(y, opts = {}) {
  const inMin = num(opts.inMin, DEFAULTS.inMin);
  const inMax = num(opts.inMax, DEFAULTS.inMax);
  const outMin = num(opts.outMin, DEFAULTS.outMin);
  const outMax = num(opts.outMax, DEFAULTS.outMax);
  const yn = num(y, NaN);
  if (!Number.isFinite(yn)) return undefined;
  const outSpan = outMax - outMin;
  if (outSpan === 0) return undefined;
  const t = (yn - outMin) / outSpan;
  return inMin + t * (inMax - inMin);
}

export const plugin = {
  type: "sketchy:surface",
  id: "range-map",
  name: "Range map",
  icon: "Ruler",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountRangeMap;
  },
};
