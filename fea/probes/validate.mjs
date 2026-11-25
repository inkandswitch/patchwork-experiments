// Runs with known answers, through the real runner, gmsh and CalculiX on an
// in-memory repo. Prints what came out against what theory says, and exits 1
// if any is further off than its tolerance.
//
//   node probes/validate.mjs [--only cantilever,plate] [--mesh coarse|medium|fine] [--json out.json]
//
// The cases (src/test/shapes.js makes the parts):
//
//   cantilever  a steel bar fixed at one end, a force across the other: tip
//               deflection by beam theory with shear (Timoshenko), the wall's
//               reaction, the strain energy ½ F δ
//   plate       a plate with a hole pulled along its length: the stress at
//               the hole's edge, by Howland's finite-width factor
//   block       a block pressed on top, sliding on three faces: it shortens
//               by p H / E and is stressed p everywhere, exactly
//   turned      the same block at an odd angle, so its sliding supports are
//               equations and not plain conditions: the same answers
//   hanging     a bar hung from its top under its own weight: it stretches
//               ρ g L² / 2E, and the support carries its weight
//   modal       the cantilever's first bending frequency (Euler–Bernoulli)
//   ball        a ball: one face with no edge, which gmsh can't lay out as it
//               is, so the mesh comes from the second way

import { writeFileSync } from "node:fs";
import { box, plateWithHole, ball, placed, turned } from "../src/test/shapes.js";
import { localRun, faceFacing } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const only = typeof args.only === "string" ? args.only.split(",") : null;
const meshSize = args.mesh ?? "medium";

const steel = { name: "Steel", E: { value: 200, unit: "GPa" }, nu: 0.3, density: { value: 7850, unit: "kg/m³" }, yield: { value: 250, unit: "MPa" } };
const E = 200e9, nu = 0.3, rho = 7850, g = 9.80665;
const rows = [];
const check = (name, what, got, want, tol) => {
  const off = want === 0 ? Math.abs(got) : Math.abs(got / want - 1);
  rows.push({ case: name, what, got, want, off, tol, ok: off <= tol });
};

const cases = {
  async cantilever() {
    const L = 0.1, w = 0.01, P = 100;
    const r = await localRun({
      title: "cantilever",
      triangles: box(L, w, w),
      setup: (part) => ({
        material: steel,
        mesh: { size: meshSize, order: 2 },
        supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
        loads: { a: { name: "Tip", kind: "force", faces: [faceFacing(part, [1, 0, 0])], magnitude: { value: P, unit: "N" }, direction: [0, -1, 0] } },
      }),
    });
    const s = need(r);
    const I = w ** 4 / 12, A = w * w, G = E / (2 * (1 + nu)), kappa = (10 * (1 + nu)) / (12 + 11 * nu);
    const delta = (P * L ** 3) / (3 * E * I) + (P * L) / (kappa * A * G);
    check("cantilever", "tip deflection (m)", s.displacement.max, delta, 0.02);
    check("cantilever", "wall reaction, y (N)", s.reactions[0].force[1], P, 1e-4);
    check("cantilever", "strain energy (J)", s.energy, 0.5 * P * delta, 0.03);
    check("cantilever", "forces balance", s.balance, 0, 1e-6);
    check("cantilever", "energy against work", s.adrift, 0, 1e-5);
    return r;
  },
  async plate() {
    const L = 0.1, W = 0.04, t = 0.005, d = 0.008, P = 1000;
    const r = await localRun({
      title: "plate with a hole",
      triangles: plateWithHole(L, W, t, d / 2, 48),
      setup: (part) => ({
        material: steel,
        mesh: { size: "fine", order: 2 },
        supports: { a: { name: "Held end", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
        loads: { a: { name: "Pull", kind: "force", faces: [faceFacing(part, [1, 0, 0])], magnitude: { value: P, unit: "N" }, direction: [1, 0, 0] } },
      }),
    });
    const s = need(r);
    const x = d / W;
    const Kt = 3 - 3.14 * x + 3.667 * x * x - 1.527 * x ** 3; // Howland, on the net section
    check("plate", "stress at the hole (Pa)", s.stress.max, (Kt * P) / ((W - d) * t), 0.05);
    check("plate", "the peak is at the hole, x (m)", s.stress.at[0], L / 2, 0.05);
    check("plate", "energy against work", s.adrift, 0, 1e-5);
    return r;
  },
  async block() {
    return pressed("block", {});
  },
  async turned() {
    return pressed("turned", { axis: [0.48, 0.6, 0.64], angle: 0.7, move: [0.02, -0.01, 0.03] });
  },
  async hanging() {
    const L = 0.2, w = 0.02;
    const r = await localRun({
      title: "hanging bar",
      triangles: box(w, L, w),
      setup: (part) => ({
        material: steel,
        mesh: { size: meshSize, order: 2 },
        supports: { a: { name: "Hung from", kind: "fixed", faces: [faceFacing(part, [0, 1, 0])] } },
        loads: { a: { name: "Gravity", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] } },
      }),
    });
    const s = need(r);
    check("hanging", "stretch (m)", s.displacement.max, (rho * g * L * L) / (2 * E), 0.02);
    check("hanging", "support carries the weight (N)", s.reactions[0].force[1], rho * w * w * L * g, 1e-3);
    check("hanging", "mass (kg)", s.mass, rho * w * w * L, 1e-3);
    check("hanging", "energy against work", s.adrift, 0, 1e-5);
    return r;
  },
  async modal() {
    const L = 0.1, w = 0.01;
    const r = await localRun({
      title: "cantilever, modal",
      triangles: box(L, w, w),
      setup: (part) => ({
        analysis: "modal",
        modes: 4,
        material: steel,
        mesh: { size: meshSize, order: 2 },
        supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
      }),
    });
    const s = need(r);
    const I = w ** 4 / 12, A = w * w;
    const f1 = (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * A * L ** 4));
    check("modal", "first bending frequency (Hz)", s.modes[0].hz, f1, 0.02);
    check("modal", "its twin, the other way (Hz)", s.modes[1].hz, f1, 0.02);
    check("modal", "second bending frequency (Hz)", s.modes[2].hz, f1 * (4.6941 / 1.8751) ** 2, 0.06);
    return r;
  },
  async ball() {
    const r = await localRun({
      title: "ball",
      triangles: ball(0.02, 16),
      setup: () => ({
        material: steel,
        mesh: { size: "coarse", order: 2 },
        supports: { a: { name: "Held all over", kind: "fixed", faces: [0] } },
        loads: { a: { name: "Gravity", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] } },
      }),
    });
    const s = need(r);
    rows.push({ case: "ball", what: "meshed the second way", got: r.run.mesh.method, want: "angle", off: 0, tol: 0, ok: r.run.mesh.method === "angle" });
    check("ball", "support carries the weight (N)", s.reactions[0].force[1], s.mass * g, 1e-3);
    return r;
  },
};

/** A block pressed on top, sliding on its bottom and two sides: uniaxial stress p, shortening p H / E. */
async function pressed(name, placement) {
  const a = 0.03, H = 0.05, b = 0.02, p = 2e6;
  const dir = (v) => turned(v, placement);
  const r = await localRun({
    title: name,
    triangles: placed(box(a, H, b), placement),
    setup: (part) => ({
      material: steel,
      mesh: { size: "coarse", order: 2 },
      supports: {
        a: { name: "Floor", kind: "slide", faces: [faceFacing(part, dir([0, -1, 0]))] },
        b: { name: "Side", kind: "slide", faces: [faceFacing(part, dir([-1, 0, 0]))] },
        c: { name: "Back", kind: "slide", faces: [faceFacing(part, dir([0, 0, -1]))] },
      },
      loads: { a: { name: "Press", kind: "pressure", faces: [faceFacing(part, dir([0, 1, 0]))], pressure: { value: p, unit: "Pa" } } },
    }),
  });
  const s = need(r);
  // the far corner moves down p H / E and out ν p a / E, ν p b / E
  const corner = Math.hypot((p * H) / E, (nu * p * a) / E, (nu * p * b) / E);
  check(name, "far corner moves (m)", s.displacement.max, corner, 1e-3);
  check(name, "stress everywhere (Pa)", s.stress.max, p, 1e-3);
  check(name, "stress, 99th percentile (Pa)", s.stress.p99, p, 1e-3);
  const up = dir([0, 1, 0]);
  const floor = s.reactions.find((x) => x.name === "Floor").force;
  check(name, "floor pushes back (N)", floor[0] * up[0] + floor[1] * up[1] + floor[2] * up[2], p * a * b, 1e-4);
  check(name, "energy against work", s.adrift, 0, 1e-5);
  return r;
}

function need(r) {
  if (r.run.status !== "done") throw new Error(`the run ${r.run.status}: ${r.run.error ?? ""}\n${r.run.stages.map((s) => `  ${s.id}: ${s.status} ${s.note ?? ""}`).join("\n")}`);
  return r.run.summary;
}

const timings = [];
for (const [name, fn] of Object.entries(cases)) {
  if (only && !only.includes(name)) continue;
  try {
    const r = await fn();
    timings.push({ case: name, nodes: r.run.mesh.nodes, elements: r.run.mesh.elements, method: r.run.mesh.method, worst: Number(r.run.mesh.quality.worst.toFixed(3)), seconds: r.seconds, notes: r.run.notes?.length ?? 0 });
  } catch (err) {
    rows.push({ case: name, what: "ran", got: String(err.message).split("\n")[0], want: "done", off: 1, tol: 0, ok: false });
    console.error(err.message);
  }
}
const n = (x) => (typeof x === "number" ? (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-2 && x !== 0) ? x.toExponential(4) : x.toFixed(4)) : String(x));
console.table(rows.map((r) => ({ case: r.case, what: r.what, got: n(r.got), theory: n(r.want), off: typeof r.got === "number" ? `${(r.off * 100).toFixed(2)}%` : "", within: `${(r.tol * 100).toFixed(2)}%`, ok: r.ok ? "✓" : "✗" })));
console.table(timings);
if (typeof args.json === "string") writeFileSync(args.json, JSON.stringify({ rows, timings }, null, 2));
process.exit(rows.every((r) => r.ok) ? 0 : 1);
