// prepare() on hand-assembled modules: every kind of global, every refusal.
import { prepare } from "./wasm-module.js";
import { snapshot, restore } from "./wasm-state.js";

const leb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const str = (s) => [...leb(s.length), ...new TextEncoder().encode(s)];
const section = (id, entries) => (entries ? [id, ...leb(vec(entries).length), ...vec(entries)] : []);
const vec = (entries) => [...leb(entries.length), ...entries.flat()];

const VALTYPE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, v128: 0x7b, funcref: 0x70 };
const ZERO = {
  i32: [0x41, 0], i64: [0x42, 0], f32: [0x43, 0, 0, 0, 0], f64: [0x44, ...Array(8).fill(0)],
  v128: [0xfd, 12, ...Array(16).fill(0)], funcref: [0xd0, 0x70],
};

/** A module from parts; each part is a list of entries, or absent. */
function mod({ imports, tables, memories = [[0, 1]], globals, exports = [[...str("memory"), 2, 0]], elems, data }) {
  return new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, [[0x60, 0, 0]]),
    ...section(2, imports),
    ...section(4, tables),
    ...section(5, memories),
    ...section(6, globals?.map(([t, mut]) => [VALTYPE[t], mut, ...ZERO[t], 0x0b])),
    ...section(7, exports),
    ...section(9, elems),
    ...section(11, data),
  ]);
}

const VALUES = { i32: -123456, i64: -(2n ** 40n), f32: 1.5, f64: -0.1 };

describe("every global: four types, mutable or not, exported or not", () => {
  for (const type of Object.keys(VALUES))
    for (const mut of [0, 1])
      for (const exported of [false, true])
        test(`${type} ${mut ? "mutable" : "constant"} ${exported ? "exported" : "hidden"}`, () => {
          const name = "g";
          const exports = [[...str("memory"), 2, 0], ...(exported ? [[...str(name), 3, 0]] : [])];
          const { bytes, globals } = prepare(mod({ globals: [[type, mut]], exports }));
          if (!mut) return expect(globals).toEqual([]);
          expect(globals).toEqual([{ name: exported ? name : "machine:global:0", type }]);
          const x = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
          const target = { memory: x.memory, globals: [{ global: x[globals[0].name], type }] };
          target.globals[0].global.value = VALUES[type];
          const snap = snapshot(target);
          target.globals[0].global.value = type === "i64" ? 7n : 7;
          restore(target, snap);
          expect(target.globals[0].global.value).toBe(VALUES[type]);
        });
});

test("a module without an export section gets one, in its place among the sections", () => {
  const m = mod({ globals: [["i32", 1]], exports: undefined, data: [[0, 0x41, 0, 0x0b, ...str("hi")]] });
  const { bytes, globals } = prepare(m);
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
  expect(x[globals[0].name]).toBeInstanceOf(WebAssembly.Global);
});

test("the rewritten module keeps every export it had", () => {
  const exports = [[...str("memory"), 2, 0], [...str("c"), 3, 0]];
  const { bytes } = prepare(mod({ globals: [["i32", 0], ["f64", 1]], exports }));
  const names = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map((e) => e.name);
  expect(names).toEqual(["memory", "c", "machine:global:1"]);
});

const TABLE = [0x70, 0, 1]; // funcref, at least 1
// One element segment of each encoding that is not passive: active (flags 0,
// 2, 4, 6) and declarative (3, 7), each with a null reference or none.
const ELEMS = [
  [0, 0x41, 0, 0x0b, 0],
  [2, 0, 0x41, 0, 0x0b, 0x00, 0],
  [3, 0x00, 0],
  [4, 0x41, 0, 0x0b, 1, 0xd0, 0x70, 0x0b],
  [6, 0, 0x41, 0, 0x0b, 0x70, 1, 0xd0, 0x70, 0x0b],
  [7, 0x70, 1, 0xd0, 0x70, 0x0b],
];

describe("refusals", () => {
  const fn = (m, f) => [...str(m), ...str(f), 0, 0];
  const cases = {
    "an import the host does not provide": [mod({ imports: [fn("env", "now")] }), /env\.now/],
    "an imported memory": [mod({ imports: [[...str("env"), ...str("mem"), 2, 0, 1]], memories: [] }), /env\.mem/],
    "no memory": [mod({ memories: [], exports: [] }), /0 memories/],
    "two memories": [mod({ memories: [[0, 1], [0, 1]] }), /2 memories/],
    "shared memory": [mod({ memories: [[3, 1, 1]] }), /shared/],
    "a mutable v128": [mod({ globals: [["v128", 1]] }), /global 0/],
    "a mutable reference": [mod({ globals: [["funcref", 1]] }), /global 0/],
    "a passive data segment": [mod({ data: [[1, ...str("hi")]] }), /passive/],
    // Found only if each active segment before it is skipped by its full size.
    "a passive data segment after active ones": [
      mod({ data: [[0, 0x41, 0, 0x0b, ...str("hi")], [0, 0x41, 2, 0x0b, ...str("there")], [1, ...str("!")]] }),
      /passive/,
    ],
    // Element segments of every encoding but the passive ones come before it.
    "a passive element segment after every other kind": [mod({ tables: [TABLE], elems: [...ELEMS, [1, 0x00, 0]] }), /passive element/],
    "a passive element segment of expressions": [mod({ tables: [TABLE], elems: [[5, 0x70, 1, 0xd0, 0x70, 0x0b]] }), /passive element/],
  };
  for (const [what, [m, error]] of Object.entries(cases))
    test(what, () => expect(() => prepare(m)).toThrow(error));

  test("but an allowed import, a constant v128, active segments and declarative ones are fine", () => {
    const m = mod({
      imports: [fn("env", "ok")],
      tables: [TABLE],
      globals: [["v128", 0], ["funcref", 0]],
      elems: ELEMS,
      data: [[0, 0x41, 0, 0x0b, ...str("hi")]],
    });
    new WebAssembly.Module(m); // a valid module, so the segments above are well formed
    expect(prepare(m, new Set(["env.ok"])).globals).toEqual([]);
  });
});
