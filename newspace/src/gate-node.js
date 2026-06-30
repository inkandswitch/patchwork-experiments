// GATE — run-on-bang / sample-on-trigger. Holds the latest value seen on the `in`
// inlet and emits it on `out` ONLY when a BANG arrives on the `bang` inlet. With no
// bang it never emits; updates on `in` alone are silently held. Repeated bangs
// re-emit whatever `in` is current at that moment.
import { Source } from "./opstreams.js";
import { anySchema } from "./ops.js";

// ── pure helpers (unit-testable without rendering) ───────────────────────────

// Subscribe to an inlet's emits, skipping the FIRST (initial connect snapshot)
// callback so we only react to true edges, not to mounting. Returns an off().
export function onBang(stream, fn) {
  if (!stream || !stream.connect) return () => {};
  let first = true;
  return stream.connect(() => {
    if (first) { first = false; return; }
    fn();
  });
}

// A tiny pure state machine: a held cell you can set() and read(). The gate keeps
// the latest `in` here and reads it out on bang. Kept separate so the gating logic
// is exercised without any DOM or opstreams.
export function makeHold(initial) {
  let held = initial;
  let hasValue = arguments.length > 0;
  return {
    set(v) { held = v; hasValue = true; },
    read() { return held; },
    hasValue() { return hasValue; },
  };
}

// Read the current snapshot value of an inlet (or undefined if absent).
export function inletValue(inlet) {
  return inlet ? inlet.value : undefined;
}

// ── mount ────────────────────────────────────────────────────────────────────

function mountGate({ element, inlets = {}, setOutlet }) {
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);

  const hold = makeHold();

  const root = document.createElement("div");
  root.className = "ns-source ns-flow ns-gate";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  status.textContent = "bang to pass";
  root.append(status);
  element.append(root);

  // Track the latest `in` value. connect fires immediately with the current
  // snapshot, then on each change — we keep them all (this never emits).
  const offIn = inlets.in && inlets.in.connect
    ? inlets.in.connect(() => { hold.set(inletValue(inlets.in)); })
    : () => {};

  // On a real bang (skipping the initial connect callback) emit the held `in`.
  const offBang = onBang(inlets.bang, () => {
    const v = hold.read();
    out.push(v);
    try {
      status.textContent = "passed: " + (typeof v === "string" ? v : JSON.stringify(v));
    } catch {
      status.textContent = "passed";
    }
  });

  return () => { offIn(); offBang(); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "gate",
  name: "Gate",
  icon: "DoorOpen",
  inlets: [
    { name: "in", type: "json", schema: anySchema() },
    { name: "bang", type: "bang" },
  ],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  async load() { return mountGate; },
};
