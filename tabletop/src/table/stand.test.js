// Standing a piece on edge and laying it flat (stand.js), over every way a
// piece can lie square (the 24 turns of a cube) and every compass direction
// it can be stood toward: the result is always a proper turn, faces where it
// should, and rests where the piece rested. And a hand laid out face up.
import { describe, it, expect } from "vitest";
import { boxUnder, canStand, isStanding, layPose, restAt, spread, standPose, upness } from "./stand.js";
import { composeMatrix } from "./frame.js";

const TILE = { min: [-0.0125, 0, -0.025], max: [0.0125, 0.0097, 0.025] };
const CARD = { min: [-0.028, 0, -0.0435], max: [0.028, 0.0012, 0.0435] };

/** The 24 rotations that map the axes onto the axes (quarter turns), as Euler XYZ. */
function cubeTurns() {
  const q = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const seen = new Map();
  for (const a of q) for (const b of q) for (const c of q) {
    const m = composeMatrix({ rotation: [a, b, c] });
    const key = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => Math.round(m[i])).join();
    if (!seen.has(key)) seen.set(key, [a, b, c]);
  }
  return [...seen.values()];
}
const TURNS = cubeTurns();
const COMPASS = Array.from({ length: 8 }, (_, k) => [Math.sin((k * Math.PI) / 4), 0, Math.cos((k * Math.PI) / 4)]);
const col = (m, k) => [m[4 * k], m[4 * k + 1], m[4 * k + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A proper rotation (orthonormal, det +1) of scale s. */
function expectRotation(m, s = 1) {
  const [x, y, z] = [0, 1, 2].map((k) => col(m, k).map((v) => v / s));
  for (const v of [x, y, z]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
  expect(dot(x, y)).toBeCloseTo(0, 9);
  expect(dot(y, z)).toBeCloseTo(0, 9);
  expect(dot(x, z)).toBeCloseTo(0, 9);
  expect(dot(cross(x, y), z)).toBeCloseTo(1, 9);
}
/** Rests where `m` rested: the same footprint middle, the same lowest point. */
function expectRestsAs(to, m, box) {
  const [a, b] = [boxUnder(m, box), boxUnder(to, box)];
  expect((b.min[0] + b.max[0]) / 2).toBeCloseTo((a.min[0] + a.max[0]) / 2, 9);
  expect((b.min[2] + b.max[2]) / 2).toBeCloseTo((a.min[2] + a.max[2]) / 2, 9);
  expect(b.min[1]).toBeCloseTo(a.min[1], 9);
}

it(`there are 24 square turns and 8 directions: ${TURNS.length * COMPASS.length} cases`, () => {
  expect(TURNS).toHaveLength(24);
});

describe("standPose", () => {
  for (const [i, r] of TURNS.entries()) {
    it(`turn ${i}: stood toward each of 8 directions, it faces that way on edge, length level, and rests where it was`, () => {
      for (const scale of [1, 2]) {
        const m = composeMatrix({ position: [0.3, 0.01, -0.2], rotation: r, scale });
        for (const toward of COMPASS) {
          const to = standPose(m, TILE, toward);
          expectRotation(to, scale);
          const y = col(to, 1).map((v) => v / scale);
          const z = col(to, 2).map((v) => v / scale);
          expect(dot(y, toward)).toBeCloseTo(1, 9);
          expect(z[1]).toBeCloseTo(0, 9);
          expect(isStanding(to)).toBe(true);
          expect(upness(to)).toBeCloseTo(0, 9);
          // its length keeps the way it pointed as far as it can: never turned more than a quarter from it, seen level
          const was = col(m, 2).map((v) => v / scale);
          if (Math.hypot(was[0], was[2]) > 1e-9) expect(dot(z, was)).toBeGreaterThanOrEqual(-1e-9);
          expectRestsAs(to, m, TILE);
        }
      }
    });
  }

  it("needs a direction with a level part", () => {
    expect(standPose(composeMatrix({}), TILE, [0, 1, 0])).toBeNull();
    expect(standPose(composeMatrix({}), TILE, [0, 0, 0])).toBeNull();
  });
});

describe("layPose", () => {
  for (const [i, r] of TURNS.entries()) {
    it(`turn ${i}: laid flat face up, resting where it was; laying a flat face-up piece leaves it be`, () => {
      const m = composeMatrix({ position: [-0.1, 0.02, 0.4], rotation: r });
      const to = layPose(m, TILE);
      expectRotation(to);
      expect(upness(to)).toBeCloseTo(1, 9);
      expect(isStanding(to)).toBe(false);
      expectRestsAs(to, m, TILE);
      const again = layPose(to, TILE);
      for (let k = 0; k < 16; k++) expect(again[k]).toBeCloseTo(to[k], 9);
      // stood toward any way and laid down again: flat face up where it stood
      for (const toward of COMPASS) {
        const back = layPose(standPose(to, TILE, toward), TILE);
        expect(upness(back)).toBeCloseTo(1, 9);
      }
    });
  }
});

describe("what can stand", () => {
  it("a domino can; a card can't; nor nothing", () => {
    expect(canStand(TILE)).toBe(true);
    expect(canStand(CARD)).toBe(false);
    expect(canStand(null)).toBe(false);
    expect(canStand({ min: [0, 0, 0], max: [0, 0, 0] })).toBe(false);
  });

  it("restAt keeps the scale", () => {
    const m = composeMatrix({ position: [0, 0.5, 0], rotation: [0, 0.3, 0], scale: 3 });
    const to = restAt(m, composeMatrix({ rotation: [Math.PI / 2, 0, 0] }), TILE);
    expect(Math.hypot(to[0], to[1], to[2])).toBeCloseTo(3, 9);
    expectRestsAs(to, m, TILE);
  });
});

describe("spread: a hand laid out face up", () => {
  for (let n = 0; n <= 30; n++) {
    it(`${n} tiles: out past the edge, none touching, rows within the width`, () => {
      const spots = spread(Array.from({ length: n }, () => TILE), { edge: -0.035, width: 0.62 });
      expect(spots).toHaveLength(n);
      for (const s of spots) {
        expect(s.z + 0.025).toBeLessThan(-0.035); // wholly past the edge
        expect(Math.abs(s.x) + 0.0125).toBeLessThanOrEqual(0.31 + 1e-9);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = Math.abs(spots[i].x - spots[j].x);
        const dz = Math.abs(spots[i].z - spots[j].z);
        expect(dx >= 0.025 || dz >= 0.05).toBe(true);
      }
    });
  }
});
