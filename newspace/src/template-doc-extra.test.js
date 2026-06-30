import { describe, it, expect } from "vitest";
import { parseTemplate, fillTemplate, templateInlets, parseSlotType } from "./template-doc.js";

describe("parseSlotType — full grammar", () => {
  it("<> (empty) and the json-family words all map to type json with a schema", () => {
    for (const raw of ["", "any", "json", "object", "array"]) {
      const t = parseSlotType(raw);
      expect(t.type).toBe("json");
      expect(t.schema).toBeTruthy();
      expect(t.options).toBeUndefined();
    }
  });
  it("trims surrounding whitespace before classifying", () => {
    expect(parseSlotType("  string  ").type).toBe("text");
    expect(parseSlotType("\tnumber\n").type).toBe("number");
    expect(parseSlotType("   ").type).toBe("json"); // trims to "" → json
  });
  it("<string> → text with a schema", () => {
    const t = parseSlotType("string");
    expect(t).toMatchObject({ type: "text" });
    expect(t.schema).toBeTruthy();
  });
  it("<number> → number with a schema", () => {
    const t = parseSlotType("number");
    expect(t).toMatchObject({ type: "number" });
    expect(t.schema).toBeTruthy();
  });
  it("<boolean> and its <bool> alias both map to json (no native boolean port)", () => {
    expect(parseSlotType("boolean").type).toBe("json");
    expect(parseSlotType("bool").type).toBe("json");
  });
  it("a double-quoted enum becomes text + stripped options", () => {
    const t = parseSlotType('"a"|"b"');
    expect(t.type).toBe("text");
    expect(t.options).toEqual(["a", "b"]);
  });
  it("a single-quoted enum is recognised too (quote char at s[0])", () => {
    const t = parseSlotType("'x'|'y'|'z'");
    expect(t.type).toBe("text");
    expect(t.options).toEqual(["x", "y", "z"]);
  });
  it("a single-option enum yields one stripped option", () => {
    const t = parseSlotType('"only"');
    expect(t.type).toBe("text");
    expect(t.options).toEqual(["only"]);
  });
  it("enum splitting trims whitespace around each pipe-separated option", () => {
    const t = parseSlotType('"a" | "b" | "c"');
    expect(t.options).toEqual(["a", "b", "c"]);
  });
  it("an unrecognised schema hint <{...}> falls through to json", () => {
    const t = parseSlotType("{ name: string }");
    expect(t.type).toBe("json");
    expect(t.schema).toBeTruthy();
    expect(t.options).toBeUndefined();
  });
  it("any other bare word falls through to json", () => {
    expect(parseSlotType("widget").type).toBe("json");
  });
  it("tolerates a nullish raw (treated as empty → json)", () => {
    expect(parseSlotType(undefined).type).toBe("json");
    expect(parseSlotType(null).type).toBe("json");
  });
});

describe("parseTemplate — slot wiring across the grammar", () => {
  it("classifies json-family, boolean, and <{...}> holes by their parsed type", () => {
    const { template, slots, error } = parseTemplate(
      '{ "j": <json>, "arr": <array>, "any": <>, "b": <boolean>, "schema": <{x:number}> }'
    );
    expect(error).toBe(null);
    const byName = Object.fromEntries(slots.map((s) => [s.name, s]));
    expect(byName.j.type).toBe("json");
    expect(byName.arr.type).toBe("json");
    expect(byName.any.type).toBe("json");
    expect(byName.b.type).toBe("json");
    expect(byName.schema.type).toBe("json");
    // sentinels remain in the parsed tree at every hole
    for (const s of slots) expect(typeof template[s.path[0]]).toBe("string");
  });
  it("carries enum options through onto the slot", () => {
    const { slots } = parseTemplate('{ "kind": <"a"|"b"> }');
    expect(slots[0].options).toEqual(["a", "b"]);
    expect(slots[0].type).toBe("text");
  });
  it("keeps the raw body and a stable id on each slot", () => {
    const { slots } = parseTemplate('{ "title": <string> }');
    expect(slots[0].raw).toBe("string");
    expect(slots[0].id).toBe("s0");
  });
  it("reports the JSON parser's own message on bad JSON", () => {
    const r = parseTemplate("{ not json");
    expect(r.template).toBe(null);
    expect(r.slots).toEqual([]);
    expect(typeof r.error).toBe("string");
    expect(r.error.length).toBeGreaterThan(0);
  });
  it("a hole used as an OBJECT KEY is dropped (no path landed)", () => {
    // <string> as a key serialises to a string key, never visited as a value,
    // so it has no path and is filtered out.
    const { slots, error } = parseTemplate('{ <string>: 1 }');
    expect(error).toBe(null);
    expect(slots).toEqual([]);
  });
});

describe("fillTemplate — root (whole-doc) hole", () => {
  it("returns getValue(rootSlot) verbatim for <> at the root", () => {
    const { template, slots } = parseTemplate("<>");
    const value = { whatever: [1, 2, 3] };
    const out = fillTemplate(template, slots, (s) => {
      expect(s.path).toEqual([]);
      expect(s.name).toBe("value");
      return value;
    });
    expect(out).toBe(value); // same reference — not cloned
  });
  it("the root hole ignores the template clone entirely (returns a primitive)", () => {
    const { template, slots } = parseTemplate("<number>");
    expect(fillTemplate(template, slots, () => 7)).toBe(7);
  });
  it("a root <string> hole still returns its value directly", () => {
    const { template, slots } = parseTemplate("<string>");
    expect(fillTemplate(template, slots, () => "hello")).toBe("hello");
  });
});

describe("templateInlets — naming by path", () => {
  it("names a nested hole a.b", () => {
    const inlets = templateInlets({ template: '{ "a": { "b": <number> } }' });
    expect(inlets.map((i) => i.name)).toEqual(["a.b"]);
    expect(inlets[0].type).toBe("number");
    expect(inlets[0].schema).toBeTruthy();
  });
  it("names array holes by index, e.g. items.0", () => {
    const inlets = templateInlets({ template: '{ "items": [<string>] }' });
    expect(inlets.map((i) => i.name)).toEqual(["items.0"]);
    expect(inlets[0].type).toBe("text");
  });
  it("names a top-level array element 0 (path joined from root)", () => {
    const inlets = templateInlets({ template: "[<number>, <string>]" });
    expect(inlets.map((i) => i.name).sort()).toEqual(["0", "1"]);
  });
  it("a deeply nested + array path joins with dots", () => {
    const inlets = templateInlets({ template: "{ a: { b: [ { c: boolean } ] } }" });
    expect(inlets.map((i) => i.name)).toEqual(["a.b.0.c"]);
    expect(inlets[0].type).toBe("json"); // boolean → json port
  });
  it("a whole-doc hole is named 'value' (root path)", () => {
    const inlets = templateInlets({ template: "any" });
    expect(inlets.map((i) => i.name)).toEqual(["value"]);
  });
  it("a config with no template falls back to the default and yields named inlets", () => {
    const inlets = templateInlets();
    expect(inlets.length).toBeGreaterThan(0);
    expect(inlets.every((i) => typeof i.name === "string" && i.name.length > 0)).toBe(true);
  });
  it("an `any` hole defaults its wire type to json", () => {
    const inlets = templateInlets({ template: "{ x: any }" });
    expect(inlets[0].type).toBe("json");
  });
});
