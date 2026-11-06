// Dice, pure: which side is up, the rotation that rests a die on a side, and
// a roll worked out from its seed.
import { describe, it, expect } from "vitest";
import { AXES, DEFAULT_FACES, eulerMatrix, faceUp, facesOf, matrixEuler, pivotOf, restingOn, rollPlan, seeded, upIn, ROLL_SKID } from "./dice.js";

const near = (got, want, digits = 6) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], digits));
const mulV = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const unit = (v) => v.map((x) => x / Math.hypot(...v));

describe("a die's faces", () => {
  it("are a d6's unless its trait says otherwise, opposite sides adding to seven", () => {
    expect(facesOf({})).toEqual(DEFAULT_FACES);
    expect(facesOf(undefined)).toEqual(DEFAULT_FACES);
    for (const [a, b] of [["+x", "-x"], ["+y", "-y"], ["+z", "-z"]]) expect(DEFAULT_FACES[a] + DEFAULT_FACES[b]).toBe(7);
    expect(Object.values(DEFAULT_FACES).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keep only well-formed sides, and fall back to a d6's when none is", () => {
    expect(facesOf({ faces: { "+y": 20, "-y": 1, up: 3, "+x": 0, "-x": 2.5, "+z": "4", "-z": 1001 } })).toEqual({ "+y": 20, "-y": 1 });
    expect(facesOf({ faces: { up: 3 } })).toEqual(DEFAULT_FACES);
    expect(facesOf({ faces: [1, 2, 3] })).toEqual(DEFAULT_FACES);
  });
});

describe("which side is up", () => {
  it("Euler XYZ goes to a matrix and back", () => {
    const rnd = seeded(7);
    for (let i = 0; i < 50; i++) {
      const r = [rnd() * 6 - 3, rnd() * 3 - 1.5, rnd() * 6 - 3];
      const m = eulerMatrix(r);
      near(eulerMatrix(matrixEuler(m)).flat(), m.flat(), 9);
    }
  });

  it("reads all 24 resting orientations of a cube: each side up, turned four ways", () => {
    let n = 0;
    for (const key of Object.keys(AXES)) {
      for (let k = 0; k < 4; k++) {
        const m = restingOn(key, (k * Math.PI) / 2);
        expect(det(m)).toBeCloseTo(1, 9);
        near(mulV(m, AXES[key]), [0, 1, 0], 9);
        expect(faceUp(m)).toEqual({ key, value: DEFAULT_FACES[key] });
        // and as the Euler angles the doc keeps
        expect(faceUp(matrixEuler(m))).toEqual({ key, value: DEFAULT_FACES[key] });
        n++;
      }
    }
    expect(n).toBe(24);
  });

  it("rests on a side whatever way is up (a die on a tilted board)", () => {
    const up = unit([0.2, 1, -0.4]);
    for (const key of Object.keys(AXES)) {
      const m = restingOn(key, 1.1, up);
      near(mulV(m, AXES[key]), up, 9);
      expect(faceUp(m, DEFAULT_FACES, up).key).toBe(key);
    }
  });

  it("world up in a parent's frame is its matrix's second row", () => {
    expect(upIn(null)).toEqual([0, 1, 0]);
    // turned a quarter about x: its own −z points up
    const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
    const m = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
    near(upIn(m), [0, 0, -1], 9);
  });

  it("a die turns about the middle of its box", () => {
    expect(pivotOf({ hint: { bounds: { min: [-0.008, 0, -0.008], max: [0.008, 0.016, 0.008] } } })).toEqual([0, 0.008, 0]);
    expect(pivotOf({})).toEqual([0, 0, 0]);
  });
});

describe("a roll", () => {
  const from = { position: [0.1, 0, -0.2], rotation: [0, 0.3, 0], scale: 1 };
  const pivot = [0, 0.008, 0];

  it("is the same roll for the same seed", () => {
    const a = rollPlan(1234, { from, pivot });
    const b = rollPlan(1234, { from, pivot });
    expect(a.to).toEqual(b.to);
    expect(a.value).toBe(b.value);
    expect(a.at(0.4)).toEqual(b.at(0.4));
  });

  it("lands on the side it says, its middle where it was (within a skid), as high as before", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = rollPlan(seed, { from, pivot });
      expect(faceUp(p.to.rotation).value).toBe(p.value);
      const centre = (t) => {
        const c = mulV(eulerMatrix(t.rotation), pivot);
        return t.position.map((v, i) => v + c[i]);
      };
      const c0 = centre(from);
      const c1 = centre(p.to);
      expect(c1[1]).toBeCloseTo(c0[1], 5);
      expect(Math.hypot(c1[0] - c0[0], c1[2] - c0[2])).toBeLessThanOrEqual(ROLL_SKID + 1e-6);
    }
  });

  it("starts where it is, tumbles in the air, and ends turned as it lands", () => {
    const p = rollPlan(99, { from, pivot });
    near(p.at(0).position, from.position);
    near(p.at(0).rotation, from.rotation);
    expect(p.at(0.5).position[1]).toBeGreaterThan(from.position[1] + 0.03);
    near(p.at(1).position, p.to.position, 5);
    near(eulerMatrix(p.at(1).rotation).flat(), eulerMatrix(p.to.rotation).flat(), 9);
  });

  it("lands on every side about as often", () => {
    const counts = {};
    for (let seed = 0; seed < 6000; seed++) {
      const v = rollPlan(seed * 2654435761, { from }).value;
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const c of Object.values(counts)) expect(c).toBeGreaterThan(850), expect(c).toBeLessThan(1150);
  });

  it("only ever shows a side its faces name", () => {
    const faces = { "+y": 7, "-y": 8 };
    for (let seed = 0; seed < 50; seed++) {
      const p = rollPlan(seed, { from, faces });
      expect([7, 8]).toContain(p.value);
      expect(faceUp(p.to.rotation, faces).value).toBe(p.value);
    }
  });
});
