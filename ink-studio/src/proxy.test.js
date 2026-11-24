import { describe, it, expect } from "vitest";
import { proxyMesh } from "./proxy.js";
import source from "./source.js";
import { parseGLB } from "./glb.js";
import { InkSceneDatatype } from "./datatype.js";

/** A world of splats at the given centres, all opaque, all one colour. */
function worldOf(points, rgb = [255, 0, 0]) {
  const data = new Float32Array(points.length * 16);
  points.forEach(([x, y, z], i) => {
    data.set([x, y, z, 1], i * 16);
    data[i * 16 + 7] = rgb[0] + 256 * rgb[1] + 65536 * rgb[2];
  });
  return { data, count: points.length };
}

describe("proxyMesh", () => {
  it("draws a lone cell as a closed cube: 6 faces, 12 triangles", () => {
    const m = proxyMesh(worldOf([[0, 0, 0]]), { cells: 1, cut: 0 });
    expect(m.cells).toBe(1);
    expect(m.indices.length).toBe(36);
    expect(m.colors[0]).toBeCloseTo(1); // linear red
    expect(m.colors[1]).toBeCloseTo(0);
  });
  it("leaves out the face two filled cells share", () => {
    // two cells side by side along x: 2·6 − 2 shared = 10 faces
    const m = proxyMesh(worldOf([[0, 0, 0], [1, 0, 0]]), { cells: 1, cut: 0 }); // unit cells: x = 0 and x = 1 are neighbours
    expect(m.cells).toBe(2);
    expect(m.indices.length / 6).toBe(10);
  });
  it("skips faint splats and gives nothing for an empty world", () => {
    const w = worldOf([[0, 0, 0]]);
    w.data[3] = 0.001;
    const m = proxyMesh(w);
    expect(m.bounds).toBeNull();
    expect(m.indices.length).toBe(0);
  });
});

describe("the scene source", () => {
  it("builds the starting scene into a GLB with bounds", async () => {
    const doc = {};
    InkSceneDatatype.init(doc);
    const out = await source.build({ doc, params: {} });
    expect(out.kind).toBe("glb");
    const { json } = parseGLB(out.glb);
    expect(json.meshes).toHaveLength(1);
    expect(json.scenes[0].extras.ink.splats).toBeGreaterThan(1000);
    expect(out.meta.bounds.max[1]).toBeGreaterThan(out.meta.bounds.min[1]);
  });
  it("fingerprints exactly what build reads", () => {
    const a = { kind: "js", main: "s.js", files: { "s.js": "x" }, title: "A" };
    expect(source.fingerprint(a)).toBe(source.fingerprint({ ...a, title: "B" }));
    expect(source.fingerprint(a)).not.toBe(source.fingerprint({ ...a, files: { "s.js": "y" } }));
  });
});
