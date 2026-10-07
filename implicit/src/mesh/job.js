// A mesh job: source + bounds + params -> GLB bytes. Pure; runs in the mesh
// worker or on the main thread. It is a generator so the main-thread fallback
// can yield between steps (surface-nets layers, blocks of normals, chunks of
// the unweld); the worker just drains it. Only encodeGLB runs in one piece.

import { compile, formatError, ImplicitError } from "../lang/index.js";
import { makeEvaluator } from "../lang/eval.js";
import { boundsProblem, normalizeBounds } from "../doc.js";
import { clippedSampler, fieldNormalsSteps, gridFor, surfaceNets } from "./surface-nets.js";
import { computeBounds, encodeGLB } from "./glb.js";

export const MIN_RESOLUTION = 8;
// Every build the Scene keeps is a new file doc in synced storage, and GLB
// size grows with resolution², so both are capped: 160 cells across, and
// 48 MB of GLB. The gyroid example is 30 MB at 160 with smooth normals (flat
// normals unweld the mesh and roughly triple that, so it is refused there).
export const MAX_RESOLUTION = 160;
export const DEFAULT_RESOLUTION = 96;
export const MAX_GLB_BYTES = 48_000_000;
const UNWELD_CHUNK = 60_000; // triangle corners per step

/**
 * Surface finish → glTF PBR. "matte" writes no material at all, so a scene
 * treats the part as uncoloured and gives it its theme colour, as before.
 * The others are white, so the scene's object colour tints them (bronze,
 * say), and keep their metalness and roughness under that tint.
 */
export const FINISHES = Object.freeze({
  matte: null,
  satin: { color: [1, 1, 1, 1], metallic: 0, roughness: 0.42 },
  metal: { color: [1, 1, 1, 1], metallic: 1, roughness: 0.32 },
});

export function finishMaterial(finish) {
  return FINISHES[finish] ?? {};
}

export function clampResolution(r) {
  const n = Math.round(Number(r));
  if (!Number.isFinite(n)) return DEFAULT_RESOLUTION;
  return Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, n));
}

/**
 * @param {{ source: string, bounds: any, resolution?: number, smoothNormals?: boolean, finish?: "matte" | "satin" | "metal", name?: string, maxBytes?: number }} job
 * @returns {Generator<{ layer: number, of: number }, { glb: Uint8Array, bounds: any, notes: string, stats: object }>}
 */
export function* meshJob(job) {
  const t0 = Date.now();
  const problem = boundsProblem(job.bounds);
  if (problem) throw new Error(problem);
  const bounds = normalizeBounds(job.bounds);
  const resolution = clampResolution(job.resolution ?? DEFAULT_RESOLUTION);
  const smooth = job.smoothNormals !== false;
  const name = String(job.name || "Implicit surface");

  let compiled;
  try {
    compiled = compile(job.source);
  } catch (err) {
    if (err instanceof ImplicitError) throw new Error(formatError(err));
    throw err;
  }
  const evaluator = makeEvaluator(compiled.ir);
  const sample = clippedSampler(evaluator, bounds);
  const grid = gridFor(bounds, resolution);
  const mesh = yield* surfaceNets(sample, grid);
  const meshTriangles = mesh.indices.length / 3;
  const estimate = glbBytes(mesh.positions.length / 3, meshTriangles, smooth);
  const maxBytes = job.maxBytes ?? MAX_GLB_BYTES;
  if (estimate > maxBytes) {
    throw new Error(
      `At resolution ${resolution} this mesh would be ${formatBytes(estimate)} ` +
        `(${meshTriangles.toLocaleString("en-US")} triangles), over the ${formatBytes(maxBytes)} limit. ` +
        `Lower the resolution, tighten the bounds${smooth ? "" : ", or turn smooth normals back on"}.`,
    );
  }
  const { normals: fieldN, curvature } = yield* fieldNormalsSteps(sample, mesh.positions, grid.h * 0.5);

  let positions = mesh.positions;
  let indices = mesh.indices;
  let normals = fieldN;
  let curv = curvature;
  if (!smooth) {
    // unweld: every triangle gets its own corners and a flat face normal
    const corners = indices.length;
    const p2 = new Float32Array(corners * 3);
    const n2 = new Float32Array(corners * 3);
    const c2 = new Float32Array(corners);
    for (let i = 0; i < corners; i++) {
      const v = indices[i];
      p2[i * 3] = positions[v * 3];
      p2[i * 3 + 1] = positions[v * 3 + 1];
      p2[i * 3 + 2] = positions[v * 3 + 2];
      c2[i] = curvature[v];
      if (i % 3 === 2) flatNormal(p2, n2, i - 2);
      if (i % UNWELD_CHUNK === UNWELD_CHUNK - 1) yield { unweld: i + 1, of: corners };
    }
    positions = p2;
    curv = c2;
    normals = n2;
    indices = null;
  }

  const triangles = (indices ? indices.length : positions.length / 3) / 3;
  const primitive = { positions, normals, attributes: { _CURVATURE: curv }, ...finishMaterial(job.finish) };
  if (indices) primitive.indices = indices;
  const glb = encodeGLB({
    generator: "patchwork implicit-surface (surface nets)",
    meshes: [{ name, primitives: [primitive] }],
    extras: { source: "implicit-surface", resolution, cell: grid.h },
  });
  const meshBounds = computeBounds(positions);
  const ms = Date.now() - t0;
  const cellMm = grid.h * 1000;
  const notes =
    triangles === 0
      ? `Nothing inside the bounds at resolution ${resolution} — the shape may be empty, outside the bounds, or thinner than a cell (${cellMm.toFixed(1)} mm).`
      : `${triangles.toLocaleString("en-US")} triangles · ${formatBytes(glb.byteLength)} GLB · surface nets at ${resolution} (cell ${cellMm.toFixed(cellMm < 10 ? 2 : 1)} mm) · ${ms} ms`;
  return {
    glb,
    bounds: meshBounds ?? bounds,
    notes,
    stats: { triangles, vertices: positions.length / 3, resolution, cell: grid.h, ms, instructions: compiled.ir.count },
  };
}

/** Write triangle t's (corners t, t+1, t+2) face normal into all three corners of n. */
function flatNormal(p, n, t) {
  const a = t * 3;
  const ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
  const vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len > 0) {
    nx /= len;
    ny /= len;
    nz /= len;
  } else {
    nx = 0;
    ny = 1; // degenerate: point up rather than emit a zero normal
    nz = 0;
  }
  for (let c = 0; c < 9; c += 3) {
    n[a + c] = nx;
    n[a + c + 1] = ny;
    n[a + c + 2] = nz;
  }
}

/** Upper bound on GLB size: POSITION + NORMAL + _CURVATURE (28 bytes a vertex), plus 32-bit indices when welded. */
function glbBytes(vertices, triangles, welded) {
  return welded ? vertices * 28 + triangles * 12 : triangles * 3 * 28;
}

function formatBytes(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} kB`;
}
