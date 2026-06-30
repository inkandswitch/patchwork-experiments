import { describe, it, expect } from "vitest";
import { apply } from "./opstreams.js";
import { snapshot, isSnapshot, valuesEqual, anySchema, stringSchema, numberSchema, fileSchema } from "./ops.js";

describe("apply — the COW op engine ({path, range, value})", () => {
  it("assigns a top-level key without mutating the input", () => {
    const a = { x: 1 };
    const b = apply(a, { path: [], range: "y", value: 2 });
    expect(b).toEqual({ x: 1, y: 2 });
    expect(a).toEqual({ x: 1 }); // copy-on-write
  });
  it("assigns a nested key", () => {
    expect(apply({ a: { b: 1 } }, { path: ["a"], range: "c", value: 2 })).toEqual({ a: { b: 1, c: 2 } });
  });
  it("deletes a key when value is undefined", () => {
    expect(apply({ a: 1, b: 2 }, { path: [], range: "b", value: undefined })).toEqual({ a: 1 });
  });
  it("splices a string range", () => {
    expect(apply("abc", { path: [], range: [1, 2], value: "X" })).toBe("aXc");
    expect(apply("abc", { path: [], range: [1, 1], value: "X" })).toBe("aXbc"); // insert
  });
  it("splices an array range", () => {
    expect(apply([1, 2, 3], { path: [], range: [1, 2], value: 9 })).toEqual([1, 9, 3]);
  });
  it("replaces the whole value via a snapshot op", () => {
    // Opstream uses isSnapshot to short-circuit; apply itself patches by op,
    // so a snapshot is handled by the stream, not apply — sanity only here:
    expect(isSnapshot(snapshot(5))).toBe(true);
    expect(snapshot(5)).toEqual({ type: "snapshot", value: 5 });
  });
});

describe("valuesEqual", () => {
  it("primitives + plain structures", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
  });
});

describe("standard schemas validate()", () => {
  const ok = (s, v) => !s["~standard"].validate(v).issues;
  it("anySchema accepts everything", () => {
    expect(ok(anySchema(), 1)).toBe(true);
    expect(ok(anySchema(), { x: 1 })).toBe(true);
    expect(ok(anySchema(), null)).toBe(true);
  });
  it("stringSchema only strings", () => {
    expect(ok(stringSchema(), "a")).toBe(true);
    expect(ok(stringSchema(), 1)).toBe(false);
  });
  it("numberSchema only finite numbers", () => {
    expect(ok(numberSchema(), 3.14)).toBe(true);
    expect(ok(numberSchema(), NaN)).toBe(false);
    expect(ok(numberSchema(), "3")).toBe(false);
  });
  it("fileSchema needs {name, text}", () => {
    expect(ok(fileSchema(), { name: "a", text: "x" })).toBe(true);
    expect(ok(fileSchema(), { name: "a" })).toBe(false);
  });
});
