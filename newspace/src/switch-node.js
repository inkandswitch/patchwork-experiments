// SWITCH — a multiplexer. The `sel` (number) inlet picks ONE of the value inlets
// `a`,`b`,`c`,`d` (0→a, 1→b, 2→c, 3→d), clamped into range, and forwards it to
// `out`. Recomputes whenever `sel` or the currently-selected input changes.
import { Source } from "./opstreams.js";
import { anySchema, numberSchema } from "./ops.js";

// the order the index maps onto — index 0 selects names[0], etc.
export const NAMES = ["a", "b", "c", "d"];

// PURE: pick the value at floor(sel) from `values`, clamped to [0, len-1].
// An empty array has nothing to pick → undefined. Non-finite sel ⇒ index 0.
export function pick(sel, values) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  let i = Math.floor(Number(sel));
  if (!Number.isFinite(i)) i = 0;
  if (i < 0) i = 0;
  if (i > values.length - 1) i = values.length - 1;
  return values[i];
}

export function mountSwitch({ element, inlets = {}, setOutlet }) {
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);

  const root = document.createElement("div");
  root.className = "ns-source ns-flow ns-switch";
  const big = document.createElement("div");
  big.className = "ns-flow-big";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(big, status);
  element.append(root);

  const recompute = () => {
    const sel = inlets.sel ? inlets.sel.value : undefined;
    const values = NAMES.map((n) => (inlets[n] ? inlets[n].value : undefined));
    const v = pick(sel, values);
    out.push(v);
    const idx = Math.max(0, Math.min(NAMES.length - 1, Math.floor(Number(sel)) || 0));
    big.textContent = NAMES[idx];
    try { status.textContent = typeof v === "string" ? v : JSON.stringify(v); }
    catch { status.textContent = "—"; }
  };

  // subscribe to sel + every value inlet; connect fires immediately so the first
  // recompute happens on mount with the current snapshots.
  const offs = [];
  if (inlets.sel && inlets.sel.connect) offs.push(inlets.sel.connect(recompute));
  for (const n of NAMES) if (inlets[n] && inlets[n].connect) offs.push(inlets[n].connect(recompute));
  recompute();

  return () => { offs.forEach((o) => o && o()); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "switch",
  name: "Switch",
  icon: "ToggleLeft",
  inlets: [
    { name: "sel", type: "number", schema: numberSchema() },
    { name: "a", type: "json", schema: anySchema() },
    { name: "b", type: "json", schema: anySchema() },
    { name: "c", type: "json", schema: anySchema() },
    { name: "d", type: "json", schema: anySchema() },
  ],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  async load() { return mountSwitch; },
};
