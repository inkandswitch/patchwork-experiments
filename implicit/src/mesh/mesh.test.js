import { describe, expect, it } from "vitest";
import { compile, makeEvaluator } from "../lang/index.js";
import { clippedSampler, drain, fieldNormals, gridFor, surfaceNets } from "./surface-nets.js";
import { clampResolution, finishMesh, meshJob, meshSurface, surfaceBytes } from "./job.js";
import { parseGLB } from "./glb.js";

const B = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
const meshOf = (src, res = 32, bounds = B) => {
  const sample = clippedSampler(makeEvaluator(compile(src).ir), bounds);
  const grid = gridFor(bounds, res);
  return { ...drain(surfaceNets(sample, grid)), sample, grid };
};

function edgeReport(indices) {
  const count = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = `${indices[t + e]},${indices[t + ((e + 1) % 3)]}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let bad = 0; // not a clean 2-manifold edge
  let open = 0; // an edge whose uses aren't matched by opposite uses: a hole
  for (const [k, n] of count) {
    const [a, b] = k.split(",");
    const back = count.get(`${b},${a}`) ?? 0;
    if (back !== n) open++;
    if (n !== 1 || back !== 1) bad++;
  }
  return { edges: count.size, bad, open };
}

describe("gridFor", () => {
  it("uses cubic cells with a one-cell margin", () => {
    const g = gridFor({ min: [0, 0, 0], max: [2, 1, 0.5] }, 20);
    expect(g.h).toBeCloseTo(0.1);
    expect([g.nx, g.ny, g.nz]).toEqual([22, 12, 7]);
    expect(g.origin[0]).toBeCloseTo(-0.1);
  });
});

describe("surface nets", () => {
  it("meshes a sphere closed, outward-facing and on the surface", () => {
    const { positions, indices, grid } = meshOf("sphere(0.3)", 32);
    expect(indices.length).toBeGreaterThan(1000);
    expect(edgeReport(indices).bad).toBe(0);
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      expect(Math.abs(r - 0.3)).toBeLessThan(grid.h * 0.5);
    }
    let inward = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
      const v = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[0] * positions[a] + n[1] * positions[a + 1] + n[2] * positions[a + 2] < 0) inward++;
    }
    expect(inward).toBe(0);
  });

  it("caps infinite fields at the bounds, so a gyroid block is watertight", () => {
    // walls (3 cm) thicker than two cells: a clean closed 2-manifold
    const fine = meshOf("gyroid(0.25, 0.03)", 80);
    expect(edgeReport(fine.indices)).toMatchObject({ bad: 0, open: 0 });
    // walls near the cell size: still closed, though surface nets may pinch
    // two sheets through one vertex (non-manifold, never a hole)
    const coarse = meshOf("gyroid(0.25, 0.03)", 40);
    expect(coarse.indices.length).toBeGreaterThan(3000);
    expect(edgeReport(coarse.indices).open).toBe(0);
  });

  it("is empty when nothing is inside the bounds", () => {
    const { positions, indices } = meshOf("translate(5, 0, 0, sphere(0.1))", 16);
    expect(positions.length).toBe(0);
    expect(indices.length).toBe(0);
  });

  it("gives radial normals and mean curvature 1/r on a sphere", () => {
    const { positions, sample, grid } = meshOf("sphere(0.25)", 48);
    const { normals, curvature } = fieldNormals(sample, positions, grid.h * 0.5);
    for (let i = 0; i < positions.length / 3; i += 17) {
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const dot = (normals[i * 3] * positions[i * 3] + normals[i * 3 + 1] * positions[i * 3 + 1] + normals[i * 3 + 2] * positions[i * 3 + 2]) / r;
      expect(dot).toBeGreaterThan(0.999);
      expect(curvature[i]).toBeGreaterThan(3.6);
      expect(curvature[i]).toBeLessThan(4.4);
    }
  });

  it("yields once per layer so the main thread can breathe", () => {
    const sample = clippedSampler(makeEvaluator(compile("sphere(0.2)").ir), B);
    const grid = gridFor(B, 16);
    const gen = surfaceNets(sample, grid);
    let yields = 0;
    for (let r = gen.next(); !r.done; r = gen.next()) yields++;
    expect(yields).toBe(grid.nz);
  });
});

describe("meshJob", () => {
  it("produces a GLB with normals, indices, _CURVATURE and a named mesh", () => {
    const r = drain(meshJob({ source: "sphere(0.2)", bounds: B, resolution: 24, name: "Ball" }));
    const { json } = parseGLB(r.glb);
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes[0].name).toBe("Ball");
    const prim = json.meshes[0].primitives[0];
    expect(Object.keys(prim.attributes).sort()).toEqual(["NORMAL", "POSITION", "_CURVATURE"]);
    expect(prim.indices).toBeTypeOf("number");
    expect(r.bounds.min[0]).toBeCloseTo(-0.2, 1);
    expect(r.notes).toMatch(/triangles · [\d.]+ (kB|MB) GLB · surface nets at 24/);
    expect(r.stats.triangles).toBeGreaterThan(100);
  });
  it("flat normals unweld the mesh", () => {
    const smooth = drain(meshJob({ source: "sphere(0.2)", bounds: B, resolution: 16 }));
    const flat = drain(meshJob({ source: "sphere(0.2)", bounds: B, resolution: 16, smoothNormals: false }));
    const prim = parseGLB(flat.glb).json.meshes[0].primitives[0];
    expect(prim.indices).toBeUndefined();
    expect(flat.stats.triangles).toBe(smooth.stats.triangles);
    expect(flat.stats.vertices).toBe(flat.stats.triangles * 3);
    // the flat normals face out of the sphere
    const { json, bin } = parseGLB(flat.glb);
    const acc = (i) => {
      const a = json.accessors[i];
      const v = json.bufferViews[a.bufferView];
      return new Float32Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * 3);
    };
    const P = acc(prim.attributes.POSITION);
    const N = acc(prim.attributes.NORMAL);
    for (let i = 0; i < P.length; i += 3) {
      expect(P[i] * N[i] + P[i + 1] * N[i + 1] + P[i + 2] * N[i + 2]).toBeGreaterThan(0);
      expect(Math.hypot(N[i], N[i + 1], N[i + 2])).toBeCloseTo(1, 5);
    }
  });
  it("yields while computing normals and unwelding, not just between layers", () => {
    const steps = (smoothNormals) => {
      const gen = meshJob({ source: "gyroid(40mm, 4mm)", bounds: B, resolution: 48, smoothNormals });
      const kinds = new Set();
      for (let r = gen.next(); !r.done; r = gen.next()) kinds.add(Object.keys(r.value)[0]);
      return kinds;
    };
    expect([...steps(true)].sort()).toEqual(["layer", "vertex"]);
    expect([...steps(false)].sort()).toEqual(["layer", "unweld", "vertex"]);
  });
  it("refuses a mesh over the size limit, and says what to change", () => {
    const job = { source: "sphere(0.2)", bounds: B, resolution: 24 };
    const ok = drain(meshJob(job));
    // the estimate assumes 32-bit indices, so it is an upper bound (give or
    // take the JSON chunk) and close to the real size
    const est = ok.stats.vertices * 28 + ok.stats.triangles * 12;
    expect(ok.glb.byteLength).toBeLessThan(est + 4096);
    expect(ok.glb.byteLength).toBeGreaterThan(est * 0.7);
    expect(() => drain(meshJob({ ...job, maxBytes: 1000 }))).toThrow(/At resolution 24 this mesh would be .* over the 1 kB limit\. Lower the resolution, tighten the bounds\./);
    expect(() => drain(meshJob({ ...job, smoothNormals: false, maxBytes: 1000 }))).toThrow(/or turn smooth normals back on/);
  });
  it("reports source errors with a position and rejects bad bounds", () => {
    expect(() => drain(meshJob({ source: "sphre(1)", bounds: B }))).toThrow(/^line 1, col 1: Unknown function "sphre"/);
    expect(() => drain(meshJob({ source: "sphere(1)", bounds: { min: [0, 0, 0], max: [0, 1, 1] } }))).toThrow(/max x must be larger/);
    expect(() => drain(meshJob({ source: "sphere(1)", bounds: null }))).toThrow(/Bounds are missing/);
  });
  it("says so when the shape is empty", () => {
    const r = drain(meshJob({ source: "translate(9, 0, 0, sphere(0.1))", bounds: B, resolution: 16 }));
    expect(r.notes).toMatch(/Nothing inside the bounds/);
    expect(parseGLB(r.glb).json.asset.version).toBe("2.0");
  });
  it("names the mesh 'Implicit surface' unless told otherwise", () => {
    const r = drain(meshJob({ source: "sphere(0.2)", bounds: B, resolution: 16 }));
    expect(parseGLB(r.glb).json.meshes[0].name).toBe("Implicit surface");
  });
  it("splits into a surface stage and a finish stage that gives the same bytes", () => {
    const job = { source: "sphere(0.2)", bounds: B, resolution: 20, smoothNormals: false, finish: "metal" };
    const surface = drain(meshSurface(job));
    expect(surface).toMatchObject({ resolution: 20, bounds: B });
    expect(surface.normals.length).toBe(surface.positions.length);
    expect(surface.curvature.length).toBe(surface.positions.length / 3);
    expect(surfaceBytes(surface)).toBeGreaterThan(0);
    const finished = drain(finishMesh(surface, job));
    expect(finished.glb).toEqual(drain(meshJob(job)).glb);
    // the finish stage refuses an oversized flat mesh on its own, too
    expect(() => drain(finishMesh(surface, { smoothNormals: false, maxBytes: 1000 }))).toThrow(/or turn smooth normals back on/);
    expect(drain(finishMesh(surface, { cached: true })).notes).toMatch(/mesh reused, finished in \d+ ms/);
  });
  it("clamps resolution to the ParamSpec's 16–160", () => {
    expect(clampResolution(1)).toBe(16);
    expect(clampResolution(8)).toBe(16);
    expect(clampResolution(10_000)).toBe(160);
    expect(clampResolution("abc")).toBe(96);
    expect(clampResolution(100.4)).toBe(100);
  });
});

describe("meshQuality", () => {
  it("finds a closed, outward cube clean and a flipped face opposed", async () => {
    const { meshQuality } = await import("./quality.js");
    // unit cube, 8 vertices, 12 outward triangles
    const P = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
    const I = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
    const N = new Float32Array(24);
    for (let v = 0; v < 8; v++) for (let a = 0; a < 3; a++) N[v * 3 + a] = P[v * 3 + a] - 0.5;
    const q = meshQuality(P, I, N);
    expect(q).toMatchObject({ nonManifoldEdges: 0, opposedCorners: 0 });
    expect(q.volume).toBeCloseTo(1, 6);
    const flipped = I.slice();
    [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
    expect(meshQuality(P, flipped, N).opposedCorners).toBe(3);
  });
});
