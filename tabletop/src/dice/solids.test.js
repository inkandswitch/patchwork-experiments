// The shapes, checked whole: every claim solids.js makes about a solid is
// checked for every shape, every side and every outcome. Nothing is sampled.
import { describe, it, expect } from "vitest";
import { COIN_SIDES, COIN_THICK, SHAPES, hullFaces, neighbours, shapeName, shapeSides, solid, standingBounds } from "./solids.js";
import { add, cross, dot, len, scale, sub, unit } from "./m3.js";

const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, coin: 2 };
/** How many corners each side has, and how many corners and sides the solid has. */
const FORM = { d4: [4, 4, 3], d6: [8, 6, 4], d8: [6, 8, 3], d10: [12, 10, 4], d12: [20, 12, 5], d20: [12, 20, 3] };

describe("the shapes", () => {
  it("are a d4, d6, d8, d10, d12, d20 and a coin", () => {
    expect(SHAPES).toEqual(["d4", "d6", "d8", "d10", "d12", "d20", "coin"]);
    for (const s of SHAPES) {
      expect(shapeSides(s)).toBe(SIDES[s]);
      expect(solid(s).outcomes).toHaveLength(SIDES[s]);
      expect(shapeName(s)).toBeTruthy();
    }
    expect(solid("d7")).toBeNull();
    expect(solid("constructor")).toBeNull();
  });

  it("have the corners and sides their names say", () => {
    for (const [shape, [v, f, n]] of Object.entries(FORM)) {
      const s = solid(shape);
      expect([shape, s.verts.length, s.polys.length]).toEqual([shape, v, f]);
      for (const p of s.polys) expect(p.verts).toHaveLength(n);
    }
    const coin = solid("coin");
    expect(coin.verts).toHaveLength(2 * COIN_SIDES);
    expect(coin.polys.map((p) => p.verts.length).sort((a, b) => a - b)).toEqual([...Array(COIN_SIDES).fill(4), COIN_SIDES, COIN_SIDES]);
  });
});

describe.each(SHAPES)("%s, as a solid", (shape) => {
  const s = solid(shape);

  it("is centred on its middle", () => {
    const sum = s.verts.reduce((a, v) => add(a, v), [0, 0, 0]);
    for (const x of sum) expect(x).toBeCloseTo(0, 9);
  });

  it("has unit normals, all different, each pointing out of a flat side", () => {
    s.polys.forEach((p, i) => {
      expect(len(p.normal)).toBeCloseTo(1, 12);
      expect(p.d).toBeGreaterThan(0);
      // flat: every corner of the side lies in its plane
      for (const v of p.verts) expect(dot(p.normal, s.verts[v])).toBeCloseTo(p.d, 9);
      s.polys.forEach((q, j) => j > i && expect(len(sub(p.normal, q.normal))).toBeGreaterThan(1e-3));
    });
  });

  it("is convex: every corner is on or behind every side", () => {
    for (const p of s.polys) for (const v of s.verts) expect(dot(p.normal, v)).toBeLessThanOrEqual(p.d + 1e-9);
  });

  it("is closed: every edge of a side is another side's, the other way round, and corners − edges + sides = 2", () => {
    const edges = new Map();
    for (const p of s.polys) {
      p.verts.forEach((a, k) => {
        const b = p.verts[(k + 1) % p.verts.length];
        const key = `${a}>${b}`;
        expect(edges.has(key)).toBe(false);
        edges.set(key, true);
      });
    }
    for (const key of edges.keys()) {
      const [a, b] = key.split(">");
      expect(edges.has(`${b}>${a}`)).toBe(true);
    }
    expect(s.verts.length - edges.size / 2 + s.polys.length).toBe(2);
  });

  it("has its sides' corners anticlockwise seen from outside", () => {
    for (const p of s.polys) {
      const pts = p.verts.map((v) => s.verts[v]);
      pts.forEach((a, k) => {
        const b = pts[(k + 1) % pts.length], c = pts[(k + 2) % pts.length];
        expect(dot(cross(sub(b, a), sub(c, b)), p.normal)).toBeGreaterThan(0);
      });
    }
  });

  it("is 1 across: 1 high at rest, or for a coin 1 wide", () => {
    const b = standingBounds(s);
    expect(b.min[1]).toBeCloseTo(0, 12);
    if (shape === "coin") {
      expect(b.max[0] - b.min[0]).toBeCloseTo(1, 9);
      expect(b.max[1]).toBeCloseTo(COIN_THICK, 9);
    } else expect(b.max[1]).toBeCloseTo(1, 9);
  });

  it("shows outcome 0 as it stands, and its outcomes' ups are unit and all different", () => {
    for (const [k, x] of s.outcomes[0].up.entries()) expect(x).toBeCloseTo([0, 1, 0][k], 9);
    s.outcomes.forEach((o, i) => {
      expect(len(o.up)).toBeCloseTo(1, 12);
      s.outcomes.forEach((q, j) => j > i && expect(len(sub(o.up, q.up))).toBeGreaterThan(1e-3));
    });
  });

  it("rests steadily on every outcome's side: its middle is over the inside of that side, `rest` above it", () => {
    for (const o of s.outcomes) {
      const p = s.polys[o.poly];
      expect(len(add(p.normal, o.up))).toBeLessThan(1e-9);
      expect(o.rest).toBeCloseTo(p.d, 12);
      // the middle, dropped onto the side, is inside every edge
      const foot = scale(p.normal, p.d);
      const pts = p.verts.map((v) => s.verts[v]);
      pts.forEach((a, k) => {
        const b = pts[(k + 1) % pts.length];
        expect(dot(sub(foot, a), unit(cross(p.normal, sub(b, a))))).toBeGreaterThan(1e-3);
      });
    }
  });

  it("is read from what's on top: a side facing up, or a d4's top corner", () => {
    for (const o of s.outcomes) {
      if (s.read === "face") {
        expect(o.readVert).toBeNull();
        expect(len(sub(s.polys[o.readPoly].normal, o.up))).toBeLessThan(1e-9);
      } else {
        expect(o.readPoly).toBeNull();
        expect(len(sub(unit(s.verts[o.readVert]), o.up))).toBeLessThan(1e-9);
        // the top corner is the one corner not on the side it rests on
        expect(s.polys[o.poly].verts).not.toContain(o.readVert);
      }
    }
    expect(s.read).toBe(shape === "d4" ? "vertex" : "face");
  });

  it("has an opposite for every outcome, each other's, except a d4 (which has none)", () => {
    s.outcomes.forEach((o, i) => {
      if (shape === "d4") return expect(o.opposite).toBeNull();
      expect(o.opposite).not.toBe(i);
      expect(s.outcomes[o.opposite].opposite).toBe(i);
      expect(len(add(s.outcomes[o.opposite].up, o.up))).toBeLessThan(1e-9);
    });
  });

  it("is found again from its own corners: the same sides", () => {
    const again = hullFaces(s.verts.map((v) => [...v]));
    expect(again.map((p) => p.verts)).toEqual(s.polys.map((p) => [...p.verts]));
  });
});

describe("neighbours", () => {
  it("each face of a d20 touches three others, a d6's four, a d12's five, and it goes both ways", () => {
    for (const [shape, n] of [["d20", 3], ["d8", 3], ["d6", 4], ["d10", 4], ["d12", 5]]) {
      const s = solid(shape);
      s.outcomes.forEach((_, i) => {
        const near = neighbours(s, i);
        expect(near).toHaveLength(n);
        for (const j of near) expect(neighbours(s, j)).toContain(i);
      });
    }
  });
});
