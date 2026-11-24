// The output policy (output.js), over every re-simulation pattern in a small
// window. A model timeline: every tick has a label, and stepping it again
// either keeps the label or gives it a fresh one. A tick's output depends on
// its label and its predecessor's: its samples ramp from where the previous
// tick ended to where this one ends, and its events are its label's parity.
// So a re-simulation can leave a tick's output exactly as it was (dedupe),
// change its events, its samples, or both, and break the stream's
// continuity at any boundary, the way a real engine's does.
//
// Each frame: maybe rewind to a tick r at or above the frontier and within W
// of the head, re-stepping every tick from r with each label kept or fresh
// (2^(head - r) patterns); then step the head 0, 1 or 2 ticks further (0: a
// frame that only re-simulates, as when paused or out of budget); the
// frontier trails the head by C. Every sequence of F frames (43,905), at lags
// 0, 1, 2 and confirmed-only, then everything confirmed: about 11 million
// checks. Each of these fails it: no crossfade, no dedupe, no splice
// detection, a correction not remembered, and the old timeline's next tick
// forgotten while a splice waits.
import { Outputs, fade } from "./output.js";

const N = 4; // samples per tick
const W = 3; // deepest rewind
const C = 3; // the frontier trails the head by this
const F = 4; // frames
const LATE = W + 1;

const end = (t, label) => (((t * 5 + label * 3) % 7) / 7) - 0.5;
function output(labels, t) {
  const a = t === 0 ? 0 : end(t - 1, labels[t - 1]);
  const b = end(t, labels[t]);
  const samples = new Float32Array(N);
  for (let i = 0; i < N; i++) samples[i] = a + ((b - a) * (i + 1)) / N;
  return { audio: { rate: 1, channels: 1, samples }, events: new Uint8Array([labels[t] & 1]) };
}
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Every frame plan: [rewind to r (or null), keep/fresh bits for the re-stepped ticks, ticks to advance].
function* frames(now, f, k) {
  if (k === 0) return yield [];
  for (const advance of [0, 1, 2])
    for (let r = Math.max(f, now - W); r <= now; r++) {
      const n = now - r;
      for (let bits = 0; bits < (r === now ? 1 : 1 << n); bits++)
        for (const rest of frames(now + advance, Math.max(f, now + advance - C), k - 1))
          yield [[r === now ? null : r, bits, advance], ...rest];
    }
}

function tally() {
  const t = { checks: 0, failures: 0, first: null };
  t.check = (ok, what) => {
    t.checks++;
    if (!ok && t.failures++ === 0) t.first = what();
  };
  return t;
}

test.each([0, 1, 2, Infinity])(
  "every re-simulation pattern of F frames, at lag %s: each tick once, in order, corrected exactly when changed, and no click",
  (lag) => {
    const t = tally();
    let runs = 0, spliced = 0, corrected = 0;
    for (const plan of frames(0, 0, F)) {
      runs++;
      const o = new Outputs({ lag, late: LATE, stale: 100 });
      o.start(0);
      const labels = [];
      let fresh = 0, now = 0, f = 0;
      const step = (tick) => o.stepped(tick, output(labels, tick));
      const heard = []; // what the listener was given, by tick: { events, samples, on }
      const stream = []; // every sample played, in order
      let next = 0;
      const frame = (r, bits, advance) => {
        if (r !== null) {
          for (let tick = r; tick < now; tick++) if (bits & (1 << (tick - r))) labels[tick] = ++fresh;
          for (let tick = r; tick < now; tick++) step(tick);
        }
        for (let k = 0; k < advance; k++) {
          labels[now] = ++fresh;
          step(now++);
        }
        f = Math.max(f, now - C);
        const before = o.stats.spliced;
        o.deliver(now, f);
        const items = o.take();
        let spliceSeen = 0;
        for (const it of items) {
          const what = () => ({ plan, lag, it, next, now, f });
          if (it.was) {
            // A correction: of a delivered tick, still in reach, whose events
            // the listener has wrong, to what they are now.
            t.check(it.tick < next && it.tick >= next - LATE, what);
            t.check(!equal(it.was, it.events), what);
            t.check(equal(it.was, heard[it.tick].events), what);
            t.check(equal(it.events, output(labels, it.tick).events), what);
            heard[it.tick].events = it.events;
            corrected++;
            continue;
          }
          // A delivery: the next tick, due, with the model's output now.
          t.check(it.tick === next, what);
          t.check(it.tick < f || it.tick < now - lag, what);
          const want = output(labels, it.tick);
          t.check(equal(it.events, want.events), what);
          const prev = heard[it.tick - 1];
          const joins = prev && !equal(prev.on, output(labels, it.tick - 1).audio.samples);
          if (joins) {
            spliceSeen++;
            const last = it.audio.samples[N - 1];
            t.check(last === want.audio.samples[N - 1], what);
          } else t.check(equal(it.audio.samples, want.audio.samples), what);
          heard[it.tick] = { events: it.events, on: want.audio.samples };
          stream.push(...it.audio.samples);
          next++;
        }
        t.check(o.stats.spliced - before === spliceSeen, () => ({ plan, lag, spliceSeen }));
        spliced += spliceSeen;
        // Everything due was delivered, and nothing in reach is left wrong.
        const due = Math.min(now, Math.max(f, now - lag));
        t.check(next === Math.max(0, due), () => ({ plan, lag, next, due }));
        for (let tick = Math.max(0, next - LATE); tick < next; tick++)
          t.check(equal(heard[tick].events, output(labels, tick).events), () => ({ plan, lag, tick }));
      };
      for (const [r, bits, advance] of plan) frame(r, bits, advance);
      // Then everything is confirmed.
      f = now;
      frame(null, 0, 0);
      // No click: every step between played samples is at most what a ramp
      // can do (1/N) plus what a crossfade adds (1/N). Unfaded, a splice can
      // jump by up to 1.
      for (let i = 1; i < stream.length; i++)
        t.check(Math.abs(stream[i] - stream[i - 1]) <= 2 / N + 1e-6, () => ({ plan, lag, i, stream }));
    }
    expect(t.first).toBe(null);
    expect(t.failures).toBe(0);
    // The patterns reach every case: splices and corrections happen, except
    // where only confirmed ticks are delivered.
    if (lag === Infinity) expect(spliced + corrected).toBe(0);
    else expect(spliced * corrected).toBeGreaterThan(0);
    expect(runs).toBe(43_905);
  },
  60_000,
);

test("a stream behind the clock skips to it, as a gap, and fades in from silence", () => {
  const o = new Outputs({ lag: 2, late: 4, stale: 8 });
  o.start(100);
  o.skip(105); // within stale: nothing
  expect(o.take()).toEqual([]);
  o.skip(200);
  const labels = [];
  for (let t = 0; t < 200; t++) labels[t] = 1;
  for (let t = 190; t < 200; t++) o.stepped(t, output(labels, t));
  o.deliver(200, 200);
  const items = o.take();
  expect(items[0]).toEqual({ gap: [100, 198] });
  expect(items.slice(1).map((i) => i.tick)).toEqual([198, 199]);
  // The first tick after the gap rises from 0 to its own end.
  const first = items[1].audio.samples;
  const want = output(labels, 198).audio.samples;
  expect(first[N - 1]).toBe(want[N - 1]);
  expect(Math.abs(first[0])).toBeLessThanOrEqual(Math.abs(want[0]) / N + 1e-7);
  expect(items[2].audio.samples).toEqual(output(labels, 199).audio.samples);
  expect(o.stats.skipped).toBe(98);
  // Outputs of ticks behind the stream are not even asked for.
  expect(o.wants(197 - 4)).toBe(false);
  // Confirmed-only (an infinite lag) skips to `stale` behind the clock.
  const c = new Outputs({ lag: Infinity, late: 4, stale: 8 });
  c.start(100);
  c.skip(116);
  expect(c.take()).toEqual([]);
  c.skip(200);
  expect(c.take()).toEqual([{ gap: [100, 192] }]);
});

test("fade: the last frame is the target's, a shorter source holds its last frame, null is silence", () => {
  const to = { channels: 2, samples: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]) };
  expect([...fade(null, to)]).toEqual([0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1]);
  const from = { channels: 2, samples: new Float32Array([-1, 0]) };
  expect([...fade(from, to)]).toEqual([-0.5, 0.25, 0, 0.5, 0.5, 0.75, 1, 1]);
});
