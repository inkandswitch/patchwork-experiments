// A DELAY node: re-emits each incoming value on `out` after a configurable delay (ms).
// Useful for staggering a dataflow, debouncing a bang, or animating handoffs. Each
// value is scheduled independently (a straight delay line, not a debounce).
import { Source } from "./opstreams.js";
import { anySchema, paramsSchema } from "./ops.js";

export const DEFAULT_MS = 300;
export const clampMs = (n) => { const v = Math.floor(Number(n)); return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MS; };

export function mountDelay({ element, inlets = {}, setOutlet, config = {}, setConfig, onConfig }) {
  const src = inlets.in;
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);
  let ms = "ms" in config ? clampMs(config.ms) : DEFAULT_MS;

  const root = document.createElement("div"); root.className = "ns-source ns-delay";
  const field = document.createElement("input"); field.type = "number"; field.min = "0"; field.className = "ns-text"; field.value = ms; field.style.cssText = "width:72px;";
  const status = document.createElement("div"); status.className = "ns-source-status"; status.textContent = "delay (ms)";
  root.append(field, status); element.append(root);

  const timers = new Set();
  let first = true;
  const off = src && src.connect ? src.connect(() => {
    if (first) { first = false; return; } // skip the initial snapshot — only delay CHANGES
    const v = src.value;
    const t = setTimeout(() => { timers.delete(t); out.push(v); }, ms);
    timers.add(t);
  }) : null;
  field.oninput = () => { ms = clampMs(field.value); if (setConfig) setConfig({ ms }); };
  // react to ms changed elsewhere — e.g. the properties-popup slider (node params)
  if (onConfig) onConfig((c) => { if ("ms" in c) { const m = clampMs(c.ms); if (m !== ms) { ms = m; field.value = String(m); } } });

  return () => { if (off) off(); for (const t of timers) clearTimeout(t); timers.clear(); root.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "delay",
  name: "Delay",
  icon: "Hourglass",
  inlets: [{ name: "in", type: "json", schema: anySchema() }],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  // a real param: selecting a Delay node shows a live "Delay (ms)" slider in the popup
  schema: paramsSchema([{ key: "ms", label: "Delay (ms)", type: "number", min: 0, max: 3000, step: 10, default: DEFAULT_MS }]),
  async load() { return mountDelay; },
};
