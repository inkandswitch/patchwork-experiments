import { describe, expect, test } from "vitest";
import { canMove, dropIntent, isMove, moveInOrder, placementFor, siblings, spliceOrder } from "./tree-drop.js";

// A group with two children, a loose object after it.
//   g1
//     a
//     b
//   c
const objects = {
  g1: { kind: "group", name: "g1", parent: null },
  a: { kind: "object", name: "a", parent: "g1" },
  b: { kind: "object", name: "b", parent: "g1" },
  c: { kind: "object", name: "c", parent: null },
};
const order = ["g1", "a", "b", "c"];

describe("dropIntent", () => {
  test("a leaf has no middle: it is before or after, nothing else", () => {
    expect(dropIntent(false, 0.1)).toBe("before");
    expect(dropIntent(false, 0.49)).toBe("before");
    expect(dropIntent(false, 0.5)).toBe("after");
    expect(dropIntent(false, 0.9)).toBe("after");
  });

  // Pointing at a group usually means the group, so its middle is the widest
  // band and the edges are the narrow ones.
  test("a group takes the drop into itself from the middle half", () => {
    expect(dropIntent(true, 0.1)).toBe("before");
    expect(dropIntent(true, 0.3)).toBe("into");
    expect(dropIntent(true, 0.5)).toBe("into");
    expect(dropIntent(true, 0.7)).toBe("into");
    expect(dropIntent(true, 0.9)).toBe("after");
  });

  test("a fraction off the end of the row is clamped, not believed", () => {
    expect(dropIntent(true, -3)).toBe("before");
    expect(dropIntent(true, 12)).toBe("after");
    expect(dropIntent(true, NaN)).toBe("before");
  });
});

describe("placementFor", () => {
  test("into a group appends inside it", () => {
    expect(placementFor(objects, order, "g1", "into")).toEqual({ parent: "g1", before: null });
  });

  test("before a row takes that row's parent", () => {
    expect(placementFor(objects, order, "b", "before")).toEqual({ parent: "g1", before: "b" });
  });

  // `order` is flat, so "after g1" must not mean "in front of g1's first
  // child" — that would land inside the subtree instead of after it.
  test("after a group skips its descendants to find the next sibling", () => {
    expect(placementFor(objects, order, "g1", "after")).toEqual({ parent: null, before: "c" });
  });

  // The rule is about what the user can see: on a folded group "after" is
  // after the whole (hidden) subtree; on an open one the line sits between the
  // group and its first child, so that is where it goes.
  test("after an expanded group means inside it, at the top", () => {
    expect(placementFor(objects, order, "g1", "after", undefined, { expanded: true })).toEqual({ parent: "g1", before: "a" });
  });

  test("expanded makes no difference to a row with no children", () => {
    expect(placementFor(objects, order, "c", "after", undefined, { expanded: true })).toEqual({ parent: null, before: null });
  });

  test("after the last child means last among its siblings", () => {
    expect(placementFor(objects, order, "b", "after")).toEqual({ parent: "g1", before: null });
  });

  test("a row that isn't there puts it at the top level", () => {
    expect(placementFor(objects, order, "nope", "into")).toEqual({ parent: null, before: null });
  });
});

describe("canMove", () => {
  test("a group cannot be moved inside itself or its own descendants", () => {
    expect(canMove(objects, "g1", "g1")).toBe(false);
    expect(canMove(objects, "g1", "a")).toBe(false);
  });

  test("an ordinary move is allowed", () => {
    expect(canMove(objects, "c", "g1")).toBe(true);
    expect(canMove(objects, "a", null)).toBe(true);
  });
});

describe("moveInOrder", () => {
  test("moves an id in front of another", () => {
    expect(moveInOrder(order, "c", "a")).toEqual(["g1", "c", "a", "b"]);
  });

  test("null means the end", () => {
    expect(moveInOrder(order, "g1", null)).toEqual(["a", "b", "c", "g1"]);
  });

  test("leaves the input alone", () => {
    const before = [...order];
    moveInOrder(order, "a", "c");
    expect(order).toEqual(before);
  });

  // So a drag that ends where it started can be compared and skipped rather
  // than written.
  test("a move that changes nothing produces an equal array", () => {
    expect(moveInOrder(order, "a", "b")).toEqual(order);
  });
});

describe("isMove", () => {
  test("a row dropped on its own line is not a move", () => {
    expect(isMove(objects, order, "a", { parent: "g1", before: "a" })).toBe(false);
    // "after a" is "before b": b is already there
    expect(isMove(objects, order, "b", { parent: "g1", before: "b" })).toBe(false);
    expect(isMove(objects, order, "b", { parent: "g1", before: null })).toBe(false);
  });

  // In the flat order g1's children sit between g1 and c, so moving g1 in front
  // of c changes the array but not the tree.
  test("a group moved past its own descendants is not a move", () => {
    expect(isMove(objects, order, "g1", { parent: null, before: "c" })).toBe(false);
  });

  test("a real reorder or reparent is", () => {
    expect(isMove(objects, order, "b", { parent: "g1", before: "a" })).toBe(true);
    expect(isMove(objects, order, "c", { parent: null, before: "g1" })).toBe(true);
    expect(isMove(objects, order, "c", { parent: "g1", before: null })).toBe(true);
  });

  test("siblings lists one parent's children in order", () => {
    expect(siblings(objects, order, "g1")).toEqual(["a", "b"]);
    expect(siblings(objects, order, null)).toEqual(["g1", "c"]);
  });
});

describe("spliceOrder", () => {
  test("moves in place and agrees with moveInOrder", () => {
    for (const [id, before] of [["c", "a"], ["g1", null], ["a", "c"], ["b", "g1"]]) {
      const list = [...order];
      spliceOrder(list, id, before);
      expect(list).toEqual(moveInOrder(order, id, before));
    }
  });

  test("an id not yet listed is inserted", () => {
    const list = ["a", "b"];
    spliceOrder(list, "x", "b");
    expect(list).toEqual(["a", "x", "b"]);
  });
});
