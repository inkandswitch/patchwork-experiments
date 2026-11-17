// The plain container (plain.js): slots over items, and shuffles that merge whole.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { PLAIN, PlainDatatype, itemAt, newPlain, shuffleSlots, shuffled, wellFormed } from "./plain.js";

const items = (n) => Array.from({ length: n }, (_, i) => ({ sourceUrl: `automerge:face${i}`, name: `Card ${i}` }));
/** Every sequence of `n` draws from [0, 1) on a grid of `k` values: every shuffle a Fisher–Yates of n + 1 things can make. */
function* randoms(n, k) {
  const total = k ** n;
  for (let c = 0; c < total; c++) {
    const seq = [];
    let x = c;
    for (let i = 0; i < n; i++) {
      seq.push((x % k) / k);
      x = Math.floor(x / k);
    }
    let i = 0;
    yield () => seq[i++ % seq.length];
  }
}

describe("the plain container", () => {
  it("a new one holds item k in slot k", () => {
    const doc = newPlain({ title: "Deck", items: items(4) });
    expect(doc["@patchwork"]).toEqual({ type: PLAIN });
    expect(doc.at).toEqual([0, 1, 2, 3]);
    expect(wellFormed(doc)).toBe(true);
    for (let k = 0; k < 4; k++) expect(itemAt(doc, k)).toEqual(items(4)[k]);
    expect(itemAt(doc, 4)).toBeUndefined();
    expect(itemAt(doc, -1)).toBeUndefined();
    const d = {};
    PlainDatatype.init(d);
    expect(wellFormed(d)).toBe(true);
    expect(PlainDatatype.getTitle(d)).toBe("Kept things");
  });

  it("a doc whose slots aren't a permutation of its items answers nothing", () => {
    for (const at of [[0, 0, 1], [0, 1], [0, 1, 3], [0, 1, "2"], null]) {
      const doc = { items: items(3), at };
      expect(wellFormed(doc)).toBe(false);
      expect(itemAt(doc, 0)).toBeUndefined();
    }
  });

  it("a shuffle of some slots permutes those and touches no other: every shuffle of every subset of 4", () => {
    const at = [2, 0, 3, 1];
    for (let mask = 0; mask < 16; mask++) {
      const slots = [0, 1, 2, 3].filter((k) => mask & (1 << k));
      const seen = new Set();
      for (const random of randoms(Math.max(1, slots.length - 1), 4)) {
        const next = shuffled(at, slots, random);
        for (let k = 0; k < 4; k++) if (!slots.includes(k)) expect(next[k]).toBe(at[k]);
        expect(slots.map((k) => next[k]).sort()).toEqual(slots.map((k) => at[k]).sort());
        expect([...next].sort()).toEqual([0, 1, 2, 3]);
        seen.add(next.join(","));
      }
      // and every arrangement of them can come up
      const fact = [1, 1, 2, 6, 24][slots.length];
      expect(seen.size).toBe(fact);
    }
    expect(at).toEqual([2, 0, 3, 1]);
  });

  it("slots out of range or said twice count once or not at all; fewer than two is nothing to do", () => {
    let doc = newPlain({ items: items(3) });
    const handle = { doc: () => doc, change: (fn) => ((doc = structuredClone(doc)), fn(doc)) };
    expect(shuffleSlots(handle, [1])).toBe(0);
    expect(shuffleSlots(handle, [1, 1, 9, -2, 1.5])).toBe(0);
    expect(doc.at).toEqual([0, 1, 2]);
    expect(shuffleSlots(handle, [0, 2, 2], () => 0)).toBe(2);
    expect(doc.at).toEqual([2, 1, 0]);
    expect(doc.items).toEqual(items(3));
  });

  it("two shuffles at once merge to one of them, whole: no item twice, none lost", () => {
    const handleOf = (d) => {
      const h = { current: d, doc: () => h.current, change: (fn) => (h.current = Automerge.change(h.current, fn)) };
      return h;
    };
    const base = Automerge.from(newPlain({ title: "Deck", items: items(6) }));
    // every pair of the shuffles two fixed random sources give, over two overlapping piles
    const sources = [() => 0, () => 0.3, () => 0.6, () => 0.99];
    for (const ra of sources) for (const rb of sources) {
      const a = handleOf(Automerge.clone(base));
      const b = handleOf(Automerge.clone(base));
      expect(shuffleSlots(a, [0, 1, 2, 3], ra)).toBe(4);
      expect(shuffleSlots(b, [2, 3, 4, 5], rb)).toBe(4);
      const merged = Automerge.toJS(Automerge.merge(a.current, b.current));
      expect(wellFormed(merged)).toBe(true);
      expect([Automerge.toJS(a.current).at, Automerge.toJS(b.current).at]).toContainEqual(merged.at);
    }
  });
});
