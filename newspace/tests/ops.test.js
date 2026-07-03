import { describe, it, expect } from "vitest";
import { apply } from "../src/opstreams.js";
import { snapshot, isSnapshot, valuesEqual, anySchema, stringSchema, numberSchema, fileSchema, fmtNum, previewReplacer, transformOp, RESYNC } from "../src/ops.js";

describe("fmtNum / previewReplacer — display rounding (data untouched)", () => {
  it("rounds noisy floats to 2 dp, leaves integers + clean values alone", () => {
    expect(fmtNum(59.1678248461549)).toBe(59.17);
    expect(fmtNum(59)).toBe(59);
    expect(fmtNum(59.1)).toBe(59.1);
    expect(fmtNum("x")).toBe("x");
  });
  it("previewReplacer rounds numbers inside a JSON.stringify", () => {
    expect(JSON.stringify({ x: 59.1678248461549, y: 3 }, previewReplacer)).toBe('{"x":59.17,"y":3}');
  });
});

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

describe("transformOp — rebase a stale op over an already-applied one", () => {
  const spl = (path, from, to, value) => ({ path, range: [from, to], value });
  const set = (path, key, value) => ({ path, range: key, value });
  const del = (path, key) => ({ path, range: key, value: undefined });

  // [name, op, against, want] — want "same" pins identity (untouched, not a copy)
  const cases = [
    ["against a snapshot → RESYNC (the world was replaced)", spl([], 0, 1, "x"), snapshot("whole new value"), RESYNC],
    ["against an error op → unchanged (no mutation happened)", spl([], 0, 1, "x"), { type: "error", error: "boom" }, "same"],
    ["disjoint paths → unchanged", set(["a"], "k", 1), set(["b"], "k", 2), "same"],
    ["against deeper than the op → unchanged (coordinates unmoved)", spl(["items"], 0, 2, undefined), set(["items", 0], "x", 1), "same"],
    // splice vs splice, same container
    ["splice entirely before → shift by the net delta", spl([], 5, 7, "AB"), spl([], 0, 2, undefined), spl([], 3, 5, "AB")],
    ["splice entirely after → unchanged", spl([], 0, 1, "x"), spl([], 5, 6, undefined), "same"],
    ["insert-insert at the same position → client lands AFTER the host", spl([], 2, 2, "z"), spl([], 2, 2, "XY"), spl([], 4, 4, "z")],
    ["insert at the exact END of a delete → shifts to the collapse point", spl([], 3, 3, "z"), spl([], 1, 3, undefined), spl([], 1, 1, "z")],
    ["insert INSIDE a deleted region → moved to the collapse point", spl([], 2, 2, "z"), spl([], 1, 4, undefined), spl([], 1, 1, "z")],
    ["delete fully inside a delete → no-op (null)", spl([], 1, 3, undefined), spl([], 0, 4, undefined), null],
    ["delete straddling a pure delete → the contiguous surviving range", spl([], 1, 5, undefined), spl([], 2, 4, undefined), spl([], 1, 3, undefined)],
    ["delete overlapping on the left → the surviving head only", spl([], 1, 3, undefined), spl([], 2, 5, undefined), spl([], 1, 2, undefined)],
    ["delete overlapping on the right → the surviving tail, shifted", spl([], 2, 5, undefined), spl([], 1, 3, undefined), spl([], 1, 3, undefined)],
    ["delete straddling a REPLACEMENT → RESYNC (never delete unseen content)", spl([], 1, 5, undefined), spl([], 2, 4, "XY"), RESYNC],
    ["replace fully inside a delete → keep the client's insert at the collapse point", spl([], 2, 3, "Z"), spl([], 1, 5, undefined), spl([], 1, 1, "Z")],
    // op's path descends through an index of the spliced container
    ["path segment after a delete → index shifted down", set(["items", 2], "x", 9), spl(["items"], 0, 1, undefined), set(["items", 1], "x", 9)],
    ["path segment after an insert → index shifted right", set(["items", 1], "x", 9), spl(["items"], 0, 0, [{}, {}]), set(["items", 3], "x", 9)],
    ["path segment INSIDE the deleted range → orphaned (RESYNC)", set(["items", 0], "x", 9), spl(["items"], 0, 1, undefined), RESYNC],
    // assign vs splice on the same list (a numeric key is an index)
    ["numeric set after a delete → key shifted", set(["items"], 2, "v"), spl(["items"], 0, 1, undefined), set(["items"], 1, "v")],
    ["numeric set on a deleted element → orphaned (RESYNC)", set(["items"], 0, "v"), spl(["items"], 0, 1, undefined), RESYNC],
    ["numeric delete after a delete → key shifted", del(["items"], 3), spl(["items"], 0, 2, undefined), del(["items"], 1)],
    ["numeric delete of an already-deleted element → no-op (null)", del(["items"], 1), spl(["items"], 0, 2, undefined), null],
    ["splice against a numeric key-delete (≡ splice one out) → shift", spl(["items"], 2, 3, ["C"]), del(["items"], 0), spl(["items"], 1, 2, ["C"])],
    // assigns
    ["assign vs assign on the same key → last-writer, the client op stands", set([], "name", "b"), set([], "name", "a"), "same"],
    ["descend through a key the other op REPLACED wholesale → RESYNC", set(["cfg"], "x", 1), set([], "cfg", { fresh: true }), RESYNC],
    ["descend through a key the other op DELETED → RESYNC", set(["cfg"], "x", 1), del([], "cfg"), RESYNC],
    ["string-key assign vs a list splice → unchanged (containers disagree)", set(["items"], "meta", 1), spl(["items"], 0, 1, undefined), "same"],
    // the op side passes through when it isn't positional
    ["a snapshot op → unchanged (it replaces wholesale anyway)", snapshot(5), spl([], 0, 1, undefined), "same"],
  ];

  for (const [name, op, against, want] of cases) {
    it(name, () => {
      const got = transformOp(op, against);
      if (want === "same") expect(got).toBe(op); // identity: untouched ops aren't copied
      else if (want === null || want === RESYNC) expect(got).toBe(want);
      else expect(got).toEqual(want);
    });
  }

  it("folds over several missed ops in order (how the provider replays its buffer)", () => {
    // op targets index 4; a delete of [0,2) then an insert of one at 0 both shift it
    let op = set(["items"], 4, "v");
    op = transformOp(op, spl(["items"], 0, 2, undefined)); // → 2
    op = transformOp(op, spl(["items"], 0, 0, ["new"])); // → 3
    expect(op).toEqual(set(["items"], 3, "v"));
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
