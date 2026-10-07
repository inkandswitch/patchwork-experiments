import { describe, it, expect } from "vitest";
import { describeSource, extensionOf, matchProviders, normalizeExtension, providerMatches } from "./providers.js";

const stl = { id: "file-stl", supportedDatatypes: ["file"], extensions: ["stl"] };
const glb = { id: "file-glb", supportedDatatypes: ["file"], extensions: ["glb"] };
const anyFile = { id: "any-file", supportedDatatypes: ["file"] };
const hull = { id: "camber-hull-surface", supportedDatatypes: ["camber-hull"] };
const wild = { id: "bbox", supportedDatatypes: "*" };

describe("describeSource", () => {
  it("reads datatype and extension", () => {
    expect(describeSource({ "@patchwork": { type: "file" }, extension: ".STL", name: "x.stl" })).toEqual({ datatype: "file", extension: "stl" });
    expect(describeSource({ "@patchwork": { type: "file" }, extension: "", name: "boat.GLB" })).toEqual({ datatype: "file", extension: "glb" });
    expect(describeSource({ "@patchwork": { type: "camber-hull" } })).toEqual({ datatype: "camber-hull", extension: null });
    expect(describeSource({})).toEqual({ datatype: null, extension: null });
  });
  it("normalises extensions", () => {
    expect(normalizeExtension("..Stl ")).toBe("stl");
    expect(extensionOf("a.b.c")).toBe("c");
    expect(extensionOf("noext")).toBe("");
  });
});

describe("matchProviders", () => {
  const all = [wild, anyFile, glb, stl, hull];
  it("filters by datatype and extension", () => {
    expect(providerMatches(stl, { datatype: "file", extension: "stl" })).toBe(true);
    expect(providerMatches(stl, { datatype: "file", extension: "glb" })).toBe(false);
    expect(providerMatches(stl, { datatype: "file", extension: null })).toBe(false);
    expect(providerMatches(hull, { datatype: "file", extension: "stl" })).toBe(false);
  });
  it("sorts specific before generic", () => {
    expect(matchProviders(all, { datatype: "file", extension: "stl" }).map((p) => p.id)).toEqual(["file-stl", "any-file", "bbox"]);
    expect(matchProviders(all, { datatype: "camber-hull", extension: null }).map((p) => p.id)).toEqual(["camber-hull-surface", "bbox"]);
    expect(matchProviders([hull], { datatype: "todo", extension: null })).toEqual([]);
  });
});
