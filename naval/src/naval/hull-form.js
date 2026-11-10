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
//
// One statics engine per hull source. A hull that brings its own Chartroom
// hydrostatic table (a camber hull: its package's chartroom:source) is
// floated and read by that table: the waterplane it floats at, ∇, B (LCB,
// VCB, KB), Aw, LCF, BMt/BMl and so KMt/KMl, and its wetted area when the
// table states one, are the table's (tableUpright, below). The mesh then
// gives only what a hydrostatic table has no field for: the hull's drawn
// extents, the waterline's own extents (LWL, BWL), the deepest immersed
// point (Tc), the section areas (Ax, Am, the half angle of entrance), the
// side view and the lateral profile. Any other hull is read off its mesh
// alone (mesh-hydro.js). hydro.engine names the engine and hydro.from says,
// figure by figure, "table", "mesh" or "mixed" (a table figure over a mesh
// one: Cb, Cp, Cw); ∇ is "given" when a displacement is stated.

import { RHO_SEA, qty } from "./units.js";
import { GAP_TOL, cut, immerse, lateralProfile, prepareMesh, rotationRows, sideAt, sideView, uprightHydrostatics } from "./mesh-hydro.js";
import { syntheticHull } from "./synthetic-hull.js";
import { immersion, interpolate, validateTable } from "./statics.js";

/** Below this LOA a hull is a model, not a boat (the rig aid works at real size). */
export const MODEL_LOA_M = 2;

export const modelWarning = (loa) =>
  `LOA is ${qty(loa, "length", 2)}: this hull looks like a model, not a boat. The rig aid uses a hull at the size it is drawn (real size only); in camber, set the hull's length overall (or its unit) so it is drawn at its real size.`;

const rotate = (R, p) => R.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);

/** The figures of hydro.from, and where each comes from when the mesh is the only engine. */
const MESH_FROM = Object.freeze(
  Object.fromEntries(
    ["volumeM3", "lwl", "bwl", "tc", "xAft", "xFwd", "wsaM2", "transomWetM2", "wsaCanoeM2", "awM2", "lcb", "tcb", "vcb", "lcf", "kb", "kRefZ", "bmt", "bml", "kmt", "kml", "amaxM2", "xAmax", "amM2", "cb", "cp", "cm", "cpMid", "cmMid", "cw", "halfEntranceDeg"].map((k) => [k, "mesh"]),
  ),
);

/** What a hydrostatic table has no field for, so the mesh gives it whatever the table says. */
export const MESH_ONLY = Object.freeze(["lwl", "bwl", "tc", "xAft", "xFwd", "transomWetM2", "amaxM2", "xAmax", "amM2", "cm", "cmMid", "halfEntranceDeg"]);

/**
 * Where a hull's own table floats it, upright at the table's reference trim.
 * Finite cases, by what the table states and what is asked:
 *   reference state, design waterline: the reference plane; ∇ is the table's there
 *   reference state, a displacement:   the plane the table immerses to ∇; the mesh is cut that far from its design waterline (z = 0)
 *   no reference state, design waterline: the table doesn't say where the design waterline is, so the mesh's z = 0 and its ∇ there; the table is entered at that ∇
 *   no reference state, a displacement:   the table is entered at ∇; the mesh is immersed to ∇ by itself
 * @param {object} table a validated Chartroom hydrostatic-table v1
 * @param {{ volumeM3: number|null, meshVolumeAtDesign: () => number, meshImmerse: (v: number) => number|null }} o
 * @returns {{ ok: true, trimDeg, hT, volumeM3, meshH, vertical: "reference"|"volume", volumeFrom: "table"|"mesh"|"given" } | { ok: false, reason: string }}
 */
export function tableFloat(table, { volumeM3 = null, meshVolumeAtDesign, meshImmerse }) {
  const ref = table.referenceState && table.referenceState.heelDeg === 0 ? table.referenceState : null;
  const trimDeg = ref?.trimDeg ?? 0;
  const at = { heelDeg: 0, trimDeg };
  if (volumeM3 == null && ref) {
    const r = interpolate(table, { ...at, h: ref.waterplaneOffsetM });
    if (!r.available) return { ok: false, reason: r.reason };
    if (!(r.volumeM3 > 0)) return { ok: false, reason: "the table has nothing below its reference waterplane" };
    return { ok: true, trimDeg, hT: ref.waterplaneOffsetM, volumeM3: r.volumeM3, meshH: 0, vertical: "reference", volumeFrom: "table" };
  }
  const V = volumeM3 ?? meshVolumeAtDesign();
  if (!(V > 0)) return { ok: false, reason: "nothing is below the design waterline" };
  const im = immersion(table, V, at);
  if (!im.available) return { ok: false, reason: im.reason };
  if (im.nonunique) return { ok: false, reason: "the table's volume doesn't change with immersion there, so it states no waterplane" };
  if (ref) return { ok: true, trimDeg, hT: im.h, volumeM3: V, meshH: im.h - ref.waterplaneOffsetM, vertical: "reference", volumeFrom: "given" };
  const meshH = volumeM3 == null ? 0 : meshImmerse(V);
  if (meshH == null) return { ok: false, reason: "the mesh can't displace that volume" };
  return { ok: true, trimDeg, hT: im.h, volumeM3: V, meshH, vertical: "volume", volumeFrom: volumeM3 == null ? "mesh" : "given" };
}

/**
 * The upright figures a table gives at a floated state, laid over the
 * mesh's (the rig frame: the floated waterplane at z = 0, upright at the
 * table's reference trim). Every figure the table's reading carries
 * replaces the mesh's; one it doesn't carry stays the mesh's, and `from`
 * says which, figure by figure. Pure.
 *
 * Longitudinal frame. "shared": the mesh and the table are known to be the
 * same hull in the same x (camber: the GLB names the table's fingerprint),
 * so table x is rig x and LCB / LCF are the table's. "aligned": nothing
 * says the two share an origin, so the table is slid to put its LCB on the
 * mesh's: LCB stays the mesh's, and LCF is the table's LCF–LCB separation
 * from there.
 *
 * @param {object} meshHydro uprightHydrostatics of the mesh at the same waterplane (z = 0)
 * @param {object} table
 * @param {{ hT: number, trimDeg: number, frame: "shared"|"aligned", volumeFrom?: "table"|"mesh"|"given" }} o
 * @returns {{ ok: true, hydro: object, dx: number } | { ok: false, reason: string }}
 */
export function tableUpright(meshHydro, table, { hT, trimDeg = 0, frame = "aligned", volumeFrom = "table" }) {
  const r = interpolate(table, { heelDeg: 0, trimDeg, h: hT });
  if (!r.available) return { ok: false, reason: r.reason };
  if (!(r.volumeM3 > 0) || !r.buoyancyCenterM) return { ok: false, reason: "the table has no buoyancy at this waterplane" };
  const R = rotationRows(0, trimDeg);
  const V = r.volumeM3;
  const Bw = rotate(R, r.buoyancyCenterM);
  const dx = frame === "shared" ? 0 : Bw[0] - meshHydro.lcb;
  const Kw = rotate(R, table.frame.knReferenceM);
  const from = { ...MESH_FROM };
  const h = { ...meshHydro };
  const m = meshHydro;
  const fin = Number.isFinite;
  // ∇ and B
  h.volumeM3 = V;
  from.volumeM3 = volumeFrom; // "table" (its reference waterplane), "given" (a stated displacement) or "mesh" (no reference waterplane)
  h.lcb = Bw[0] - dx;
  from.lcb = frame === "shared" ? "table" : "mesh";
  h.tcb = Bw[1];
  h.vcb = Bw[2] - hT;
  h.kRefZ = Kw[2] - hT;
  h.kb = h.vcb - h.kRefZ;
  from.tcb = from.vcb = from.kRefZ = from.kb = "table";
  // the waterplane: only what the reading supplies (spec §4: omitted is unknown, never zero)
  const wp = r.waterplane;
  const gaps = [];
  if (wp && fin(wp.areaM2)) {
    h.awM2 = wp.areaM2;
    from.awM2 = "table";
  } else gaps.push(wp === null ? "the table says there is no free waterplane here, so Aw is the mesh's" : "the table gives no waterplane here, so Aw is the mesh's");
  if (wp?.centroidM) {
    h.lcf = rotate(R, wp.centroidM)[0] - dx;
    from.lcf = "table";
  } else gaps.push("the table gives no waterplane centroid here, so LCF is the mesh's");
  const mom = wp?.secondMomentsM4 ?? {};
  if (fin(mom.yy)) {
    h.bmt = mom.yy / V;
    from.bmt = "table";
  } else {
    h.bmt = m.bmt; // the mesh's own I_T over its own ∇
    gaps.push("the table gives no transverse second moment (yy) here, so BMt is the mesh's");
  }
  if (fin(mom.xx)) {
    h.bml = mom.xx / V;
    from.bml = "table";
  } else {
    h.bml = m.bml;
    gaps.push("the table gives no longitudinal second moment (xx) here, so BMl is the mesh's");
  }
  h.kmt = h.bmt != null ? h.kb + h.bmt : null;
  h.kml = h.bml != null ? h.kb + h.bml : null;
  from.kmt = from.bmt === "table" ? "table" : "mixed";
  from.kml = from.bml === "table" ? "table" : "mixed";
  // wetted area: the table's when it states one (camber's does not: its sweep measures the skin only)
  if (fin(r.wettedAreaM2)) {
    h.wsaM2 = r.wettedAreaM2;
    h.wsaCanoeM2 = r.wettedAreaM2 - m.transomWetM2;
    from.wsaM2 = "table";
    from.wsaCanoeM2 = m.transomWetM2 > 0 ? "mixed" : "table";
  } else gaps.push("the table states no wetted area, so the wetted surface is the mesh's");
  // coefficients: the table's ∇ and Aw over the mesh's lengths and sections
  const ratio = (a, b) => (fin(a / b) ? a / b : null);
  const overMesh = (k) => (from[k] === "mesh" ? "mesh" : "mixed");
  h.cb = ratio(V, m.lwl * m.bwl * m.tc);
  h.cp = ratio(V, m.amaxM2 * m.lwl);
  h.cpMid = ratio(V, m.amM2 * m.lwl);
  from.cb = from.cp = from.cpMid = overMesh("volumeM3");
  h.cw = ratio(h.awM2, m.lwl * m.bwl);
  from.cw = overMesh("awM2");
  h.engine = "chartroom";
  h.from = from;
  h.tableGaps = gaps;
  return { ok: true, hydro: h, dx };
}

/** One sentence: what the table gave and what stayed on the mesh. */
export function engineNote(hydro, name = "") {
  if (hydro.engine !== "chartroom") return "";
  const who = name ? `${name}'s hydrostatic table` : "the hull's own hydrostatic table";
  const LABEL = { volumeM3: "∇", lcb: "LCB", vcb: "VCB and KB", awM2: "Aw", lcf: "LCF", bmt: "BMt", kmt: "KMt", wsaM2: "the wetted surface" };
  const table = Object.keys(LABEL).filter((k) => hydro.from[k] === "table").map((k) => LABEL[k]);
  if (hydro.from.volumeM3 === "given") table.unshift("the waterplane the stated displacement floats at");
  const stay = ["LWL, BWL, Tc", "the section areas (Ax, the half angle of entrance)", ...Object.keys(LABEL).filter((k) => hydro.from[k] === "mesh").map((k) => LABEL[k])];
  return `Statics are ${who}: ${table.join(", ")} are read from it at the floated waterplane. A hydrostatic table has no ${stay.join(", ")}: those are read off the mesh at the same waterplane, and Cb, Cp and Cw are the table's figures over the mesh's.`;
}

/**
 * Float a hull and read it.
 * @param {Float64Array} triangles source frame (x forward, y port, z up, m)
 * @param {{ massKg?: number|null, rho?: number, kind?: "mesh"|"synthetic", label?: string,
 *           table?: object|null, tableFrame?: "shared"|"aligned", tableName?: string }} o
 *   massKg: float at this; null/absent: at the source frame's design waterline, z = 0
 *   table: the hull's own Chartroom table: when it validates and covers the floated state it is the statics
 *   engine (see the header); when it doesn't, the mesh is, and a note says why
 */
export function floatHull(triangles, { massKg = null, rho = RHO_SEA, kind = "mesh", label = "", table = null, tableFrame = "aligned", tableName = "" } = {}) {
  const source = prepareMesh(triangles);
  const warnings = [];
  const notes = [];
  if (!source.count) return { ok: false, kind, error: "the mesh has no triangles", warnings };
  if (source.flipped) notes.push("The mesh was wound inward; it is read turned outward.");

  const view0 = sideView(source, 120);
  const given = Number.isFinite(massKg) && massKg > 0;
  const designChecks = () => {
    const sheerLow = Math.min(...view0.map((r) => r.zMax));
    return sheerLow <= 0 ? "its design waterline (z = 0) is at or above the sheer, so it states no floating hull: give a displacement to float it" : null;
  };
  let h, volumeM3, from;
  let tf = null; // the table's float, when the table is the engine
  if (table) {
    const v = validateTable(table);
    const tried = v.ok
      ? tableFloat(table, {
          volumeM3: given ? massKg / rho : null,
          meshVolumeAtDesign: () => cut(source, { h: 0 }, { full: false }).volumeM3,
          meshImmerse: (V) => immerse(source, V),
        })
      : { ok: false, reason: `it doesn't check out (${v.errors[0]?.message ?? "invalid"})` };
    if (tried.ok) tf = tried;
    else notes.push(`The hull's own hydrostatic table isn't used (${tried.reason}): its figures are read off the mesh.`);
  }
  if (tf) {
    h = tf.meshH;
    volumeM3 = tf.volumeM3;
    from = given ? "given" : "design-waterline";
    if (!given) {
      const bad = designChecks();
      if (bad) return { ok: false, kind, error: bad, warnings, source };
    }
  } else if (given) {
    volumeM3 = massKg / rho;
    h = immerse(source, volumeM3);
    from = "given";
    if (h == null) return { ok: false, kind, error: `the hull can't displace ${Math.round(massKg)} kg: it sinks (its whole envelope is ${Math.round(source.volumeM3 * rho)} kg)`, warnings, source };
  } else {
    h = 0;
    from = "design-waterline";
    volumeM3 = cut(source, { h: 0 }, { full: false }).volumeM3;
    if (!(volumeM3 > 0)) return { ok: false, kind, error: "nothing of the hull is below its design waterline (z = 0): give a displacement to float it", warnings, source };
    const bad = designChecks();
    if (bad) return { ok: false, kind, error: bad, warnings, source };
  }

  // the rig frame: the floated waterplane at z = 0
  const t = Float64Array.from(source.triangles);
  for (let i = 2; i < t.length; i += 3) t[i] -= h;
  const mesh = prepareMesh(t);
  const meshHydro = uprightHydrostatics(mesh, 0);
  if (!meshHydro.ok) return { ok: false, kind, error: `the floated hull has ${meshHydro.reason}`, warnings, source };
  let hydro = { ...meshHydro, engine: "mesh", from: MESH_FROM, tableGaps: [] };
  let chartroom = null;
  if (tf) {
    const u = tableUpright(meshHydro, table, { hT: tf.hT, trimDeg: tf.trimDeg, frame: tableFrame === "shared" ? "shared" : "aligned", volumeFrom: tf.volumeFrom });
    if (u.ok) {
      hydro = u.hydro;
      const R = rotationRows(0, tf.trimDeg);
      const map = (p) => {
        const w = [p[0] + u.dx, p[1], p[2] + tf.hT];
        return [0, 1, 2].map((j) => R[0][j] * w[0] + R[1][j] * w[1] + R[2][j] * w[2]);
      };
      chartroom = { table, available: true, map, trimDeg: tf.trimDeg, h: tf.hT, dx: u.dx, volumeCheck: hydro.volumeM3, frame: tableFrame === "shared" ? "shared" : "aligned", vertical: tf.vertical, name: tableName };
      notes.push(engineNote(hydro, tableName), ...hydro.tableGaps.map((g) => `${g[0].toUpperCase()}${g.slice(1)}.`));
    } else notes.push(`The hull's own hydrostatic table isn't used (${u.reason}): its figures are read off the mesh.`);
  }
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
    float: { from, massKg: volumeM3 * rho, volumeM3, rho, h, engine: hydro.engine },
    hydro,
    chartroom,
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
 * A hull floated by this very table (floatHull's `table`) returns the map it
 * was floated by: Δx = 0 when the two share a frame, and the reference
 * waterplane rather than a second immersion.
 * @returns {{ available: true, map: (r: number[]) => number[], trimDeg: number, h: number } | { available: false, reason: string }}
 */
export function rigToTable(table, form) {
  // the table that floated the hull: the map it was floated by (floatHull), never a second alignment
  if (form.chartroom?.table === table) return form.chartroom;
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
