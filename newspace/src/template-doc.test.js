import { describe, it, expect } from "vitest";
import { parseTemplate, fillTemplate, templateInlets, parseSlotType } from "./template-doc.js";

describe("parseSlotType", () => {
  it("maps the placeholder body to a port type + schema", () => {
    expect(parseSlotType("")).toMatchObject({ type: "json" });
    expect(parseSlotType("string")).toMatchObject({ type: "text" });
    expect(parseSlotType("number")).toMatchObject({ type: "number" });
    expect(parseSlotType("object")).toMatchObject({ type: "json" });
    expect(parseSlotType("boolean")).toMatchObject({ type: "json" });
  });
  it("reads an enum from quoted, pipe-separated options", () => {
    const t = parseSlotType('"a"|"b"|"c"');
    expect(t.type).toBe("text");
    expect(t.options).toEqual(["a", "b", "c"]);
  });
});

describe("parseTemplate", () => {
  it("punches a wireable inlet for each <…>, named by its path", () => {
    const { template, slots, error } = parseTemplate('{ "title": <string>, "size": <number> }');
    expect(error).toBe(null);
    expect(slots.map((s) => s.name).sort()).toEqual(["size", "title"]);
    expect(slots.find((s) => s.name === "title").type).toBe("text");
    expect(slots.find((s) => s.name === "size").type).toBe("number");
    // the parsed template still has sentinel placeholders at those paths
    expect(typeof template.title).toBe("string");
  });
  it("names nested + array holes by their full path", () => {
    const { slots } = parseTemplate('{ "a": { "b": <number> }, "list": [<string>, <string>] }');
    expect(slots.map((s) => s.name).sort()).toEqual(["a.b", "list.0", "list.1"]);
  });
  it("a whole-doc hole has path [] and name 'value'", () => {
    const { slots } = parseTemplate("<object>");
    expect(slots).toHaveLength(1);
    expect(slots[0].path).toEqual([]);
    expect(slots[0].name).toBe("value");
  });
  it("reports a JSON error for a malformed template", () => {
    expect(parseTemplate("{ not json").error).toBeTruthy();
  });
});

describe("fillTemplate", () => {
  it("fills each hole from getValue(slot), leaving static parts intact", () => {
    const { template, slots } = parseTemplate('{ "title": <string>, "n": <number>, "keep": "x" }');
    const vals = { title: "hi", n: 42 };
    const out = fillTemplate(template, slots, (s) => vals[s.name]);
    expect(out).toEqual({ title: "hi", n: 42, keep: "x" });
  });
  it("a whole-doc hole returns its value directly", () => {
    const { template, slots } = parseTemplate("<object>");
    expect(fillTemplate(template, slots, () => ({ a: 1 }))).toEqual({ a: 1 });
  });
  it("nested + array holes land at the right paths", () => {
    const { template, slots } = parseTemplate('{ "a": { "b": <number> }, "list": [<string>] }');
    const vals = { "a.b": 9, "list.0": "z" };
    expect(fillTemplate(template, slots, (s) => vals[s.name])).toEqual({ a: { b: 9 }, list: ["z"] });
  });
  it("unwired holes fill as undefined (dropped from JSON)", () => {
    const { template, slots } = parseTemplate('{ "title": <string>, "keep": 1 }');
    const out = fillTemplate(template, slots, () => undefined);
    expect(out.keep).toBe(1);
    expect("title" in out).toBe(true); // present, value undefined
  });
});

describe("templateInlets (the dynamicInlets hook)", () => {
  it("turns template text into inlet defs", () => {
    const inlets = templateInlets({ template: '{ "x": <number>, "y": <string> }' });
    expect(inlets.map((i) => i.name).sort()).toEqual(["x", "y"]);
    expect(inlets.find((i) => i.name === "x").type).toBe("number");
  });
  it("falls back to the default template when none given", () => {
    expect(templateInlets({}).length).toBeGreaterThan(0);
  });
});
