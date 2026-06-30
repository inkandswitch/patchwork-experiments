// Range map — a sketchy:window node that remaps an incoming number linearly from
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
import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, numberSchema } from "./ops.js";

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
  const src = inlets.in;
  const out = new Source(undefined, { schema: numberSchema() });
  if (setOutlet) setOutlet("out", out);

  let cfg = normalizeConfig(config);

  const root = document.createElement("div");
  root.className = "ns-range-map ns-source";

  const grid = document.createElement("div");
  grid.className = "ns-range-map-grid";

  const inputs = {};
  for (const { key, label } of FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "ns-range-map-field";
    const span = document.createElement("span");
    span.className = "ns-range-map-label";
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "ns-text ns-range-map-input";
    input.value = String(cfg[key]);
    inputs[key] = input;
    wrap.append(span, input);
    grid.append(wrap);
  }

  const clampWrap = document.createElement("label");
  clampWrap.className = "ns-range-map-clamp";
  const clampBox = document.createElement("input");
  clampBox.type = "checkbox";
  clampBox.checked = cfg.clamp;
  const clampLabel = document.createElement("span");
  clampLabel.textContent = "clamp";
  clampWrap.append(clampBox, clampLabel);

  const status = document.createElement("div");
  status.className = "ns-source-status";

  root.append(grid, clampWrap, status);
  element.append(root);

  const recompute = () => {
    const x = src ? src.value : undefined;
    const y = remap(x, cfg);
    out.push(y);
    status.textContent = `${num(x, 0)} → ${y}`;
  };

  const persist = () => { if (setConfig) setConfig({ ...cfg }); };

  for (const { key } of FIELDS) {
    inputs[key].oninput = () => {
      cfg = { ...cfg, [key]: num(inputs[key].value, cfg[key]) };
      persist();
      recompute();
    };
  }
  clampBox.oninput = () => {
    cfg = { ...cfg, clamp: !!clampBox.checked };
    persist();
    recompute();
  };

  // bidirectional: if downstream writes `out` and the source is editable, invert
  // the mapping to figure out what `in` would produce that `out`, and write it
  // back. (A zero-width out range isn't invertible → leave the source alone.)
  if (src && typeof src.apply === "function") {
    out.apply = (op) => {
      const cur = out.value;
      const next = isSnapshot(op) ? op.value : applyOp(cur, op);
      const back = invert(next, cfg);
      if (back !== undefined) src.apply(snapshot(back));
    };
  }

  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => { if (off) off(); root.remove(); };
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
  type: "sketchy:window",
  id: "range-map",
  name: "Range map",
  icon: "Ruler",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountRangeMap;
  },
};
