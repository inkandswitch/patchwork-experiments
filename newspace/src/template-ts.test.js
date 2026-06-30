import { describe, it, expect } from "vitest";
import { parseTemplateTS } from "./template-ts.js";

const names = (r) => r.holes.map((h) => h.name);
const ok = (schema, v) => !schema["~standard"].validate(v).issues;

describe("parseTemplateTS — TypeScript-ish template", () => {
  it("parses the folder example: literals stay, types become inlets", () => {
    const r = parseTemplateTS(`{
      "@patchwork": { type: "folder" }
      docs: { url: string, title: string, type?: string }[]
      conf: { a: string }
    }`);
    expect(r.error).toBe(null);
    expect(names(r).sort()).toEqual(["conf.a", "docs"]);

    // build with wired values
    const doc = r.build((name) => ({ "docs": [{ url: "u", title: "t" }], "conf.a": "hi" }[name]));
    expect(doc).toEqual({
      "@patchwork": { type: "folder" },
      docs: [{ url: "u", title: "t" }],
      conf: { a: "hi" },
    });
  });

  it("the docs inlet schema is array-of-object (url+title required, type optional)", () => {
    const r = parseTemplateTS(`{ docs: { url: string, title: string, type?: string }[] }`);
    const s = r.holes.find((h) => h.name === "docs").schema;
    expect(ok(s, [{ url: "u", title: "t" }])).toBe(true);
    expect(ok(s, [{ url: "u", title: "t", type: "file" }])).toBe(true);
    expect(ok(s, [{ url: "u" }])).toBe(false);         // missing required title
    expect(ok(s, [{ url: 1, title: "t" }])).toBe(false); // url must be string
    expect(ok(s, "not an array")).toBe(false);
  });

  it("primitive holes get primitive schemas + coarse wire types", () => {
    const r = parseTemplateTS(`{ title: string, count: number, on: boolean }`);
    expect(names(r)).toEqual(["title", "count", "on"]);
    const byName = Object.fromEntries(r.holes.map((h) => [h.name, h]));
    expect(byName.title.type).toBe("text");
    expect(byName.count.type).toBe("number");
    expect(ok(byName.count.schema, 5)).toBe(true);
    expect(ok(byName.count.schema, "x")).toBe(false);
  });

  it("nested-object holes are named by dot path; literals coexist", () => {
    const r = parseTemplateTS(`{ name: "fixed", conf: { a: string, b: number } }`);
    expect(names(r).sort()).toEqual(["conf.a", "conf.b"]);
    const doc = r.build((n) => ({ "conf.a": "x", "conf.b": 3 }[n]));
    expect(doc).toEqual({ name: "fixed", conf: { a: "x", b: 3 } });
  });

  it("string[] is an array-of-string inlet", () => {
    const r = parseTemplateTS(`{ tags: string[] }`);
    const s = r.holes[0].schema;
    expect(ok(s, ["a", "b"])).toBe(true);
    expect(ok(s, [1, 2])).toBe(false);
  });

  it("reports a parse error instead of throwing", () => {
    const r = parseTemplateTS(`{ a: `);
    expect(r.error).toBeTruthy();
    expect(r.holes).toEqual([]);
  });
});
