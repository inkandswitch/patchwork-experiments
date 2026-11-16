// A bounded body's reader (bounded.js) and its waves: W19 (frames, tilt and
// carrier velocity, against transforms composed the long way), W22 (the
// spectrum's clip) and W23 (the current, in the reader and in the value the
// shader draws, for open and bounded water). Every space enumerated.
import { describe, expect, it } from "vitest";
import golden from "./test/golden.json";
import { boundedReader } from "./bounded.js";
import { boxOf, carried, clipToSpan, currentOf, heldVolume, rigidVelocity, shiftByCurrent } from "./bodies.js";
import { createSurface } from "./surface.js";
import { createTiming, readerFor } from "./convert.js";
import { compose, mulM } from "./test/fake-view.js";

const SEAS = golden.seas;
const sloop = SEAS.find((s) => s.name === "Ship at sea");
const deg = (d) => (d * Math.PI) / 180;

// ─── the long way: a general 4×4 inverse by Gauss–Jordan, and points through matrices ───
function inverse4(M) {
  const A = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => M[c * 4 + r]));
  const I = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (r === c ? 1 : 0)));
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [I[c], I[p]] = [I[p], I[c]];
    const k = A[c][c];
    for (let j = 0; j < 4; j++) (A[c][j] /= k), (I[c][j] /= k);
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = 0; j < 4; j++) (A[r][j] -= f * A[c][j]), (I[r][j] -= f * I[c][j]);
    }
  }
  const out = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = I[r][c];
  return out;
}
const pt = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);

// the attachments: at the root; under a hull; under a fitting under the hull
const HULL = (yaw, heel) => compose({ position: [3, 0.2, -4], rotation: [0, yaw, 0] });
const HEEL = (heel) => compose({ rotation: [0, 0, heel] });
const FITTING = compose({ position: [0.4, -0.3, 1.1], rotation: [0, 0.25, 0] });
const TANK = compose({ position: [0.1, -0.5, 2] });
function bodyMatrix(yaw, heel, attach) {
  const hull = mulM(HULL(yaw), HEEL(heel));
  if (attach === "root") return mulM(compose({ position: [3, 0.2, -4], rotation: [0, yaw, 0] }), mulM(HEEL(heel), TANK));
  if (attach === "hull") return mulM(hull, TANK);
  return mulM(hull, mulM(FITTING, TANK));
}

const SIZE = [2, 1, 3];
const WAVES = sloop.components.filter((c) => (2 * Math.PI) / c.k <= 2);

describe("bounded frames and tilt (W19)", () => {
  for (const yawD of [0, 30, 137])
    for (const heelD of [0, 10, 30])
      for (const attach of ["root", "hull", "fitting"])
        it(`yaw ${yawD}°, heel ${heelD}°, attached at ${attach}: inside, height (clipped; the floor outside), normal`, () => {
          const M = bodyMatrix(deg(yawD), deg(heelD), attach);
          const Mi = inverse4(M);
          const cell = { box: boxOf(SIZE, M), rv: rigidVelocity(null, M, 0) };
          const R = boundedReader({ id: "tank", components: WAVES, U: [0, 0] }, cell);
          const raw = createSurface(WAVES);
          const level = M[13];
          const o = pt(M, [0, 0, 0]);
          for (let i = 0; i < 7; i++)
            for (let j = 0; j < 7; j++) {
              const x = o[0] - 2.5 + (5 * i) / 6;
              const z = o[2] - 2.5 + (5 * j) / 6;
              const q = pt(Mi, [x, level, z]);
              const inside = Math.abs(q[0]) <= SIZE[0] / 2 && Math.abs(q[2]) <= SIZE[2] / 2;
              for (const t of [0, 3.7, 1000]) {
                const h = R.heightAt(x, z, t);
                if (inside) {
                  expect(h).toBeCloseTo(level + raw.heightAt(x, z, t), 12);
                  const n = R.normalAt(x, z, t);
                  const m = raw.normalAt(x, z, t);
                  for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(m[k], 12);
                } else {
                  // the floor: where the vertical through (x, z) crosses the body's y = -depth, solved the long way
                  const q0 = pt(Mi, [x, 0, z]), q1 = pt(Mi, [x, 1, z]);
                  const y = (-SIZE[1] - q0[1]) / (q1[1] - q0[1]);
                  expect(h).toBeCloseTo(y, 9);
                  // the floor's normal is the body's +Y
                  const up = [M[4], M[5], M[6]];
                  const l = Math.hypot(...up);
                  const n = R.normalAt(x, z, t);
                  for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(up[k] / l, 9);
                }
              }
            }
        });

  it("the free surface stays level in the doc through the origin, whatever the heel (the mutation: tilt it with the frame)", () => {
    for (const heelD of [0, 10, 30]) {
      const M = bodyMatrix(deg(30), deg(heelD), "hull");
      const R = boundedReader({ id: "tank", components: [], U: [0, 0] }, { box: boxOf(SIZE, M), rv: rigidVelocity(null, M, 0) });
      const o = pt(M, [0, 0, 0]);
      for (const [dx, dz] of [[0, 0], [0.3, 0.2], [-0.4, -0.5]]) {
        expect(R.heightAt(o[0] + dx, o[2] + dz, 0)).toBeCloseTo(o[1], 12);
        expect(R.normalAt(o[0] + dx, o[2] + dz, 0)).toEqual([0, 1, 0]);
      }
    }
  });

  it("the held volume of a box turned about its surface's centre is the upright volume while the surface meets only the sides; else it says the floor", () => {
    for (const size of [[2, 2, 2], [2, 1, 4], [1, 4, 4]])
      for (const heelD of [0, 5, 10, 30, 60])
        for (const yawD of [0, 30, 137]) {
          const M = mulM(compose({ position: [5, 1, 5], rotation: [0, deg(yawD), 0] }), compose({ rotation: [0, 0, deg(heelD)] }));
          const v = heldVolume(size, M);
          // the long way: the plane meets the floor once a corner's depth, d − |x| tan(heel), goes below zero
          const floor = (size[0] / 2) * Math.tan(deg(heelD)) > size[1] + 1e-12;
          expect([size, heelD, yawD, v.meets]).toEqual([size, heelD, yawD, floor ? "floor" : "sides"]);
          if (!floor) expect(Math.abs(v.volume - size[0] * size[1] * size[2])).toBeLessThan(1e-9);
          else expect(v.volume).toBeGreaterThan(size[0] * size[1] * size[2]); // (no lid: the dry corner no longer pays for the deep one)
        }
  });
});

describe("carrier velocity (W19): the water in a tank moves with what carries it", () => {
  for (const attach of ["root", "hull", "fitting"])
    it(`attached at ${attach}: velocityAt = orbital + current + v + ω×r, with v and ω from two drawn poses`, () => {
      // the hull turning at 0.2 rad/s about +Y and heeling at 0.1 rad/s, moving at (1.5, 0.1, −2) m/s: two poses dt apart
      const dt = 1e-4;
      const pose = (s) => {
        const hull = mulM(compose({ position: [3 + 1.5 * s, 0.2 + 0.1 * s, -4 - 2 * s], rotation: [0, 0.3 + 0.2 * s, 0] }), compose({ rotation: [0, 0, 0.1 + 0.1 * s] }));
        return attach === "root" ? mulM(hull, TANK) : attach === "hull" ? mulM(hull, TANK) : mulM(hull, mulM(FITTING, TANK));
      };
      const M0 = pose(0), M1 = pose(dt);
      const rv = rigidVelocity(M0, M1, dt);
      const U = currentOf({ speed: 0.5, toward: 60 });
      const comps = shiftByCurrent(WAVES, U);
      const R = boundedReader({ id: "tank", components: comps, U }, { box: boxOf(SIZE, M1), rv });
      const raw = createSurface(comps);
      for (const [u, w] of [[0, 0], [0.5, 1], [-0.7, -1.2]]) {
        const p = pt(M1, [u, -0.3, w]);
        // the long way: the point fixed in the body, moved by the poses
        const local = pt(inverse4(M1), p);
        const before = pt(M0, local);
        const rigid = p.map((x, k) => (x - before[k]) / dt);
        for (const t of [0, 3.7, 1000]) {
          const v = R.velocityAt(p[0], p[1], p[2], t);
          const orb = raw.velocityAt(p[0], p[1] - M1[13], p[2], t);
          expect(v[0]).toBeCloseTo(orb[0] + U[0] + rigid[0], 4);
          expect(v[1]).toBeCloseTo(orb[1] + rigid[1], 4);
          expect(v[2]).toBeCloseTo(orb[2] + U[1] + rigid[2], 4);
        }
        // and carried() is the rigid part exactly as the reader adds it
        const c = carried(rv, p);
        for (let k = 0; k < 3; k++) expect(c[k]).toBeCloseTo(rigid[k], 4);
      }
    });

  it("no previous pose, or no time between them: still", () => {
    const M = bodyMatrix(0.3, 0.1, "hull");
    expect(rigidVelocity(null, M, 1)).toEqual({ v: [0, 0, 0], w: [0, 0, 0], o: [M[12], M[13], M[14]] });
    expect(rigidVelocity(M, M, 0).v).toEqual([0, 0, 0]);
  });
});

describe("the spectrum's clip (W22): a bounded body keeps the waves that fit its footprint's shorter side", () => {
  for (const s of SEAS)
    it(s.name, () => {
      for (const span of [1, 10, 37.5, 200, Infinity]) {
        const kept = clipToSpan(s.components, span);
        expect(kept).toEqual(s.components.filter((c) => (2 * Math.PI) / c.k <= span));
        if (span === Infinity) expect(kept).toBe(s.components);
      }
    });

  it("the span is the shorter side, scaled", () => {
    expect(boxOf([10, 1, 4], compose({ scale: 2 })).span).toBe(8);
    expect(boxOf([10, 1, 4], compose({ scale: 2 })).volume).toBe(320);
  });
});

describe("the current (W23): velocityAt gains exactly U; each frequency is shifted by k (dir · U), in the drawn value and the reader alike", () => {
  const currents = [null, ...[0, 90, 180, 270].map((toward) => ({ speed: 0.5, toward }))];
  const POINTS = [[0, -0.3, 0], [3, -1, -2], [-7, -0.2, 5], [12, -2, 12], [0.5, 0, -0.5]];
  for (const trait of currents)
    for (const yawD of [0, 90])
      it(`current ${trait ? `0.5 m/s toward ${trait.toward}°` : "none"}, frame yaw ${yawD}°: open water and a bounded body`, () => {
        const U = currentOf(trait);
        const comps = shiftByCurrent(sloop.components, U);
        // the value shifts each frequency by k (dir · U), and nothing else
        comps.forEach((c, i) => {
          const o = sloop.components[i];
          expect(c.omega).toBeCloseTo(o.omega + o.k * (o.dir[0] * U[0] + o.dir[1] * U[1]), 12);
          expect({ ...c, omega: 0 }).toEqual({ ...o, omega: 0 });
        });
        // open water, read through a link yawed by yawD: U turned into the frame
        const yaw = deg(yawD);
        const F = compose({ position: [10, 0, -3], rotation: [0, yaw, 0] });
        const Fi = inverse4(F);
        const timing = createTiming(false);
        timing.latched = true;
        const value = { v: 2, level: 0, components: comps, ...(trait ? { current: U } : {}) };
        const R = readerFor(value, { matrix: F }, timing);
        const still = readerFor({ ...value, current: undefined }, { matrix: F }, timing);
        const Uhere = [Fi[0] * U[0] + Fi[8] * U[1], Fi[1] * U[0] + Fi[9] * U[1], Fi[2] * U[0] + Fi[10] * U[1]];
        for (const p of POINTS)
          for (const t of [0, 3.7, 1000]) {
            const a = R.velocityAt(p[0], p[1], p[2], t);
            const b = still.velocityAt(p[0], p[1], p[2], t);
            for (let k = 0; k < 3; k++) expect(a[k] - b[k]).toBeCloseTo(Uhere[k], 12);
          }
        // a bounded body in the doc's own frame: U as it is
        const M = compose({ position: [0, 0, 0], rotation: [0, yaw, 0] });
        const cell = { box: boxOf([30, 3, 30], M), rv: rigidVelocity(null, M, 0) };
        const B = boundedReader({ id: "b", components: comps, U }, cell);
        const B0 = boundedReader({ id: "b", components: comps, U: [0, 0] }, cell);
        for (const p of POINTS)
          for (const t of [0, 3.7, 1000]) {
            const a = B.velocityAt(p[0], p[1], p[2], t);
            const b = B0.velocityAt(p[0], p[1], p[2], t);
            expect([a[0] - b[0], a[1] - b[1], a[2] - b[2]].map((x) => Math.round(x * 1e12) / 1e12 + 0)).toEqual([U[0], 0, U[1]].map((x) => Math.round(x * 1e12) / 1e12 + 0));
          }
        // and what's drawn is what floats: the reader's components are the shifted ones
        expect(B.components).toBe(comps);
      });

  it("a current's bearing: 0 toward north (−Z), 90 toward east (+X); none, or no speed, is still", () => {
    const r = (v) => v.map((x) => Math.round(x * 1e12) / 1e12 + 0);
    expect(r(currentOf({ speed: 1, toward: 0 }))).toEqual([0, -1]);
    expect(r(currentOf({ speed: 1, toward: 90 }))).toEqual([1, 0]);
    expect(currentOf(null)).toEqual([0, 0]);
    expect(currentOf({ speed: 0, toward: 90 })).toEqual([0, 0]);
    expect(shiftByCurrent(sloop.components, [0, 0])).toBe(sloop.components);
  });
});
