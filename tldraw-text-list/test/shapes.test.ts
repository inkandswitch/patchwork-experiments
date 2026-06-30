import { describe, expect, it } from "vitest";
import { isTextShape, order, type Shape } from "../src/shapes";

const shape = (p: Partial<Shape> & { id: string }): Shape => ({
  typeName: "shape",
  type: "text",
  props: { richText: { type: "doc", content: [] } },
  ...p,
});

describe("isTextShape", () => {
  it("accepts text / geo / note with richText", () => {
    for (const type of ["text", "geo", "note"]) {
      expect(isTextShape(shape({ id: "a", type }))).toBe(true);
    }
  });

  it("rejects frame, non-shape records, and shapes without richText", () => {
    expect(isTextShape(shape({ id: "f", type: "frame" }))).toBe(false);
    expect(isTextShape({ id: "p", typeName: "page", type: "page" } as Shape)).toBe(false);
    expect(isTextShape({ id: "x", typeName: "shape", type: "text", props: {} })).toBe(false);
    expect(isTextShape(undefined)).toBe(false);
  });
});

describe("order", () => {
  const ids = (list: Shape[]) => [...list].sort(order).map((s) => s.id);

  it("sorts top-to-bottom, then left-to-right", () => {
    const list = [
      shape({ id: "bottom", x: 0, y: 500 }),
      shape({ id: "topRight", x: 300, y: 0 }),
      shape({ id: "topLeft", x: 0, y: 0 }),
    ];
    expect(ids(list)).toEqual(["topLeft", "topRight", "bottom"]);
  });

  it("treats shapes within the row band as one row, sorted by x", () => {
    const list = [
      shape({ id: "right", x: 200, y: 10 }),
      shape({ id: "left", x: 0, y: 0 }), // within 24px of `right`
    ];
    expect(ids(list)).toEqual(["left", "right"]);
  });

  it("breaks exact ties by index then id", () => {
    const list = [
      shape({ id: "b", x: 0, y: 0, index: "a2" }),
      shape({ id: "a", x: 0, y: 0, index: "a1" }),
    ];
    expect(ids(list)).toEqual(["a", "b"]);
  });
});
