import { describe, it, expect } from "vitest";
import { boundsIntersect, itemsUnder, nounForItem, describeItems } from "../src/board-snapshot.js";

describe("board-snapshot geometry", () => {
  it("boundsIntersect", () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
    expect(boundsIntersect(null, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });
  it("itemsUnder excludes the glass itself and non-overlapping items", () => {
    const region = { x: 0, y: 0, w: 100, h: 100 };
    const b = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h });
    const items = [
      { id: "glass", x: 0, y: 0, w: 100, h: 100 },
      { id: "a", x: 10, y: 10, w: 20, h: 20 },     // under
      { id: "z", x: 500, y: 500, w: 20, h: 20 },   // far
    ];
    expect(itemsUnder(items, region, b, "glass").map((i) => i.id)).toEqual(["a"]);
  });
});

describe("describeItems", () => {
  it("names each kind sensibly", () => {
    expect(nounForItem({ kind: "doc", name: "Cat" })).toBe("document “Cat”");
    expect(nounForItem({ kind: "shape", type: "arrow" })).toBe("arrow");
    expect(nounForItem({ kind: "text", text: "hello world" })).toBe("text “hello world”");
    expect(nounForItem({ kind: "editor", editorId: "llm" })).toBe("llm node");
  });
  it("groups + counts + articles, in first-seen order", () => {
    const items = [
      { kind: "doc", name: "A" },
      { kind: "stroke" }, { kind: "stroke" }, { kind: "stroke" },
      { kind: "shape", type: "arrow" },
    ];
    expect(describeItems(items)).toBe("a document “A”, 3 ink strokes, an arrow");
  });
  it("empty → nothing", () => {
    expect(describeItems([])).toBe("nothing");
  });
});
