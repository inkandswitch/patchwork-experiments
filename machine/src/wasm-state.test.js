// snapshot/restore/copy over bare memories of every size pair from 1 to 4
// pages: memory grows to fit, never shrinks, and the state comes back whole.
import { snapshot, restore, copy, hash, hashSnapshot, size, PAGE } from "./wasm-state.js";

const TYPES = { i32: 7, i64: 7n, f32: 0.5, f64: 1e300 };

function target(pages, seed) {
  const memory = new WebAssembly.Memory({ initial: pages, maximum: 8 });
  const m = new Uint8Array(memory.buffer);
  for (let i = 0; i < m.length; i++) m[i] = (i * 31 + seed) & 0xff;
  const globals = Object.entries(TYPES).map(([type, v]) => {
    const value = typeof v === "bigint" ? v * BigInt(seed) : v * seed;
    return { global: new WebAssembly.Global({ value: type, mutable: true }, value), type };
  });
  return { memory, globals };
}

const values = (t) => t.globals.map((g) => g.global.value);
const SIZES = [1, 2, 3, 4];

for (const a of SIZES)
  for (const b of SIZES) {
    test(`a ${a}-page state into a ${b}-page memory`, () => {
      const source = target(a, 1);
      const snap = snapshot(source);
      expect(hashSnapshot(snap)).toBe(hash(source));
      for (const put of [(t) => restore(t, snap), (t) => copy(source, t)]) {
        const t = target(b, 2);
        const before = hash(t);
        if (b > a) {
          expect(() => put(t)).toThrow(RangeError);
          expect(hash(t)).toBe(before); // refused before writing anything
          continue;
        }
        put(t);
        expect(size(t)).toBe(a);
        expect(values(t)).toEqual(values(source));
        expect(Buffer.compare(new Uint8Array(t.memory.buffer), new Uint8Array(source.memory.buffer))).toBe(0);
        expect(hash(t)).toBe(hash(source));
      }
    });
  }

test("the hash covers the size: equal bytes, one more zero page, another hash", () => {
  const t = target(1, 0);
  const h = hash(t);
  t.memory.grow(1);
  expect(new Uint8Array(t.memory.buffer).subarray(PAGE).every((b) => b === 0)).toBe(true);
  expect(hash(t)).not.toBe(h);
});

test("the hash sees one changed bit anywhere a word lives", () => {
  const t = target(1, 3);
  const seen = new Set([hash(t)]);
  const m = new Uint8Array(t.memory.buffer);
  for (let i = 0; i < PAGE; i += 4093) {
    m[i] ^= 1;
    seen.add(hash(t));
    m[i] ^= 1;
  }
  expect(seen.size).toBe(1 + Math.ceil(PAGE / 4093));
});
