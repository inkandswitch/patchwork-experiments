// Chartroom hydrostatic-table v1: validation against Chartroom's own
// fixtures, interpolation against its §10 box example, and a table built
// from a mesh against the wall-sided formula.
//
// src/test/chartroom/ holds copies of @risingtideresearch/chartroom v0.2.0
// formats/hydrostatic-table/v1/{examples/box.json, examples/upright-box.json,
// fixtures/**} (the version camber pins), copied as test data, not depended on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildTable,
  curveReadouts,
  DEFAULT_HEELS,
  freeTrimRightingAt,
  immersion,
  interpolate,
  rightingAt,
  rightingCurve,
  uprightKM,
  validateTable,
} from "./statics.js";
import { rotationRows, prepareMesh, immerse, cut } from "./mesh-hydro.js";
import { boxMesh, shift } from "../test/meshes.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const json = (p) => JSON.parse(readFileSync(here(p), "utf8"));
const RAD = Math.PI / 180;

describe("validation (spec §8) on Chartroom's fixtures", () => {
  const manifest = json("../test/chartroom/fixtures/manifest.json");
  it("every valid fixture and example passes", () => {
    for (const f of ["valid/minimal.json", "valid/dry-and-unknown.json", "valid/partial-moments.json"]) expect(validateTable(json(`../test/chartroom/fixtures/${f}`)), f).toEqual({ ok: true, errors: [] });
    expect(validateTable(json("../test/chartroom/box.json")).ok).toBe(true);
    expect(validateTable(json("../test/chartroom/upright-box.json")).ok).toBe(true);
  });
  for (const m of manifest)
    it(`rejects ${m.file} at the ${m.stage} stage${m.error ? ` (${m.error})` : ""}`, () => {
      const v = validateTable(json(`../test/chartroom/fixtures/${m.file}`));
      expect(v.ok).toBe(false);
      expect(v.errors.map((e) => e.stage)).toContain(m.stage);
      if (m.error) expect(v.errors.map((e) => e.code)).toContain(m.error);
    });
});

describe("interpolation (spec §5) on Chartroom's box example", () => {
  const box = json("../test/chartroom/box.json");
  // §10: V = A·h/c, Q = [−A·a·sx²/c, −A·b·sy²/c, A·(h² + a²sx² + b²sy²)/(2c²)], A 8, sx² 4/3, sy² 1/3
  const exact = (heelDeg, trimDeg, h) => {
    const [a, b, c] = rotationRows(heelDeg, trimDeg)[2];
    const V = (8 * h) / c;
    const Q = [(-8 * a * (4 / 3)) / c, (-8 * b * (1 / 3)) / c, (8 * (h * h + a * a * (4 / 3) + b * b * (1 / 3))) / (2 * c * c)];
    return { V, B: Q.map((q) => q / V) };
  };

  it("on stored states returns the §10 values", () => {
    for (const [heel, trim, h] of [
      [-10, -2, 0.5],
      [0, 0, 1],
      [10, 2, 1.5],
    ]) {
      const r = interpolate(box, { heelDeg: heel, trimDeg: trim, h });
      const e = exact(heel, trim, h);
      expect(r.volumeM3).toBeCloseTo(e.V, 9);
      r.buoyancyCenterM.forEach((v, k) => expect(v).toBeCloseTo(e.B[k], 9));
    }
  });

  it("between states interpolates V and Q = V·B, not B", () => {
    // heel 5 between 0 and 10, trim 1 between 0 and 2, h 0.75 between 0.5 and 1
    const r = interpolate(box, { heelDeg: 5, trimDeg: 1, h: 0.75 });
    let V = 0;
    const Q = [0, 0, 0];
    for (const [heel, wh] of [
      [0, 0.5],
      [10, 0.5],
    ])
      for (const [trim, wt] of [
        [0, 0.5],
        [2, 0.5],
      ])
        for (const [h, wo] of [
          [0.5, 0.5],
          [1, 0.5],
        ]) {
          const e = exact(heel, trim, h);
          const w = wh * wt * wo;
          V += w * e.V;
          for (let k = 0; k < 3; k++) Q[k] += w * e.V * e.B[k];
        }
    expect(r.volumeM3).toBeCloseTo(V, 12);
    r.buoyancyCenterM.forEach((v, k) => expect(v).toBeCloseTo(Q[k] / V, 12));
    // the interpolant is not exact between samples (§10) but it is close here
    const e = exact(5, 1, 0.75);
    expect(Math.abs(r.volumeM3 / e.V - 1)).toBeLessThan(0.01);
  });

  it("never extrapolates: outside the angles or any row's offsets is unavailable", () => {
    expect(interpolate(box, { heelDeg: 20, trimDeg: 0, h: 1 }).available).toBe(false);
    expect(interpolate(box, { heelDeg: 0, trimDeg: 3, h: 1 }).available).toBe(false);
    const r = interpolate(box, { heelDeg: 0, trimDeg: 0, h: 1.6 });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/immersion range/);
    expect(immersion(box, 20, { heelDeg: 0 }).available).toBe(false);
  });

  it("immersion inverts volume exactly for the interpolant", () => {
    for (const [heel, trim, h] of [
      [0, 0, 0.8],
      [5, 1, 1.2],
      [-7, -1.5, 0.6],
    ]) {
      const V = interpolate(box, { heelDeg: heel, trimDeg: trim, h }).volumeM3;
      const im = immersion(box, V, { heelDeg: heel, trimDeg: trim });
      expect(im.available).toBe(true);
      expect(im.h).toBeCloseTo(h, 10);
    }
  });

  it("solves free trim: the trim that puts B under G in the world", () => {
    // The exact box, upright, V = 8: h = cos t, B = [−tan t·sx², 0, (cos²t + sin²t·sx²)/(2 cos t)] with sx² = 4/3.
    // The world fore-and-aft lever (R·(B − G)).x = cos t·(Bx − Gx) − sin t·(Bz − Gz) is zero at t ≈ 1.375° for G = [−0.02, 0, 1].
    const lever = (t) => {
      const Bx = -Math.tan(t) * (4 / 3);
      const Bz = (Math.cos(t) ** 2 + Math.sin(t) ** 2 * (4 / 3)) / (2 * Math.cos(t));
      return Math.cos(t) * (Bx + 0.02) - Math.sin(t) * (Bz - 1);
    };
    let lo = 0, hi = 2 * RAD;
    for (let i = 0; i < 80; i++) (lever((lo + hi) / 2) > 0 ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2));
    const hand = ((lo + hi) / 2) / RAD;
    const r = freeTrimRightingAt(box, { volumeM3: 8, G: [-0.02, 0, 1] }, { heelDeg: 0 });
    expect(r.available).toBe(true);
    expect(Math.abs(r.trimLever)).toBeLessThan(1e-9);
    console.log(`box free trim: ${r.trimDeg.toFixed(4)}° (hand ${hand.toFixed(4)}°, Δ ${(r.trimDeg - hand).toFixed(4)}°; the table is linear in trim between 0° and 2°)`);
    expect(Math.abs(r.trimDeg - hand)).toBeLessThan(0.02);
    expect(freeTrimRightingAt(box, { volumeM3: 8, G: [0.1, 0, 1] }, { heelDeg: 0 }).available).toBe(false); // wants about −7°, outside ±2°
  });
});

describe("a table built from a box barge mesh", () => {
  // 10 × 4 × 2 m, waterline at z = 0 (1 m draft), G 0.5 m above it (KG 1.5)
  const mesh = prepareMesh(shift(boxMesh(10, 4, 2), [0, 0, -1]));
  const table = buildTable(mesh, { volumes: [40], reference: { heelDeg: 0, trimDeg: 0, waterplaneOffsetM: 0 } });
  const G = [0, 0, 0.5];
  const GM = 0.5 + 4 / 3 - 1.5;
  const curve = rightingCurve(table, { volumeM3: 40, G }, DEFAULT_HEELS);

  it("is a valid Chartroom table", () => {
    expect(validateTable(table)).toEqual({ ok: true, errors: [] });
    expect(table.table.rows).toHaveLength(DEFAULT_HEELS.length);
    expect(table.frame.knReferenceM).toEqual([0, 0, -1]);
  });

  it("gives the wall-sided GZ to the deck edge, and KN = GZ + KG·sin φ", () => {
    const rows = [];
    for (const p of curve.filter((p) => p.heelDeg > 0 && p.heelDeg <= 25)) {
      const f = p.heelDeg * RAD;
      const ws = Math.sin(f) * (GM + 0.5 * (4 / 3) * Math.tan(f) ** 2);
      rows.push(`${p.heelDeg}° ${p.gz.toFixed(6)} (hand ${ws.toFixed(6)})`);
      expect(p.gz).toBeCloseTo(ws, 9);
      expect(p.kn).toBeCloseTo(p.gz + 1.5 * Math.sin(f), 9);
    }
    console.log(`box table GZ: ${rows.join(", ")}`);
  });

  it("reads camber's vocabulary off the curve", () => {
    const r = curveReadouts(curve);
    // the deck edge goes under at tan φ = freeboard / half-beam = 1/2: 26.565°
    expect(r.sheerImmersionDeg).toBeCloseTo(Math.atan(0.5) / RAD, 1);
    expect(r.coveredToDeg).toBe(180);
    // area to 30° and 40°, against the mesh's own GZ integrated at 0.1° (Simpson)
    const fine = (to) => {
      const n = to * 10;
      let s = 0;
      for (let i = 0; i <= n; i++) {
        const d = i / 10;
        const h = immerse(mesh, 40, { heelDeg: d });
        const B = cut(mesh, { heelDeg: d, h }).buoyancyCenterM;
        const R = rotationRows(d, 0);
        const gz = -(R[1][0] * (B[0] - G[0]) + R[1][1] * (B[1] - G[1]) + R[1][2] * (B[2] - G[2]));
        s += gz * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
      }
      return (s * 0.1 * RAD) / 3;
    };
    const a30 = fine(30), a40 = fine(40);
    console.log(`box areas: to 30° ${r.area30.toFixed(5)} (fine ${a30.toFixed(5)}), to 40° ${r.area40.toFixed(5)} (fine ${a40.toFixed(5)}) m·rad; GZ max ${r.gzMax.toFixed(4)} at ${r.heelAtMaxDeg}°; AVS ${r.avsDeg.toFixed(1)}°`);
    expect(Math.abs(r.area30 / a30 - 1)).toBeLessThan(0.01);
    expect(Math.abs(r.area40 / a40 - 1)).toBeLessThan(0.01);
    expect(r.avsDeg).toBeGreaterThan(r.heelAtMaxDeg);
    expect(uprightKM(table, 40).kmt).toBeCloseTo(0.5 + 4 / 3, 9);
    // no volume, no centre of buoyancy: unavailable, not a throw
    expect(uprightKM(table, 0).available).toBe(false);
  });

  it("labels what its coverage can't reach rather than guessing", () => {
    const short = buildTable(mesh, { volumes: [40], heels: [0, 5, 10, 15, 20] });
    const r = curveReadouts(rightingCurve(short, { volumeM3: 40, G }, [0, 5, 10, 15, 20, 25, 30]));
    expect(r.area30).toBeNull();
    expect(r.area40).toBeNull();
    expect(r.gzMax).toBeNull(); // still rising where coverage ends
    expect(r.notes.join(" ")).toMatch(/covered to 20°/);
    expect(rightingAt(short, { volumeM3: 40, G }, { heelDeg: 30 }).available).toBe(false);
  });
});
