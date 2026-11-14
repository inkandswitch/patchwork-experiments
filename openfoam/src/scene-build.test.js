import { describe, it, expect } from "vitest";
import { mirrorTriangles, linesGeometry, waterOnly, buildResultsGLB, fadeAlpha } from "./scene-build.js";
import { parseGLB } from "./glb.js";
import { decodeLayer, encodeLayer } from "./protocol.js";
import { SCENE_PARAMS } from "./scene-params.js";

const params = Object.fromEntries(SCENE_PARAMS.map((p) => [p.key, p.default]));
const tri = decodeLayer(encodeLayer({ name: "hull", kind: "triangles", positions: [0, -1, 0, 1, -1, 0, 0, -1, 1], indices: [0, 1, 2], fields: { Cp: [-1, 0, 1], Cf: [0.001, 0.002, 0.003] }, half: true }));

describe("mirroring a half model", () => {
  it("doubles the points, reflects y and reverses the winding", () => {
    const m = mirrorTriangles(tri, true);
    expect(m.positions.length).toBe(18);
    expect(Array.from(m.positions.subarray(9, 12))).toEqual([0, 1, 0]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 3, 5, 4]);
    expect(Array.from(m.fields.Cp)).toEqual([-1, 0, 1, -1, 0, 1]);
  });
  it("leaves a full model alone", () => expect(mirrorTriangles(tri, false).positions).toBe(tri.positions));
  it("joins line points pairwise, per line, mirrored", () => {
    const L = decodeLayer(encodeLayer({ name: "s", kind: "lines", positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 0, 0, 6, 0, 0], counts: [3, 2], fields: { speed: [1, 1, 1, 1, 1] } }));
    expect(Array.from(linesGeometry(L, false).indices)).toEqual([0, 1, 1, 2, 3, 4]);
    expect(Array.from(linesGeometry(L, true).indices)).toEqual([0, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9]);
  });
});

describe("planes in a free-surface run", () => {
  it("drop triangles that are all air", () => {
    const g = { positions: new Float32Array(18), indices: Uint32Array.from([0, 1, 2, 3, 4, 5]), fields: { alpha: Float32Array.from([0, 0, 0, 0, 1, 0]) } };
    expect(Array.from(waterOnly(g).indices)).toEqual([3, 4, 5]);
  });
});

describe("fading", () => {
  it("leaves the undisturbed flow faint and the extremes opaque", () => {
    const a = fadeAlpha("Cp", [0, 1, -1], [-1, 1], 0.8);
    expect(a[0]).toBeCloseTo(0.2, 6); // Float32
    expect(a[1]).toBe(1);
    expect(a[2]).toBe(1);
    expect(fadeAlpha("speed", [1], [0.5, 1.5], 1)[0]).toBe(0);
  });
});

describe("the GLB", () => {
  it("draws the hull mirrored, in glTF's frame, with a legend", () => {
    const { glb, meta } = buildResultsGLB({ layers: { hull: tri }, params, mode: "double-body" });
    const { json } = parseGLB(glb);
    expect(json.meshes.map((m) => m.name)).toEqual(["Hull"]);
    expect(json.meshes[0].extras.legend.title).toMatch(/Pressure/);
    // y = −1 (starboard) maps to Z = +1; the mirror to Z = −1
    expect(meta.bounds.min[2]).toBe(-1);
    expect(meta.bounds.max[2]).toBe(1);
    // z up → Y up
    expect(meta.bounds.max[1]).toBe(1);
  });
  it("draws the frozen hull plain when there are no results yet", () => {
    const { glb } = buildResultsGLB({ layers: {}, params, mode: "double-body", hullTriangles: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]) });
    expect(parseGLB(glb).json.meshes[0].name).toMatch(/no results yet/);
  });
  it("returns the scene contract's BuildResult, kind and all", async () => {
    const source = (await import("./scene-source.js")).default;
    const repo = { find: async () => ({ doc: () => null }) };
    const r = await source.build({ doc: { "@patchwork": { type: "openfoam-case" }, runs: [] }, url: "automerge:x", params, repo });
    expect(r.kind).toBe("glb");
    expect(r.glb).toBeInstanceOf(Uint8Array);
    expect(buildResultsGLB({ layers: {}, params, mode: "double-body" }).kind).toBe("glb");
  });
  it("is a valid empty GLB with nothing at all", () => {
    expect(parseGLB(buildResultsGLB({ layers: {}, params, mode: "double-body" }).glb).json.asset.version).toBe("2.0");
  });
});
