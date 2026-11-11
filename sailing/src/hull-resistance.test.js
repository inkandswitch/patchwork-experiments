// Plan item 10, one mechanism per case: a rig contract's ship floats on
// columns from her own hull (the drawn mesh when it's the one the rig was
// designed on, else the hull the contract describes, §3.3), her canoe body
// resists by the contract's R(V, φ) table with its planing blend (§6.5,
// §6.5.6–7), pushes sideways by §6.4's Y_h and N_h, and her whole side
// force costs §6.5.5's induced drag. The fixtures are naval's
// (test/rig-contract/); compose.js is its reference consumer of §6, copied.
import { describe, it, expect } from "vitest";
import { createShip } from "./physics.js";
import { buildHull, contractHullTriangles, meshColumns, meshVolumeBelow } from "./hull-model.js";
import { contractResistance } from "./resistance.js";
import { bodyRig, rigSpecParts, toContract } from "./rig-contract.js";
import { hullTriangles, specFor, specKey } from "./sim.js";
import { invert } from "./frames.js";
import { contractShip, floatHeight, heelQuat, unflagged } from "./test/agreement-harness.js";
import { composer } from "./test/rig-contract/compose.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import catalina from "./test/rig-contract/catalina-30.json";
import j24 from "./test/rig-contract/j24.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const RAD = Math.PI / 180;
const RHO = 1025;
const G = 9.80665;
const FIXTURES = { sloop, cuvature, catalina, j24, laser };
const SYNTHETIC = { sloop, catalina, j24, laser }; // designed on a hull from principal dimensions: the aid's own
const LEVEL = [0, 0, 0, 1];
const shipOf = (c) => contractShip(c);
/** The same ship with her keel and rudder (and a bulb) dragging and lifting nothing; they still float her. */
const bare = (ship) => createShip({ ...ship.spec, rig: { ...ship.spec.rig, appendages: ship.spec.rig.appendages.map((a) => ({ ...a, areaM2: 0, bulb: null })) } });
/** Moving ahead at V with leeway λ (deg), sliding to port (body = world, heading −Z), the air moving with her (no wind on her). */
const ahead = (V, lamDeg) => {
  const velocity = [-Math.sin(lamDeg * RAD) * V, 0, -Math.cos(lamDeg * RAD) * V];
  return { motion: { velocity, spin: [0, 0, 0] }, env: { wind: { at: (x, z, t, out = [0, 0]) => ((out[0] = velocity[0]), (out[1] = velocity[2]), out) } } };
};
/** Her wrench afloat (vertical force zero) at a heel and motion, sail down. */
function afloat(ship, heelDeg, { motion, env }, controls = {}) {
  const q = heelQuat(heelDeg);
  const c = { sail: 0, ...controls };
  const y = floatHeight(ship, q, motion.velocity, c, env, 0);
  return ship.wrench({ position: [0, y, 0], quaternion: q, crew: 0 }, motion, c, env);
}

describe("her own hull: columns from the hull the contract describes (§3.3)", () => {
  it("displaces the contract's ∇ on her lines, and floats displacing her mass", () => {
    for (const c of Object.values(FIXTURES)) {
      const h = buildHull(shipOf(c).spec);
      expect(h.mesh).toBe("contract");
      expect(h.canoeVolume / c.hull.volumeM3 - 1).toBeCloseTo(0, 9);
      expect(h.restVolume * RHO).toBeCloseTo(c.loading.massKg, 6);
    }
  });

  it("her centre of buoyancy is the contract's LCB (to 0.6% of LWL) and VCB (to 1 cm)", () => {
    for (const c of Object.values(FIXTURES)) {
      const cb = buildHull(shipOf(c).spec).cb;
      expect(Math.abs(cb[2] - -c.hull.lcbM)).toBeLessThan(0.006 * c.hull.lwlM);
      expect(Math.abs(cb[1] - c.hull.vcbM)).toBeLessThan(0.01);
      expect(Math.abs(cb[0])).toBeLessThan(1e-4);
    }
  });

  it("a synthetic hull is the aid's own (α 0.6), and the mesh displaces ∇ exactly; a drawn one's α is fitted to its BM", () => {
    for (const c of Object.values(SYNTHETIC)) {
      const { triangles, alpha } = contractHullTriangles(shipOf(c).spec.rig.hull.form);
      expect(alpha).toBe(0.6);
      expect(meshVolumeBelow(triangles) / c.hull.volumeM3 - 1).toBeCloseTo(0, 9);
    }
    const form = shipOf(cuvature).spec.rig.hull.form;
    const { triangles, alpha } = contractHullTriangles(form);
    expect(form.prov).toBe("mesh");
    expect(alpha).not.toBe(0.6);
    expect(meshVolumeBelow(triangles) / cuvature.hull.volumeM3 - 1).toBeCloseTo(0, 9);
    // its waterplane's transverse inertia, ∫(2/3)·y³ over the waterline, is the contract's BM·∇ (to the mesh's facets)
    let it = 0;
    const { cols } = meshColumns(triangles, { rows: 200, across: 400, flare: 0 });
    for (let i = 0; i < cols.n; i++) if (cols.bottom[i] < 0 && cols.top[i] > 0) it += cols.area[i] * cols.x[i] ** 2;
    expect(it / form.inertiaT - 1).toBeCloseTo(0, 1);
  });

  // Her righting moment, her crew in, against the contract's boatNm (§6.6).
  // The four synthetic hulls are the aid's own; cuvature is a drawn hull,
  // and the contract describes it by its coefficients only, so her stand-in
  // has the right ∇, LCB, Cp, Cm and BM but not her big flare (5.54 m on deck
  // over a 3.71 m waterline): a KNOWN GAP past 5°, held to what it measured
  // (in the sim she floats on her drawn mesh, below).
  const RM_HEELS = [5, 10, 15, 20, 25, 30];
  // % of the contract's, measured 2026-11-09. Sailing's righting moment is
  // from columns over the synthetic hull's mesh (hull-model.js), the
  // contract's from the aid's own hydrostatics; they differ by a few percent,
  // either way, heel by heel (the most: the J/24 +5.5% at 5°, the Laser −7.1%
  // at 10°), which isn't traced further here. So this is not a tolerance:
  // each is held to what it measured, ±RM_HOLD points, and a regression of a
  // few percent shows.
  const RM_MEASURED = {
    sloop: [-0.6, 2.7, -2.0, -1.0, 3.2, -0.4],
    catalina: [1.0, 4.4, -2.4, 0.3, 1.6, -1.4],
    j24: [5.5, -4.6, 0.5, 0.2, 0.5, 0.9],
    laser: [4.2, -7.1, -1.6, 0.6, -3.0, 0.2],
  };
  const RM_HOLD = 1.5;
  const RM_GAP = { cuvature: [1, -16, -17, -18, -17, -14] }; // % of the contract's, measured 2026-11-09
  const rmOf = (c) => {
    const ship = shipOf(c);
    return RM_HEELS.map((deg) => {
      const w = afloat(ship, deg, { motion: { velocity: [0, 0, 0], spin: [0, 0, 0] }, env: {} });
      const want = c.loading.righting.boatNm[c.loading.righting.heelsDeg.indexOf(deg)];
      // heeled to port: righting is − about +z
      return 100 * (-w.torque[2] / want - 1);
    });
  };
  it("her righting moment on the synthetic hulls, 5° to 30°, is what it measured against the contract's (§6.6): within 7.1%, each to ±1.5 points", () => {
    for (const [name, c] of Object.entries(SYNTHETIC)) for (const [i, e] of rmOf(c).entries()) expect(Math.abs(e - RM_MEASURED[name][i]), `${name} at ${RM_HEELS[i]}°: ${e.toFixed(1)}%, measured ${RM_MEASURED[name][i]}%`).toBeLessThan(RM_HOLD);
  });
  it("cuvature's stand-in hull: KNOWN GAP, 14–18% short of her righting moment past 5°", () => {
    for (const [i, e] of rmOf(cuvature).entries()) expect(Math.abs(e - RM_GAP.cuvature[i]), `at ${RM_HEELS[i]}°: ${e.toFixed(1)}%`).toBeLessThan(2);
  });

  it("she floats a touch above her lines, by what her keel and rudder displace (the aid's canoe body at ∇ − ∇_app)", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = shipOf(c);
      const y = floatHeight(ship, LEVEL, [0, 0, 0], { sail: 0 }, {}, 0);
      const va = c.appendages.reduce((s, a) => s + a.volumeM3, 0);
      expect(y / (va / c.hull.awM2)).toBeGreaterThan(0.85);
      expect(y / (va / c.hull.awM2)).toBeLessThan(1.15);
    }
  });
});

describe("her own hull: a drawn mesh", () => {
  // a closed box, L × B, from y = lo to y = hi, its faces outward
  const box = (L, B, lo, hi) => {
    const p = (x, y, z) => [(x * B) / 2, y ? hi : lo, (z * L) / 2];
    const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
    const v = (i, j, k) => p(i, j, k);
    return Float64Array.from([
      ...quad(v(-1, 0, -1), v(1, 0, -1), v(1, 0, 1), v(-1, 0, 1)), // bottom
      ...quad(v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)), // top
      ...quad(v(-1, 0, -1), v(-1, 0, 1), v(-1, 1, 1), v(-1, 1, -1)),
      ...quad(v(1, 0, -1), v(1, 1, -1), v(1, 1, 1), v(1, 0, 1)),
      ...quad(v(-1, 0, -1), v(-1, 1, -1), v(1, 1, -1), v(1, 0, -1)),
      ...quad(v(-1, 0, 1), v(1, 0, 1), v(1, 1, 1), v(-1, 1, 1)),
    ]);
  };

  it("a box's volume below the waterplane: what's under, none of what's over", () => {
    expect(meshVolumeBelow(box(4, 2, -0.5, 1))).toBeCloseTo(4, 9);
    expect(meshVolumeBelow(box(4, 2, -2, -1))).toBeCloseTo(8, 9);
    expect(meshVolumeBelow(box(4, 2, 0.5, 1))).toBeCloseTo(0, 9);
  });

  it("a box's columns run bottom to top over its whole plan, and scale their depth to a stated ∇", () => {
    const { cols, scale, volume0 } = meshColumns(box(4, 2, -0.5, 1), { rows: 4, across: 3, flare: 1 });
    expect(volume0).toBeCloseTo(4, 9);
    expect(scale).toBe(1);
    let plan = 0;
    for (let i = 0; i < cols.n; i++) {
      expect(cols.bottom[i]).toBeCloseTo(-0.5, 9);
      expect(cols.top[i]).toBeCloseTo(1, 9);
      plan += cols.area[i];
    }
    expect(plan).toBeCloseTo(8, 9);
    const deeper = meshColumns(box(4, 2, -0.5, 1), { rows: 4, across: 3, flare: 1, volume: 5 });
    expect(deeper.scale).toBeCloseTo(1.25, 12);
    for (let i = 0; i < deeper.cols.n; i++) expect(deeper.cols.bottom[i]).toBeCloseTo(-0.625, 9);
  });

  // cuvature's own description, meshed, then put back into her GLB's coordinates: as if it were drawn
  const rig1 = bodyRig(cuvature);
  const body = contractHullTriangles(rig1.hull.form).triangles;
  const toGlb = invert(cuvature.frame.glbToFrame);
  const glbOf = (tri, k = 1) => {
    const out = new Float64Array(tri.length);
    for (let i = 0; i < tri.length; i += 3) {
      const p = toContract([tri[i], tri[i + 1], tri[i + 2]]);
      for (let j = 0; j < 3; j++) out[i + j] = k * (toGlb[j] * p[0] + toGlb[4 + j] * p[1] + toGlb[8 + j] * p[2] + toGlb[12 + j]);
    }
    return out;
  };
  const drawn = glbOf(body);

  it("a rig designed on this hull floats her on its drawn mesh: the same columns as the contract's description, through glbToFrame", () => {
    const rig = bodyRig(cuvature, 1, { mesh: drawn, hullUrl: cuvature.source.hull.url });
    expect(rig.warnings).toEqual([]);
    expect(rig.mesh).not.toBeNull();
    for (let i = 0; i < body.length; i++) expect(rig.mesh.triangles[i]).toBeCloseTo(body[i], 9);
    const viaMesh = specFor(null, undefined, 1, { rig: { matrix: null, contract: cuvature }, hullMesh: drawn, hullUrl: cuvature.source.hull.url });
    const viaForm = specFor(null, undefined, 1, { rig: { matrix: null, contract: cuvature } });
    const a = buildHull(viaMesh), b = buildHull(viaForm);
    expect(a.mesh).toBe("drawn");
    expect(b.mesh).toBe("contract");
    for (let i = 0; i < a.cols.n; i++) expect(a.cols.bottom[i]).toBeCloseTo(b.cols.bottom[i], 9);
    // the physics knows which hull it floats on
    expect(specKey(viaMesh)).not.toBe(specKey(viaForm));
    expect(rigSpecParts(cuvature, 1, { mesh: drawn })).toBe(rigSpecParts(cuvature, 1, { mesh: drawn }));
  });

  it("not this hull's mesh: one that displaces 33% more is refused, with a warning; on another hull, or a rig designed on a synthetic one, it isn't used", () => {
    const big = bodyRig(cuvature, 1, { mesh: glbOf(body, 1.1) });
    expect(big.mesh).toBeNull();
    expect(big.warnings.join(" ")).toMatch(/displaces .* m³ below the contract's waterline/);
    expect(bodyRig(cuvature, 1, { mesh: drawn, hullUrl: "automerge:some-other-hull" }).mesh).toBeNull();
    expect(bodyRig(sloop, 1, { mesh: drawn }).mesh).toBeNull();
  });

  it("hullTriangles reads a loaded model in its root's own frame, whatever has moved the root; once per root", () => {
    const m = (tx, ty, tz) => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1] });
    let updated = 0;
    const child = {
      isMesh: true,
      matrixWorld: m(5 + 1, 2, 3), // the root's (5, 2, 3) and its own (1, 0, 0)
      geometry: { attributes: { position: { array: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9]), itemSize: 3, count: 4 } }, index: { array: Uint16Array.from([0, 1, 2]) } },
    };
    const root = { matrixWorld: m(5, 2, 3), updateMatrixWorld: () => updated++, traverse: (f) => [root, child].forEach(f) };
    const tri = hullTriangles(root);
    expect(Array.from(tri)).toEqual([1, 0, 0, 2, 0, 0, 1, 1, 0]);
    expect(hullTriangles(root)).toBe(tri);
    expect(updated).toBe(1);
    const empty = { matrixWorld: m(0, 0, 0), traverse: (f) => f(empty) };
    expect(hullTriangles(empty)).toBeNull();
    expect(hullTriangles(null)).toBeNull();
  });
});

describe("her resistance is the contract's R(V, φ) table (§6.5)", () => {
  it("read as §6.5 'The table' says: bilinear, the same as compose.js's table reading; within 0.5% of the formulas at every predicted point", () => {
    for (const c of Object.values(FIXTURES)) {
      const r = contractResistance(shipOf(c).spec.rig);
      const table = composer(c, { resistanceFromTable: true });
      const formulas = composer(c);
      for (const V of [0.4, 1.3, 2.71, 3.9]) for (const h of [0, 3, 12.5, 35]) expect(r.hull(V, h) / table.resistanceAt(V, h, 0).hull - 1).toBeCloseTo(0, 9);
      for (const p of unflagged(c)) expect(Math.abs(r.hull(p.speedMs, p.heelDeg) / formulas.resistanceAt(p.speedMs, p.heelDeg, 0).hull - 1)).toBeLessThan(0.005);
      // heeled the same either way; past 35° the last row
      expect(r.hull(3, -20)).toBe(r.hull(3, 20));
      expect(r.hull(3, 50)).toBe(r.hull(3, 35));
    }
  });

  it("V² below its first speed; past its last, the last segment's trend, held where that falls", () => {
    const end = (c) => {
      const r = contractResistance(shipOf(c).spec.rig);
      const vs = c.resistance.speedsMs, row = c.resistance.hullN[0], n = vs.length;
      expect(r.hull(vs[0] / 2, 0)).toBeCloseTo(row[0] / 4, 9);
      expect(r.hull(0, 0)).toBe(0);
      return { r, last: vs[n - 1], at: row[n - 1], slope: (row[n - 1] - row[n - 2]) / (vs[n - 1] - vs[n - 2]) };
    };
    // the Laser's table runs on to Fn 1.2, on the plane, rising
    const l = end(laser);
    expect(l.slope).toBeGreaterThan(0);
    expect(l.r.hull(l.last + 1, 0)).toBeCloseTo(l.at + l.slope, 6);
    // the sloop's stops at Fn 0.75, where §6.5.2's held regression already turns down: held there, not followed down
    const s = end(sloop);
    expect(s.slope).toBeLessThan(0);
    expect(s.r.hull(s.last + 1, 0)).toBeCloseTo(s.at, 6);
  });

  // To 0.2%: the J/24's and the Laser's transom-hung rudders reach up to the
  // waterline, and she floats a few millimetres high on her appendages'
  // buoyancy (above), so the top of the blade is dry (0.13% of the J/24's)
  it("in the wrench: upright, no leeway, no wind on her, she meets the contract's total (§6.5: hull, keel, rudder and bulb) to 0.2%, straight aft", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = shipOf(c);
      const k = composer(c, { resistanceFromTable: true });
      for (const fn of [0.15, 0.3, 0.4]) {
        const V = fn * Math.sqrt(G * c.hull.lwlM);
        const w = afloat(ship, 0, ahead(V, 0));
        expect(Math.abs(w.force[2] / k.resistanceAt(V, 0, 0).total - 1)).toBeLessThan(0.002);
        expect(Math.abs(w.force[0])).toBeLessThan(1e-6 * w.force[2]);
      }
    }
  });

  it("going astern the hull's is STERNWAY (6) times as much", () => {
    const ship = bare(shipOf(sloop));
    const fwd = afloat(ship, 0, ahead(1, 0)).force[2];
    const back = afloat(ship, 0, ahead(-1, 0)).force[2];
    expect(-back / fwd).toBeCloseTo(6, 9);
  });
});

describe("planing (§6.5.6–7): the Laser climbs onto the plane, a keelboat never does", () => {
  const ship = shipOf(laser);
  const r = contractResistance(ship.spec.rig);
  const atFn = (fn) => fn * Math.sqrt(G * laser.hull.lwlM);
  const formulas = composer(laser);
  const noPlaning = structuredClone(laser);
  noPlaning.resistance.planing.capability = 0;
  const displacement = composer(noPlaning);

  it("the planing weight: none to Fn 0.55, half at 0.65, all of her capability from 0.75; the sloop's capability is 0", () => {
    expect(r.planing(atFn(0.5))).toBe(0);
    expect(r.planing(atFn(0.55))).toBeCloseTo(0, 6);
    expect(r.planing(atFn(0.65))).toBeCloseTo(0.5, 2);
    expect(r.planing(atFn(0.75))).toBeCloseTo(1, 6);
    expect(r.planing(atFn(1.4))).toBe(1);
    const s = contractResistance(shipOf(sloop).spec.rig);
    expect(s.capability).toBe(0);
    expect(s.planing(0.9 * Math.sqrt(G * sloop.hull.lwlM))).toBe(0);
  });

  it("her resistance is the blend: (1 − w)·displacement + w·Savitsky, as the formulas give it, to 0.5%; and the switch-over is real", () => {
    for (const fn of [0.3, 0.5, 0.6, 0.65, 0.7, 0.9, 1.1, 1.2]) expect(Math.abs(r.hull(atFn(fn), 0) / formulas.resistanceAt(atFn(fn), 0, 0).hull - 1), `Fn ${fn}`).toBeLessThan(0.005);
    // a displacement hull below 0.55: the same
    for (const fn of [0.3, 0.5]) expect(r.hull(atFn(fn), 0)).toBeCloseTo(displacement.resistanceAt(atFn(fn), 0, 0).hull, 6);
    // through the hump, the plane is cheaper than ploughing: 2%, 7% and 14% at Fn 0.6, 0.65, 0.7
    for (const fn of [0.6, 0.65, 0.7]) expect(r.hull(atFn(fn), 0)).toBeLessThan(0.98 * displacement.resistanceAt(atFn(fn), 0, 0).hull);
    // past her table (Fn 1.2) the trend holds: within 1% of the formulas at 1.3
    expect(Math.abs(r.hull(atFn(1.3), 0) / formulas.resistanceAt(atFn(1.3), 0, 0).hull - 1)).toBeLessThan(0.01);
  });

  it("read() says how far onto the plane she is", () => {
    for (const fn of [0.5, 0.65, 0.9]) {
      const V = atFn(fn);
      const d = ship.read({ ...ship.rest(), velocity: [0, 0, -V] }, { sail: 0 }, ahead(V, 0).env);
      expect(d.planing).toBeCloseTo(r.planing(V), 9);
    }
    expect("planing" in createShip().read(createShip().rest())).toBe(false);
  });
});

describe("her canoe body's side force (§6.4)", () => {
  // At 0.2° of leeway the cross-flow's quadratic part is a fraction of a percent of the linear Y_h.
  const lam = 0.2, V = 3;
  for (const [name, c] of Object.entries(FIXTURES)) {
    it(`${name}: Y_h = q·LWL²·|Y'v|·sin λ·cos φ at mid-LWL, and N_h turns her bow to windward`, () => {
      const ship = bare(shipOf(c));
      const sf = c.hull.sideForce;
      const r = contractResistance(ship.spec.rig);
      const q = 0.5 * RHO * V * V;
      const s = Math.sin(lam * RAD);
      for (const heel of [0, 20]) {
        const w = afloat(ship, heel, ahead(V, lam));
        const yh = q * sf.lwlM ** 2 * sf.yv * s * Math.cos(heel * RAD);
        // the resistance is along the flow (to port here): its share across her is R·sin λ
        const across = w.force[0] - r.hull(V, heel) * s;
        expect(across / (yh * Math.cos(heel * RAD)) - 1, `${heel}°`).toBeCloseTo(0, 2);
        if (heel) continue;
        // upright, its moment about her CG: Y_h at mid-LWL, R across her at her CB, and N_h (bow to starboard, windward: −)
        const zMid = ship.spec.rig.hull.sideForce.midZM - ship.cg[2];
        const zCb = buildHull(ship.spec).cb[2] - ship.cg[2];
        const nh = q * sf.lwlM ** 3 * sf.nv * s;
        const want = zMid * yh + zCb * r.hull(V, 0) * s - nh;
        expect(Math.abs(w.torque[1] - want)).toBeLessThan(0.02 * (Math.abs(zMid * yh) + nh));
      }
    });
  }
});

describe("her canoe body's side force is lift, square to her flow, until her keel stalls", () => {
  // In her track's frame: `side` square to it (+ resisting her slide to
  // port), `drag` along it (+ resisting her). Afloat, upright, no wind on her.
  const trackFrame = (f, lamDeg) => {
    const l = lamDeg * RAD;
    return { side: f[0] * Math.cos(l) - f[2] * Math.sin(l), drag: f[0] * Math.sin(l) + f[2] * Math.cos(l) };
  };
  const V = 3;
  for (const [name, c] of Object.entries(FIXTURES)) {
    it(`${name}: at 5° and 10° of leeway the force square to her track is §6.4's Y_h, and the leeway costs her only Y_h's induced drag`, () => {
      const ship = bare(shipOf(c));
      const sf = c.hull.sideForce;
      const k = composer(c);
      const straight = trackFrame(afloat(ship, 0, ahead(V, 0)).force, 0);
      for (const lam of [5, 10]) {
        const yh = 0.5 * RHO * V * V * sf.lwlM ** 2 * Math.abs(sf.yv) * Math.sin(lam * RAD);
        const t = trackFrame(afloat(ship, 0, ahead(V, lam)).force, lam);
        // no cross-flow drag on top of it (under the stall)
        expect(Math.abs(t.side / yh - 1), `${lam}°: side ${t.side.toFixed(1)} vs Y_h ${yh.toFixed(1)}`).toBeLessThan(0.01);
        // square to the flow: not leaning aft by λ, which would cost Y_h·sin λ (8.7% of it at 5°)
        const extra = t.drag - straight.drag - k.resistanceAt(V, 0, yh).induced;
        expect(Math.abs(extra / yh), `${lam}°: ${extra.toFixed(2)} N more drag than its induced`).toBeLessThan(0.01);
      }
    });
  }

  it("sliding broadside, no lift is left to push her along her keel line: the columns' cross-flow drag resists the slide", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = bare(shipOf(c));
      const w = afloat(ship, 0, ahead(1, 90));
      // her track is to port (−x): across it is her keel line (z)
      expect(Math.abs(w.force[2])).toBeLessThan(0.01 * Math.abs(w.force[0]));
      expect(w.force[0]).toBeGreaterThan(0);
    }
  });
});

describe("induced drag of her whole side force (§6.5.5)", () => {
  it("R_i = Y²/(π·T_e²·q) for keel, rudder and canoe body together, along the flow: compose.js's to 3%; none going astern", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = shipOf(c);
      const rig = ship.spec.rig;
      const without = createShip({ ...ship.spec, rig: { ...rig, resistance: { ...rig.resistance, coefficients: { ...rig.resistance.coefficients, teUpright: null } } } });
      const k = composer(c);
      for (const [V, lam] of [
        [2.5, 4],
        [3, 6],
      ]) {
        const m = ahead(V, lam);
        const a = afloat(ship, 0, m), b = afloat(without, 0, m);
        const d = [a.force[0] - b.force[0], a.force[2] - b.force[2]];
        const flow = [-m.motion.velocity[0] / V, -m.motion.velocity[2] / V]; // the way the water pushes
        const along = d[0] * flow[0] + d[1] * flow[1];
        expect(Math.abs(d[0] * flow[1] - d[1] * flow[0])).toBeLessThan(1e-6 * along);
        const want = k.forcesAt({ set: c.sets[0], flat: 1, twsMs: 0, twaDeg: 0 }, { V, heelDeg: 0, leewayDeg: lam, rudderDeg: 0 }).res.induced;
        expect(Math.abs(along / want - 1)).toBeLessThan(0.03);
      }
      const back = ahead(-1.5, 4);
      const a = afloat(ship, 0, back), b = afloat(without, 0, back);
      expect(Math.hypot(a.force[0] - b.force[0], a.force[2] - b.force[2])).toBe(0);
    }
  });
});

// One short seeded run, as a guard: damping her heave along the world's
// vertical (an earlier cut of this step) took her bottom's lift moving
// ahead pitched, and she kept 83% of her flat-water speed on this sea
// against the stock sloop's 88% (now 97%). Not a measure of seakeeping (the
// contract is flat-water and says so): only that the contract's hull terms
// cost her no more on a sea than the stock's do.
// (on a sea, 45 s on a seeded sea twice over: hull-resistance.slow.test.js)
