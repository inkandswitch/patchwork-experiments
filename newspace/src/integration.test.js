// "Integration" tests: drive the pure model the way the tool does, on a plain
// items array standing in for a surface's `doc.items`. These exercise whole
// flows (reconcile → group → bind → delete) rather than single functions.
import { describe, it, expect } from "vitest";
import {
  linksNeedingItems, itemPresent, shouldUnlinkDoc, expandGroups,
  arrowGeometry, worldAnchor, cloneItem, clickSelection,
  linkItemId, duplicateItemIds,
} from "./model.js";

// a tiny stand-in for a layout surface
function surface(items = [], docs = []) { return { items, docs }; }

describe("docs → items reconcile flow", () => {
  it("creates a shape for each new folder link, then stops", () => {
    const s = surface([], [{ url: "a", type: "essay" }, { url: "b", type: "folder" }]);
    // first pass: both links need items
    let missing = linksNeedingItems(s.docs, s.items);
    expect(missing.map((l) => l.url)).toEqual(["a", "b"]);
    // the tool would push a doc/frame item per missing link
    for (const l of missing) s.items.push({ id: "i_" + l.url, kind: l.type === "folder" ? "frame" : "doc", url: l.url });
    // second pass: nothing left to create
    expect(linksNeedingItems(s.docs, s.items)).toEqual([]);
  });

  it("a tombstoned (just-deleted) url is not recreated", () => {
    const s = surface([], [{ url: "a", type: "essay" }]);
    expect(linksNeedingItems(s.docs, s.items, (u) => u === "a")).toEqual([]);
  });
});

describe("alt-drag copy + last-shape deletion flow", () => {
  it("a copy shares the url and adds no link; deleting one keeps the doc", () => {
    const items = [{ id: "d1", kind: "doc", url: "u1", x: 0, y: 0, w: 10, h: 10 }];
    // alt-drag: clone with a new id, same url
    const copy = cloneItem(items[0]); copy.id = "d2";
    expect(itemPresent(items, copy.id)).toBe(false);
    items.push(copy);
    // deleting d1 must NOT unlink u1 (d2 still references it)
    expect(shouldUnlinkDoc(items, "u1", ["d1"])).toBe(false);
    // deleting both → unlink
    expect(shouldUnlinkDoc(items, "u1", ["d1", "d2"])).toBe(true);
  });
});

describe("grouping selection flow", () => {
  const items = [
    { id: "a", group: "g1" }, { id: "b", group: "g1" }, { id: "c" }, { id: "d", group: "g2" },
  ];
  it("clicking one group member selects the whole group", () => {
    expect(expandGroups(items, ["a"]).sort()).toEqual(["a", "b"]);
  });
  it("an ungrouped item stays a singleton", () => {
    expect(expandGroups(items, ["c"])).toEqual(["c"]);
  });
  it("a marquee over members of two groups grabs both groups whole", () => {
    expect(expandGroups(items, ["a", "d"]).sort()).toEqual(["a", "b", "d"]);
  });
});

describe("collab: adding a doc with two viewers must not duplicate it", () => {
  it("linkItemId is deterministic per url, so both peers create the SAME id", () => {
    expect(linkItemId("automerge:abc")).toBe(linkItemId("automerge:abc"));
    expect(linkItemId("automerge:abc")).not.toBe(linkItemId("automerge:def"));
  });

  it("duplicateItemIds flags the racing duplicate but keeps an alt-drag copy", () => {
    // peer A and peer B both reconciled the new link → two items with the SAME
    // (deterministic) id; plus a genuine alt-drag copy (same url, DIFFERENT id)
    const items = [
      { id: linkItemId("u1"), kind: "doc", url: "u1" },
      { id: linkItemId("u1"), kind: "doc", url: "u1" }, // the racing duplicate
      { id: "copy-xyz", kind: "doc", url: "u1" },        // intentional copy — keep it
    ];
    expect(duplicateItemIds(items)).toEqual([1]); // remove only the 2nd (same id)
  });

  it("does nothing when there are no id collisions", () => {
    expect(duplicateItemIds([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([]);
  });
});

describe("clickSelection (group-as-shape: enter / scope / exit)", () => {
  const items = [{ id: "a", group: "g1" }, { id: "b", group: "g1" }, { id: "c" }, { id: "d", group: "g2" }];

  it("clicking a grouped item with NO group entered selects the whole group", () => {
    expect(clickSelection(items, "a", null)).toEqual({ ids: ["a", "b"], exitGroup: false });
  });
  it("clicking a member of the ENTERED group selects just that member", () => {
    expect(clickSelection(items, "a", "g1")).toEqual({ ids: ["a"], exitGroup: false });
  });
  it("clicking a member of a DIFFERENT group exits and selects that group", () => {
    expect(clickSelection(items, "d", "g1")).toEqual({ ids: ["d"], exitGroup: true });
  });
  it("clicking an ungrouped item while inside a group exits the group", () => {
    expect(clickSelection(items, "c", "g1")).toEqual({ ids: ["c"], exitGroup: true });
  });
});

describe("arrow binding flow (anchor round-trip on a moving box)", () => {
  it("the arrow end tracks the box as it moves and rotates", () => {
    const box = { id: "box", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };
    // bind the end to the box's right-edge midpoint via a world point
    const anchor = worldAnchor(box, 100, 50);
    expect(anchor.x).toBeCloseTo(1); expect(anchor.y).toBeCloseTo(0.5);
    const arrow = { kind: "shape", type: "arrow", x: -50, y: 50, w: 0, h: 0, toId: "box", toAnchor: anchor };
    // box at origin → end at (100,50)
    let g = arrowGeometry(arrow, [box, arrow]);
    expect([g.x + g.w, g.y + g.h]).toEqual([100, 50]);
    // move the box right by 200 → end follows to (300,50)
    box.x = 200;
    g = arrowGeometry(arrow, [box, arrow]);
    expect([g.x + g.w, g.y + g.h]).toEqual([300, 50]);
    // rotate the box 90° → the right-edge anchor swings to the bottom
    box.x = 0; box.rotation = 90;
    g = arrowGeometry(arrow, [box, arrow]);
    expect(g.x + g.w).toBeCloseTo(50, 5);
    expect(g.y + g.h).toBeCloseTo(100, 5);
  });
});
