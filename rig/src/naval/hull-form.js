// The hull under the rig: a mesh (a linked hull's, or a synthetic one from
// principal dimensions) floated at a stated displacement, and everything the
// rest of the aid reads off it: the upright hydrostatics, the side view and
// the underwater lateral profile, the stem, sheer and transom the rig stands
// on. Pure and synchronous (a few milliseconds for a camber hull); the
// heeled statics (a Chartroom table) are built separately, in the worker.
//
// Frames. The source frame is the mesh's own after the bow/up choice
// (hull-frame.js). The rig frame is that, lowered so the floated waterplane
// is z = 0: rig = source − [0, 0, h]. x keeps the source's origin (camber's:
// its own x datum; a synthetic hull's: mid-LWL), so every rig longitudinal
// is measured from the stem, which this finds on the mesh.
//
// Real size only: the mesh is used at the size it arrives in. A hull under
// MODEL_LOA_M overall is said plainly to look like a model.

import { RHO_SEA, qty } from "./units.js";
import { GAP_TOL, cut, immerse, lateralProfile, prepareMesh, rotationRows, sideAt, sideView, uprightHydrostatics } from "./mesh-hydro.js";
import { syntheticHull } from "./synthetic-hull.js";
import { immersion, interpolate } from "./statics.js";

/** Below this LOA a hull is a model, not a boat (the rig aid works at real size). */
export const MODEL_LOA_M = 2;

export const modelWarning = (loa) =>
  `LOA is ${qty(loa, "length", 2)}: this hull looks like a model, not a boat. The rig aid uses a hull at the size it is drawn or built; in camber, use the render's "Scale to length" to get a real-size hull.`;

/**
 * Float a mesh and read it.
 * @param {Float64Array} triangles source frame (x forward, y port, z up, m)
 * @param {{ massKg?: number|null, rho?: number, kind?: "mesh"|"synthetic", label?: string }} o
 *   massKg: float at this; null/absent: at the source frame's design waterline, z = 0
 */
export function floatHull(triangles, { massKg = null, rho = RHO_SEA, kind = "mesh", label = "" } = {}) {
  const source = prepareMesh(triangles);
  const warnings = [];
  const notes = [];
  if (!source.count) return { ok: false, kind, error: "the mesh has no triangles", warnings };
  if (source.flipped) notes.push("The mesh was wound inward; it is read turned outward.");

  const view0 = sideView(source, 120);
  let h, volumeM3, from;
  if (Number.isFinite(massKg) && massKg > 0) {
    volumeM3 = massKg / rho;
    h = immerse(source, volumeM3);
    from = "given";
    if (h == null) return { ok: false, kind, error: `the hull can't displace ${Math.round(massKg)} kg: it sinks (its whole envelope is ${Math.round(source.volumeM3 * rho)} kg)`, warnings, source };
  } else {
    h = 0;
    from = "design-waterline";
    volumeM3 = cut(source, { h: 0 }, { full: false }).volumeM3;
    if (!(volumeM3 > 0)) return { ok: false, kind, error: "nothing of the hull is below its design waterline (z = 0): give a displacement to float it", warnings, source };
    const sheerLow = Math.min(...view0.map((r) => r.zMax));
    if (sheerLow <= 0)
      return { ok: false, kind, error: "its design waterline (z = 0) is at or above the sheer, so it states no floating hull: give a displacement to float it", warnings, source };
  }

  // the rig frame: the floated waterplane at z = 0
  const t = Float64Array.from(source.triangles);
  for (let i = 2; i < t.length; i += 3) t[i] -= h;
  const mesh = prepareMesh(t);
  const hydro = uprightHydrostatics(mesh, 0);
  if (!hydro.ok) return { ok: false, kind, error: `the floated hull has ${hydro.reason}`, warnings, source };
  // Every integral here is of a field along world Z, so a hole changes them
  // only through the vertical part of its normal. A hole facing aft or
  // forward (an absent transom) costs only what its rake tilts upward; one
  // facing sideways is a missing side, and is a real error.
  const [gx, gy] = hydro.cut.immersedGapAxes;
  const g = source.gapAxes;
  const holeTiltDeg = Math.atan2(g[2], Math.hypot(g[0], g[1])) * (180 / Math.PI);
  if (gy > GAP_TOL || (gx > GAP_TOL && Math.abs(holeTiltDeg) > 45))
    warnings.push(`The hull mesh is open below the waterline (${((gx + gy) * 100).toFixed(2)}% of the wetted area), so its volumes and stability are approximate. Close it (a transom panel, caps) in the source.`);
  else if (gx > GAP_TOL)
    notes.push(
      `The mesh is open below the waterline where a transom would be (${(gx * 100).toFixed(2)}% of the wetted area, its opening tilted about ${Math.abs(holeTiltDeg).toFixed(0)}° from vertical): ∇ and B miss only the sliver that tilt would cap, and the opening isn't counted as wetted area.`,
    );
  else if (!source.closed)
    notes.push(`The mesh is open (gap ${(source.gap * 100).toFixed(2)}% of its area), but not below the waterline, so the upright figures are exact; heeled ones are approximate once the opening goes under.`);
  const view = sideView(mesh, 120);
  const lateral = lateralProfile(view, 0);
  const { min, max } = mesh.bounds;
  const loa = max[0] - min[0];
  const beam = max[1] - min[1];
  const stem = view[view.length - 1];
  const stern = view[0];
  const freeboardMin = Math.min(...view.map((r) => r.zMax));
  if (loa < MODEL_LOA_M) warnings.push(modelWarning(loa));
  if (freeboardMin <= 0) warnings.push("At this displacement the sheer is under water somewhere: the hull is overloaded or floated too deep.");
  return {
    ok: true,
    kind,
    label,
    mesh,
    source,
    shiftZ: h,
    float: { from, massKg: volumeM3 * rho, volumeM3, rho, h },
    hydro,
    view,
    lateral,
    loa,
    beam,
    depth: max[2] - min[2],
    bounds: mesh.bounds,
    stem: [stem.x, stem.zMax],
    stern: [stern.x, stern.zMax],
    keelZ: min[2],
    freeboardMin,
    sheerAt: (x) => sideAt(view, x, "zMax"),
    warnings,
    notes,
  };
}

/** The datum the sail plan stands on, with the sheer read where the mast is. */
export function datumOf(form, mastAftOfStem = 0) {
  const stemX = form.stem[0];
  const sheerZ = form.sheerAt(stemX - mastAftOfStem) ?? form.stem[1];
  return { stemX, stemZ: form.stem[1], sheerZ, sternX: form.stern[0], sternZ: form.stern[1] };
}

const DIM_KEYS = ["loa", "lwl", "beam", "bwl", "tc", "freeboard", "displacementKg", "cp", "cm", "lcbFrac"];

/** A hull from principal dimensions: the synthetic mesh, floated at massKg (or its own displacement). */
export function syntheticForm(dims, { estimated = [], massKg = null } = {}) {
  const s = syntheticHull(Object.fromEntries(DIM_KEYS.map((k) => [k, dims[k]])), { estimated });
  if (!s.ok) return { ok: false, kind: "synthetic", error: s.error, warnings: [] };
  const f = floatHull(s.triangles, { massKg: Number.isFinite(massKg) && massKg > 0 ? massKg : null, kind: "synthetic", label: "synthetic hull from principal dimensions" });
  if (!f.ok) return f;
  f.synthetic = s;
  f.warnings.push(...s.fit.warnings);
  return f;
}

/**
 * Where a point of the rig frame sits in a Chartroom table's own frame. The
 * two agree on the waterplane at the same displacement: the table is read at
 * its reference trim (its design attitude) and immersed to the hull's
 * volume; its LCB there is lined up with the hull's. p_table = Rᵀ·(r + [Δx, 0, h_t]).
 * @returns {{ available: true, map: (r: number[]) => number[], trimDeg: number, h: number } | { available: false, reason: string }}
 */
export function rigToTable(table, form) {
  const trimDeg = table.referenceState?.trimDeg ?? 0;
  const im = immersion(table, form.float.volumeM3, { heelDeg: 0, trimDeg });
  if (!im.available) return im;
  const r = interpolate(table, { heelDeg: 0, trimDeg, h: im.h });
  const R = rotationRows(0, trimDeg);
  const Bw = R.map((row) => row[0] * r.buoyancyCenterM[0] + row[1] * r.buoyancyCenterM[1] + row[2] * r.buoyancyCenterM[2]);
  const dx = Bw[0] - form.hydro.lcb;
  const map = (p) => {
    const w = [p[0] + dx, p[1], p[2] + im.h];
    return [0, 1, 2].map((j) => R[0][j] * w[0] + R[1][j] * w[1] + R[2][j] * w[2]);
  };
  return { available: true, map, trimDeg, h: im.h, volumeCheck: r.volumeM3 };
}
