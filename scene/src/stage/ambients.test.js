// Ambients, the pure half (./ambients.js): only data crosses, by construction
// (W4), and the stacking rule (W2's per-stage half, W9's merge).
import { describe, expect, it } from "vitest";
import { EMPTY, frozenJSON, mergeAmbients } from "./ambients.js";

class Handle {
  constructor() {
    this.url = "automerge:x";
  }
}

/** Every value W4 names: { name, value, ok } — nested plain is taken, the rest refused. */
function offers() {
  const cycle = { a: 1 };
  cycle.self = cycle;
  const deepCycle = { list: [{ x: 1 }] };
  deepCycle.list[0].up = deepCycle;
  const shared = { k: 1 };
  return [
    { name: "nested plain", value: { v: 1, level: 0, components: [{ dir: [1, 0], k: 0.1, omega: 1, amp: 0.5, steep: 0.8, phase: 2 }], look: { seed: "x", on: true, none: null } }, ok: true },
    { name: "a shared (not cyclic) subobject", value: { a: shared, b: shared }, ok: true },
    { name: "a null-prototype object", value: Object.assign(Object.create(null), { a: 1 }), ok: true },
    { name: "a function", value: { heightAt: () => 0 }, ok: false },
    { name: "a function alone", value: () => 0, ok: false },
    { name: "a cycle", value: cycle, ok: false },
    { name: "a cycle through an array", value: deepCycle, ok: false },
    { name: "a handle", value: { handle: new Handle() }, ok: false },
    { name: "a Map", value: new Map([["a", 1]]), ok: false },
    { name: "a Date", value: { at: new Date(0) }, ok: false },
    { name: "a typed array", value: { a: new Float64Array(2) }, ok: false },
    { name: "NaN", value: { t: NaN }, ok: false },
    { name: "Infinity", value: { t: Infinity }, ok: false },
    { name: "a symbol", value: { s: Symbol("s") }, ok: false },
    { name: "a bigint", value: { b: 1n }, ok: false },
  ];
}

const deepFrozen = (v) => v === null || typeof v !== "object" || (Object.isFrozen(v) && Object.values(v).every(deepFrozen));

describe("only data crosses, by construction (W4)", () => {
  for (const { name, value, ok } of offers()) {
    it(`${name}: ${ok ? "copied, deep-frozen, equal as JSON, never the same object" : "refused"}`, () => {
      if (!ok) {
        expect(() => frozenJSON(value)).toThrow(TypeError);
        const refused = [];
        const m = mergeAmbients([{ id: "p", offer: { w: value, keep: { a: 1 } } }], EMPTY, (id, n) => refused.push([id, n]));
        expect(refused).toEqual([["p", "w"]]);
        // refused whole: the name isn't there, and the provider's other names are
        expect(m).toEqual({ keep: { a: 1 } });
        return;
      }
      const c = frozenJSON(value);
      expect(c).not.toBe(value);
      expect(deepFrozen(c)).toBe(true);
      expect(JSON.parse(JSON.stringify(c))).toEqual(JSON.parse(JSON.stringify(value)));
    });
  }

  it("a provider's later mutation never shows in what a reader holds, and a reader can't change it", () => {
    const value = { v: 1, components: [{ amp: 1 }] };
    const m = mergeAmbients([{ id: "p", offer: { water: value } }]);
    const held = m.water;
    value.components[0].amp = 99;
    value.v = 2;
    expect(held).toEqual({ v: 1, components: [{ amp: 1 }] });
    expect(() => {
      "use strict";
      held.components[0].amp = 5;
    }).toThrow(TypeError);
  });

  it("undefined properties are left out, as JSON leaves them; numbers keep every bit", () => {
    const x = 0.1 + 0.2;
    expect(frozenJSON({ a: undefined, b: x, c: [-0, 5e-324, 1.7976931348623157e308] })).toEqual({ b: x, c: [-0, 5e-324, 1.7976931348623157e308] });
    expect(Object.is(frozenJSON([-0])[0], -0)).toBe(true);
  });
});

describe("stacking per name (mergeAmbients)", () => {
  const A = { sky: { top: "#000" } };
  const B = { sun: { direction: [0, 1, 0] } };
  // every running order of two extensions, each offering {nothing, null, A, B} under one name
  const choices = [undefined, null, A, B];
  for (const first of choices)
    for (const second of choices)
      it(`first ${JSON.stringify(first) ?? "nothing"}, then ${JSON.stringify(second) ?? "nothing"}: the later value whole, null clearing, nothing keeping`, () => {
        const offer = (v) => (v === undefined ? {} : { atmosphere: v });
        const m = mergeAmbients([
          { id: "one", offer: offer(first) },
          { id: "two", offer: offer(second) },
        ]);
        const want = second === undefined ? first : second;
        if (want == null) expect(m).toBe(EMPTY);
        else expect(m).toEqual({ atmosphere: want });
      });

  it("an equal value keeps its identity across flushes; a changed one doesn't; the whole is the same object when nothing changed", () => {
    const one = mergeAmbients([{ id: "p", offer: { a: { x: 1 }, b: { y: [1, 2] } } }]);
    const two = mergeAmbients([{ id: "p", offer: { a: { x: 1 }, b: { y: [1, 2] } } }], one);
    expect(two).toBe(one);
    const three = mergeAmbients([{ id: "p", offer: { a: { x: 1 }, b: { y: [1, 3] } } }], two);
    expect(three).not.toBe(two);
    expect(three.a).toBe(one.a);
    expect(three.b).not.toBe(one.b);
    // a name gone is a change
    const four = mergeAmbients([{ id: "p", offer: { a: { x: 1 } } }], three);
    expect(four).toEqual({ a: { x: 1 } });
    expect(four.a).toBe(one.a);
  });

  it("offers that aren't objects are nothing", () => {
    expect(mergeAmbients([{ id: "p", offer: null }, { id: "q", offer: 3 }, { id: "r", offer: "x" }])).toBe(EMPTY);
    expect(mergeAmbients([])).toBe(EMPTY);
  });
});
