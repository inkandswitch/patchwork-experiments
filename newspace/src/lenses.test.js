import { describe, it, expect } from "vitest";
import { lensDescriptor, lensSpec, applyLens } from "./lenses.js";
import { Source, Opstream } from "./opstreams.js";
import { numberSchema, stringSchema, snapshot } from "./ops.js";
import { firstMatchingInlet, inletAcceptsValue } from "./wire.js";

// the canonical first lens: number → string
const numToStr = {
  type: "sketchy:lens",
  id: "number-to-string",
  name: "number → string",
  inlet: { name: "in", type: "number", schema: numberSchema() },
  outlet: { name: "out", type: "text", schema: stringSchema() },
  project: (v) => (v == null ? "" : String(v)),
};

describe("lensDescriptor", () => {
  it("normalises to editor-shaped inlets/outlets arrays with a required inlet", () => {
    const d = lensDescriptor(numToStr);
    expect(d.lens).toBe(true);
    expect(d.inlets).toEqual([{ name: "in", type: "number", schema: numToStr.inlet.schema, required: true }]);
    expect(d.outlets).toEqual([numToStr.outlet]);
  });

  it("defaults inlet/outlet when absent", () => {
    const d = lensDescriptor({ id: "x" });
    expect(d.inlets[0]).toMatchObject({ name: "in", required: true });
    expect(d.outlets[0]).toMatchObject({ name: "out" });
  });
});

describe("lens wire matching", () => {
  it("the number inlet accepts a number value, not a string (Standard Schema)", () => {
    const d = lensDescriptor(numToStr);
    expect(inletAcceptsValue(d.inlets[0], 42)).toBe(true);
    expect(inletAcceptsValue(d.inlets[0], "hi")).toBe(false);
    expect(firstMatchingInlet(d, 42).name).toBe("in");
    expect(firstMatchingInlet(d, "hi")).toBe(null); // a string won't wire INTO number→string
  });
});

describe("applyLens", () => {
  it("projects the value (number → string)", () => {
    const out = applyLens(lensDescriptor(numToStr), new Source(42));
    expect(out.value).toBe("42");
  });

  it("is read-only — the output has no `apply` (a derived view, no write-back)", () => {
    const out = applyLens(lensDescriptor(numToStr), new Source(1));
    expect(out.apply).toBeUndefined();
  });

  it("passes the source complement through unchanged", () => {
    const src = new Source(7, { complement: { mimeType: "text/plain", save: () => {} } });
    const out = applyLens(lensDescriptor(numToStr), src);
    expect(out.complement.mimeType).toBe("text/plain");
    expect(typeof out.complement.save).toBe("function"); // capability survives the lens
  });

  it("re-projects live as the source changes", () => {
    const src = new Source(1);
    const out = applyLens(lensDescriptor(numToStr), src);
    const seen = [];
    out.connect(() => seen.push(out.value));
    expect(out.value).toBe("1");
    src.push(2);
    src.push(3);
    expect(out.value).toBe("3");
    expect(seen).toEqual(["1", "2", "3"]); // initial snapshot + each push
  });

  it("handles null/empty input via the projection (∅ → \"\")", () => {
    const out = applyLens(lensDescriptor(numToStr), new Source(null));
    expect(out.value).toBe("");
  });

  it("returns null with no source", () => {
    expect(applyLens(lensDescriptor(numToStr), null)).toBe(null);
  });
});

describe("bidirectional lens (unproject)", () => {
  const numToStrBi = { ...numToStr, unproject: (s) => { const n = Number(s); return Number.isFinite(n) ? n : undefined; } };

  it("is editable over an editable source, and writes inverted edits back", () => {
    const src = new Opstream(600); // editable (has apply)
    const out = applyLens(lensDescriptor(numToStrBi), src);
    expect(out.value).toBe("600");
    expect(typeof out.apply).toBe("function"); // editable → downstream editor is writable
    out.apply(snapshot("6000")); // downstream edits the text
    expect(src.value).toBe(6000); // parsed back to a NUMBER and written to the source
  });

  it("ignores an invalid number (keeps the last good source value)", () => {
    const src = new Opstream(5);
    const out = applyLens(lensDescriptor(numToStrBi), src);
    out.apply(snapshot("not a number"));
    expect(src.value).toBe(5); // unchanged
  });

  it("is READ-ONLY over a read-only source (Source has no apply) — no silent drops", () => {
    const out = applyLens(lensDescriptor(numToStrBi), new Source(7));
    expect(out.value).toBe("7");
    expect(out.apply).toBeUndefined(); // can't write through → present as read-only
  });
});

describe("lensSpec", () => {
  it("carries the projection and the outlet schema", () => {
    const spec = lensSpec(numToStr);
    expect(spec.value(5)).toBe("5");
    expect(spec.schema).toBe(numToStr.outlet.schema);
  });
});

import { plugins } from "./index.jsx";
import { fileSchema } from "./ops.js";

const lensById = (id) => plugins.find((p) => p.type === "sketchy:lens" && p.id === id);

describe("registered file lenses", () => {
  it("File → text projects the snapshot text", () => {
    const p = lensById("file-to-text");
    expect(p.project({ name: "a.txt", text: "hello" })).toBe("hello");
    expect(p.project(null)).toBe("");
    expect(p.project({ name: "a", text: undefined })).toBe("");
  });
  it("File → JSON parses the text, null on garbage", () => {
    const p = lensById("file-to-json");
    expect(p.project({ name: "a.json", text: '{"a":1}' })).toEqual({ a: 1 });
    expect(p.project({ name: "a.json", text: "not json" })).toBe(null);
    expect(p.project(null)).toBe(null);
  });
});

describe("a File snapshot wires INTO the file lenses (usability)", () => {
  const snapshot = { name: "data.json", type: "application/json", size: 7, lastModified: 1, extension: "json", text: '{"a":1}' };
  const lensDescById = (id) => lensDescriptor(lensById(id));

  it("the File→text inlet accepts a snapshot (so a File source can drive it)", () => {
    const d = lensDescById("file-to-text");
    expect(inletAcceptsValue(d.inlets[0], snapshot)).toBe(true);
    expect(firstMatchingInlet(d, snapshot).name).toBe("in");
  });
  it("the File→JSON inlet accepts a snapshot", () => {
    const d = lensDescById("file-to-json");
    expect(firstMatchingInlet(d, snapshot).name).toBe("in");
  });
  it("File→text yields the string codemirror's content inlet then accepts", () => {
    const out = applyLens(lensDescById("file-to-text"), new Source(snapshot));
    expect(out.value).toBe('{"a":1}');
    expect(typeof out.value).toBe("string"); // ← now a string, so it wires into codemirror
  });
});

describe("fileSchema", () => {
  it("accepts a file snapshot, rejects other shapes", () => {
    const std = fileSchema()["~standard"];
    expect(std.validate({ name: "a", text: "x" }).issues).toBeUndefined();
    expect(std.validate({ name: "a" }).issues).toBeTruthy(); // no text
    expect(std.validate("nope").issues).toBeTruthy();
    expect(std.validate(42).issues).toBeTruthy();
  });
});

describe("json-parse lens (registered, bidirectional)", () => {
  const p = () => lensById("json-parse");
  it("parses a string forward; null on bad json", () => {
    expect(p().project('{"a":1}')).toEqual({ a: 1 });
    expect(p().project("nope")).toBe(null);
  });
  it("stringifies back (unproject) for round-trip editing", () => {
    expect(JSON.parse(p().unproject({ a: 1 }))).toEqual({ a: 1 });
  });
  it("over an editable string source it's a real Lens (writes parsed edits back as text)", () => {
    const src = new Opstream('{"a":1}');
    const out = applyLens(lensDescriptor(p()), src);
    expect(out.value).toEqual({ a: 1 });
    out.apply(snapshot({ a: 2 }));
    expect(JSON.parse(src.value)).toEqual({ a: 2 }); // written back as stringified text
  });
});

describe("general-purpose lenses (registered)", () => {
  it("string→number parses forward and stringifies back (bidi)", () => {
    const p = lensById("string-to-number");
    expect(p.project("42")).toBe(42);
    expect(p.project("nope")).toBe(0);
    expect(p.unproject(7)).toBe("7");
  });
  it("json-stringify ⇄ (inverse of json-parse)", () => {
    const p = lensById("json-stringify");
    expect(JSON.parse(p.project({ a: 1 }))).toEqual({ a: 1 });
    expect(p.unproject('{"a":2}')).toEqual({ a: 2 });
    expect(p.unproject("bad")).toBeUndefined();
  });
  it("uppercase / lowercase", () => {
    expect(lensById("uppercase").project("aB")).toBe("AB");
    expect(lensById("lowercase").project("aB")).toBe("ab");
    expect(lensById("uppercase").project(null)).toBe("");
  });
  it("length covers strings, arrays, objects", () => {
    const p = lensById("length");
    expect(p.project("abc")).toBe(3);
    expect(p.project([1, 2])).toBe(2);
    expect(p.project({ a: 1, b: 2, c: 3 })).toBe(3);
    expect(p.project(null)).toBe(0);
  });
  it("keys returns an object's keys (else [])", () => {
    const p = lensById("keys");
    expect(p.project({ a: 1, b: 2 })).toEqual(["a", "b"]);
    expect(p.project(42)).toEqual([]);
  });
});
