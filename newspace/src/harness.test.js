import { describe, it, expect } from "vitest";
import { createRoot, For } from "solid-js";
import { render } from "solid-js/web";
import { makeDocumentProjection } from "solid-automerge";
import { makeRepo, makeSurface, withProjection, flush } from "./test-harness.js";
import { applyReorder, framesToWorld, groupBounds, linksNeedingItems, linkItemId, duplicateItemIds } from "./model.js";
import { snapshotItems, diffCommand } from "./history.js";

const sortById = (items) => [...(items || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// ── pure primitives the deferred features will build on ──────────────────────

describe("applyReorder (plain array)", () => {
  const ids = (arr) => arr.map((x) => x.id);
  const mk = () => [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("front / back move the selection to the ends, keeping relative order", () => {
    let a = mk(); applyReorder(a, ["b", "c"], "front"); expect(ids(a)).toEqual(["a", "d", "b", "c"]);
    a = mk(); applyReorder(a, ["b", "c"], "back"); expect(ids(a)).toEqual(["b", "c", "a", "d"]);
  });
  it("forward / backward nudge by one, blocked by a selected neighbour", () => {
    let a = mk(); applyReorder(a, ["b"], "forward"); expect(ids(a)).toEqual(["a", "c", "b", "d"]);
    a = mk(); applyReorder(a, ["c"], "backward"); expect(ids(a)).toEqual(["a", "c", "b", "d"]);
    a = mk(); applyReorder(a, ["c", "d"], "forward"); expect(ids(a)).toEqual(["a", "b", "c", "d"]); // already at the end
  });
  it("carries the item's data across the move", () => {
    const a = [{ id: "a", x: 1 }, { id: "b", x: 2 }];
    applyReorder(a, ["a"], "front");
    expect(a[1]).toMatchObject({ id: "a", x: 1 });
  });
});

describe("framesToWorld (nested-frame coordinate composition)", () => {
  it("is the identity with no frames", () => {
    expect(framesToWorld([], 5, 7)).toEqual([5, 7]);
  });
  it("composes an outer + inner unrotated frame (pure translation)", () => {
    const outer = { x: 100, y: 0, w: 200, h: 200, rotation: 0 };
    const inner = { x: 10, y: 20, w: 50, h: 50, rotation: 0 };
    // a point at the inner frame's origin → outer-local (10,20) → world (110,20)
    expect(framesToWorld([outer, inner], 0, 0)).toEqual([110, 20]);
  });
  it("composes rotation through the chain", () => {
    const outer = { x: 0, y: 0, w: 100, h: 100, rotation: 90 };
    const [wx, wy] = framesToWorld([outer], 100, 50); // outer's right-edge midpoint
    expect(wx).toBeCloseTo(50, 6);
    expect(wy).toBeCloseTo(100, 6);
  });
});

describe("groupBounds", () => {
  it("encloses every item in the group, ignoring others", () => {
    const items = [
      { id: "a", kind: "doc", x: 0, y: 0, w: 10, h: 10, group: "g" },
      { id: "b", kind: "doc", x: 40, y: 30, w: 10, h: 10, group: "g" },
      { id: "c", kind: "doc", x: 200, y: 200, w: 10, h: 10 },
    ];
    expect(groupBounds(items, "g")).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  });
  it("returns null for an empty group", () => {
    expect(groupBounds([{ id: "a" }], "nope")).toBe(null);
  });
});

// ── real automerge-repo + projection (the regression net) ────────────────────

describe("reorder against a REAL automerge doc + Solid projection", () => {
  it("updates the doc order correctly", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a", x: 1 }, { id: "b", x: 2 }, { id: "c", x: 3 }] });
    layout.change((d) => applyReorder(d.items, ["b"], "front"));
    await flush();
    expect(layout.doc().items.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(layout.doc().items.find((x) => x.id === "b").x).toBe(2);
  });

  // THE embed-preservation invariant the tool relies on: rendering a <For> in a
  // STABLE id-sorted order (as the tool does) must NOT recreate a moved item's
  // DOM node on reorder — that's what keeps a live embed (a call) from reloading.
  it("does NOT recreate the moved item's <For> row (stays mounted across reorder)", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const host = document.createElement("div");
    const mounted = new Map(); // id -> a unique token created when its row mounts
    let dispose, proj;
    createRoot((d) => {
      dispose = d;
      proj = makeDocumentProjection(layout);
      render(() => For({ each: sortById(proj.items), children: (it) => { if (!mounted.has(it.id)) mounted.set(it.id, {}); return null; } }), host);
    });
    const tokenB = mounted.get("b");
    layout.change((dd) => applyReorder(dd.items, ["b"], "front"));
    await flush();
    // if the row was recreated, mounted.get("b") would be a NEW token
    expect(mounted.get("b")).toBe(tokenB); // SAME token → row stayed mounted → embed preserved
    dispose();
  });
});

describe("collab duplicate-doc dedup on a real layout doc", () => {
  it("two reconciles for one link collapse to a single item", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [] });
    // both peers reconcile the new link u1 → same deterministic id, two entries
    layout.change((d) => d.items.push({ id: linkItemId("u1"), kind: "doc", url: "u1", x: 0, y: 0, w: 360, h: 280 }));
    layout.change((d) => d.items.push({ id: linkItemId("u1"), kind: "doc", url: "u1", x: 0, y: 0, w: 360, h: 280 }));
    await flush();
    expect(layout.doc().items.length).toBe(2);
    // the dedup pass (what the tool runs) removes the duplicate id
    const dup = duplicateItemIds(layout.doc().items);
    layout.change((d) => { for (let k = dup.length - 1; k >= 0; k--) d.items.splice(dup[k], 1); });
    await flush();
    expect(layout.doc().items.map((x) => x.url)).toEqual(["u1"]);
  });
});

describe("delete reconcile against a real doc", () => {
  it("once a link is removed, that url no longer 'needs' an item", async () => {
    const repo = makeRepo();
    const { folder, layout } = makeSurface(repo, {
      items: [{ id: "i", kind: "doc", url: "u1" }],
      docs: [{ url: "u1", type: "essay", name: "x" }],
    });
    // before: link present, item present → nothing missing
    expect(linksNeedingItems(folder.doc().docs, layout.doc().items)).toEqual([]);
    // tool deletes: drop the folder link first
    folder.change((d) => { const i = d.docs.findIndex((l) => l.url === "u1"); d.docs.splice(i, 1); });
    await flush();
    // now there are no links, so the dangling item won't be recreated
    expect(linksNeedingItems(folder.doc().docs, layout.doc().items)).toEqual([]);
  });
});

// REGRESSION: deleting captures the item from the PROJECTION (a Solid store
// proxy) for undo. structuredClone() THROWS on a store proxy — capturing it that
// way made removeItems throw, so "delete" silently stopped working. We must
// JSON-clone instead. (This test would have caught it.)
describe("delete capture must not structuredClone a store proxy", () => {
  it("structuredClone throws on a projection item; JSON clone works", () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a", kind: "shape", x: 1, points: [[1, 2]] }] });
    withProjection(layout, (proj) => {
      const it = proj.items.find((x) => x.id === "a");
      expect(() => structuredClone(it)).toThrow();
      expect(JSON.parse(JSON.stringify(it))).toEqual({ id: "a", kind: "shape", x: 1, points: [[1, 2]] });
    });
  });

  it("transact's snapshot (structuredClone of handle.doc().items) works on a real doc", async () => {
    // the undo `transact` snapshots from handle.doc() (plain automerge objects),
    // NOT the projection — so structuredClone is fine there. A move → undo round-trip.
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 9, y: 9 }] });
    const before = snapshotItems(layout.doc().items); // must not throw
    layout.change((d) => { const a = d.items.find((x) => x.id === "a"); a.x = 100; a.y = 50; });
    await flush();
    const cmd = diffCommand(before, snapshotItems(layout.doc().items), (mut) => layout.change((d) => mut(d.items)), "move");
    cmd.undo(); await flush();
    expect(layout.doc().items.find((x) => x.id === "a")).toMatchObject({ x: 0, y: 0 });
    cmd.redo(); await flush();
    expect(layout.doc().items.find((x) => x.id === "a")).toMatchObject({ x: 100, y: 50 });
  });

  it("delete + undo round-trips a projection item (JSON capture)", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a", kind: "shape", x: 1, y: 2 }, { id: "b" }] });
    await withProjection(layout, async (proj) => {
      const captured = JSON.parse(JSON.stringify(proj.items.find((x) => x.id === "a"))); // how removeItems captures
      layout.change((d) => { const i = d.items.findIndex((x) => x.id === "a"); d.items.splice(i, 1); }); // delete
      await flush();
      expect(layout.doc().items.map((x) => x.id)).toEqual(["b"]);
      layout.change((d) => { if (!d.items.some((x) => x.id === captured.id)) d.items.push(JSON.parse(JSON.stringify(captured))); }); // undo
      await flush();
      expect(layout.doc().items.find((x) => x.id === "a")).toMatchObject({ kind: "shape", x: 1, y: 2 });
    });
  });
});
