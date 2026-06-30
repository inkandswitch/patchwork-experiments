// BUFFER — a FIFO window over its `in` stream. Each new input value is pushed onto
// the tail of an array capped at `size` (config, default 16, editable via a number
// field); the oldest values fall off the front. The `out` outlet always carries the
// current array (an ordered list of the last N inputs). A bang on `reset` clears it
// back to empty. Shrinking `size` re-caps the existing buffer immediately.
import { Source } from "./opstreams.js";
import { anySchema, numberSchema } from "./ops.js";

export const DEFAULT_SIZE = 16;

// PURE: append `v` to `arr` and return a NEW array keeping only the LAST `n` items
// (FIFO, oldest dropped from the front). `n <= 0` ⇒ empty.
export function pushCapped(arr, v, n) {
  const cap = capSize(n);
  const next = (Array.isArray(arr) ? arr : []).concat([v]);
  return cap <= 0 ? [] : next.slice(Math.max(0, next.length - cap));
}

// PURE: re-cap an existing array to the last `n` items (used when size shrinks).
export function recap(arr, n) {
  const cap = capSize(n);
  const a = Array.isArray(arr) ? arr : [];
  return cap <= 0 ? [] : a.slice(Math.max(0, a.length - cap));
}

// PURE: coerce a config size to a sane integer cap (>= 0, default DEFAULT_SIZE).
export function capSize(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return DEFAULT_SIZE;
  return Math.max(0, x);
}

// subscribe to a stream's emits, ignoring the first (initial snapshot) callback so a
// bang is a true EMIT edge and not the mount-time snapshot.
function onBang(stream, fn) {
  if (!stream || !stream.connect) return () => {};
  let first = true;
  return stream.connect(() => { if (first) { first = false; return; } fn(); });
}

export function mountBuffer({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  let size = capSize(config.size);
  let buf = [];

  const out = new Source(buf, { schema: anySchema() });
  if (setOutlet) setOutlet("out", out);

  const root = document.createElement("div"); root.className = "ns-source ns-buffer";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:6px;align-items:center;";
  const label = document.createElement("span"); label.textContent = "size";
  const input = document.createElement("input");
  input.className = "ns-text ns-buffer-size"; input.type = "number"; input.min = "0";
  input.style.width = "5em"; input.value = String(size);
  bar.append(label, input);
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(bar, status); element.append(root);

  const emit = () => { out.push(buf); };
  const render = () => { status.textContent = `${buf.length} / ${size}`; };

  // the `in` inlet: each NEW snapshot (including the initial one, if `in` is wired)
  // pushes onto the buffer. We DON'T skip the first callback here — the current value
  // of a connected source is a real value worth buffering.
  let firstIn = true;
  const offIn = inlets.in && inlets.in.connect
    ? inlets.in.connect(() => {
        const v = inlets.in.value;
        // skip the connect snapshot only when the source has no value yet (undefined)
        if (firstIn) { firstIn = false; if (v === undefined) return; }
        buf = pushCapped(buf, v, size);
        emit(); render();
      })
    : () => {};

  const offReset = onBang(inlets.reset, () => { buf = []; emit(); render(); });

  input.onchange = () => {
    size = capSize(input.value);
    input.value = String(size);
    if (setConfig) setConfig({ size });
    buf = recap(buf, size);
    emit(); render();
  };

  emit(); render();
  return () => { offIn(); offReset(); root.remove(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "buffer",
  name: "Buffer",
  icon: "List",
  inlets: [
    { name: "in", type: "json", schema: anySchema() },
    { name: "reset", type: "bang" },
  ],
  outlets: [{ name: "out", type: "json", schema: anySchema() }], // an ARRAY of the last N inputs
  async load() { return mountBuffer; },
};
