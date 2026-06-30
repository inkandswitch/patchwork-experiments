// Flow-control nodes that consume BANGs (see the bang/timer sources). These react
// to a trigger inlet's EMIT — skipping the initial connect snapshot so they only
// fire on an actual bang, not on mount.
import { Source } from "./opstreams.js";

// subscribe to a stream's emits, ignoring the first (initial snapshot) callback
function onBang(stream, fn) {
  if (!stream || !stream.connect) return () => {};
  let first = true;
  return stream.connect(() => { if (first) { first = false; return; } fn(); });
}

// COUNTER — a `+` bang increments, a `-` bang decrements, a `reset` bang zeroes it.
// (A plain `bang` inlet still works as +1.) The count is PERSISTED in config so it
// survives a remount (wiring another inlet re-runs the mount — that must NOT reset it).
export function mountCounter({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  let n = Number(config.n) || 0;
  const out = new Source(n);
  if (setOutlet) setOutlet("count", out);
  const root = document.createElement("div"); root.className = "ns-source ns-flow";
  const big = document.createElement("div"); big.className = "ns-flow-big"; big.textContent = String(n);
  root.append(big); element.append(root);
  const set = () => { out.push(n); big.textContent = String(n); if (setConfig) setConfig({ n }); };
  const offs = [
    onBang(inlets["+"], () => { n++; set(); }),
    onBang(inlets["-"], () => { n--; set(); }),
    onBang(inlets.reset, () => { n = 0; set(); }),
    onBang(inlets.bang, () => { n++; set(); }),
  ];
  return () => { offs.forEach((o) => o()); root.remove(); };
}

// SAMPLE & HOLD — on a bang at `trigger`, emit the CURRENT value of `value`. Gates a
// continuously-changing stream down to the moments you bang it.
export function mountSample({ element, inlets = {}, setOutlet }) {
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);
  const root = document.createElement("div"); root.className = "ns-source ns-flow";
  const status = document.createElement("div"); status.className = "ns-source-status"; status.textContent = "bang to sample";
  root.append(status); element.append(root);
  const off = onBang(inlets.trigger, () => {
    const v = inlets.value ? inlets.value.value : undefined;
    out.push(v);
    try { status.textContent = "held: " + (typeof v === "string" ? v : JSON.stringify(v)); } catch { status.textContent = "held"; }
  });
  return () => { off(); root.remove(); };
}
