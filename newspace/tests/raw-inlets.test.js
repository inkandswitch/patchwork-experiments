// Item-3 pure logic: param-inlet-WINS-when-wired resolution (paramWireFor) and
// which inlets the properties popup can edit inline (rawValueInlets — wired to a
// RAW VALUE node), plus the raw text round-trip the inline editor uses.
import { describe, it, expect } from "vitest";
import { paramWireFor, rawValueInlets } from "../src/wire.js";
import { rawText, parseRawText } from "../src/brush/ui/chrome.jsx";

describe("paramWireFor — the wire wins only when actually wired", () => {
  const item = { inlets: { ms: { node: "rv1", outlet: "value" }, cut: null } };
  it("a real wiring entry wins", () => {
    expect(paramWireFor(item, "ms")).toEqual({ node: "rv1", outlet: "value" });
  });
  it("no entry ⇒ not wired (panel edits config)", () => {
    expect(paramWireFor(item, "gain")).toBe(null);
  });
  it("the null unwire TOMBSTONE ⇒ not wired (an explicitly-cut param is yours again)", () => {
    expect(paramWireFor(item, "cut")).toBe(null);
  });
  it("robust to items without inlets", () => {
    expect(paramWireFor({}, "ms")).toBe(null);
    expect(paramWireFor(null, "ms")).toBe(null);
  });
});

describe("rawValueInlets — inline-editable inlets (wired to a raw value node)", () => {
  const items = [
    { id: "rv1", kind: "editor", editorId: "value", config: { raw: "5", kind: "number" } },
    { id: "rv2", kind: "editor", editorId: "value" }, // no config ⇒ kind defaults to text
    { id: "lens1", kind: "editor", editorId: "uppercase" },
    { id: "shape1", kind: "shape" },
  ];
  const defs = [{ name: "in" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }];
  it("finds inlets wired to a raw value node, with the raw node's kind", () => {
    const item = { inlets: { in: { node: "rv1", outlet: "value" }, b: { node: "rv2", outlet: "value" } } };
    expect(rawValueInlets(item, defs, items)).toEqual([
      { name: "in", node: "rv1", outlet: "value", kind: "number" },
      { name: "b", node: "rv2", outlet: "value", kind: "text" },
    ]);
  });
  it("ignores non-raw upstreams, cut inlets, url/context wires and unwired inlets", () => {
    const item = { inlets: { in: { node: "lens1", outlet: "out" }, b: null, c: { url: "automerge:x", path: [] }, d: { context: "camera" } } };
    expect(rawValueInlets(item, defs, items)).toEqual([]);
  });
  it("ignores a wire to a NON-editor item with the same id shape", () => {
    const item = { inlets: { in: { node: "shape1", outlet: "props" } } };
    expect(rawValueInlets(item, defs, items)).toEqual([]);
  });
});

describe("raw text round-trip (the inline editor's coerce/uncoerce)", () => {
  it("number", () => {
    expect(parseRawText("42", "number")).toBe(42);
    expect(parseRawText("nope", "number")).toBe(0);
    expect(rawText(42, "number")).toBe("42");
  });
  it("boolean", () => {
    expect(parseRawText("true", "boolean")).toBe(true);
    expect(parseRawText("false", "boolean")).toBe(false);
  });
  it("json — unparseable returns undefined (the editor skips the write)", () => {
    expect(parseRawText('{"a":1}', "json")).toEqual({ a: 1 });
    expect(parseRawText("{oops", "json")).toBe(undefined);
    expect(rawText({ a: 1 }, "json")).toBe('{"a":1}');
  });
  it("text", () => {
    expect(parseRawText("hi", "text")).toBe("hi");
    expect(rawText(null, "text")).toBe("");
  });
});
