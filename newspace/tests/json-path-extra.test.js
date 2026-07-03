import { describe, it, expect } from "vitest";
import { parsePath, evalPath, writeOp, jsonPathStream } from "../src/json-path.js";
import { Opstream, Source } from "../src/opstreams.js";
import { isSnapshot } from "../src/ops.js";

describe("parsePath — quoted bracket keys", () => {
  it("a double-quoted key may contain dots and brackets verbatim", () => {
    // the chars inside the quotes are NOT re-parsed as path syntax
    expect(parsePath('["a.b"]')).toEqual(["a.b"]);
    expect(parsePath('.["a.b"]')).toEqual(["a.b"]);
  });
  it("a single-quoted key with spaces stays one step", () => {
    expect(parsePath("['hello world']")).toEqual(["hello world"]);
  });
  it("an empty quoted key is the empty string step", () => {
    expect(parsePath('[""]')).toEqual([""]);
  });
  it("a bareword inside brackets (unquoted, non-numeric) is kept as-is", () => {
    // not quoted and not /^-?\d+$/ → pushed raw
    expect(parsePath("[foo]")).toEqual(["foo"]);
  });
  it("whitespace inside the brackets is trimmed before classification", () => {
    expect(parsePath("[ 3 ]")).toEqual([3]);
    expect(parsePath('[ "k" ]')).toEqual(["k"]);
  });
});

describe("parsePath — negative indices typing", () => {
  it("a negative index is a number, not a string", () => {
    const steps = parsePath("[-2]");
    expect(steps).toEqual([-2]);
    expect(typeof steps[0]).toBe("number");
  });
  it("a multi-digit negative index", () => {
    expect(parsePath(".a[-10].b")).toEqual(["a", -10, "b"]);
  });
});

describe("evalPath — arrays and missing paths", () => {
  const v = { rows: [[1, 2], [3, 4]], obj: { deep: { n: 9 } }, "": "empty-key" };

  it("indexes nested arrays positionally", () => {
    expect(evalPath(v, ".rows[1][0]")).toBe(3);
    expect(evalPath(v, ".rows[0][-1]")).toBe(2); // negative via at()
  });
  it("a negative index past the start is undefined (at() returns undefined)", () => {
    expect(evalPath(v, ".rows[0][-5]")).toBeUndefined();
  });
  it("an out-of-range positive index on an array is undefined", () => {
    expect(evalPath(v, ".rows[9]")).toBeUndefined();
  });
  it("stepping through an undefined intermediate short-circuits to undefined", () => {
    expect(evalPath(v, ".missing.also.gone")).toBeUndefined();
  });
  it("evalPath on undefined/null root is undefined", () => {
    expect(evalPath(undefined, ".a")).toBeUndefined();
    expect(evalPath(null, ".a.b")).toBeUndefined();
  });
  it("a numeric step against a non-array reads it as a plain key", () => {
    // typeof step === number but cur is an object → cur[step]
    expect(evalPath({ 0: "zero" }, "[0]")).toBe("zero");
  });
  it("the empty-string key is reachable via a quoted bracket", () => {
    expect(evalPath(v, '[""]')).toBe("empty-key");
  });
  it("identity on a primitive returns the primitive", () => {
    expect(evalPath(42, ".")).toBe(42);
  });
});

describe("writeOp — nested array indices end-to-end", () => {
  it("builds a {path, range} op where the trailing index is the range", () => {
    expect(writeOp(["grid", 2, 5], "z")).toEqual({ path: ["grid", 2], range: 5, value: "z" });
  });

  it("writes into a nested array element on an Opstream, sharing siblings", () => {
    const doc = new Opstream({ grid: [["a", "b"], ["c", "d"]], keep: 1 });
    doc.apply(writeOp(parsePath(".grid[1][0]"), "C"));
    expect(doc.value.grid[1][0]).toBe("C");
    expect(doc.value.grid[1][1]).toBe("d"); // sibling element untouched
    expect(doc.value.grid[0]).toEqual(["a", "b"]); // sibling row untouched
    expect(doc.value.keep).toBe(1); // sibling key untouched
  });

  it("a deeper mixed object/array path round-trips through evalPath", () => {
    const doc = new Opstream({ a: { list: [{ v: 0 }, { v: 1 }] } });
    const steps = parsePath(".a.list[1].v");
    doc.apply(writeOp(steps, 99));
    expect(evalPath(doc.value, ".a.list[1].v")).toBe(99);
    expect(doc.value.a.list[0].v).toBe(0);
  });
});

describe("writeOp — `.` identity whole-doc write (mountJsonSet semantics)", () => {
  it("writeOp([]) produces a snapshot of the value", () => {
    const op = writeOp([], { fresh: true });
    expect(isSnapshot(op)).toBe(true);
    expect(op).toEqual({ type: "snapshot", value: { fresh: true } });
  });

  it("parsePath('.') → [] → snapshot replacing the whole doc", () => {
    const doc = new Opstream({ old: 1, gone: 2 });
    doc.apply(writeOp(parsePath("."), { only: "this" }));
    expect(doc.value).toEqual({ only: "this" }); // wholesale replace, old keys gone
  });

  it("an identity write of a primitive replaces the root with that primitive", () => {
    const doc = new Opstream({ a: 1 });
    doc.apply(writeOp(parsePath("."), "scalar"));
    expect(doc.value).toBe("scalar");
  });
});

describe("jsonPathStream — bidirectional idempotency (no emit on no-op)", () => {
  it("a no-op write-back does not notify connected listeners", () => {
    const src = new Opstream({ a: { b: 7 } });
    const out = jsonPathStream(src, () => ".a.b");
    const seen = [];
    out.connect((s) => seen.push(s.value));
    expect(seen).toEqual([7]); // the initial connect snapshot
    out.apply({ type: "snapshot", value: 7 }); // equal to current → suppressed
    expect(seen).toEqual([7]); // still just the connect snapshot, no extra emit
  });

  it("a real write-back propagates exactly one downstream notification", () => {
    const src = new Opstream({ a: { b: 7 } });
    const out = jsonPathStream(src, () => ".a.b");
    const seen = [];
    out.connect((s) => seen.push(s.value));
    out.apply({ type: "snapshot", value: 8 }); // a genuine change
    expect(src.value.a.b).toBe(8);
    expect(seen).toEqual([7, 8]); // connect snapshot, then the change
  });

  it("an op (non-snapshot) write-back is applied to the narrowed value then written at the path", () => {
    // the narrowed value is a string; apply a text-splice op to it
    const src = new Opstream({ note: "hi" });
    const out = jsonPathStream(src, () => ".note");
    expect(out.value).toBe("hi");
    out.apply({ path: [], range: [2, 2], value: "!" }); // append "!" → "hi!"
    expect(src.value.note).toBe("hi!");
  });

  it("a no-op op write-back (splice that changes nothing) is suppressed", () => {
    const src = new Opstream({ note: "hi" });
    let writes = 0;
    const real = src.apply.bind(src);
    src.apply = (op) => { writes++; real(op); };
    const out = jsonPathStream(src, () => ".note");
    out.apply({ path: [], range: [0, 0], value: "" }); // empty splice → unchanged
    expect(writes).toBe(0);
    expect(src.value.note).toBe("hi");
  });

  it("write-back targets whatever path getExpr() currently returns", () => {
    const src = new Opstream({ a: 1, b: 2 });
    let expr = ".a";
    const out = jsonPathStream(src, () => expr);
    out.apply({ type: "snapshot", value: 10 });
    expect(src.value.a).toBe(10);
    expr = ".b"; // change the live path
    out.apply({ type: "snapshot", value: 20 });
    expect(src.value.b).toBe(20);
    expect(src.value.a).toBe(10); // earlier write preserved
  });

  it("over a read-only Source there is no apply at all", () => {
    const out = jsonPathStream(new Source({ a: { b: 1 } }), () => ".a");
    expect(out.apply).toBeUndefined();
    expect(out.value).toEqual({ b: 1 });
  });
});

import { makeRepo, flush } from "./test-harness.js";
import { automergeOpstream } from "../src/opstreams.js";

describe("parsePath — a quoted key CONTAINING ] (quote-aware bracket scan)", () => {
  it('["a]b"] parses to the single step "a]b"', () => {
    expect(parsePath('["a]b"]')).toEqual(["a]b"]);
    expect(parsePath("['a]b']")).toEqual(["a]b"]);
  });
  it("brackets and dots inside the quotes are not re-parsed as path syntax", () => {
    expect(parsePath('.x["w]e[i.rd"].y')).toEqual(["x", "w]e[i.rd", "y"]);
  });
  it("still throws on a genuinely unclosed bracket, even with a quote inside", () => {
    expect(() => parsePath('["a]b"')).toThrow();
    expect(() => parsePath('["a]b')).toThrow();
  });
});

describe("negative-index WRITE parity (in-memory apply ⇄ applyAutomerge)", () => {
  it("[-1] writes hit the LAST element on an in-memory opstream (no bogus '-1' key)", () => {
    const doc = new Opstream({ xs: [1, 2, 3] });
    doc.apply(writeOp(parsePath(".xs[-1]"), 99));
    expect(doc.value.xs).toEqual([1, 2, 99]);
    expect(Object.prototype.hasOwnProperty.call(doc.value.xs, "-1")).toBe(false);
  });

  it("[-1] writes hit the LAST element on a REAL automerge doc (no throw in handle.change)", async () => {
    const repo = makeRepo();
    const handle = repo.create({ xs: [1, 2, 3] });
    const s = automergeOpstream(handle);
    expect(() => s.apply(writeOp(parsePath(".xs[-1]"), 99))).not.toThrow();
    await flush();
    expect([...handle.doc().xs]).toEqual([1, 2, 99]);
  });

  it("a negative index in the MIDDLE of a path resolves the same on both paths", async () => {
    const repo = makeRepo();
    const handle = repo.create({ rows: [{ v: 1 }, { v: 2 }] });
    automergeOpstream(handle).apply(writeOp(parsePath(".rows[-1].v"), 9));
    await flush();
    expect(handle.doc().rows[1].v).toBe(9);

    const mem = new Opstream({ rows: [{ v: 1 }, { v: 2 }] });
    mem.apply(writeOp(parsePath(".rows[-1].v"), 9));
    expect(mem.value.rows[1].v).toBe(9); // same landing spot in memory
  });

  it("negative-index DELETE splices the resolved element (in memory)", () => {
    const doc = new Opstream({ xs: ["a", "b", "c"] });
    doc.apply({ path: ["xs"], range: -1, value: undefined }); // delete last
    expect(doc.value.xs).toEqual(["a", "b"]);
  });
});

describe("missing-intermediate WRITE parity — both paths autovivify objects", () => {
  it("in-memory: writing .a.b.c into {} vivifies {a:{b:{c:1}}}", () => {
    const doc = new Opstream({});
    doc.apply(writeOp(parsePath(".a.b.c"), 1));
    expect(doc.value).toEqual({ a: { b: { c: 1 } } });
  });

  it("automerge: the same write vivifies the same shape instead of throwing", async () => {
    const repo = makeRepo();
    const handle = repo.create({});
    const s = automergeOpstream(handle);
    expect(() => s.apply(writeOp(parsePath(".a.b.c"), 1))).not.toThrow();
    await flush();
    expect(handle.doc().a.b.c).toBe(1);
  });
});
