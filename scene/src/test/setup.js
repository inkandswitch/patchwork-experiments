// Every test file's setup (vitest.config.ts, setupFiles). flush()
// (fake-repo.js) waits for exactly the work that is due now and isn't on a
// clock a test steps, so it can't return before that work has run:
//
// - a SHA-256 digest (a build's hash) runs on Node's thread pool and
//   resolves whenever it is done: each one in flight is in `__offThread`;
// - a page timer set for "now" (setTimeout with no delay or 0: a queue
//   yielding between jobs, a settle window of 0) is due at once, and what it
//   runs may set another: each one pending is in `__dueTimers`;
// - a frame asked for (requestAnimationFrame: happy-dom runs it on the next
//   turn) is due at once too: each one pending is in `__dueFrames`. A frame
//   asked for by a frame's own callback is the next frame of something
//   animating (a loop, the clock ticking): that is time passing, not work
//   landing, so it isn't waited for (and on the real clock it never ends).
//
// A timer with a delay is time passing, not work landing: a test moves it
// (vi.useFakeTimers, or the stage's manualTime()), never waits for it here.

/** The off-thread work in flight now. */
const offThread = new Set();
globalThis.__offThread = offThread;

const subtle = globalThis.crypto?.subtle;
if (subtle) {
  const digest = subtle.digest.bind(subtle);
  Object.defineProperty(subtle, "digest", {
    configurable: true,
    value: (...args) => {
      const p = digest(...args);
      offThread.add(p);
      const done = () => offThread.delete(p);
      p.then(done, done);
      return p;
    },
  });
}

/** The page timers set for now, not yet run. */
const dueTimers = new Set();
globalThis.__dueTimers = dueTimers;
/** The page's own timers, for a flush to wait one turn on without counting itself. */
globalThis.__pageTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };

const { setTimeout: set, clearTimeout: clear } = globalThis.__pageTimers;
globalThis.setTimeout = function setTimeout(fn, ms, ...args) {
  if (typeof fn !== "function" || Number(ms) > 0) return set(fn, ms, ...args);
  const h = set(() => {
    dueTimers.delete(h);
    fn(...args);
  }, 0);
  dueTimers.add(h);
  return h;
};
globalThis.clearTimeout = function clearTimeout(h) {
  dueTimers.delete(h);
  return clear(h);
};

/** The frames asked for, not yet run. */
const dueFrames = new Set();
globalThis.__dueFrames = dueFrames;
if (typeof globalThis.requestAnimationFrame === "function") {
  const ask = globalThis.requestAnimationFrame.bind(globalThis);
  const cancel = globalThis.cancelAnimationFrame.bind(globalThis);
  let inFrame = false;
  globalThis.requestAnimationFrame = function requestAnimationFrame(fn) {
    const h = ask((t) => {
      dueFrames.delete(h);
      inFrame = true;
      try {
        fn(t);
      } finally {
        inFrame = false;
      }
    });
    if (!inFrame) dueFrames.add(h);
    return h;
  };
  globalThis.cancelAnimationFrame = function cancelAnimationFrame(h) {
    dueFrames.delete(h);
    return cancel(h);
  };
}
