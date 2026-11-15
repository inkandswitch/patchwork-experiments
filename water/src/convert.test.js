// The world's water as a stage reads it (convert.js): W5 (frames) and W6
// (time), each over the finite space WATER.md names. Nothing is randomized.
import { describe, expect, it } from "vitest";
import { createSurface } from "./surface.js";
import { createTiming, latch, levelOf, readerFor, tauOf } from "./convert.js";

import golden from "./test/golden.json";
const harbour = golden.seas.find((s) => s.name === "Harbour");
const sloop = golden.seas.find((s) => s.name === "Ship at sea");
const value = (sea, level = 0) => ({ v: 1, level, components: sea.components, look: { seed: sea.seed } });

// ─── 4×4 column-major matrices, the long way (the check doesn't share convert.js's algebra) ───
const mul = (A, B) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k];
  return o;
};
const compose = ({ yaw = 0, t = [0, 0, 0], s = 1, tilt = 0 }) => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(tilt), sx = Math.sin(tilt);
  // R = Ry(yaw) · Rx(tilt), scaled, then translated
  const Ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const S = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
  return mul(T, mul(mul(Ry, Rx), S));
};
const point = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
const dir = (M, v) => [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2]);
function invert(M) {
  // a similarity's inverse: (s R)ᵀ / s², and −that · T
  const s2 = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
  const L = [M[0], M[4], M[8], 0, M[1], M[5], M[9], 0, M[2], M[6], M[10], 0, 0, 0, 0, 1].map((v, i) => (i % 4 === 3 ? v : v / s2));
  const t = dir(L, [M[12], M[13], M[14]]);
  L[12] = -t[0];
  L[13] = -t[1];
  L[14] = -t[2];
  L[15] = 1;
  return L;
}
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

/** The world's water mapped by M, computed the long way: what a reader through M must answer. */
function expectedThrough(M, world, level, x, z, tau) {
  const Mi = invert(M);
  const [xw, , zw] = point(M, [x, 0, z]);
  const h = world.heightAt(xw, zw, tau);
  const height = point(Mi, [xw, h + level, zw])[1];
  const n = world.normalAt(xw, zw, tau, [0, 0, 0]);
  const normal = unit(dir(Mi, n));
  const y = height - 0.7; // a point under the caller's surface
  const pw = point(M, [x, y, z]);
  const v = world.velocityAt(pw[0], pw[1] - level, pw[2], tau, [0, 0, 0]);
  const velocity = dir(Mi, v);
  const D = world.displaced(xw, zw, tau, [0, 0, 0, 0]);
  const back = point(Mi, [D[0], D[1] + level, D[2]]);
  return { height, normal, y, velocity, displaced: [...back, D[3]] };
}

const YAWS = [0, 30, 90, 137, 180].map((d) => (d * Math.PI) / 180);
const MOVES = [[0, 0, 0], [40, 0, 25], [40, 0, -25], [-40, 0, 25], [-40, 0, -25]];
const SCALES = [0.5, 1, 2];
const RISES = [0, 2];
const GRID = [-30, -20, -10, 0, 10, 20, 30];
const TS = [0, 3.7, 1000];

describe("frames (W5): through a level similarity the reader is the world's water mapped by the frame", () => {
  const world = createSurface(harbour.components);
  const level = 0.4;
  const check = (M, label) => {
    const timing = createTiming(false);
    latch(timing, { t: 0, running: true }, 0);
    const r = readerFor(value(harbour, level), { matrix: M }, timing);
    expect(r, label).not.toBeNull();
    let worst = 0;
    const err = (a, b) => (worst = Math.max(worst, ...(Array.isArray(a) ? a.map((v, i) => Math.abs(v - b[i])) : [Math.abs(a - b)])));
    for (const x of GRID)
      for (const z of GRID)
        for (const t of TS) {
          const e = expectedThrough(M, world, level, x, z, t);
          err(r.heightAt(x, z, t), e.height);
          err(r.normalAt(x, z, t, [0, 0, 0]), e.normal);
          const smp = r.sampleAt(x, z, t, [0, 0, 0, 0]);
          err(smp, [e.height, ...e.normal]);
          err(r.velocityAt(x, e.y, z, t, [0, 0, 0]), e.velocity);
          err(r.displaced(x, z, t, [0, 0, 0, 0]), e.displaced);
        }
    expect(worst, label).toBeLessThan(1e-9);
  };

  for (const yaw of YAWS)
    for (const s of SCALES)
      it(`yaw ${Math.round((yaw * 180) / Math.PI)}°, scale ${s}: × translation × rise, on a 7×7 grid × t ∈ {0, 3.7, 1000}`, () => {
        for (const t of MOVES) for (const rise of RISES) check(compose({ yaw, t: [t[0], rise, t[2]], s }), `t ${t} rise ${rise}`);
      });

  it("links two and three deep: the frames composed", () => {
    const A = compose({ yaw: YAWS[1], t: [40, 0, 25], s: 1 });
    const B = compose({ yaw: YAWS[3], t: [-40, 2, -25], s: 0.5 });
    const C = compose({ yaw: YAWS[4], t: [40, 0, -25], s: 2 });
    for (const M of [mul(A, B), mul(B, A), mul(mul(A, B), C), mul(mul(C, B), A)]) check(M, "composed");
  });

  it("a tilted frame gives no reader (2°, 5°, about X, and under a yaw and a scale)", () => {
    const timing = createTiming(false);
    for (const deg of [2, 5])
      for (const yaw of [0, YAWS[2]])
        for (const s of [1, 2]) {
          const M = compose({ yaw, tilt: (deg * Math.PI) / 180, s });
          expect(levelOf({ matrix: M })).toBeNull();
          expect(readerFor(value(harbour), { matrix: M }, timing)).toBeNull();
        }
  });

  it("no value, another version, or no components: no reader", () => {
    const timing = createTiming(true);
    expect(readerFor(null, null, timing)).toBeNull();
    expect(readerFor({ ...value(harbour), v: 2 }, null, timing)).toBeNull();
    expect(readerFor({ v: 1, level: 0 }, null, timing)).toBeNull();
  });

  it("the outermost's own reader at level 0 is the evaluator, unwrapped (W1: alone is today)", () => {
    const r = readerFor(value(sloop), null, createTiming(true));
    const raw = createSurface(sloop.components);
    for (const s of sloop.samples) {
      expect(r.heightAt(s.x, s.z, s.t) === raw.heightAt(s.x, s.z, s.t)).toBe(true);
      expect(r.heightAt(s.x, s.z, s.t) === s.height).toBe(true);
    }
    // a level is a translation of the world: heights rise by it, nothing else changes
    const raised = readerFor(value(sloop, 1.5), null, createTiming(true));
    for (const s of sloop.samples.slice(0, 8)) expect(raised.heightAt(s.x, s.z, s.t) - 1.5).toBeCloseTo(s.height, 12);
  });
});

describe("time (W6): τ is the world's time at the moment the caller's clock shows t", () => {
  const DTS = [0, 1 / 60, 0.1, 0.25, 1.0];
  /** Every frame sequence of length ≤ 3 over DTS, each frame optionally pausing or resuming the world. */
  function* sequences() {
    const events = [null, "pause", "resume"];
    const frames = [];
    for (const dt of DTS) for (const ev of events) frames.push({ dt, ev });
    for (const a of frames) {
      yield [a];
      for (const b of frames) {
        yield [a, b];
        for (const c of frames) yield [a, b, c];
      }
    }
  }
  const STEP = 1 / 60;
  const clamp = (dt) => Math.min(0.25, dt);

  for (const coComputed of [true, false])
    for (const order of ["world first", "caller first"])
      it(`co-computed ${coComputed}, clocks tick ${order}, every sequence of ≤ 3 frames over dt {0, 1/60, 0.1, 0.25, 1} with pauses and resumes: τ exact and non-decreasing when co-computed and running, else within one frame`, () => {
        let checked = 0;
        for (const seq of sequences()) {
          // the world (H) and the caller (a boat, A): each clock advances by its frame's dt (clamped) while it runs;
          // not co-computed, the world is followed and lags by its own frame (here: it advances by half the frame)
          const H = { t: 100, running: true };
          const A = { t: 0 };
          const timing = createTiming(false);
          latch(timing, H, A.t);
          let lastTau = -Infinity;
          for (const { dt, ev } of seq) {
            if (ev === "pause") H.running = false;
            if (ev === "resume") H.running = true;
            const tickH = () => {
              if (H.running) H.t += coComputed ? clamp(dt) : clamp(dt) / 2;
            };
            const taus = [];
            const tickA = () => {
              // the caller's process steps on the grid, reading τ for each substep with the last latched Δ
              const from = A.t;
              A.t += clamp(dt);
              for (let k = Math.floor(from / STEP + 1e-9) + 1; k * STEP <= A.t + 1e-12; k++) {
                const tau = tauOf(timing, k * STEP);
                // non-decreasing while co-computed and running (a pause landing or a slewing follower may step back, by at most a frame: Decisions 14)
                if (coComputed && seq.every((f) => !f.ev) && tau < lastTau - 1e-12) throw new Error(`τ went back: ${tau} < ${lastTau}`);
                lastTau = tau;
                taus.push([k * STEP, tau]);
              }
            };
            if (order === "world first") (tickH(), tickA());
            else (tickA(), tickH());
            // after every clock has ticked: latch
            latch(timing, H, A.t);
            for (const [t, tau] of taus) {
              // the world's time at the caller's t, as this frame ended
              const truth = H.running ? t + timing.delta : H.t;
              if (coComputed && seq.every((f) => !f.ev)) expect(Math.abs(tau - truth)).toBeLessThan(1e-9);
              else expect(Math.abs(tau - truth)).toBeLessThanOrEqual(clamp(dt) + 1e-9);
              checked++;
            }
            // and the latch itself: τ now is the world's t (running), or the world's frozen t (paused)
            expect(Math.abs(tauOf(timing, A.t) - H.t)).toBeLessThan(1e-9);
          }
        }
        expect(checked).toBeGreaterThan(0);
      });

  it("τ's slope is 1 while the world runs and 0 while it's paused; the outermost's τ is t itself", () => {
    const timing = createTiming(false);
    latch(timing, { t: 50, running: true }, 10);
    for (const t of [10, 10.5, 13]) expect(tauOf(timing, t)).toBe(t + 40);
    latch(timing, { t: 50, running: false }, 10);
    for (const t of [10, 10.5, 13]) expect(tauOf(timing, t)).toBe(50);
    const mine = createTiming(true);
    latch(mine, { t: 50, running: false }, 10);
    for (const t of [0, 1.25, 1e4]) expect(tauOf(mine, t)).toBe(t);
  });

  it("paused world water has no velocity; running, it has the world's", () => {
    const timing = createTiming(false);
    const M = compose({ yaw: 0.5, t: [10, 0, 5] });
    latch(timing, { t: 20, running: false }, 3);
    const r = readerFor(value(harbour), { matrix: M }, timing);
    expect(r.velocityAt(1, -0.5, 2, 3, [9, 9, 9])).toEqual([0, 0, 0]);
    latch(timing, { t: 20, running: true }, 3);
    expect(Math.hypot(...r.velocityAt(1, -0.5, 2, 3, [0, 0, 0]))).toBeGreaterThan(0);
  });
});
