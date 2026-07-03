// perf.js — Phase 0 measurement scaffolding (PERF.md).
//
// Counters live on `window.__perf` so they're inspectable from the console;
// the overlay (toggled with the canvas's ` debug key) shows rolling frame
// times plus every counter with a per-second rate. `rafBatch` is the shared
// coalescing primitive later phases build on (Phase 1 defers gesture doc
// writes through it and `flush()`es on pointerup before endTxn).

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const host = typeof window !== "undefined" ? window : globalThis;

// counters() / count(name, n): named counters on window.__perf.
export function counters() {
  return host.__perf || (host.__perf = {});
}
export function count(name, n = 1) {
  const c = counters();
  c[name] = (c[name] || 0) + n;
  return c[name];
}

const raf = (cb) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(() => cb(now()), 16));
const caf = (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

// frame() — a counter bumped once per rAF. The loop still starts lazily on the
// first call (importing perf.js costs one visibilitychange listener, below, and
// nothing else). Phase 3 keys its cached viewport rect on this ("stable within
// a frame").
//
// The loop SELF-HEALS: a test that stubs requestAnimationFrame (fakeRaf +
// unstubAllGlobals) can strand the re-arm callback in a discarded fake queue,
// which would pin frameN for the rest of the worker — turning every perFrame
// cache into a forever-cache. So frame() restarts the loop — through the
// CURRENT global rAF — when the last tick is older than STALL_MS and the
// document isn't hidden (a hidden tab legitimately pauses rAF; perFrame stays
// fresh there via the visibility epoch instead). A generation token makes a
// superseded loop's tick a no-op, so there's never more than one live loop.
let frameN = 0;
let frameLoopStarted = false;
let frameGen = 0;
let lastTickAt = 0;
const STALL_MS = 250; // a real rAF ticks ~16ms; anything this old is stranded/paused

function startFrameLoop() {
  frameLoopStarted = true;
  lastTickAt = now();
  const gen = ++frameGen;
  const tick = () => {
    if (gen !== frameGen) return; // superseded (restart/reset) — don't re-arm
    frameN++;
    lastTickAt = now();
    raf(tick);
  };
  raf(tick);
}

export function frame() {
  if (!frameLoopStarted) startFrameLoop();
  else if (
    now() - lastTickAt > STALL_MS &&
    !(typeof document !== "undefined" && document.visibilityState === "hidden")
  ) startFrameLoop(); // stranded (or jank-stalled) — re-arm on the CURRENT rAF
  return frameN;
}

// test-only: forget the current loop (any still-queued tick becomes a no-op via
// the generation token) so the next frame() call starts a fresh one immediately.
export function __resetFrameLoop() {
  frameGen++;
  frameLoopStarted = false;
  lastTickAt = 0;
}

// perFrame's visibility epoch: rAF pauses in hidden tabs, freezing frameN at
// whatever it reached — while remote-change effects still run — so a
// frame-keyed cache WOULD return the pre-hide value forever. Bumping an epoch
// on visibilitychange makes the first read after a visibility flip fresh.
let visEpoch = 0;
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => { visEpoch++; });
}

// perFrame(read, frameFn=frame) — memoize `read()` for the duration of one rAF
// frame (Phase 3 keys the cached viewport rect on this: the rect is stable
// within a frame). While the frame loop has NEVER ticked (frameFn() still 0 —
// headless tests, or before the first rAF fires) every call falls through to a
// fresh read. A loop that started and then PAUSED (frameN frozen > 0) is the
// case that CAN pin a stale value, so the cache also keys on the visibility
// epoch above (hidden tab) and frame() self-heals stranded loops (stubbed rAF).
export function perFrame(read, frameFn = frame) {
  let at = -1;
  let atEpoch = -1;
  let value;
  return () => {
    const f = frameFn();
    if (f > 0 && f === at && visEpoch === atEpoch) return value;
    at = f;
    atEpoch = visEpoch;
    value = read();
    return value;
  };
}

// rafBatch(fn?) — coalesce many schedule() calls into ONE rAF callback, with
// the LATEST state winning. Two shapes:
//
//   const b = rafBatch();       // schedule a closure; only the latest runs
//   b.schedule(() => handle.change(applyLatestDeltas));
//
//   const b = rafBatch(write);  // fixed fn; runs once with the latest args
//   b.schedule(dx, dy);
//
// b.flush() runs any pending callback SYNCHRONOUSLY (cancelling the rAF) and
// clears it — Phase 1 calls this on pointerup BEFORE endTxn so the gesture
// ends with the doc fully current and the undo diff correct. Returns true if
// something ran. b.cancel() drops the pending callback without running it.
export function rafBatch(fn) {
  let pending = false;
  let latest;
  let id = 0;
  const run = () => {
    pending = false;
    const args = latest;
    latest = undefined;
    if (fn) fn(...args);
    else args[0]();
  };
  return {
    schedule(...args) {
      latest = args; // latest state wins
      if (!pending) { pending = true; id = raf(run); }
    },
    flush() {
      if (!pending) return false;
      caf(id);
      run();
      return true;
    },
    cancel() {
      if (!pending) return;
      caf(id);
      pending = false;
      latest = undefined;
    },
    get pending() { return pending; },
  };
}

// startOverlay(el) — a rAF loop writing rolling avg/min/max frame time (last
// ~120 frames) plus the __perf counters (total + rate/s since the previous
// repaint) into `el` as text, ~4×/s. Returns a stop() cleanup. Spec'd in
// PERF.md Phase 0 for the canvas's ` debug toggle; not wired up there yet.
export function startOverlay(el) {
  let stopped = false;
  let last = 0;
  let lastPaint = now();
  let lastCounts = {};
  const times = [];
  const tick = (t) => {
    if (stopped) return;
    if (t == null) t = now();
    if (last) {
      times.push(t - last);
      if (times.length > 120) times.shift();
    }
    last = t;
    if (t - lastPaint >= 250 && times.length) {
      let min = Infinity, max = 0, sum = 0;
      for (const d of times) { sum += d; if (d < min) min = d; if (d > max) max = d; }
      const lines = [`frame ${(sum / times.length).toFixed(1)}ms avg / ${min.toFixed(1)} min / ${max.toFixed(1)} max`];
      const c = counters();
      const dt = (t - lastPaint) / 1000;
      for (const k of Object.keys(c).sort()) {
        const rate = (c[k] - (lastCounts[k] || 0)) / dt;
        lines.push(`${k} ${c[k]} (${rate.toFixed(0)}/s)`);
        lastCounts[k] = c[k];
      }
      lastPaint = t;
      el.textContent = lines.join("\n");
    }
    raf(tick);
  };
  raf(tick);
  return () => { stopped = true; };
}
