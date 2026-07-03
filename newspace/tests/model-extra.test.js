import { describe, it, expect } from "vitest";
import {
  linkItemId, duplicateItemIds, applyReorder, framesToWorld, groupBounds,
  itemsInRect, clickSelection, expandGroups, localToWorld,
} from "../src/model.js";

// doc/frame items take their bounds straight from x/y/w/h, so these tests use
// them to exercise the pure geometry without pulling in draw.js stroke maths.
const box = (id, x, y, w, h, extra) => ({ id, kind: "doc", x, y, w, h, ...extra });

describe("linkItemId (deterministic layout id per url)", () => {
  it("is a stable, url-derived id so two peers compute the SAME id", () => {
    expect(linkItemId("automerge:abc")).toBe("li-automerge:abc");
    expect(linkItemId("automerge:abc")).toBe(linkItemId("automerge:abc"));
  });
  it("differs per url", () => {
    expect(linkItemId("a")).not.toBe(linkItemId("b"));
  });
});

describe("duplicateItemIds", () => {
  it("returns indices of later items whose id already appeared", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "b" }, { id: "c" }];
    // the second "a" (idx 2) and second "b" (idx 3) are the dupes
    expect(duplicateItemIds(items)).toEqual([2, 3]);
  });
  it("keeps alt-drag COPIES (same url, unique ids) — dedupe is by id only", () => {
    const items = [box("x1", 0, 0, 10, 10, { url: "u" }), box("x2", 5, 5, 10, 10, { url: "u" })];
    expect(duplicateItemIds(items)).toEqual([]);
  });
  it("returns ascending indices (so callers splice high→low safely)", () => {
    const items = [{ id: "a" }, { id: "a" }, { id: "a" }];
    expect(duplicateItemIds(items)).toEqual([1, 2]);
  });
  it("is empty for a unique array", () => {
    expect(duplicateItemIds([{ id: "a" }, { id: "b" }])).toEqual([]);
  });
});

describe("applyReorder (z-order = array order)", () => {
  const ids = (a) => a.map((i) => i.id);

  it("front moves the selection to the end, preserving relative order", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1), box("c", 0, 0, 1, 1)];
    applyReorder(arr, ["a"], "front");
    expect(ids(arr)).toEqual(["b", "c", "a"]);
  });
  it("back moves the selection to the start, preserving relative order", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1), box("c", 0, 0, 1, 1)];
    applyReorder(arr, ["b", "c"], "back");
    expect(ids(arr)).toEqual(["b", "c", "a"]);
  });
  it("forward nudges a single item one step toward the front", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1), box("c", 0, 0, 1, 1)];
    applyReorder(arr, ["a"], "forward");
    expect(ids(arr)).toEqual(["b", "a", "c"]);
  });
  it("backward nudges a single item one step toward the back", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1), box("c", 0, 0, 1, 1)];
    applyReorder(arr, ["c"], "backward");
    expect(ids(arr)).toEqual(["a", "c", "b"]);
  });
  it("forward stops the topmost item at the top (can't move past the end)", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1)];
    applyReorder(arr, ["b"], "forward");
    expect(ids(arr)).toEqual(["a", "b"]);
  });
  it("forward keeps adjacent selected items together (won't swap past another selected one)", () => {
    const arr = [box("a", 0, 0, 1, 1), box("b", 0, 0, 1, 1), box("c", 0, 0, 1, 1)];
    applyReorder(arr, ["a", "b"], "forward");
    // a,b move forward as a block past c → c,a,b? no: each moves only if neighbour isn't selected
    expect(ids(arr)).toEqual(["c", "a", "b"]);
  });
  it("re-inserts CLONES (new object identity) so live automerge proxies aren't reused", () => {
    const original = box("a", 1, 2, 3, 4);
    const arr = [original, box("b", 0, 0, 1, 1)];
    applyReorder(arr, ["a"], "front");
    const moved = arr.find((i) => i.id === "a");
    expect(moved).not.toBe(original); // a fresh clone
    expect(moved).toMatchObject({ id: "a", x: 1, y: 2, w: 3, h: 4 });
  });
  it("does nothing for an empty selection", () => {
    const arr = [box("a", 0, 0, 1, 1)];
    applyReorder(arr, [], "front");
    expect(ids(arr)).toEqual(["a"]);
  });
});

describe("framesToWorld (compose nested frame transforms)", () => {
  it("is the identity with no frames", () => {
    expect(framesToWorld([], 5, 7)).toEqual([5, 7]);
  });
  it("applies a single frame's local->world transform", () => {
    const frame = { x: 100, y: 50, w: 200, h: 120, rotation: 0 };
    expect(framesToWorld([frame], 10, 20)).toEqual(localToWorld(frame, 10, 20));
  });
  it("composes outermost-first: inner local coords pass up through each frame", () => {
    const outer = { x: 100, y: 0, w: 200, h: 200, rotation: 0 };
    const inner = { x: 10, y: 10, w: 50, h: 50, rotation: 0 };
    // a point (5,5) inside inner → through inner → through outer
    const expected = localToWorld(outer, ...localToWorld(inner, 5, 5));
    expect(framesToWorld([outer, inner], 5, 5)).toEqual(expected);
  });
});

describe("groupBounds (group-as-shape bounding box)", () => {
  it("encloses every item sharing the group id", () => {
    const items = [
      box("a", 0, 0, 10, 10, { group: "g" }),
      box("b", 90, 40, 10, 10, { group: "g" }),
      box("c", 500, 500, 10, 10, { group: "other" }), // excluded
    ];
    expect(groupBounds(items, "g")).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it("returns null when no item belongs to the group", () => {
    expect(groupBounds([box("a", 0, 0, 10, 10)], "g")).toBe(null);
  });
});

describe("itemsInRect (marquee selection by centre)", () => {
  const items = [
    box("a", 0, 0, 10, 10),     // centre 5,5
    box("b", 100, 100, 10, 10), // centre 105,105
  ];
  it("selects items whose centre is inside the rect", () => {
    expect(itemsInRect(items, -5, -5, 50, 50)).toEqual(["a"]);
  });
  it("normalises a backwards (drag-up-left) rect", () => {
    // same rect given as x1<x0 / y1<y0 must select the same item
    expect(itemsInRect(items, 50, 50, -5, -5)).toEqual(["a"]);
  });
  it("excludes an item whose centre is outside even if it overlaps the rect edge", () => {
    // b's centre (105,105) is outside a rect ending at 100
    expect(itemsInRect(items, 0, 0, 100, 100)).toEqual(["a"]);
  });
  it("can select multiple", () => {
    expect(itemsInRect(items, -5, -5, 200, 200).sort()).toEqual(["a", "b"]);
  });
});

describe("expandGroups", () => {
  const items = [
    { id: "a", group: "g" }, { id: "b", group: "g" },
    { id: "c", group: "h" }, { id: "d" }, // d ungrouped
  ];
  it("pulls in every sibling sharing a group with the selection", () => {
    expect(expandGroups(items, ["a"]).sort()).toEqual(["a", "b"]);
  });
  it("unions across multiple groups in the selection", () => {
    expect(expandGroups(items, ["a", "c"]).sort()).toEqual(["a", "b", "c"]);
  });
  it("leaves an ungrouped selection untouched", () => {
    expect(expandGroups(items, ["d"])).toEqual(["d"]);
  });
});

describe("clickSelection (group-as-shape entry/exit)", () => {
  const items = [
    { id: "a", group: "g" }, { id: "b", group: "g" }, { id: "lone" },
  ];

  it("clicking a grouped item (not inside its group) selects the WHOLE group", () => {
    const { ids, exitGroup } = clickSelection(items, "a", null);
    expect(ids.sort()).toEqual(["a", "b"]);
    expect(exitGroup).toBe(false); // wasn't in any group
  });

  it("clicking a member while INSIDE its group picks just that member", () => {
    const { ids, exitGroup } = clickSelection(items, "a", "g");
    expect(ids).toEqual(["a"]);
    expect(exitGroup).toBe(false);
  });

  it("clicking outside the current group signals exitGroup", () => {
    // entered group "g", but clicked the lone (ungrouped) item → leave g
    const { ids, exitGroup } = clickSelection(items, "lone", "g");
    expect(ids).toEqual(["lone"]);
    expect(exitGroup).toBe(true);
  });

  it("clicking an ungrouped item with no entered group just selects it", () => {
    const { ids, exitGroup } = clickSelection(items, "lone", null);
    expect(ids).toEqual(["lone"]);
    expect(exitGroup).toBe(false);
  });
});
