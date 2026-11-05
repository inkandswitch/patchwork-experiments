import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";
import { ImplicitSurfaceDatatype } from "./datatype.js";
import { compile } from "./lang/index.js";
import { DEFAULT_RESOLUTION, MAX_RESOLUTION, MIN_RESOLUTION } from "./mesh/job.js";

describe("plugins", () => {
  it("are structured-clone safe apart from load()", () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(() => structuredClone(meta)).not.toThrow();
    }
  });
  it("register the datatype, the tool and the scene provider", () => {
    expect(plugins.map((p) => `${p.type}:${p.id}`)).toEqual([
      "patchwork:datatype:implicit-surface",
      "patchwork:tool:implicit-surface",
      "scene:source:implicit-mesh",
    ]);
    const src = plugins.find((p) => p.type === "scene:source");
    expect(src.supportedDatatypes).toEqual(["implicit-surface"]);
    expect(src.extensions).toBeUndefined();
    expect(src.params).toEqual([
      expect.objectContaining({ key: "resolution", kind: "integer", default: 96, cost: "expensive" }),
      expect.objectContaining({ key: "smoothNormals", kind: "boolean", default: true, cost: "cheap" }),
      expect.objectContaining({ key: "finish", kind: "enum", default: "matte", cost: "cheap" }),
    ]);
    expect(src.cost).toBe("expensive");
    expect(Number.isInteger(src.version)).toBe(true);
    expect(src.version).toBeGreaterThanOrEqual(2);
  });
  it("agree with the mesher on the resolution range", () => {
    const spec = plugins.find((p) => p.type === "scene:source").params.find((p) => p.key === "resolution");
    expect([spec.min, spec.max, spec.default]).toEqual([MIN_RESOLUTION, MAX_RESOLUTION, DEFAULT_RESOLUTION]);
    expect([spec.min, spec.max]).toEqual([16, 160]);
  });
  it("load what they promise", async () => {
    const [dt, tool, src] = await Promise.all(plugins.map((p) => p.load()));
    expect(dt).toBe(ImplicitSurfaceDatatype);
    expect(typeof tool).toBe("function");
    expect(typeof src.build).toBe("function");
    expect(typeof src.fingerprint).toBe("function");
  });
});

describe("datatype", () => {
  it("seeds a doc that compiles, with bounds and notes", () => {
    const doc = {};
    ImplicitSurfaceDatatype.init(doc);
    expect(doc.title).toBe("Implicit surface");
    expect(() => compile(doc.source)).not.toThrow();
    expect(doc.bounds.min).toHaveLength(3);
    expect(doc.notes).toBe("");
    // the host stamps @patchwork after init; init must not depend on it
    expect(doc["@patchwork"]).toBeUndefined();
    ImplicitSurfaceDatatype.setTitle(doc, "Bracket");
    expect(ImplicitSurfaceDatatype.getTitle(doc)).toBe("Bracket");
    ImplicitSurfaceDatatype.markCopy(doc);
    expect(doc.title).toBe("Copy of Bracket");
  });
});
