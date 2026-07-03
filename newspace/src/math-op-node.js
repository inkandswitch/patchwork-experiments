// A Math node: takes a number on `in`, applies a chosen unary op, emits on `out`.
// The op is picked from a <select> and persisted in config.op. Pure math lives in
// `mathOp` / `OPS` so it can be unit-tested with no DOM.
import { numberSchema } from "./ops.js";
import { mountTransformSurface, fmtValue } from "./transform-surface.js";

// the menu of unary operations — each a pure (number) -> number.
export const OPS = [
  { name: "abs", label: "abs", fn: (x) => Math.abs(x) },
  { name: "round", label: "round", fn: (x) => Math.round(x) },
  { name: "floor", label: "floor", fn: (x) => Math.floor(x) },
  { name: "ceil", label: "ceil", fn: (x) => Math.ceil(x) },
  { name: "negate", label: "negate", fn: (x) => -x },
  { name: "sqrt", label: "sqrt", fn: (x) => Math.sqrt(x) },
  { name: "sign", label: "sign", fn: (x) => Math.sign(x) },
  { name: "trunc", label: "trunc", fn: (x) => Math.trunc(x) },
];

export const DEFAULT_OP = "abs";

// look up an op by name (falls back to the default).
export function opByName(name) {
  return OPS.find((o) => o.name === name) || OPS.find((o) => o.name === DEFAULT_OP);
}

// the pure transform: apply the named unary op to x. Non-numeric input ⇒ NaN.
// (sqrt of a negative is NaN, which is the JS Math.sqrt behaviour we keep.)
export function mathOp(name, x) {
  if (typeof x !== "number" || Number.isNaN(x)) return NaN;
  return opByName(name).fn(x);
}

// the mount: a <select> over OPS + a readout, recomputing `out` from `in` & the op.
export function mountMathOp({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  let op = typeof config.op === "string" ? config.op : DEFAULT_OP;
  if (!OPS.some((o) => o.name === op)) op = DEFAULT_OP;
  return mountTransformSurface({
    className: "ns-mathop",
    schema: numberSchema(),
    normalize: (c = {}) => ({ op: OPS.some((o) => o.name === c.op) ? c.op : DEFAULT_OP }),
    fields: [{ key: "op", type: "select", options: OPS }],
    compute: (x, cfg) => mathOp(cfg.op, x),
    status: (x, y, cfg) => `${cfg.op}(${fmt(x)}) = ${fmt(y)}`,
  }, { element, inlets, setOutlet, config: { op }, setConfig });
}

// small display helper (kept pure & exported for testability).
export const fmt = fmtValue;

export const plugin = {
  type: "sketchy:surface",
  id: "math-op",
  name: "Math",
  icon: "Calculator",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountMathOp;
  },
};
