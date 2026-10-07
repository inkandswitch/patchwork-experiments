// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { isBinarySTL, parseSTL, toYUpMeters } from "./stl.js";
import { stlToGLB } from "./sources/file-stl.js";
import fileStl from "./sources/file-stl.js";
import fileGlb from "./sources/file-glb.js";
import { encodeGLB } from "./glb.js";

const ascii = `solid cube-ish
  facet normal 0 0 0
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 20 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 30
      vertex 1.5e1 0 30
      vertex 0 -2E1 30
    endloop
  endfacet
endsolid cube-ish
`;

function binarySTL(tris, header = "solid binary but actually binary") {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode(header).subarray(0, 80));
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v, true));
  });
  return new Uint8Array(buf);
}

describe("parseSTL", () => {
  it("parses ASCII (string and bytes)", () => {
    const s = parseSTL(ascii);
    expect(s.format).toBe("ascii");
    expect(s.triangles).toBe(2);
    expect(s.name).toBe("cube-ish");
    expect(s.positions[12]).toBe(15);
    expect(parseSTL(new TextEncoder().encode(ascii)).triangles).toBe(2);
  });
  it("parses binary even when the header says solid", () => {
    const bytes = binarySTL([[0, 0, 0, 1, 0, 0, 0, 1, 0]]);
    expect(isBinarySTL(bytes)).toBe(true);
    const s = parseSTL(bytes);
    expect(s.format).toBe("binary");
    expect(Array.from(s.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  it("accepts an ImmutableString-like object", () => {
    expect(parseSTL({ toString: () => ascii }).triangles).toBe(2);
  });
  it("rejects truncated ASCII", () => {
    expect(() => parseSTL("solid x\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\n")).toThrow(/whole number/);
  });
});

describe("toYUpMeters", () => {
  it("scales and turns Z-up into Y-up keeping handedness", () => {
    const out = toYUpMeters(new Float32Array([10, 20, 30]), { unit: "mm", up: "z" });
    expect(Array.from(out).map((v) => +v.toFixed(6))).toEqual([0.01, 0.03, -0.02]);
    const y = toYUpMeters(new Float32Array([1, 2, 3]), { unit: "in", up: "y" });
    expect(y[1]).toBeCloseTo(0.0508);
  });
  it("keeps triangle winding (normal of a Z-up floor face points +Y)", async () => {
    const r = stlToGLB(binarySTL([[0, 0, 0, 1, 0, 0, 0, 1, 0]]), { unit: "m", up: "z" }, "floor");
    const buf = r.glb.buffer.slice(r.glb.byteOffset, r.glb.byteOffset + r.glb.byteLength);
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, "", res, rej));
    const mesh = gltf.scene.getObjectByName("floor");
    expect(mesh.geometry.getAttribute("normal").getY(0)).toBeCloseTo(1);
    expect(r.meta.bounds.max[2]).toBeCloseTo(0);
    expect(r.meta.bounds.min[2]).toBeCloseTo(-1);
  });
});

describe("file providers", () => {
  it("file-stl builds from a file doc", async () => {
    const res = await fileStl.build({ doc: { name: "part.stl", extension: "stl", content: ascii }, params: { unit: "mm", up: "z" } });
    expect(res.kind).toBe("glb");
    expect(res.meta.notes).toMatch(/2 triangles/);
  });
  it("file-glb passes bytes through and rejects non-GLB", async () => {
    const glb = encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
    const res = await fileGlb.build({ doc: { content: glb } });
    expect(res.glb).toBe(glb);
    await expect(fileGlb.build({ doc: { content: new Uint8Array(40) } })).rejects.toThrow(/magic/);
  });
});
