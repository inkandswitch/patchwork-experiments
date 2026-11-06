import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glbTriangles, sliceTriangles, meshSection, sliceGLB, decodeGLB, readAccessor, glbUnits, readGLB } from "./mesh-section.js";
import { signedArea } from "./body.js";
import { encodeGLB } from "./glb.js";
import { prismGLB, transomWaterline, circleLoop, instancedPrismGLB } from "./test/hull-fixtures.js";

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

describe("units", () => {
  it("reads asset.extras.units (short or long names), defaulting to metres, never guessing", () => {
    expect(glbUnits({ asset: {} })).toEqual({ unit: "m", scale: 1, declared: null, known: true });
    expect(glbUnits({ asset: { extras: { units: "mm" } } })).toMatchObject({ unit: "mm", scale: 0.001 });
    expect(glbUnits({ asset: { extras: { units: "Inches" } } })).toMatchObject({ unit: "in", scale: 0.0254 });
    expect(glbUnits({ asset: { extras: { units: "furlong" } } })).toEqual({ unit: "m", scale: 1, declared: "furlong", known: false });
  });

  it("scales the triangles to metres after the node transforms", () => {
    const glb = encodeGLB({
      meshes: [{ name: "tri", positions: [0, 0, 0, 1, 0, 0, 0, 2, -3] }],
      nodes: [{ name: "a", mesh: 0, translation: [10, 20, 30] }],
      units: "cm",
    });
    const { triangles, units } = glbTriangles(glb);
    expect(units.unit).toBe("cm");
    Array.from(triangles).forEach((v, i) => expect(v).toBeCloseTo([0.1, -0.3, 0.2, 0.11, -0.3, 0.2, 0.1, -0.27, 0.22][i], 12));
    const mm = transomWaterline().map(([x, y]) => [x * 1000, y * 1000]);
    const s = meshSection(prismGLB(mm, { levels: [-1000, 500], units: "mm" }), -0.25);
    expect(s.loops).toHaveLength(1);
    expect(s.meta.lengthWL).toBeCloseTo(10, 9);
    expect(s.meta).toMatchObject({ units: "mm", zMin: -1, zMax: 0.5 });
    expect(s.meta.notes).toMatch(/GLB in mm, scaled to metres/);
    const odd = encodeGLB({ meshes: [{ name: "tri", positions: [0, 0, 0, 1, 0, 0, 0, 2, -3] }], units: "furlong" });
    expect(meshSection(odd, 0).meta.notes).toMatch(/GLB units “furlong” unknown, read as metres/);
  });
});

describe("an empty cut says why", () => {
  it("gives the body's z range and which side of it the plane is, or that there are no triangles", () => {
    const glb = prismGLB(transomWaterline(), { levels: [-1, 0.5] });
    const above = meshSection(glb, 2);
    expect(above.loops).toEqual([]);
    expect(above.meta).toMatchObject({ zMin: -1, zMax: 0.5, triangles: expect.any(Number) });
    expect(above.meta.miss).toBe("the body spans z = -1.00 m to 0.50 m, and the plane at z = 2.00 m is above it");
    expect(meshSection(glb, -3).meta.miss).toMatch(/is below it/);
    expect(meshSection(glb, 0).meta.miss).toBeUndefined();
    const lines = encodeGLB({ meshes: [{ name: "edge", positions: [0, 0, 0, 5, 5, 5], mode: 1 }] });
    const none = meshSection(lines, 0);
    expect(none.meta).toMatchObject({ triangles: 0, zMin: null, zMax: null });
    expect(none.meta.miss).toMatch(/no triangles/);
  });
});

describe("reading GLBs the scene shows", () => {
  const fixture = (name) => new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures", name)));
  const box = (t) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) ((lo[k] = Math.min(lo[k], t[i + k])), (hi[k] = Math.max(hi[k], t[i + k])));
    return [lo, hi];
  };

  it("decodes meshopt + quantized GLBs (the Solander site's), matching three's GLTFLoader bounds", async () => {
    // bounds from three r186 GLTFLoader + MeshoptDecoder, Box3.setFromObject(scene, precise), in the floating frame
    const expected = {
      "solander-freezer.glb": [[-8.3398, -0.2735, 1.4105], [-7.8798, 0.2599, 1.9439]],
      "solander-battery-cell.glb": [[-0.4725, -0.056, -0.0452], [0.4725, 0.056, 0.0453]],
    };
    for (const [name, [lo, hi]] of Object.entries(expected)) {
      const bytes = fixture(name);
      expect(() => meshSection(bytes, 0)).toThrow(/meshopt-compressed/);
      const { triangles } = glbTriangles(await decodeGLB(bytes));
      const [blo, bhi] = box(triangles);
      lo.forEach((v, k) => expect(blo[k]).toBeCloseTo(v, 3));
      hi.forEach((v, k) => expect(bhi[k]).toBeCloseTo(v, 3));
    }
    const cells = await sliceGLB(fixture("solander-battery-cell.glb"), 0);
    expect(cells.loops).toHaveLength(8); // one mesh, eight nodes
    const freezer = await sliceGLB(fixture("solander-freezer.glb"), 1.7);
    expect(freezer.loops).toHaveLength(1);
  });

  it("maps normalised integer attributes to their float range", () => {
    // a hand-made quantized accessor: int16 normalised, and uint8 normalised
    const json = {
      accessors: [
        { bufferView: 0, componentType: 5122, normalized: true, count: 2, type: "SCALAR" },
        { bufferView: 1, componentType: 5121, normalized: true, count: 2, type: "SCALAR" },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }, { buffer: 0, byteOffset: 4, byteLength: 2 }],
    };
    const bin = new Uint8Array(8);
    const dv = new DataView(bin.buffer);
    dv.setInt16(0, 32767, true);
    dv.setInt16(2, -32768, true);
    bin[4] = 255;
    bin[5] = 51;
    expect(Array.from(readAccessor(json, bin, 0))).toEqual([1, -1]);
    expect(Array.from(readAccessor(json, bin, 1))).toEqual([1, 0.2]);
  });

  it("ignores trailing bytes after the GLB, and refuses Draco", () => {
    const glb = prismGLB(transomWaterline());
    const padded = new Uint8Array(glb.byteLength + 16);
    padded.set(glb);
    expect(meshSection(padded, 0).loops).toHaveLength(1);
    const draco = encodeGLB({ meshes: [{ name: "tri", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
    const { json, bin } = readGLB(draco);
    json.extensionsUsed = json.extensionsRequired = ["KHR_draco_mesh_compression"];
    expect(() => readGLB(reencode(json, bin))).toThrow(/Draco compression/);
  });
});

/** A GLB of this JSON and BIN (4-byte aligned chunks). */
function reencode(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(text.byteLength / 4) * 4;
  const bl = bin ? Math.ceil(bin.byteLength / 4) * 4 : 0;
  const total = 12 + 8 + jl + (bin ? 8 + bl : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(text, 20);
  if (bin) {
    dv.setUint32(20 + jl, bl, true);
    dv.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
  }
  return out;
}

describe("GPU instancing, as three's GLTFLoader draws it", () => {
  const bounds = (loop) => {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of loop.points) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return b;
  };
  const three = [[0, 0, 0], [0, 0, 20], [0, 0, 40]]; // glTF Z: floating y = −Z

  it("expands EXT_mesh_gpu_instancing listed only in extensionsUsed (one loop per instance)", async () => {
    const r = await sliceGLB(instancedPrismGLB(transomWaterline(), { TRANSLATION: three }), 0);
    expect(r.loops).toHaveLength(3);
    const ys = r.loops.map((l) => (bounds(l)[1] + bounds(l)[3]) / 2).sort((a, b) => a - b);
    [-40, -20, 0].forEach((y, i) => expect(ys[i]).toBeCloseTo(y, 1));
    expect(r.meta.notes).toMatch(/3 GPU instances expanded/);
  });

  it("reads it when it is required too (no longer refused)", async () => {
    const r = await sliceGLB(instancedPrismGLB(transomWaterline(), { TRANSLATION: three }, { required: true }), 0);
    expect(r.loops).toHaveLength(3);
  });

  it("composes TRANSLATION · ROTATION · SCALE per instance, under the node's own transform", async () => {
    const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // +90° about glTF Y: glTF −Z ← X, so floating y ← x
    const r = await sliceGLB(
      instancedPrismGLB(transomWaterline(), { TRANSLATION: [[0, 0, 0], [30, 0, 0]], ROTATION: [[0, 0, 0, 1], q], SCALE: [[1, 1, 1], [2, 2, 2]] }),
      0,
    );
    const [a, b] = r.loops.map(bounds).sort((p, s) => p[0] - s[0]);
    expect(a[0]).toBeCloseTo(0, 6);
    expect(a[2]).toBeCloseTo(10, 6);
    expect(b[1]).toBeCloseTo(0, 5); // float32 quaternion
    expect(b[3]).toBeCloseTo(20, 5); // the 10 m hull at twice the size, along y
    expect((b[0] + b[2]) / 2).toBeCloseTo(30, 1);
  });

  it("ignores it on a mesh with line or point primitives, as three does", async () => {
    const r = await sliceGLB(instancedPrismGLB(transomWaterline(), { TRANSLATION: three }, { lines: true }), 0);
    expect(r.loops).toHaveLength(1);
    expect(r.meta.notes).not.toMatch(/GPU instance/);
  });
});
