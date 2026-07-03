// Throttle — a sketchy:surface node that rate-limits its input. It emits the
// LATEST value on `in` at most once per `ms` window, LEADING-EDGE:
//
//   • the first value arriving outside a window fires IMMEDIATELY (leading edge),
//     opening a window of `ms` milliseconds.
//   • values arriving DURING the window are suppressed — only the most recent one
//     is remembered.
//   • when the window closes, if any value was suppressed, the LAST one fires
//     (trailing edge), opening a fresh window.
//
//   in:json  ──▶  throttle (ms)  ──▶  out:json
//
// The initial connect snapshot is SKIPPED (mounting shouldn't fire) — like the
// delay node. The timing core lives in the pure `makeThrottle` factory so it can be
// unit-tested with no DOM by injecting `now()` + a `schedule`/`cancel` pair.
import { Source } from "./opstreams.js";
import { anySchema } from "./ops.js";

export const DEFAULT_MS = 200;

// Coerce a config value to a non-negative integer ms, falling back to DEFAULT_MS.
// (A throttle of 0ms is meaningful — "no rate limit" — so 0 is allowed; negatives
// and non-numbers fall back.)
export function clampMs(v, fallback = DEFAULT_MS) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

// THE PURE THROTTLE CORE. Build a leading+trailing throttle as a plain function you
// feed values to. Side-effects (emit / time / scheduling) are all injected so this
// is fully deterministic in a test:
//
//   getMs()   → the current window length (read fresh each call so a live UI edit
//               takes effect)
//   emit(v)   → deliver a value downstream
//   now()     → current time in ms (defaults to Date.now)
//   schedule(fn, ms) → run fn after ms, returning a handle (defaults to setTimeout)
//   cancel(handle)   → cancel a scheduled fn (defaults to clearTimeout)
//
// Returns `{ push(value), cancel() }`. `push` feeds a value through the throttle;
// `cancel()` clears any pending trailing timer (use on cleanup).
export function makeThrottle(getMs, emit, {
  now = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (h) => clearTimeout(h),
} = {}) {
  let last = 0;          // timestamp of the last EMIT (0 = never)
  let opened = false;    // has a window ever opened? (distinguishes "never fired")
  let pending = null;    // a suppressed { value } awaiting the trailing edge
  let timer = null;      // the trailing-edge timer handle

  const ms = () => clampMs(typeof getMs === "function" ? getMs() : getMs);

  const clearTimer = () => { if (timer != null) { cancel(timer); timer = null; } };

  // the trailing-edge fire: emit the last suppressed value, reopen the window.
  const fireTrailing = () => {
    timer = null;
    if (pending == null) return;
    const { value } = pending;
    pending = null;
    last = now();
    emit(value);
  };

  const push = (value) => {
    const window = ms();
    const t = now();

    // 0ms window (or no rate limit) → always pass through immediately.
    if (window <= 0) { clearTimer(); pending = null; last = t; opened = true; emit(value); return; }

    const elapsed = t - last;
    if (!opened || elapsed >= window) {
      // LEADING edge — outside any open window: fire now, open a window.
      clearTimer();
      pending = null;
      opened = true;
      last = t;
      emit(value);
      return;
    }

    // inside the window — suppress, remember the latest, ensure a trailing timer is
    // armed to fire at the window's end.
    pending = { value };
    if (timer == null) {
      const remaining = Math.max(0, window - elapsed);
      timer = schedule(fireTrailing, remaining);
    }
  };

  return { push, cancel: clearTimer };
}

export function mountThrottle({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  const out = new Source(undefined, { schema: anySchema() });
  if (setOutlet) setOutlet("out", out);

  let ms = clampMs(config.ms);

  const root = document.createElement("div");
  root.className = "ns-throttle ns-source";

  const field = document.createElement("label");
  field.className = "ns-throttle-field";
  const label = document.createElement("span");
  label.className = "ns-throttle-label";
  label.textContent = "ms";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.className = "ns-text ns-throttle-input";
  input.value = String(ms);
  field.append(label, input);

  const status = document.createElement("div");
  status.className = "ns-source-status";

  root.append(field, status);
  element.append(root);

  const throttle = makeThrottle(() => ms, (v) => {
    out.push(v);
    status.textContent = `▸ ${preview(v)}`;
  });

  input.oninput = () => {
    ms = clampMs(input.value);
    if (setConfig) setConfig({ ms });
  };

  // SKIP the initial connect snapshot — mounting must not fire. After the first
  // (snapshot) callback, every change feeds the throttle.
  let primed = false;
  const off = src && src.connect
    ? src.connect((op) => {
        if (!primed) { primed = true; return; } // drop the connect snapshot
        const value = op && op.type === "snapshot" ? op.value : (src ? src.value : undefined);
        throttle.push(value);
      })
    : null;

  return () => {
    if (off) off();
    throttle.cancel();
    root.remove();
  };
}

// small display helper for the readout (pure, exported for testability).
export function preview(v) {
  if (v === undefined) return "∅";
  if (typeof v === "string") return v.length > 24 ? v.slice(0, 24) + "…" : v;
  if (typeof v === "number") return String(v);
  try { const s = JSON.stringify(v); return s.length > 32 ? s.slice(0, 32) + "…" : s; } catch { return "{…}"; }
}

export const plugin = {
  type: "sketchy:surface",
  id: "throttle",
  name: "Throttle",
  icon: "Gauge",
  inlets: [{ name: "in", type: "json", schema: anySchema(), required: true }],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  async load() {
    return mountThrottle;
  },
};
