// The rollback core, exhaustively over small windows; the spec it is held to
// is the engine stepped from boot with each port's known input, or its last
// known one repeated.
// - Every arrival order of the inputs of 3 ticks × 2 ports, interleaved every
//   way with the 3 ticks of the local clock, advancing after each event: the
//   state is always the spec's, put() reports a re-step exactly when the
//   spec changed below the clock, and a confirmed state is the in-order run's.
// - Every arrival tick of those inputs, with a local port at input delay 0, 1
//   and 2, at snapshot spacing 1, 2 and 4: the same, and each checkpoint is
//   handed over once, with the in-order state.
// - Every change between two beliefs about one port's 3 inputs (unknown, A or
//   B each), at every pair of clock positions, rewinding across memory growth.
import { readFileSync } from "node:fs";
import { compile } from "../engine.js";
import { hashSnapshot } from "../wasm-state.js";
import { Timeline } from "./timeline.js";

const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("timeline");
const machine = await compile(wasm);
const ALLOC = 1, FREE = 2, BIG = 0x80;
const W = 3;

const v = (dx, buttons) => new Uint8Array([dx & 0xff, buttons]);
// Ports 0 and 1 vary; 2 and 3 are known from the start. Port 0 repeats itself
// once, and so does port 1, so a prediction is sometimes right. (Memory growth
// across a rollback is the belief-change test's: its B grows at tick 2.)
const X = [
  [v(1, ALLOC), v(1, ALLOC), v(-2, FREE)],
  [v(-1, 0), v(2, ALLOC), v(2, ALLOC)],
  [v(0, ALLOC), v(0, 0), v(1, FREE)],
  [v(3, 0), v(-3, ALLOC), v(0, 0)],
];
const ZERO = new Uint8Array(2);

// The spec, independent of the timeline: the rows stepped to reach tick n
// under a belief (belief[p][t]: bytes or undefined), and the state they give,
// memoized. States are compared as snapshots, byte for byte (cheaper than
// hashing the toy's 128 KB).
const scratch = machine.boot(content);
const genesis = scratch.snapshot();
function rowsKey(belief, n) {
  let key = "";
  for (let t = 0; t < n; t++)
    for (let p = 0; p < 4; p++) {
      let b = belief[p][t];
      for (let s = t - 1; !b && s >= 0; s--) b = belief[p][s];
      key += (b ? b[0] + "." + b[1] : "0.0") + (p < 3 ? "," : "|");
    }
  return key;
}
const memo = new Map();
function spec(belief, n) {
  const key = rowsKey(belief, n);
  if (!memo.has(key)) {
    scratch.restore(genesis);
    for (const r of key.split("|").slice(0, n))
      scratch.step(new Uint8Array(r.split(",").flatMap((x) => x.split(".").map(Number))));
    memo.set(key, scratch.snapshot());
  }
  return memo.get(key);
}
const full = X.map((xs) => [...xs]);
const ref = Array.from({ length: W + 1 }, (_, n) => spec(full, n));
const same = (a, b) => Buffer.compare(a, b) === 0;
// The timelines' engine: one instance, put back to genesis for each run
// (restore is exact, which the toy's own test establishes).
const live = machine.boot(content);
const fresh = () => {
  live.restore(genesis);
  return live;
};

// Every distinct sequence of the given input events and `ticks` clock ticks ("T").
function* orders(items, ticks) {
  if (items.length === 0 && ticks === 0) return yield [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of orders(rest, ticks)) yield [items[i], ...tail];
  }
  if (ticks > 0) for (const tail of orders(items, ticks - 1)) yield ["T", ...tail];
}

// Failures are counted, not expect()ed, in the hot loops: a quarter of a
// million runs, and the first failure is kept for the message.
function tally() {
  const t = { checks: 0, failures: 0, first: null };
  t.check = (ok, what) => {
    t.checks++;
    if (!ok && t.failures++ === 0) t.first = what();
  };
  return t;
}

test("the in-order run differs at every tick", () => {
  expect(new Set(ref.map((s) => hashSnapshot(s))).size).toBe(W + 1);
});

test("every arrival order of 3 ticks × 2 ports, interleaved every way with the clock, advancing after each event", () => {
  // put() says whether the state must be re-stepped; that must be exactly
  // when the spec's rows below the clock changed. The state is compared with
  // the spec's whenever either changed, and at the end.
  const inputs = [];
  for (const p of [0, 1]) for (let t = 0; t < W; t++) inputs.push([p, t]);
  const t = tally();
  let runs = 0, rewinds = 0, buf;
  for (const order of orders(inputs, W)) {
    const belief = [[], [], [...X[2]], [...X[3]]];
    const tl = new Timeline(fresh(), { every: 1 });
    for (const p of [2, 3]) for (let k = 0; k < W; k++) tl.put(p, k, X[p][k]);
    let target = 0, key = rowsKey(belief, 0);
    for (const ev of order) {
      let changed = false;
      if (ev === "T") target++;
      else {
        const [p, k] = ev;
        belief[p][k] = X[p][k];
        changed = tl.put(p, k, X[p][k]);
        if (changed) rewinds++;
        const now = rowsKey(belief, target);
        t.check(changed === (now !== key), () => ({ order, ev, changed }));
      }
      tl.advance(target);
      const was = key;
      key = rowsKey(belief, target);
      if (ev === "T" || changed || key !== was) {
        buf = tl.engine.snapshot(buf);
        t.check(tl.now === target && same(buf, spec(belief, target)), () => ({ order, ev }));
        if (tl.frontier >= tl.now) t.check(same(buf, ref[tl.now]), () => ({ order, ev, confirmed: true }));
      }
    }
    buf = tl.engine.snapshot(buf);
    t.check(tl.frontier >= W && same(buf, ref[W]), () => ({ order, end: true }));
    runs++;
  }
  expect(t.first).toBe(null);
  expect(runs).toBe(60480);
  expect(rewinds).toBeGreaterThan(0);
}, 60_000);

test("every arrival tick of 3 ticks × 2 remote ports × a local port at delay 0, 1, 2 × snapshot spacing 1, 2, 4", () => {
  // Ports 0 and 1 are remote: each of their 6 inputs arrives after 0..3 clock
  // ticks (4^6 ways). Port 2 is local: its input for tick k is put when the
  // clock reaches k - d. Ticks 0 and 2 are checkpoints; each must be handed
  // over once, with the in-order state.
  const t = tally();
  let runs = 0, handedOver = 0, buf;
  for (const every of [1, 2, 4])
    for (const d of [0, 1, 2])
      for (let a = 0; a < 4 ** 6; a++) {
        const slot = [0, 1, 2, 3, 4, 5].map((i) => Math.floor(a / 4 ** i) % 4);
        const belief = [[], [], [], [...X[3]]];
        const handed = new Map();
        const tl = new Timeline(fresh(), {
          every,
          marks: (k) => k % 2 === 0,
          confirmed: (k, snap) => {
            t.check(!handed.has(k), () => ({ every, d, a, twice: k }));
            handed.set(k, snap);
          },
        });
        for (let k = 0; k < W; k++) tl.put(3, k, X[3][k]);
        for (let target = 0; target <= W; target++) {
          for (let k = 0; k < W; k++)
            if (Math.max(0, k - d) === target) tl.put(2, k, (belief[2][k] = X[2][k]));
          slot.forEach((s, i) => {
            const p = i < 3 ? 0 : 1, k = i % 3;
            if (s === target) tl.put(p, k, (belief[p][k] = X[p][k]));
          });
          tl.advance(target);
          buf = tl.engine.snapshot(buf);
          t.check(same(buf, spec(belief, target)), () => ({ every, d, a, target }));
        }
        t.check(tl.frontier >= W && same(buf, ref[W]), () => ({ every, d, a, end: true }));
        t.check(handed.size === 1 && handed.has(2) && same(handed.get(2), ref[2]), () => ({ every, d, a, handed: [...handed.keys()] }));
        handedOver += handed.size;
        runs++;
      }
  expect(t.first).toBe(null);
  expect(runs).toBe(9 * 4096);
  expect(handedOver).toBe(runs);
}, 60_000);

test("every change of one port's belief, between every pair of clock positions", () => {
  // Port 0's belief over 3 ticks: each tick unknown, A or B. Ports 1-3 known.
  const A = [v(1, 0), v(2, ALLOC), v(3, 0)];
  const B = [v(1, 0), v(-2, FREE), v(0, BIG)];
  const states = [];
  for (let k = 0; k < 27; k++) states.push([0, 1, 2].map((t) => [undefined, A[t], B[t]][Math.floor(k / 3 ** t) % 3]));
  let cases = 0, refused = 0;
  for (const s1 of states)
    for (const s2 of states)
      for (let n1 = 0; n1 <= W; n1++)
        for (let n2 = 0; n2 <= W; n2++) {
          const tl = new Timeline(fresh(), { every: 1 });
          for (const p of [1, 2, 3]) for (let t = 0; t < W; t++) tl.put(p, t, X[p][t]);
          s1.forEach((b, t) => tl.put(0, t, b));
          tl.advance(n1);
          expect(same(tl.engine.snapshot(), spec([s1, X[1], X[2], X[3]], n1))).toBe(true);
          const below = s2.some((b, t) => t < tl.floor && !sameInput(b, s1[t]));
          if (below) {
            const t = s2.findIndex((b, t) => t < tl.floor && !sameInput(b, s1[t]));
            expect(() => tl.put(0, t, s2[t])).toThrow(RangeError);
            refused++;
            continue;
          }
          s2.forEach((b, t) => t >= tl.floor && tl.put(0, t, b));
          tl.advance(n2);
          // The state never goes below the floor: a target behind it stops there.
          const at = Math.max(n2, tl.floor);
          expect(tl.now).toBe(at);
          expect(same(tl.engine.snapshot(), spec([s2, X[1], X[2], X[3]], at))).toBe(true);
          cases++;
        }
  expect(cases + refused).toBe(27 * 27 * 16);
  expect(refused).toBeGreaterThan(0);
});

test("a port that never arrives: snapshots stay capped, and its inputs arriving late repair everything", () => {
  const N = 120;
  const tl = new Timeline(machine.boot(content), { every: 1, max: 8 });
  const belief = [[], [], [], []];
  for (let t = 0; t < N; t++)
    for (const p of [1, 2, 3]) {
      belief[p][t] = v((t * (p + 1)) % 5, t % 3 ? ALLOC : FREE);
      tl.put(p, t, belief[p][t]);
    }
  for (let n = 1; n <= N; n++) {
    tl.advance(n);
    expect(tl.snapshots).toBeLessThanOrEqual(8);
  }
  expect(tl.frontier).toBe(0);
  for (let t = N - 1; t >= 0; t--) {
    belief[0][t] = v(t % 4, t % 2 ? ALLOC : 0);
    tl.put(0, t, belief[0][t]);
  }
  tl.advance(N);
  expect(tl.frontier).toBe(N);
  expect(same(tl.engine.snapshot(), spec(belief, N))).toBe(true);
});

test("where every input is known, snapshots are rare but the floor still moves", () => {
  const tl = new Timeline(fresh(), { every: 4 });
  for (let p = 0; p < 4; p++) for (let t = 0; t < 200; t++) tl.put(p, t, v(t % 3, 0));
  let taken = 0;
  for (let n = 1; n <= 200; n++) {
    const before = tl.snapshots;
    tl.advance(n);
    if (tl.snapshots > before) taken++;
  }
  expect(taken).toBeLessThanOrEqual(Math.ceil(200 / 64) + 1);
  expect(tl.floor).toBeGreaterThanOrEqual(128);
});

test("every arrival order again, one step per event: inputs arriving mid-re-simulation are never lost", () => {
  // The host steps on a time budget, so a rollback's re-simulation can span
  // frames, and inputs (late ones included) land between its steps. Here
  // every event is followed by at most one step, at snapshot spacing 1 and
  // 2. After each, the state must be the spec's at wherever the timeline has
  // got to (behind the clock, mid-re-simulation), and once it catches up, the
  // in-order run's.
  const inputs = [];
  for (const p of [0, 1]) for (let t = 0; t < W; t++) inputs.push([p, t]);
  const t = tally();
  let runs = 0, behind = 0, buf;
  for (const every of [1, 2])
    for (const order of orders(inputs, W)) {
      const belief = [[], [], [...X[2]], [...X[3]]];
      const tl = new Timeline(fresh(), { every });
      for (const p of [2, 3]) for (let k = 0; k < W; k++) tl.put(p, k, X[p][k]);
      let target = 0;
      for (const ev of order) {
        if (ev === "T") target++;
        else {
          const [p, k] = ev;
          belief[p][k] = X[p][k];
          tl.put(p, k, X[p][k]);
        }
        tl.advance(target, 1);
        if (tl.now < target) behind++;
        buf = tl.engine.snapshot(buf);
        t.check(tl.now <= target && same(buf, spec(belief, tl.now)), () => ({ every, order, ev, now: tl.now }));
      }
      while (tl.advance(W, 1));
      buf = tl.engine.snapshot(buf);
      t.check(tl.now === W && tl.frontier >= W && same(buf, ref[W]), () => ({ every, order, end: true }));
      runs++;
    }
  expect(t.first).toBe(null);
  expect(runs).toBe(2 * 60480);
  expect(behind).toBeGreaterThan(0);
}, 120_000);

test("advance takes at most `limit` steps", () => {
  const tl = new Timeline(machine.boot(content));
  for (let p = 0; p < 4; p++) for (let t = 0; t < 10; t++) tl.put(p, t, ZERO);
  expect(tl.advance(10, 3)).toBe(3);
  expect(tl.now).toBe(3);
  expect(tl.advance(10)).toBe(7);
});

function sameInput(a, b) {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
