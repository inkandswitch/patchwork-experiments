// PERF.md Phase 2 pin — the shared item index (buildItemsIndex/findById) that the
// canvas's itemsIndex memo is built from: per-layer buckets stay id-sorted (stable
// render order — live embeds must not be relocated), z stays the DOC index, and the
// memo product is reference-stable while the items are unchanged.
import { describe, it, expect } from "vitest";
import { createRoot, createSignal, createMemo } from "solid-js";
import { buildItemsIndex, findById, byIdAsc, itemLayers } from "./model.js";
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
    const { byLayer, byHome } = buildItemsIndex(items, itemLayer);
    expect(byLayer.get("canvas").map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(byLayer.get("overlay").map((x) => x.id)).toEqual(["a", "e"]);
    expect([...byLayer.values()].flat().length).toBe(items.length);
    expect(byLayer.get("nope")).toBeUndefined();
    // a single-layer layerOf (a string return): membership == home
    expect(byHome.get("canvas")).toEqual(byLayer.get("canvas"));
    expect(byHome.get("overlay")).toEqual(byLayer.get("overlay"));
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
    const { byLayer, byHome, indexById } = buildItemsIndex([], itemLayer);
    expect(byLayer.size).toBe(0);
    expect(byHome.size).toBe(0);
    expect(indexById.size).toBe(0);
  });

  it("byIdAsc is the sortById comparator (shared, not duplicated)", () => {
    const shuffled = [{ id: "b" }, { id: "a" }, { id: "c" }];
    expect([...shuffled].sort(byIdAsc)).toEqual(sortById(shuffled));
  });
});

describe("multi-membership (layers: []) — byLayer is membership, byHome is placement", () => {
  const multi = [
    { id: "m1", kind: "shape", layers: ["canvas", "overlay"] }, // home canvas, also shown with the overlay
    { id: "m2", kind: "editor", layers: ["overlay"] },          // overlay-only
    { id: "m3", kind: "shape" },                                // untagged legacy → canvas
    { id: "m4", kind: "shape", layer: "overlay" },              // legacy single tag
  ];

  it("a member item appears in EVERY member bucket, but exactly ONE home bucket (never rendered twice)", () => {
    const { byLayer, byHome } = buildItemsIndex(multi, itemLayers);
    expect(byLayer.get("canvas").map((x) => x.id)).toEqual(["m1", "m3"]);
    expect(byLayer.get("overlay").map((x) => x.id)).toEqual(["m1", "m2", "m4"]);
    expect(byHome.get("canvas").map((x) => x.id)).toEqual(["m1", "m3"]); // m1 RENDERS at home
    expect(byHome.get("overlay").map((x) => x.id)).toEqual(["m2", "m4"]); // …not again here
    expect([...byHome.values()].flat().length).toBe(multi.length); // every item placed once
  });

  it("layersOf defaults to itemLayers (the back-compat read)", () => {
    const { byHome } = buildItemsIndex(multi);
    expect(byHome.get("canvas").map((x) => x.id)).toEqual(["m1", "m3"]);
    expect(byHome.get("overlay").map((x) => x.id)).toEqual(["m2", "m4"]);
  });

  it("duplicate membership entries don't double an item within a bucket", () => {
    const { byLayer, byHome } = buildItemsIndex([{ id: "x", layers: ["canvas", "canvas"] }]);
    expect(byLayer.get("canvas").map((i) => i.id)).toEqual(["x"]);
    expect(byHome.get("canvas").map((i) => i.id)).toEqual(["x"]);
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
