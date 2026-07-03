import { describe, it, expect } from "vitest";
import { parsePath, evalPath, writeOp } from "../src/json-path.js";
import { Opstream } from "../src/opstreams.js";

describe("parsePath", () => {
  it("identity for empty / '.'", () => {
    expect(parsePath("")).toEqual([]);
    expect(parsePath(".")).toEqual([]);
  });
  it("dotted keys", () => {
    expect(parsePath(".a.b.c")).toEqual(["a", "b", "c"]);
    expect(parsePath("a.b")).toEqual(["a", "b"]); // leading dot optional
  });
  it("bracket indices and quoted keys", () => {
    expect(parsePath(".items[0]")).toEqual(["items", 0]);
    expect(parsePath('.["weird key"]')).toEqual(["weird key"]);
    expect(parsePath("['a'][2]")).toEqual(["a", 2]);
  });
  it("mixed", () => {
    expect(parsePath(".a.b[2].c")).toEqual(["a", "b", 2, "c"]);
  });
  it("negative indices", () => {
    expect(parsePath(".x[-1]")).toEqual(["x", -1]);
  });
  it("throws on an unclosed bracket", () => {
    expect(() => parsePath(".a[0")).toThrow();
  });
});

describe("evalPath", () => {
  const v = { a: { b: [10, 20, 30] }, list: [{ id: "x" }, { id: "y" }], "weird key": 7 };
  it("identity returns the whole value", () => {
    expect(evalPath(v, ".")).toBe(v);
  });
  it("navigates keys and indices", () => {
    expect(evalPath(v, ".a.b[1]")).toBe(20);
    expect(evalPath(v, ".list[1].id")).toBe("y");
    expect(evalPath(v, '.["weird key"]')).toBe(7);
  });
  it("negative array index via at()", () => {
    expect(evalPath(v, ".a.b[-1]")).toBe(30);
  });
  it("missing path ⇒ undefined (no throw)", () => {
    expect(evalPath(v, ".a.nope.deeper")).toBeUndefined();
    expect(evalPath(null, ".a")).toBeUndefined();
  });
  it("accepts a pre-parsed step array", () => {
    expect(evalPath(v, ["a", "b", 0])).toBe(10);
  });
});

describe("writeOp + json-set write path", () => {
  it("a single-key path → assign at the root", () => {
    expect(writeOp(["width"], 600)).toEqual({ path: [], range: "width", value: 600 });
  });
  it("a nested path → walk to the parent, assign the last key", () => {
    expect(writeOp(["a", "b", "c"], 7)).toEqual({ path: ["a", "b"], range: "c", value: 7 });
  });
  it("an index path → assign at the numeric key", () => {
    expect(writeOp(["items", 0], "x")).toEqual({ path: ["items"], range: 0, value: "x" });
  });
  it("identity path → a snapshot replacing the whole value", () => {
    expect(writeOp([], { a: 1 })).toEqual({ type: "snapshot", value: { a: 1 } });
  });

  it("applied to an opstream, it writes the targeted field (end-to-end)", () => {
    const doc = new Opstream({ title: "Paint", width: 400, nested: { z: 1 } });
    doc.apply(writeOp(parsePath(".width"), 600));
    expect(doc.value.width).toBe(600);
    expect(doc.value.title).toBe("Paint"); // other fields untouched
    doc.apply(writeOp(parsePath(".nested.z"), 9));
    expect(doc.value.nested.z).toBe(9);
  });

  it("`.` (identity) replaces the WHOLE doc — the json-set whole-object write", () => {
    const doc = new Opstream({ a: 1, b: 2 });
    doc.apply(writeOp(parsePath("."), { x: 9 }));
    expect(doc.value).toEqual({ x: 9 }); // old keys gone, new object in place
  });
});

import { jsonPathStream } from "../src/json-path.js";
import { Source } from "../src/opstreams.js";

describe("jsonPathStream (bidirectional lens)", () => {
  it("reads the narrowed view and writes edits BACK at the path", () => {
    const src = new Opstream({ a: { b: 1 }, keep: "x" });
    let expr = ".a.b";
    const out = jsonPathStream(src, () => expr);
    expect(out.value).toBe(1);
    out.apply({ type: "snapshot", value: 42 }); // downstream edits the narrowed value
    expect(src.value.a.b).toBe(42); // written back through the path
    expect(src.value.keep).toBe("x"); // siblings untouched
  });

  it("re-narrows when the path changes (emit) and tracks source changes", () => {
    const src = new Opstream({ a: 1, b: 2 });
    let expr = ".a";
    const out = jsonPathStream(src, () => expr);
    const seen = [];
    out.connect((s) => seen.push(s.value));
    expect(out.value).toBe(1);
    expr = ".b"; out.emit();
    expect(out.value).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("is read-only (no apply) over a read-only source — the File case", () => {
    const out = jsonPathStream(new Source({ text: "hi" }), () => ".text");
    expect(out.value).toBe("hi");
    expect(out.apply).toBeUndefined();
  });

  it("passes the source complement through (so save() survives the lens)", () => {
    const src = new Opstream({ x: 1 }, { complement: { save: () => "saved" } });
    const out = jsonPathStream(src, () => ".x");
    expect(typeof out.complement.save).toBe("function");
  });
});

describe("parsePath never stalls (freeze guard)", () => {
  it("returns quickly for empty / dot / odd input", () => {
    expect(parsePath("")).toEqual([]);
    expect(parsePath(".")).toEqual([]);
    expect(parsePath("..")).toEqual([]);
    expect(parsePath(".a..b")).toEqual(["a", "b"]);
  });
});

import { valuesEqual } from "../src/ops.js";

describe("idempotent write-back (no feedback-loop freeze)", () => {
  it("valuesEqual: identity, primitives, plain structures", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual(1, "1")).toBe(false);
  });

  it("a bidirectional jsonPathStream does NOT write when the value is unchanged", () => {
    const src = new Opstream({ a: 1 });
    let writes = 0;
    const realApply = src.apply.bind(src);
    src.apply = (op) => { writes++; realApply(op); };
    const out = jsonPathStream(src, () => ".a");
    out.apply({ type: "snapshot", value: 1 }); // same as current → must be a no-op
    expect(writes).toBe(0);
    out.apply({ type: "snapshot", value: 2 }); // a real change → writes once
    expect(writes).toBe(1);
    out.apply({ type: "snapshot", value: 2 }); // same again → no-op
    expect(writes).toBe(1);
  });
});
