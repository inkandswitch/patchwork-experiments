// PERF.md Phase 2 pin — the shared item index (buildItemsIndex/findById) that the
// canvas's itemsIndex memo is built from: per-layer buckets stay id-sorted (stable
// render order — live embeds must not be relocated), z stays the DOC index, and the
// memo product is reference-stable while the items are unchanged.
import { describe, it, expect } from "vitest";
import { createRoot, createSignal, createMemo } from "solid-js";
import { buildItemsIndex, findById, byIdAsc } from "./model.js";
import { itemLayer } from "./layers.js";
import { sortById } from "./brush/constants.js";

const items = [
  { id: "c", kind: "shape" },
  { id: "a", kind: "doc", layer: "overlay" },
  { id: "d", kind: "stroke" },
  { id: "b", kind: "frame" },
  { id: "e", kind: "editor", layer: "overlay" },
];

describe("buildItemsIndex", () => {
  it("buckets by layer, id-sorted, covering every item exactly once", () => {
    const { byLayer } = buildItemsIndex(items, itemLayer);
    expect(byLayer.get("canvas").map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(byLayer.get("overlay").map((x) => x.id)).toEqual(["a", "e"]);
    expect([...byLayer.values()].flat().length).toBe(items.length);
    expect(byLayer.get("nope")).toBeUndefined();
  });

  it("each bucket equals the old sortById(filter(...)) path, with the SAME element references", () => {
    const { byLayer } = buildItemsIndex(items, itemLayer);
    for (const layer of ["canvas", "overlay"]) {
      const old = sortById(items.filter((x) => itemLayer(x) === layer));
      const bucket = byLayer.get(layer);
      expect(bucket.length).toBe(old.length);
      old.forEach((x, i) => expect(bucket[i]).toBe(x));
    }
  });

  it("indexById maps every id to its DOC index (the z), independent of bucket order", () => {
    const { indexById, byLayer } = buildItemsIndex(items, itemLayer);
    items.forEach((x, i) => expect(indexById.get(x.id)).toBe(i));
    for (const bucket of byLayer.values())
      for (const x of bucket) expect(items[indexById.get(x.id)]).toBe(x);
  });

  it("empty items → empty maps", () => {
    const { byLayer, indexById } = buildItemsIndex([], itemLayer);
    expect(byLayer.size).toBe(0);
    expect(indexById.size).toBe(0);
  });

  it("byIdAsc is the sortById comparator (shared, not duplicated)", () => {
    const shuffled = [{ id: "b" }, { id: "a" }, { id: "c" }];
    expect([...shuffled].sort(byIdAsc)).toEqual(sortById(shuffled));
  });
});

describe("itemsIndex as a memo (the canvas wiring)", () => {
  it("byLayer arrays are reference-stable while items are unchanged, fresh after a change", () => {
    createRoot((dispose) => {
      const [rootItems, setRootItems] = createSignal(items);
      const [unrelated, setUnrelated] = createSignal(0);
      const idx = createMemo(() => buildItemsIndex(rootItems(), itemLayer));
      const first = idx();
      expect(idx()).toBe(first);
      expect(idx().byLayer.get("canvas")).toBe(first.byLayer.get("canvas"));
      setUnrelated(unrelated() + 1); // an unrelated signal must not rebuild the index
      expect(idx().byLayer.get("canvas")).toBe(first.byLayer.get("canvas"));
      setRootItems([...items, { id: "f", kind: "shape" }]);
      expect(idx()).not.toBe(first);
      expect(idx().byLayer.get("canvas").map((x) => x.id)).toEqual(["b", "c", "d", "f"]);
      expect(idx().indexById.get("f")).toBe(5);
      dispose();
    });
  });
});

describe("findById", () => {
  it("uses the index when given, matching the linear path", () => {
    const { indexById } = buildItemsIndex(items, itemLayer);
    for (const x of items) {
      expect(findById(items, x.id, indexById)).toBe(x);
      expect(findById(items, x.id)).toBe(x);
    }
    expect(findById(items, "missing", indexById)).toBeUndefined();
    expect(findById(items, "missing")).toBeUndefined();
    expect(findById(null, "a")).toBeUndefined();
  });
});
