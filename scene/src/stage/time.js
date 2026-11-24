// The one source of time a stage runs on (NATIVE.md, "Native services").
//
// Everything in a stage that moves with time takes it from here: the frame
// loop (and with it every extension's `api.loop`, the bodies' walking and
// looking, a ride, remote poses' playback), world time (the `"clock"` service: it
// ticks once a frame at this source's now), the timers that wait (a hold's
// keepalive, an extension's linger, arrival's polling and its content wait,
// a notice's life, a die's tumble) and the wall reads that stamp or measure
// (presence samples, a claim's grace, a seat's confirm). An extension gets
// it as `api.now()` and `api.after(ms, fn)`.
//
// - **Real** (`realTime()`, the default): `now()` is `Date.now()`, the epoch
//   in ms that peers' stamps are compared on (presence samples, a round's
//   `at`); frames are the browser's requestAnimationFrame, timers setTimeout.
// - **Manual** (`manualTime()`, for probes and tests): nothing moves until
//   it is stepped. `tick()` runs one frame of exactly `frameMs`: first every
//   timer due by its end, in due order (now() reads each one's due time while
//   it runs), then every frame callback asked for before it, at its end. A
//   timer set from inside a timer five deep or more waits at least 4 ms, as
//   a browser's does (HTML's nesting clamp): a chain of them re-arming at 0
//   would otherwise never let the frame end, where on the wall it merely
//   spins.
//   `step(n)` runs n ticks back to back, yielding to the event loop after
//   each (so promises, a doc's change events and loading land between
//   frames, as they would in a browser), and asks only the last one to draw
//   (`draw`, the frame callback's second argument: a frame not drawn still
//   moves everything, it only skips the picture). It never reads the wall,
//   sets a real timer or asks for a real frame.
//
// Everything in the kernel waits on this source, the outside world
// included: a package's load timeout and the registry settling, content's
// builds, retries and who builds (../content/lock.js). A manual source moves
// them only when stepped, so a probe or a test steps it to see a build. The
// cost of a frame (`perf`) is measured on performance.now: it is CPU time,
// not time in the scene. Yielding the thread (yieldThread, below) is not time
// either: it is the page's scheduling, the same under either source.

/** From this deep in timer callbacks, a timer waits at least 4 ms (HTML's timer nesting clamp). */
const NESTING_CLAMP = 5;
/** A frame's length at 60 Hz (ms): the manual source's default. */
export const FRAME_MS = 1000 / 60;
/**
 * A manual source's now() before its first tick (ms). Small, so a frame's
 * length survives subtraction: at the epoch's 1.8e12 ms a double keeps only
 * 1e-4 ms, which a frame's dt would lose (world time then falls off its
 * 1/60 s grid); here it keeps 1e-10 ms. Not 0, so no stamp is ever falsy.
 */
export const MANUAL_EPOCH = 1_000_000;

/**
 * The browser's time: the wall, its frames, its timers.
 * @returns {Time}
 */
export function realTime() {
  const now = () => Date.now();
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis);
  return Object.freeze({
    manual: false,
    now,
    frame(fn) {
      if (raf) {
        const h = raf(() => fn(now(), true));
        return () => caf(h);
      }
      const h = setTimeout(() => fn(now(), true), 16);
      return () => clearTimeout(h);
    },
    after(ms, fn) {
      const h = setTimeout(fn, Math.max(0, Number(ms) || 0));
      return () => clearTimeout(h);
    },
  });
}

/**
 * Yield the thread for one turn of the page's event loop: every microtask
 * drained, and whatever I/O is ready delivered. Scheduling, not time: it is
 * the same under real and manual time, so a manual source nobody steps
 * doesn't hold it up. Work that lets the page breathe between chunks (the
 * GLB queue between parses) yields with this; whatever waits for time to
 * pass waits on a source's `after`.
 * @returns {Promise<void>}
 */
export const yieldThread = () =>
  new Promise((resolve) => {
    if (typeof MessageChannel === "function") {
      const c = new MessageChannel();
      c.port1.onmessage = () => {
        c.port1.close();
        resolve();
      };
      c.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });

/**
 * A source that moves only when stepped.
 * @param {{ start?: number, frameMs?: number, yieldTo?: () => Promise<void> }} [o]
 *   `yieldTo`: what step() awaits between frames (one event-loop turn)
 * @returns {ManualTime}
 */
export function manualTime({ start = MANUAL_EPOCH, frameMs = FRAME_MS, yieldTo = yieldThread } = {}) {
  if (!(frameMs > 0)) throw new Error("manualTime: frameMs must be positive");
  let frames = 0; // ticks run
  let t = start; // now(): start + frames × frameMs between ticks; a timer's due time while it runs
  let seq = 0;
  const asked = new Map(); // seq → fn, for the next frame
  const timers = new Map(); // seq → { at, fn, nesting }
  let nesting = 0; // how deep in timer callbacks the one running now is (0: not in one)
  const failed = []; // errors thrown by callbacks, newest last (kept: a probe reports them)

  const run = (fn, ...args) => {
    try {
      fn(...args);
    } catch (err) {
      failed.push(err);
      if (failed.length > 100) failed.shift();
      console.error("[scene] a callback on the manual clock failed", err);
    }
  };
  /** The timer due first (ties: the one set first), or null. */
  function nextTimer(by) {
    let best = null;
    for (const [id, tm] of timers) if (tm.at <= by && (!best || tm.at < best[1].at || (tm.at === best[1].at && id < best[0]))) best = [id, tm];
    return best;
  }

  const time = {
    manual: true,
    frameMs,
    now: () => t,
    frame(fn) {
      const id = ++seq;
      asked.set(id, fn);
      return () => asked.delete(id);
    },
    after(ms, fn) {
      const id = ++seq;
      const level = nesting + 1;
      const wait = Math.max(level >= NESTING_CLAMP ? 4 : 0, Number(ms) || 0);
      timers.set(id, { at: t + wait, fn, nesting: level });
      return () => timers.delete(id);
    },
    /**
     * One frame, synchronously: the timers due by its end, then the frame
     * callbacks asked for before it. A `still` frame takes no time: the
     * timers already due and the frame callbacks run (an update flush, a
     * loop with dt 0), and nothing that moves with time moves. It isn't
     * counted in frames().
     */
    tick({ draw = true, still = false } = {}) {
      const end = still ? t : start + (frames + 1) * frameMs;
      for (let next = nextTimer(end); next; next = nextTimer(end)) {
        timers.delete(next[0]);
        t = Math.max(t, next[1].at);
        nesting = next[1].nesting;
        run(next[1].fn);
        nesting = 0;
      }
      if (!still) frames++;
      t = end;
      const now = [...asked.values()];
      asked.clear();
      for (const fn of now) run(fn, t, draw);
      return t;
    },
    /**
     * n frames back to back, an event-loop turn after each; only the last
     * draws, and not even that with `draw: false` (sampling the world frame
     * by frame wants no pictures). `still`: frames that take no time (a
     * wait on real work, such as crypto, with the world held where it is).
     * → now()
     */
    async step(n = 1, { draw = true, still = false } = {}) {
      n = Math.max(0, Math.floor(n));
      for (let i = 0; i < n; i++) {
        time.tick({ draw: draw && i === n - 1, still });
        await yieldTo();
      }
      return t;
    },
    /** As many frames as `ms` takes (rounded up). → now() */
    advance(ms, o) {
      return time.step(Math.max(0, Math.ceil(Math.max(0, ms) / frameMs - 1e-9)), o);
    },
    /**
     * Step one frame at a time until `pred()` is truthy (asked before each
     * frame, and after the last) → its value. Its frames don't draw unless
     * `draw` (a condition on what's drawn: a label's place on the page);
     * a picture after wants a step(1). After `frames` frames it throws, with
     * `what` and `state()` in the message: a wait that fails says so, and
     * says what it saw.
     */
    async until(pred, { frames: most = 600, what = "the condition", state = null, draw = false } = {}) {
      for (let i = 0; ; i++) {
        let v;
        try {
          v = await pred();
        } catch {
          v = false;
        }
        if (v) return v;
        if (i >= most) {
          let seen = "";
          try {
            seen = state ? ` — ${JSON.stringify(await state())}`.slice(0, 2000) : "";
          } catch (err) {
            seen = ` — (its state threw: ${err?.message ?? err})`;
          }
          throw new Error(`not ${what} after ${most} frames (${((most * frameMs) / 1000).toFixed(2)} s)${seen}`);
        }
        time.tick({ draw });
        await yieldTo();
      }
    },
    /** frames run so far */
    frames: () => frames,
    /** what is waiting: frame callbacks asked for, timers set */
    pending: () => ({ frames: asked.size, timers: timers.size }),
    /** errors thrown by callbacks it ran (newest last) */
    errors: () => [...failed],
  };
  return Object.freeze(time);
}

/**
 * @typedef {{ manual: boolean, now(): number, frame(fn: (now: number, draw: boolean) => void): () => void, after(ms: number, fn: () => void): () => void }} Time
 * @typedef {Time & { frameMs: number, tick(o?: { draw?: boolean, still?: boolean }): number, step(n?: number, o?: { draw?: boolean, still?: boolean }): Promise<number>, advance(ms: number, o?: { draw?: boolean }): Promise<number>, until<T>(pred: () => T | Promise<T>, o?: { frames?: number, what?: string, state?: () => any, draw?: boolean }): Promise<T>, frames(): number, pending(): { frames: number, timers: number }, errors(): any[] }} ManualTime
 */
