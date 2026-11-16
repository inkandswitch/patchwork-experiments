// Drift logs (dressing): every log checked, on a made-up straight shore.
import { describe, it, expect } from "vitest";
import { driftLogs, logMesh, keyHash, DRIFT } from "./shore-dressing.js";

// a shore along z = 0 from x = 0 to 2000, the sea to the north (−z), the ground rising 1 in 20 inland (+z)
const pieces = Array.from({ length: 100 }, (_, q) => ({ a: [q * 20, 0], b: [q * 20 + 20, 0], sea: [0, -1], key: `way/7#${q}` }));
const groundAt = (x, z) => (x < -50 || x > 2050 ? null : z / 20);
const circles = [{ x: 600, z: 0, radius: 500 }];
const logs = driftLogs(pieces, groundAt, { circles, level: 1.93 });

describe("drift logs", () => {
  it("lie only off pieces inside the circles, by each piece's own hash: a log where it's under the chance, a second under a third of it (every piece)", () => {
    for (const pc of pieces) {
      const mx = (pc.a[0] + pc.b[0]) / 2;
      const mine = logs.filter((g) => g.key.startsWith(`${pc.key}#`));
      const want = Math.abs(mx - 600) <= 500 && keyHash(pc.key, 1) < DRIFT.chance ? (keyHash(pc.key, 2) < DRIFT.chance / 3 ? 2 : 1) : 0;
      expect(mine).toHaveLength(want);
    }
    expect(logs.length).toBeGreaterThan(5);
  });
  it("lies at the highest tide's line, along the shore ±25°, 8 to 20 m long, 0.5 to 1 m across (every log)", () => {
    for (const g of logs) {
      const mid = [(g.a[0] + g.b[0]) / 2, (g.a[2] + g.b[2]) / 2];
      // the line is at z = 38.6; the log's middle a step and 0.6 m seaward of it
      expect(mid[1]).toBeGreaterThan(38.6 - 1.7);
      expect(mid[1]).toBeLessThanOrEqual(38.6);
      const len = Math.hypot(g.b[0] - g.a[0], g.b[2] - g.a[2]);
      expect(len).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(len).toBeLessThanOrEqual(20 + 1e-6);
      expect(Math.abs(Math.atan2(g.b[2] - g.a[2], g.b[0] - g.a[0]))).toBeLessThanOrEqual((25 * Math.PI) / 180 + 1e-9);
      expect(2 * g.r).toBeGreaterThanOrEqual(0.5);
      expect(2 * g.r).toBeLessThanOrEqual(1);
      // resting on the ground at each end
      expect(g.a[1]).toBeCloseTo(groundAt(g.a[0], g.a[2]) + g.r * 0.6, 6);
    }
  });
  it("is the same every time, and none where the ground never reaches the level within reach", () => {
    expect(driftLogs(structuredClone(pieces), groundAt, { circles, level: 1.93 })).toEqual(logs);
    expect(driftLogs(pieces, groundAt, { circles, level: 10 })).toEqual([]);
    expect(driftLogs(pieces, groundAt, { circles: [], level: 1.93 })).toEqual([]);
  });
  it("draws each log as a capped six-sided prism (24 triangles: 6 sides of two, two caps of six)", () => {
    expect(logMesh(logs).positions.length / 9).toBe(24 * logs.length);
  });
});

describe("drift logs half buried, their ends darker (a place's)", () => {
  const o = { circles, level: 1.93, diameter: [0.8, 1.2], bury: 0 };
  const heavy = driftLogs(pieces, groundAt, o);
  it("lies with its axis on the ground (half buried), 0.8 to 1.2 m across (every log)", () => {
    expect(heavy.length).toBe(logs.length);
    for (const g of heavy) {
      expect(g.a[1]).toBeCloseTo(groundAt(g.a[0], g.a[2]), 6);
      expect(2 * g.r).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(2 * g.r).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });
  it("draws its ends `cap` of its sides' colour (every cap triangle)", () => {
    const m = logMesh(heavy, "#a8a49a", 0.55);
    // each log: 6 segments of [quad (2 tris), cap a, cap b]
    for (let g = 0; g < heavy.length; g++) for (let k = 0; k < 6; k++) {
      const t0 = g * 24 + k * 4;
      const side = m.colors[t0 * 9 + 1], capA = m.colors[(t0 + 2) * 9 + 1], capB = m.colors[(t0 + 3) * 9 + 1];
      expect(capA).toBeCloseTo(capB, 6);
      // the side's shading is 0.82 × (1 + up·0.25), the cap exactly 0.55 of the log's colour
      expect(capA).toBeLessThan(side);
    }
  });
});
