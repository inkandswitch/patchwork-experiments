// COMBINE — a fan-in lensN. Inlets a,b,c,d each carry any JSON value; the `out`
// outlet is an OBJECT containing only the inlets that are WIRED and whose current
// value is not `undefined`. Recomputed whenever any inlet changes.
//
// WRITE side: `out` is bidirectional — writing an object back fans each slot out
// to its inlet's source (`fanOut`). A slot carrying the SKIP sentinel (or absent /
// undefined) declines the write: that source is not touched. See SKIP in lenses.js.
//
// Mirrors mountCounter/mountSample's contract: an inlet is an opstream-like
// { value, connect(cb)->off }; connect fires immediately with the snapshot and
// then on each change. We subscribe to every inlet and recompute on any callback.
import { Source, apply as applyOp } from "./opstreams.js";
import { anySchema, snapshot, isSnapshot, valuesEqual } from "./ops.js";
import { SKIP, isSkip } from "./lenses.js";
export { SKIP, isSkip }; // the fan-in's write-side sentinel (defined with the lenses)

const NAMES = ["a", "b", "c", "d"];

// PURE: build the combined object — drop any key whose value is `undefined`.
// (An inlet that's unwired is absent from `inlets`; an inlet wired but carrying
// `undefined` is dropped here too.)
export function combine(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// PURE: read the live values of the present inlets into a plain object, then
// combine() to drop the undefined ones.
export function collect(inlets = {}, names = NAMES) {
  const raw = {};
  for (const name of names) {
    const inlet = inlets[name];
    if (inlet) raw[name] = inlet.value;
  }
  return combine(raw);
}

// PURE: the WRITE side of the fan-in (lensN SKIP). Fan a written-back object out
// to the inlet sources, one write per slot. A slot DECLINES the write when it is
// absent from the object, `undefined`, or carries the SKIP sentinel — its source
// is left untouched. Only writable inlets (those with `apply`) receive anything,
// and a write that wouldn't change the source is skipped (idempotent — no loops).
export function fanOut(obj, inlets = {}, names = NAMES) {
  if (!obj || typeof obj !== "object") return;
  for (const name of names) {
    const inlet = inlets[name];
    if (!inlet || typeof inlet.apply !== "function") continue;
    if (!(name in obj)) continue; // absent slot — leave that source alone
    const v = obj[name];
    if (v === undefined || isSkip(v)) continue; // SKIP: "don't write this source"
    if (valuesEqual(v, inlet.value)) continue;
    inlet.apply(snapshot(v));
  }
}

export function mountCombine({ element, inlets = {}, setOutlet }) {
  const out = new Source(combine({}));
  // BIDI: writing an object back into `out` fans each slot to its inlet's source
  // (the combined value then recomputes from the inlets' own change events).
  out.apply = (op) => fanOut(isSnapshot(op) ? op.value : applyOp(out.value, op), inlets);
  if (setOutlet) setOutlet("out", out);

  const root = document.createElement("div");
  root.className = "ns-source ns-flow ns-combine";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(status);
  element.append(root);

  const recompute = () => {
    const value = collect(inlets);
    out.push(value);
    const keys = Object.keys(value);
    try {
      status.textContent = keys.length ? "{ " + keys.join(", ") + " }" : "(nothing wired)";
    } catch {
      status.textContent = "combine";
    }
  };

  // connect to every present inlet; each connect fires immediately (initial
  // snapshot) and again on every change — we recompute on all of them.
  const offs = [];
  for (const name of NAMES) {
    const inlet = inlets[name];
    if (inlet && inlet.connect) offs.push(inlet.connect(recompute));
  }
  recompute();

  return () => { offs.forEach((o) => o()); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "combine",
  name: "Combine",
  icon: "Combine",
  inlets: [
    { name: "a", type: "json", schema: anySchema() },
    { name: "b", type: "json", schema: anySchema() },
    { name: "c", type: "json", schema: anySchema() },
    { name: "d", type: "json", schema: anySchema() },
  ],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  async load() {
    return mountCombine;
  },
};
