// Snapshot exactness from angles the engines' own tests do not take: a
// snapshot taken mid-rollback (after a restore, partway through re-stepping)
// is byte for byte the reference's at that tick, and restoring it into a
// fresh engine, into one that has outgrown it (a fresh instance underneath),
// into one compiled separately, or back into the engine that took it, goes
// on exactly as the reference does. Every input is fixed.
import { readFileSync } from "node:fs";
import { compile } from "./engine.js";
import { FULL } from "./test-tier.js";
import { pages } from "./wasm-state.js";
import { FOUR_PLAYERS, TWO_PLAYERS, pads } from "../engines/snes/test/unarmed.js";

const bytes = (x) => new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
const same = (a, b) => Buffer.compare(bytes(a), bytes(b)) === 0;
const sameFrame = (f, g) => f.width === g.width && f.height === g.height && same(f.rgba, g.rgba);

describe("toy: every mid-rollback snapshot", () => {
  const wasm = readFileSync(new URL("../engines/toy/dist/toy.wasm", import.meta.url));
  const content = new TextEncoder().encode("exactness");
  const N = 20;
  const ALLOC = 1, BIG = 0x80;
  const row = (t, k) => {
    const b = new Uint8Array(8);
    for (let p = 0; p < 4; p++) [b[2 * p], b[2 * p + 1]] = [((t * k + p) % 5) - 2, ((t + p) % 3 === 0 ? ALLOC : 0) | (t === 3 * k && p === k ? BIG : 0)];
    return b;
  };
  // A, the truth, grows memory at tick 6; P, the prediction a peer ran on, at 3.
  const A = Array.from({ length: N }, (_, t) => row(t, 2));
  const P = Array.from({ length: N }, (_, t) => row(t, 1));

  test("taken after restoring any state and re-stepping any distance, and restored four ways", async () => {
    const machine = await compile(wasm);
    const other = await compile(wasm); // a separately compiled module
    const ref = machine.boot(content);
    const states = [ref.snapshot()];
    const frames = [ref.frame(1)];
    for (let t = 0; t < N; t++) {
      ref.step(A[t]);
      states.push(ref.snapshot());
      frames.push(ref.frame(1));
    }
    let cases = 0, outgrown = 0;
    for (let s = 0; s <= N; s++)
      for (let k = 0; s + k <= N; k++) {
        // A peer that ran ahead on the prediction, then rolled back to s and
        // re-stepped k ticks of the truth: M is its state mid-rollback.
        const peer = machine.boot(content);
        for (let t = 0; t < N; t++) peer.step(P[t]);
        peer.restore(states[s]);
        for (let t = s; t < s + k; t++) peer.step(A[t]);
        const M = peer.snapshot();
        expect(same(M, states[s + k])).toBe(true);
        const big = machine.boot(content);
        for (let t = 0; t < N; t++) big.step(P[t]);
        if (pages(big.snapshot()) > pages(M)) outgrown++;
        for (const e of [machine.boot(content), big, other.boot(content), peer]) {
          if (e === peer) for (let t = s + k; t < N; t++) e.step(P[t]); // wander off again first
          e.restore(M);
          expect(sameFrame(e.frame(1), frames[s + k])).toBe(true);
          for (let t = s + k; t < N; t++) e.step(A[t]);
          expect(same(e.snapshot(), states[N])).toBe(true);
          cases++;
        }
      }
    expect(cases).toBe(4 * ((N + 1) * (N + 2)) / 2);
    expect(outgrown).toBeGreaterThan(0);
  });
});

describe("snes: a mid-rollback snapshot of a real game", () => {
  const wasm = readFileSync(new URL("../engines/snes/dist/snes.wasm", import.meta.url));
  const rom = new Uint8Array(readFileSync(new URL("../engines/snes/test/unarmed.sfc", import.meta.url)));
  // The two scripts agree until frame 780, then the four-player one is the
  // truth and the two-player one the misprediction.
  const [S, K, END] = [800, 100, 1000];

  test.skipIf(!FULL)("is the reference's, and goes on as the reference does in a separately compiled engine", async () => {
    const machine = await compile(wasm);
    const ref = machine.boot(rom);
    let atS, atM, frameM;
    for (let f = 0; f < END; f++) {
      if (f === S) atS = ref.snapshot();
      if (f === S + K) [atM, frameM] = [ref.snapshot(), ref.frame()];
      ref.step(pads(FOUR_PLAYERS, f));
    }
    const peer = machine.boot(rom);
    for (let f = 0; f < END; f++) peer.step(pads(TWO_PLAYERS, f));
    expect(peer.hash()).not.toBe(ref.hash());
    peer.restore(atS);
    for (let f = S; f < S + K; f++) peer.step(pads(FOUR_PLAYERS, f));
    const M = peer.snapshot();
    expect(same(M, atM)).toBe(true);
    const e = (await compile(wasm)).boot(rom);
    for (let f = 0; f < 50; f++) e.step(pads(TWO_PLAYERS, f));
    e.restore(M);
    expect(sameFrame(e.frame(), frameM)).toBe(true);
    for (let f = S + K; f < END; f++) e.step(pads(FOUR_PLAYERS, f));
    expect(e.hash()).toBe(ref.hash());
  }, 120_000);
});
