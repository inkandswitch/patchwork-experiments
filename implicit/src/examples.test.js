import { describe, expect, it } from "vitest";
import { EXAMPLES, exampleFor } from "./examples.js";
import { compile, toGLSL } from "./lang/index.js";
import { DEFAULT_RESOLUTION, meshJob } from "./mesh/job.js";
import { clippedSampler, drain, fieldNormals, gridFor, surfaceNets } from "./mesh/surface-nets.js";
import { meshQuality } from "./mesh/quality.js";
import { makeEvaluator } from "./lang/eval.js";
import { boundsProblem, normalizeBounds } from "./doc.js";

describe("examples", () => {
  it("has 4-6 distinct examples", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLES.length).toBeLessThanOrEqual(6);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(exampleFor(EXAMPLES[2].source)).toBe(EXAMPLES[2]);
    expect(exampleFor("nope")).toBeNull();
  });
  for (const ex of EXAMPLES) {
    it(`${ex.title} compiles cleanly, generates GLSL and meshes inside its bounds`, () => {
      expect(boundsProblem(ex.bounds)).toBeNull();
      const { ir, warnings } = compile(ex.source);
      expect(warnings).toEqual([]);
      expect(toGLSL(ir)).toMatch(/return/);
      const r = drain(meshJob({ source: ex.source, bounds: ex.bounds, resolution: 40 }));
      expect(r.stats.triangles).toBeGreaterThan(200);
      // the part should sit inside its bounds, not be cut off by them
      for (let a = 0; a < 3; a++) {
        const cell = r.stats.cell;
        expect(r.bounds.min[a]).toBeGreaterThan(ex.bounds.min[a] + cell * 0.5);
        expect(r.bounds.max[a]).toBeLessThan(ex.bounds.max[a] - cell * 0.5);
      }
    });
  }

  // Surface nets pinches a wall thinner than about two cells into one sheet
  // of vertices, which shows as non-manifold edges and normals that point
  // against their faces. The shipped examples have to be clean at the
  // resolution a Scene uses by default. (The gyroid block keeps a handful of
  // pinched vertices where its 8 mm walls meet the rounded box's corners.)
  for (const ex of EXAMPLES) {
    it(`${ex.title} meshes cleanly at the default resolution`, () => {
      const bounds = normalizeBounds(ex.bounds);
      const sample = clippedSampler(makeEvaluator(compile(ex.source).ir), bounds);
      const grid = gridFor(bounds, DEFAULT_RESOLUTION);
      const mesh = drain(surfaceNets(sample, grid));
      const { normals } = fieldNormals(sample, mesh.positions, grid.h * 0.5);
      const q = meshQuality(mesh.positions, mesh.indices, normals);
      const triangles = mesh.indices.length / 3;
      expect(q.nonManifoldEdges / triangles).toBeLessThan(1e-4);
      expect(q.opposedCorners / q.corners).toBeLessThan(2e-4);
      expect(q.volume).toBeGreaterThan(0);
      if (ex.id !== "gyroid-block") {
        expect(q.nonManifoldEdges).toBe(0);
        expect(q.opposedCorners).toBe(0);
      }
    }, 30_000);
  }
});
