// A Clamp node: takes a number on `in`, pins it inside [min, max], emits on `out`.
// The bounds are two persisted number fields (config.min default 0, config.max
// default 1). If min > max the bounds are swapped before clamping. Non-finite
// input yields NaN. The pure transform lives in `clampTo` so it can be
// unit-tested with no DOM.
import { Source } from "./opstreams.js";
import { numberSchema } from "./ops.js";

export const DEFAULTS = { min: 0, max: 1 };

// Coerce anything to a finite number, falling back to `fallback`.
export function num(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// THE PURE TRANSFORM. Pin `x` into the inclusive interval [min, max]. If the
// bounds are inverted (min > max) they're swapped first, so the box always
// describes a valid interval. Non-finite input (NaN/Infinity/non-number) ⇒ NaN.
export function clampTo(x, min, max) {
  if (typeof x !== "number" || !Number.isFinite(x)) return NaN;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, x));
}

// Coerce config to the two finite bounds — single source of truth for the mount.
export function normalizeConfig(config = {}) {
  return {
    min: num(config.min, DEFAULTS.min),
    max: num(config.max, DEFAULTS.max),
  };
}

// small display helper (kept pure & exported for testability).
export function fmt(v) {
  if (v === undefined) return "∅";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  return String(v);
}

// The two editable number fields, in display order.
export const FIELDS = [
  { key: "min", label: "min" },
  { key: "max", label: "max" },
];

// the mount: two <input type=number> fields + a readout, recomputing `out` from
// `in` and the bounds on input or field change.
export function mountClamp({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  const out = new Source(undefined, { schema: numberSchema() });
  if (setOutlet) setOutlet("out", out);

  let cfg = normalizeConfig(config);

  const root = document.createElement("div");
  root.className = "ns-clamp ns-source";

  const grid = document.createElement("div");
  grid.className = "ns-clamp-grid";

  const inputs = {};
  for (const { key, label } of FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "ns-clamp-field";
    const span = document.createElement("span");
    span.className = "ns-clamp-label";
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "ns-text ns-clamp-input";
    input.value = String(cfg[key]);
    inputs[key] = input;
    wrap.append(span, input);
    grid.append(wrap);
  }

  const status = document.createElement("div");
  status.className = "ns-source-status";

  root.append(grid, status);
  element.append(root);

  const recompute = () => {
    const x = src ? src.value : undefined;
    const y = clampTo(num(x, NaN), cfg.min, cfg.max);
    out.push(y);
    status.textContent = `clamp(${fmt(x)}, ${cfg.min}, ${cfg.max}) = ${fmt(y)}`;
  };

  const persist = () => { if (setConfig) setConfig({ ...cfg }); };

  for (const { key } of FIELDS) {
    inputs[key].oninput = () => {
      cfg = { ...cfg, [key]: num(inputs[key].value, cfg[key]) };
      persist();
      recompute();
    };
  }

  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => { if (off) off(); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "clamp",
  name: "Clamp",
  icon: "Brackets",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountClamp;
  },
};
