// Round — a sketchy:window node that rounds an incoming number to N decimal places
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
import { Source } from "./opstreams.js";
import { numberSchema } from "./ops.js";

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
export function fmt(v) {
  if (v === undefined) return "∅";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  return String(v);
}

// the mount: a number field + a mode <select>, recomputing `out` from `in`.
export function mountRound({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  const out = new Source(undefined, { schema: numberSchema() });
  if (setOutlet) setOutlet("out", out);

  let cfg = normalizeConfig(config);

  const root = document.createElement("div");
  root.className = "ns-round ns-source";

  const decWrap = document.createElement("label");
  decWrap.className = "ns-round-field";
  const decLabel = document.createElement("span");
  decLabel.className = "ns-round-label";
  decLabel.textContent = "decimals";
  const decInput = document.createElement("input");
  decInput.type = "number";
  decInput.min = "0";
  decInput.step = "1";
  decInput.className = "ns-text ns-round-input";
  decInput.value = String(cfg.decimals);
  decWrap.append(decLabel, decInput);

  const select = document.createElement("select");
  select.className = "ns-round-select ns-text";
  for (const m of MODES) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.label;
    if (m.name === cfg.mode) opt.selected = true;
    select.append(opt);
  }

  const readout = document.createElement("div");
  readout.className = "ns-round-readout ns-source-status";

  root.append(decWrap, select, readout);
  element.append(root);

  const recompute = () => {
    const x = src ? src.value : undefined;
    const y = roundTo(x, cfg.decimals, cfg.mode);
    out.push(y);
    readout.textContent = `${cfg.mode}(${fmt(x)}, ${cfg.decimals}) = ${fmt(y)}`;
  };

  const persist = () => { if (setConfig) setConfig({ ...cfg }); };

  decInput.oninput = () => {
    cfg = normalizeConfig({ ...cfg, decimals: decInput.value });
    persist();
    recompute();
  };
  select.onchange = () => {
    cfg = normalizeConfig({ ...cfg, mode: select.value });
    persist();
    recompute();
  };

  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => {
    if (off) off();
    root.remove();
  };
}

export const plugin = {
  type: "sketchy:window",
  id: "round",
  name: "Round",
  icon: "Hash",
  inlets: [{ name: "in", type: "number", schema: numberSchema(), required: true }],
  outlets: [{ name: "out", type: "number", schema: numberSchema() }],
  async load() {
    return mountRound;
  },
};
