// Mesh hydrostatics on shapes with hand-worked answers. Each case prints its
// figures against the hand values, so a failure shows the delta.
import { describe, it, expect } from "vitest";
import { cut, immerse, lateralProfile, prepareMesh, rotationRows, sectionAt, sideView, uprightHydrostatics } from "./mesh-hydro.js";
import { boxMesh, cylinderMesh, flip, shift, withoutTop } from "../test/meshes.js";

const RAD = Math.PI / 180;
const report = (name, rows) => console.log(`${name}\n${rows.map(([k, got, want]) => `  ${k}: ${got} (hand ${want}, Δ ${(got - want).toExponential(2)})`).join("\n")}`);

/** GZ of a mesh at a heel, floating at volume V, G given (fixed trim 0): −(R·(B − G)).y */
function gzMesh(mesh, V, G, heelDeg) {
  const h = immerse(mesh, V, { heelDeg });
  const c = cut(mesh, { heelDeg, h });
  const R = rotationRows(heelDeg, 0);
  const d = c.buoyancyCenterM.map((b, k) => b - G[k]);
  return -(R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2]);
}

describe("box barge 10 × 4 × 2 m at T = 1 m", () => {
  // hand values: ∇ = L·B·T = 40; KB = T/2 = 0.5; BMt = B²/(12T) = 1.3333;
  // BMl = L²/(12T) = 8.3333; Aw = L·B = 40; WSA = bottom 40 + sides 2·10·1 +
  // ends 2·4·1 = 68 (the plan's "60" left out the ends); Cp = Cm = Cb = 1.
  const mesh = prepareMesh(shift(boxMesh(10, 4, 2), [0, 0, -1])); // the waterline at z = 0
  const u = uprightHydrostatics(mesh, 0);
  it("upright figures", () => {
    report("box", [
      ["∇", u.volumeM3, 40],
      ["KB", u.kb, 0.5],
      ["BMt", u.bmt, 4 / 3],
      ["BMl", u.bml, 100 / 12],
      ["Aw", u.awM2, 40],
      ["WSA", u.wsaM2, 68],
    ]);
    expect(mesh.closed).toBe(true);
    expect(u.volumeM3).toBeCloseTo(40, 9);
    expect(u.kb).toBeCloseTo(0.5, 9);
    expect(u.bmt).toBeCloseTo(4 / 3, 9);
    expect(u.bml).toBeCloseTo(100 / 12, 9);
    expect(u.kmt).toBeCloseTo(0.5 + 4 / 3, 9);
    expect(u.awM2).toBeCloseTo(40, 9);
    expect(u.wsaM2).toBeCloseTo(68, 9);
    expect(u.lcf).toBeCloseTo(0, 9);
    expect(u.lcb).toBeCloseTo(0, 9);
    expect([u.lwl, u.bwl, u.tc]).toEqual([10, 4, 1].map((v) => expect.closeTo(v, 9)));
    expect([u.cp, u.cm, u.cb, u.cw]).toEqual([1, 1, 1, 1].map((v) => expect.closeTo(v, 6)));
    expect(u.amaxM2).toBeCloseTo(4, 9);
  });

  it("floats where it should, and the section, side view and lateral profile are the box's", () => {
    const raw = prepareMesh(boxMesh(10, 4, 2));
    expect(immerse(raw, 40)).toBeCloseTo(1, 10);
    expect(immerse(raw, 81)).toBeNull(); // more than the whole envelope (80 m³)
    expect(sectionAt(mesh, { h: 0 }, 2.5).areaM2).toBeCloseTo(4, 9);
    const view = sideView(mesh, 20);
    expect(view[0].x).toBeCloseTo(-5, 12);
    expect(view[view.length - 1].x).toBeCloseTo(5, 12);
    for (const r of view) expect([r.zMin, r.zMax]).toEqual([expect.closeTo(-1, 9), expect.closeTo(1, 9)]);
    const lat = lateralProfile(view, 0);
    expect(lat.areaM2).toBeCloseTo(10, 9);
    expect(lat.centroid[0]).toBeCloseTo(0, 9);
    expect(lat.centroid[1]).toBeCloseTo(-0.5, 9);
  });

  it("GZ is the wall-sided formula sin φ (GM + ½ BM tan²φ) up to the deck edge (26.57°)", () => {
    const G = [0, 0, 0.5]; // KG 1.5 above the bottom
    const GM = 0.5 + 4 / 3 - 1.5;
    const rows = [5, 10, 20, 25].map((d) => {
      const f = d * RAD;
      return [`GZ ${d}°`, gzMesh(mesh, 40, G, d), Math.sin(f) * (GM + 0.5 * (4 / 3) * Math.tan(f) ** 2)];
    });
    report("box GZ", rows);
    for (const [, got, want] of rows) expect(Math.abs(got - want)).toBeLessThan(0.005 * Math.abs(want)); // the plan's ±0.5%; exact here to ~1e-12
    for (const [, got, want] of rows) expect(got).toBeCloseTo(want, 10);
  });

  it("conserves volume heeled and trimmed, and matches Chartroom's §10 box formulas", () => {
    // Chartroom's example box: 4 × 2 × 2, origin mid-length on the bottom.
    // For n = [a, b, c] and a cut crossing only the walls: V = A·h/c,
    // Qx = −A·a·sx²/c, Qy = −A·b·sy²/c, Qz = A·(h² + a²sx² + b²sy²)/(2c²),
    // A = 8, sx² = 4/3, sy² = 1/3.
    const box = prepareMesh(boxMesh(4, 2, 2));
    for (const [heelDeg, trimDeg, h] of [
      [10, 2, 1],
      [-10, -2, 0.5],
      [7, -1.5, 1.2],
    ]) {
      const [a, b, c] = rotationRows(heelDeg, trimDeg)[2];
      const A = 8, sx = 4 / 3, sy = 1 / 3;
      const V = (A * h) / c;
      const Q = [(-A * a * sx) / c, (-A * b * sy) / c, (A * (h * h + a * a * sx + b * b * sy)) / (2 * c * c)];
      const got = cut(box, { heelDeg, trimDeg, h });
      expect(got.volumeM3).toBeCloseTo(V, 10);
      got.buoyancyCenterM.forEach((v, k) => expect(v).toBeCloseTo(Q[k] / V, 10));
      // and immersing that volume at that attitude finds the same plane
      expect(immerse(box, V, { heelDeg, trimDeg })).toBeCloseTo(h, 9);
    }
    for (const heelDeg of [0, 15, 45, 90, 135]) {
      const h = immerse(box, 6, { heelDeg });
      expect(cut(box, { heelDeg, h }).volumeM3).toBeCloseTo(6, 6);
    }
  });
});

describe("a circular cylinder floating at half its section", () => {
  it("has GZ = 0 at every heel with G at its axis (a 256-gon, within 1 mm)", () => {
    const R = 1;
    const mesh = prepareMesh(cylinderMesh(10, R, 256));
    const V = mesh.volumeM3 / 2;
    const gz = [10, 30, 60, 90, 120].map((d) => gzMesh(mesh, V, [0, 0, 0], d));
    console.log(`cylinder GZ (hand 0): ${gz.map((g) => g.toExponential(2)).join(", ")}`);
    for (const g of gz) expect(Math.abs(g)).toBeLessThan(1e-3);
    // KB = 4R/(3π) below the axis for a half circle: KM = KB + BM = R exactly
    const u = uprightHydrostatics(mesh, 0);
    expect(u.bmt + (u.vcb - 0)).toBeCloseTo(0, 3);
  });
});

describe("mesh closure", () => {
  it("rewinds an inward mesh, and says when a mesh is open", () => {
    const inward = prepareMesh(flip(boxMesh(10, 4, 2)));
    expect(inward.flipped).toBe(true);
    expect(cut(inward, { h: 1 }).volumeM3).toBeCloseTo(40, 9);
    const open = prepareMesh(withoutTop(boxMesh(10, 4, 2), 2));
    expect(open.closed).toBe(false);
    expect(open.closedForHeel).toBe(false);
    // an open end (normal along x) is harmless at level trim, and says so
    const noEnd = [];
    const t = boxMesh(10, 4, 2);
    for (let i = 0; i < t.length; i += 9) if (!(t[i] === 5 && t[i + 3] === 5 && t[i + 6] === 5)) noEnd.push(...t.slice(i, i + 9));
    const m = prepareMesh(noEnd);
    expect(m.closed).toBe(false);
    expect(m.closedForHeel).toBe(true);
    expect(cut(m, { heelDeg: 20, h: 1 }).volumeM3).toBeCloseTo(cut(prepareMesh(t), { heelDeg: 20, h: 1 }).volumeM3, 9);
  });
});
