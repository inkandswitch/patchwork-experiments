import { describe, it, expect } from "vitest";
import { glbTriangles, sliceTriangles, meshSection } from "./mesh-section.js";
import { signedArea } from "./body.js";
import { encodeGLB } from "./glb.js";
import { prismGLB, transomWaterline, circleLoop } from "./test/hull-fixtures.js";

const area = (loop) => signedArea(loop.points);

describe("glbTriangles", () => {
  it("reads triangles into the floating frame (x = X, y = −Z, z = Y), skipping lines, applying node transforms", () => {
    const glb = encodeGLB({
      meshes: [
        { name: "tri", positions: [0, 0, 0, 1, 0, 0, 0, 2, -3] },
        { name: "edge", positions: [0, 0, 0, 5, 5, 5], mode: 1 },
      ],
      nodes: [{ name: "a", mesh: 0, translation: [10, 20, 30] }, { name: "b", mesh: 1 }],
    });
    const { triangles, meshes } = glbTriangles(glb);
    expect(meshes).toEqual(["tri"]);
    expect(Array.from(triangles)).toEqual([10, -30, 20, 11, -30, 20, 10, -27, 22]);
  });
});

describe("sliceTriangles", () => {
  it("cuts a prism into one closed counter-clockwise loop that is the outline", () => {
    const loop = transomWaterline();
    const s = meshSection(prismGLB(loop), 0);
    expect(s.frame).toBe("floating");
    expect(s.plane).toEqual({ kind: "waterline", z: 0 });
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0].closed).toBe(true);
    expect(area(s.loops[0])).toBeCloseTo(signedArea(loop), 6);
    // each side quad's diagonal adds a (collinear) cut point
    expect(s.loops[0].points).toHaveLength(2 * loop.length);
    expect(s.meta.lengthWL).toBeCloseTo(10, 5);
    expect(s.meta.beamWL).toBeCloseTo(2 * Math.max(...loop.map((q) => q[1])), 5);
    expect(s.meta.notes).toMatch(/mesh slice/);
  });

  it("is robust to vertices exactly on the plane, seams of duplicated vertices, and node transforms", () => {
    const loop = circleLoop(48, 1.5);
    const onPlane = meshSection(prismGLB(loop, { levels: [-1, 0, 0.5] }), 0);
    expect(onPlane.loops).toHaveLength(1);
    expect(area(onPlane.loops[0])).toBeCloseTo(signedArea(loop), 5); // float32 positions
    const seams = meshSection(prismGLB(loop, { indexed: false }), -0.25);
    expect(seams.loops).toHaveLength(1);
    expect(seams.loops[0].points).toHaveLength(96);
    // the mesh sits under a node lifted 0.5 m (glTF Y): cut at z = 0 is its old z = −0.5
    const moved = meshSection(prismGLB(loop, { translation: [2, 0.5, 0], levels: [-2, 0] }), 0);
    expect(moved.loops).toHaveLength(1);
    const xs = moved.loops[0].points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(3.5, 5);
  });

  it("closes an open shell straight across (a hull with no transom face), and misses cleanly", () => {
    const loop = transomWaterline();
    const last = loop.length - 1; // the edge from the port transom corner back to the starboard one
    const s = meshSection(prismGLB(loop, { caps: false, skipEdges: [last] }), 0);
    expect(s.loops).toHaveLength(1);
    expect(s.meta.notes).toMatch(/closed straight across/);
    expect(area(s.loops[0])).toBeCloseTo(signedArea(loop), 6);
    expect(meshSection(prismGLB(loop), 3).loops).toEqual([]);
  });

  it("finds two loops for two hulls, and is deterministic", () => {
    const a = circleLoop(24, 1).map(([x, y]) => [x, y + 3]);
    const b = circleLoop(24, 1).map(([x, y]) => [x, y - 3]);
    const tris = Float64Array.from([...glbTriangles(prismGLB(a)).triangles, ...glbTriangles(prismGLB(b)).triangles]);
    const r1 = sliceTriangles(tris, 0);
    const r2 = sliceTriangles(tris, 0);
    expect(r1.loops).toHaveLength(2);
    for (const l of r1.loops) expect(area(l)).toBeGreaterThan(0);
    expect(r1).toEqual(r2);
  });
});
