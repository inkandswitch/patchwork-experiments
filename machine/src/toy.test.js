// The toy engine, restored exhaustively. Two fixed input scripts (no
// randomness): A, the reference, grows memory once; B, the timeline the
// engine is on before it restores, grows it twice and earlier. For every
// prior state (each tick of each timeline) and every snapshot of A, restoring
// and re-stepping must reproduce A exactly from there on: every hash, every
// output, and the final state byte for byte; into an engine of a separately
// compiled module as well.
import { readFileSync } from "node:fs";
import { compile } from "./engine.js";
import { pages, hashSnapshot } from "./wasm-state.js";

const wasm = readFileSync(new URL("../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("the toy's content");
const N = 24;
const ALLOC = 1, FREE = 2, BIG = 0x80;

function script(fn) {
  return Array.from({ length: N }, (_, t) => {
    const b = new Uint8Array(8);
    for (let p = 0; p < 4; p++) [b[2 * p], b[2 * p + 1]] = fn(t, p);
    return b;
  });
}
const A = script((t, p) => [
  ((t * 3 + p * 5) % 7) - 3,
  ((t + p) % 3 === 0 ? ALLOC : 0) | ((t + p) % 5 === 0 ? FREE : 0) | (t === 14 && p === 0 ? BIG : 0),
]);
const B = script((t, p) => [
  ((t * 5 + p) % 3) - 1,
  ((t * p) % 4 === 1 ? ALLOC : 0) | ((t === 3 && p === 2) || (t === 7 && p === 1) ? BIG : 0),
]);

const machine = await compile(wasm);
const apart = await compile(wasm); // a separately compiled module

// Byte equality; expect().toEqual walks a large typed array element by element.
const bytes = (x) => new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
const same = (a, b) => Buffer.compare(bytes(a), bytes(b)) === 0;
const sameFrame = (f, g) => f.width === g.width && f.height === g.height && same(f.rgba, g.rgba);

function run(inputs) {
  const e = machine.boot(content);
  const states = [e.snapshot()];
  const hashes = [e.hash()];
  const outputs = [null];
  for (const i of inputs) {
    e.step(i);
    states.push(e.snapshot());
    hashes.push(e.hash());
    outputs.push(e.output());
  }
  return { states, hashes, outputs };
}

const ref = run(A);
const other = run(B);

test("the reference run grows memory, and the other timeline outgrows it", () => {
  expect(pages(ref.states[N])).toBeGreaterThan(pages(ref.states[0]));
  expect(pages(other.states[10])).toBeGreaterThan(pages(ref.states[N]));
});

test("hash() is the hash of the snapshot, and two boots agree on every tick", () => {
  const again = run(A);
  for (let t = 0; t <= N; t++) {
    expect(ref.hashes[t]).toBe(hashSnapshot(ref.states[t]));
    expect(same(again.states[t], ref.states[t])).toBe(true);
  }
  expect(new Set(ref.hashes).size).toBe(N + 1);
});

test("every restore, from every prior state, re-steps into the reference", () => {
  let grew = 0, shrank = 0;
  for (const [inputs, prior] of [[A, ref], [B, other]]) {
    for (let r = 0; r <= N; r++) {
      for (let s = 0; s <= N; s++) {
        const e = machine.boot(content);
        for (let t = 0; t < r; t++) e.step(inputs[t]);
        const before = pages(prior.states[r]), after = pages(ref.states[s]);
        if (before < after) grew++;
        if (before > after) shrank++;
        e.restore(ref.states[s]);
        expect(e.hash()).toBe(ref.hashes[s]);
        for (let t = s; t < N; t++) {
          e.step(A[t]);
          expect(e.hash()).toBe(ref.hashes[t + 1]);
          const o = e.output(), want = ref.outputs[t + 1];
          expect(same(o.events, want.events) && same(o.audio.samples, want.audio.samples)).toBe(true);
        }
        expect(same(e.snapshot(), ref.states[N])).toBe(true);
      }
    }
  }
  // and into an engine of a separately compiled module
  for (let s = 0; s <= N; s++) {
    const e = apart.boot(content);
    const here = machine.boot(content);
    e.restore(ref.states[s]);
    here.restore(ref.states[s]);
    expect(sameFrame(e.frame(1), here.frame(1))).toBe(true);
    for (let t = s; t < N; t++) e.step(A[t]);
    expect(same(e.snapshot(), ref.states[N])).toBe(true);
  }
  expect(grew).toBeGreaterThan(0);
  expect(shrank).toBeGreaterThan(0);
});

test("restoring is repeatable: one snapshot, restored over and over", () => {
  const e = machine.boot(content);
  for (let s = N; s >= 0; s--) {
    e.restore(ref.states[s]);
    e.restore(ref.states[s]);
    expect(same(e.snapshot(), ref.states[s])).toBe(true);
  }
});

test("drawing never touches the live state, and draws the same for equal states", () => {
  const e = machine.boot(content);
  const twin = machine.boot(content);
  for (let t = 0; t <= N; t++) {
    for (let view = 0; view < 4; view++) {
      const f = e.frame(view);
      expect(f.width * f.height * 4).toBe(f.rgba.length);
      expect(sameFrame(e.frame(view), f)).toBe(true); // drawn on a fresh copy each time
      expect(sameFrame(twin.frame(view), f)).toBe(true);
    }
    expect(e.hash()).toBe(ref.hashes[t]);
    if (t < N) [e, twin].forEach((x) => x.step(A[t]));
  }
});

test("the state is a function of the content", () => {
  const e = machine.boot(new TextEncoder().encode("other content"));
  expect(e.hash()).not.toBe(ref.hashes[0]);
  expect(machine.boot(content).hash()).toBe(ref.hashes[0]);
});

test("the engine describes itself, and step checks its input's length", () => {
  const e = machine.boot(content);
  expect([e.hz, e.players, e.inputBytes]).toEqual([35, 4, 2]);
  expect(() => e.step(new Uint8Array(7))).toThrow(/8 input bytes/);
});
