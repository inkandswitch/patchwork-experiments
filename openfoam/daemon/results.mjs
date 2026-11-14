// What a finished case is worth keeping: its sampled surfaces and
// streamlines as layers (geometry + dimensionless fields), and the
// resistance figures. Reads the case directory; pure apart from that.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseVTK, triangulate, parseDat, forceRow, momentRow, parseYPlus } from "./parse.mjs";
import { encodeLayer } from "../src/protocol.js";
import { ittc57, reynolds, froude } from "../src/setup.js";

/** The newest numeric directory under `dir` (a function object's time folders). */
export function latestTimeDir(dir) {
  if (!existsSync(dir)) return null;
  const times = readdirSync(dir).filter((n) => Number.isFinite(Number(n)));
  if (!times.length) return null;
  times.sort((a, b) => Number(a) - Number(b));
  return join(dir, times[times.length - 1]);
}

const mag = (v, i) => Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);

/**
 * The dimensionless fields of one sampled surface. `q` is the dynamic
 * pressure per unit density (½V²): simpleFoam's p is kinematic (p/ρ), so it
 * divides by q; interFoam's p_rgh is in Pa, so it divides by ρq. Wall shear
 * comes out kinematic from both (the wallShearStress function object reads
 * the incompressible turbulence model's stress).
 */
export function surfaceFields(vtk, g, { want }) {
  const n = vtk.points.length / 3;
  const V = g.V;
  const q = 0.5 * V * V;
  const free = g.setup.mode === "free-surface";
  const pd = vtk.pointData;
  const out = {};
  if (want.includes("Cp")) {
    const src = free ? pd.p_rgh : pd.p;
    if (src) out.Cp = Float32Array.from(src.values, (p) => (free ? p / (g.water.rho * q) : p / q));
  }
  if (want.includes("Cf") && pd.wallShearStress) out.Cf = Float32Array.from({ length: n }, (_, i) => mag(pd.wallShearStress.values, i) / q);
  if (pd.U) {
    if (want.includes("ux")) out.ux = Float32Array.from({ length: n }, (_, i) => -pd.U.values[i * 3] / V);
    if (want.includes("speed")) out.speed = Float32Array.from({ length: n }, (_, i) => mag(pd.U.values, i) / V);
  }
  if (want.includes("alpha") && pd["alpha.water"]) out.alpha = Float32Array.from(pd["alpha.water"].values);
  if (want.includes("eta")) out.eta = Float32Array.from({ length: n }, (_, i) => vtk.points[i * 3 + 2]);
  return out;
}

/** Which surfaces a case samples, and which fields each keeps. */
export function layerPlan(g) {
  const free = g.setup.mode === "free-surface";
  const plan = [
    { name: "hull", file: "hull.vtk", want: ["Cp", "Cf"] },
    { name: "centreplane", file: "centreplane.vtk", want: ["Cp", "ux", "speed", ...(free ? ["alpha"] : [])] },
    free ? { name: "freeSurface", file: "freeSurface.vtk", want: ["eta", "Cp", "speed"] } : { name: "waterplane", file: "waterplane.vtk", want: ["Cp", "ux", "speed"] },
    { name: "wake", file: "wake.vtk", want: ["ux", "speed", "Cp", ...(free ? ["alpha"] : [])] },
  ];
  if (free) plan.push({ name: "depth", file: "depth.vtk", want: ["Cp", "ux", "speed", "alpha"] });
  return plan;
}

/**
 * Every layer the case wrote. A missing or unreadable file is noted, never
 * fatal: the figures still stand without a picture.
 * @returns {{ layers: object[], notes: string[] }}
 */
export function readLayers(caseDir, g) {
  const notes = [];
  const layers = [];
  const surf = latestTimeDir(join(caseDir, "postProcessing/surfaces"));
  // a centre plane on a half model is the symmetry patch itself: don't mirror it
  const halfOf = (name) => g.half && name !== "centreplane";
  for (const p of layerPlan(g)) {
    const file = surf && join(surf, p.file);
    if (!file || !existsSync(file)) {
      notes.push(`no ${p.name} surface was written`);
      continue;
    }
    try {
      const vtk = parseVTK(readFileSync(file, "utf8"));
      const indices = triangulate(vtk.polygons);
      if (!indices.length) {
        notes.push(`the ${p.name} surface is empty`);
        continue;
      }
      layers.push(encodeLayer({ name: p.name, kind: "triangles", positions: vtk.points, indices, fields: surfaceFields(vtk, g, { want: p.want }), half: halfOf(p.name) }));
    } catch (err) {
      notes.push(`couldn't read the ${p.name} surface (${err?.message ?? err})`);
    }
  }
  const sets = latestTimeDir(join(caseDir, "postProcessing/sets/streamLines"));
  const track = sets && readdirSync(sets).find((n) => n.endsWith(".vtk"));
  if (track) {
    try {
      const vtk = parseVTK(readFileSync(join(sets, track), "utf8"));
      // re-order the points along each line, so a line is a run of positions
      const pos = [];
      const counts = [];
      const keep = [];
      for (const line of vtk.lines ?? []) {
        if (line.length < 2) continue;
        counts.push(line.length);
        for (const i of line) {
          pos.push(vtk.points[i * 3], vtk.points[i * 3 + 1], vtk.points[i * 3 + 2]);
          keep.push(i);
        }
      }
      const pick = (arr) => Float32Array.from(keep, (i) => arr[i]);
      const f = surfaceFields(vtk, g, { want: ["speed", "Cp", "ux"] });
      layers.push(encodeLayer({ name: "streamlines", kind: "lines", positions: pos, counts, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, pick(v)])), half: g.half }));
    } catch (err) {
      notes.push(`couldn't read the streamlines (${err?.message ?? err})`);
    }
  } else notes.push("no streamlines were written");
  return { layers, notes };
}

/** Mean, standard deviation and drift (last minus first) of a series. */
export function stats(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, std: NaN, drift: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, std, drift: v[v.length - 1] - v[0], n: v.length };
}

/**
 * The resistance figures, from the whole force history. Each force is the
 * mean over the last tenth of the iterations (at least 20), which is what a
 * steady (or LTS) solution settles to; `std` says how much it still moves.
 */
export function summarize(caseDir, g, info, { cells = null, converged = null } = {}) {
  const forceFile = join(caseDir, "postProcessing/forces/0/force.dat");
  if (!existsSync(forceFile)) throw new Error("the solver wrote no forces");
  const { cols, rows } = parseDat(readFileSync(forceFile, "utf8"));
  if (!rows.length) throw new Error("the force history is empty");
  const series = rows.map((r) => forceRow(cols, r, { half: g.half }));
  const n = series.length;
  const w = Math.min(n, Math.max(20, Math.round(n / 10)));
  const tail = series.slice(n - w);
  const Rt = stats(tail.map((s) => s.Rt));
  const Rp = stats(tail.map((s) => s.Rp));
  const Rv = stats(tail.map((s) => s.Rv));
  const Fz = stats(tail.map((s) => s.Fz));
  let My = { mean: NaN };
  const momentFile = join(caseDir, "postProcessing/forces/0/moment.dat");
  if (existsSync(momentFile)) {
    const m = parseDat(readFileSync(momentFile, "utf8"));
    const ms = m.rows.map((r) => momentRow(m.cols, r, { half: g.half }));
    My = stats(ms.slice(Math.max(0, ms.length - w)).map((s) => s.My));
  }
  const { rho, nu } = g.water;
  const V = g.V;
  const S = info.wettedArea;
  const L = info.lwl > 0 ? info.lwl : g.dom.L;
  const qS = 0.5 * rho * V * V * S;
  const Re = reynolds(V, L, nu);
  const Cf0 = ittc57(Re);
  const Ct = Rt.mean / qS;
  const free = g.setup.mode === "free-surface";
  let yPlus = null;
  const yp = join(caseDir, "postProcessing/yPlus/0/yPlus.dat");
  if (existsSync(yp)) yPlus = parseYPlus(readFileSync(yp, "utf8"));
  return {
    mode: g.setup.mode,
    iterations: series[n - 1].iter,
    converged,
    window: w,
    V,
    rho,
    nu,
    L,
    S,
    Re,
    Fn: froude(V, L),
    Rt: Rt.mean,
    RtStd: Rt.std,
    RtDrift: Rt.drift,
    Rp: Rp.mean,
    Rv: Rv.mean,
    Fz: Fz.mean,
    // pitching moment about cofrX (on the waterline, mid-length), bow-down positive
    My: My.mean,
    cofrX: g.cofr[0],
    Ct,
    Cv: Rv.mean / qS,
    Cpr: Rp.mean / qS,
    Cf0,
    // a double body has no wave drag, so its total over the friction line is
    // the form factor (the "double-body method"); a free-surface run's excess
    // is residuary (form + waves) and isn't split here
    formFactor: free ? null : Ct / Cf0,
    Cr: free ? Ct - Cf0 : null,
    power: Rt.mean * V,
    yPlus,
    cells,
    half: g.half,
  };
}
