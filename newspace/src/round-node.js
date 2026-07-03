// Round — a sketchy:surface node that rounds an incoming number to N decimal places
// using a chosen rounding mode.
//
//   in:number  ──▶  round  ──▶  out:number
//
// Two persisted fields drive it:
//   decimals  how many decimal places to keep (config.decimals, default 0).
//             Negative values are clamped to 0 (you can't keep negative places).
//   mode      "round" | "floor" | "ceil"     (config.mode, default "round")
//
// The pure transform lives in `roundTo` so it can be unit-tested with no DOM.
import { numberSchema } from "./ops.js";
import { mountTransformSurface, fmtValue } from "./transform-surface.js";

export const MODES = [
  { name: "round", label: "round", fn: Math.round },
  { name: "floor", label: "floor", fn: Math.floor },
  { name: "ceil", label: "ceil", fn: Math.ceil },
];

export const DEFAULT_MODE = "round";
export const DEFAULT_DECIMALS = 0;

// look up a rounding mode fn by name (falls back to the default mode).
export function modeFn(name) {
  const m = MODES.find((o) => o.name === name) || MODES.find((o) => o.name === DEFAULT_MODE);
  return m.fn;
}

// THE PURE TRANSFORM. Round x to `decimals` decimal places under `mode`.
//   • decimals is coerced to an integer; negative ⇒ clamped to 0.
//   • non-finite input (NaN/±Infinity/non-number) ⇒ NaN.
//   • the rounding is done by scaling: round(x * 10^d) / 10^d.
export function roundTo(x, decimals = 0, mode = DEFAULT_MODE) {
  const xn = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(xn)) return NaN;
  let d = Math.trunc(Number(decimals));
  if (!Number.isFinite(d) || d < 0) d = 0;
  const fn = modeFn(mode);
  const factor = Math.pow(10, d);
  return fn(xn * factor) / factor;
}

// normalise the config the transform sees (single source of truth).
export function normalizeConfig(config = {}) {
  let d = Math.trunc(Number(config.decimals));
  if (!Number.isFinite(d) || d < 0) d = DEFAULT_DECIMALS;
  let mode = typeof config.mode === "string" ? config.mode : DEFAULT_MODE;
  if (!MODES.some((m) => m.name === mode)) mode = DEFAULT_MODE;
  return { decimals: d, mode };
}

// small display helper (pure & exported for testability).
export const fmt = fmtValue;

// the mount: a number field + a mode <select>, recomputing `out` from `in`.
export function mountRound({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  return mountTransformSurface({
    className: "ns-round",
    schema: numberSchema(),
    normalize: normalizeConfig,
    fields: [
      { key: "decimals", label: "decimals", type: "number", min: 0, step: 1 },
      { key: "mode", label: "mode", type: "select", options: MODES },
    ],
    compute: (x, cfg) => roundTo(x, cfg.decimals, cfg.mode),
    status: (x, y, cfg) => `${cfg.mode}(${fmt(x)}, ${cfg.decimals}) = ${fmt(y)}`,
  }, { element, inlets, setOutlet, config, setConfig });
}

export const plugin = {
  type: "sketchy:surface",
  id: "round",
  name: "Round",
  icon: "Hash",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountRound;
  },
};
