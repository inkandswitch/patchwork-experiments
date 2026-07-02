// PART A of the schema UX: show the shape + prefill from it.
//   formatShape           — describeSchema() strings rendered readably (multi-line)
//   templateSourceFromValue — example value → template-doc SOURCE (round-trips)
//   seedConfigFor         — inlet schema → the config a fresh node is seeded with
import { describe, it, expect } from "vitest";
import { formatShape, templateSourceFromValue, seedConfigFor } from "./wire.js";
import { parseTemplateTS } from "./template-ts.js";
import {
  describeSchema, schemaExample, objectSchema, arraySchema,
  stringSchema, numberSchema, boolSchema, anySchema, enumSchema,
} from "./ops.js";

describe("formatShape — the popover's shape rendering", () => {
  it("leaves a short shape on one line", () => {
    expect(formatShape("string")).toEqual(["string"]);
    expect(formatShape("{ name: string }")).toEqual(["{ name: string }"]);
  });

  it("breaks a long struct into one field per line", () => {
    const desc = describeSchema(objectSchema({
      name: stringSchema(), count: numberSchema(), enabled: boolSchema(), title: stringSchema(),
    }, ["count"]));
    const lines = formatShape(desc);
    expect(lines[0]).toBe("{");
    expect(lines).toContain("  name: string");
    expect(lines).toContain("  count?: number");
    expect(lines[lines.length - 1]).toBe("}");
  });

  it("indents nested structs and keeps them brace-balanced", () => {
    const desc = describeSchema(objectSchema({
      docs: arraySchema(objectSchema({ url: stringSchema(), title: stringSchema(), type: stringSchema() })),
      owner: stringSchema(),
    }));
    const lines = formatShape(desc, 30);
    // nested struct opens/closes at the deeper indent; the array suffix rides the close
    expect(lines.some((l) => /^ {2}docs: /.test(l) || l === "  docs: {")).toBe(true);
    expect(lines.join("\n")).toContain("[]");
    const text = lines.join("");
    expect((text.match(/\{/g) || []).length).toBe((text.match(/\}/g) || []).length);
  });

  it("degrades to the plain description for non-struct shapes", () => {
    expect(formatShape("image (ImageData / ImageBitmap / {data,width,height} / url)", 20))
      .toEqual(["image (ImageData / ImageBitmap / {data,width,height} / url)"]);
  });
});

describe("templateSourceFromValue — schema example → editable template source", () => {
  it("prints an object literal that parseTemplateTS builds back verbatim", () => {
    const v = { name: "", count: 0, ok: false, tags: ["a"], meta: { depth: 2 } };
    const src = templateSourceFromValue(v);
    const { holes, build, error } = parseTemplateTS(src);
    expect(error).toBeNull();
    expect(holes).toEqual([]); // literals, not type-holes — the doc is complete NOW
    expect(build(() => undefined)).toEqual(v);
  });

  it("quotes non-identifier keys and strings", () => {
    const src = templateSourceFromValue({ "@patchwork": { type: "folder" }, "a b": "x" });
    const { build, error } = parseTemplateTS(src);
    expect(error).toBeNull();
    expect(build(() => undefined)).toEqual({ "@patchwork": { type: "folder" }, "a b": "x" });
  });
});

describe("seedConfigFor — prefill a fresh node from the inlet's schema", () => {
  const inlet = (schema) => ({ name: "in", type: "json", schema });

  it("seeds the TEMPLATE DOC with generated source whose doc validates the schema", () => {
    const schema = objectSchema({ name: stringSchema(), count: numberSchema() }, ["count"]);
    const seed = seedConfigFor({ id: "template" }, inlet(schema));
    expect(seed).toBeTruthy();
    expect(typeof seed.template).toBe("string");
    const { build, error } = parseTemplateTS(seed.template);
    expect(error).toBeNull();
    const doc = build(() => undefined);
    expect(doc).toEqual(schemaExample(schema)); // fields present, typed defaults
    expect(schema["~standard"].validate(doc).issues).toBeUndefined(); // …and validating
  });

  it("seeds the RAW VALUE node with the example + its kind", () => {
    expect(seedConfigFor({ id: "value" }, inlet(numberSchema()))).toEqual({ raw: "0", kind: "number" });
    expect(seedConfigFor({ id: "value" }, inlet(stringSchema()))).toEqual({ raw: "", kind: "text" });
    expect(seedConfigFor({ id: "value" }, inlet(boolSchema()))).toEqual({ raw: "false", kind: "boolean" });
    expect(seedConfigFor({ id: "value" }, inlet(enumSchema(["a", "b"])))).toEqual({ raw: "a", kind: "text" });
    const obj = seedConfigFor({ id: "value" }, inlet(objectSchema({ x: numberSchema() })));
    expect(obj.kind).toBe("json");
    expect(JSON.parse(obj.raw)).toEqual({ x: 0 });
  });

  it("no derivable example → null (behave exactly as today)", () => {
    expect(seedConfigFor({ id: "template" }, inlet(anySchema()))).toBeNull();
    expect(seedConfigFor({ id: "value" }, inlet(anySchema()))).toBeNull();
    expect(seedConfigFor({ id: "template" }, inlet(undefined))).toBeNull();
    expect(seedConfigFor({ id: "template" }, null)).toBeNull();
  });

  it("a non-object example doesn't seed the template (it materialises an object)", () => {
    expect(seedConfigFor({ id: "template" }, inlet(numberSchema()))).toBeNull();
    expect(seedConfigFor({ id: "template" }, inlet(arraySchema(numberSchema())))).toBeNull();
  });

  it("other nodes are never seeded", () => {
    expect(seedConfigFor({ id: "codemirror" }, inlet(stringSchema()))).toBeNull();
    expect(seedConfigFor(null, inlet(stringSchema()))).toBeNull();
  });
});
