// Hand-worked sail-plan cases. Each figure is worked on paper in the comment
// beside it; tolerances are stated per case.

import { describe, it, expect } from "vitest";
import { buildSailPlan, polygonArea, polygonCentroid, combineCE, clipAbove, jOf } from "./sailplan.js";

const deg = Math.PI / 180;

/** A rig with the forestay at the stem, datum at the origin (stem (0,0), flat sheer at z = 0). */
const rig = (over = {}) => ({
  type: "masthead",
  mast: { aftOfStem: 4, rakeDeg: 0, stepped: "deck" },
  I: 12,
  P: 10,
  E: 4,
  BAS: 1,
  ISP: null,
  forestayAftOfStem: 0,
  main: { roach: 0, reefs: [] },
  headsail: null,
  staysail: null,
  ...over,
});

describe("polygon helpers", () => {
  it("a unit square's area and centroid, either winding", () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(polygonArea(sq)).toBeCloseTo(1, 12);
    expect(polygonArea([...sq].reverse())).toBeCloseTo(-1, 12);
    expect(polygonCentroid([...sq].reverse())).toEqual([0.5, 0.5]);
  });
  it("clips a triangle above a line", () => {
    // triangle (0,0) (2,0) (0,2), above z = 1 is the triangle (0,1) (1,1) (0,2): area 0.5
    const t = clipAbove([[0, 0], [2, 0], [0, 2]], 1);
    expect(Math.abs(polygonArea(t))).toBeCloseTo(0.5, 12);
  });
});

describe("main", () => {
  it("triangle main P = 10, E = 4: 20 m², CE E/3 aft of the mast and BAS + P/3 up", () => {
    // ½·10·4 = 20. Vertices: tack (−4, 1), head (−4, 11), clew (−8, 1).
    // Centroid x = (−4 − 4 − 8)/3 = −16/3, i.e. 4/3 = E/3 aft of the mast at x = −4.
    // Centroid z = (1 + 11 + 1)/3 = 13/3 = BAS + P/3.
    const plan = buildSailPlan(rig({ type: "cat" }));
    const main = plan.sails[0];
    expect(main.areaM2).toBeCloseTo(20, 12);
    expect(plan.mast.partners[0] - main.ce[0]).toBeCloseTo(4 / 3, 12);
    expect(main.ce[1]).toBeCloseTo(1 + 10 / 3, 12);
    expect(plan.rule.mainM2).toBe(20);
  });

  it("roach is a fraction of the triangle: ½·P·E·(1 + roach)", () => {
    // 20 · 1.12 = 22.4 exactly (the parabolic bulge is sized for its inscribed polygon)
    const main = buildSailPlan(rig({ type: "cat", main: { roach: 0.12, reefs: [] } })).sails[0];
    expect(main.areaM2).toBeCloseTo(22.4, 9);
    // the roach is on the leech: the CE moves aft and up from the triangle's
    expect(main.ce[0]).toBeLessThan(main.triangle.ce[0]);
    expect(main.ce[1]).toBeGreaterThan(main.triangle.ce[1]);
  });

  it("a reef of 30% of P leaves (1 − 0.3)² of a triangle, its tack at the gooseneck", () => {
    // the sail above a line 3 m up the luff is a similar triangle scaled 0.7: 20·0.49 = 9.8 m²
    const main = buildSailPlan(rig({ type: "cat", main: { roach: 0, reefs: [0.3] } })).sails[0];
    const r = main.reefs[0];
    expect(r.areaM2).toBeCloseTo(9.8, 9);
    // brought down to the boom: its lowest points sit at BAS (z = 1), the head at 1 + 7
    const zs = r.polygon.map((p) => p[1]);
    expect(Math.min(...zs)).toBeCloseTo(1, 12);
    expect(Math.max(...zs)).toBeCloseTo(8, 12);
    // its CE: E' = 2.8 → 0.9333 aft of the mast; z = 1 + 7/3
    expect(r.ce[0]).toBeCloseTo(-4 - 2.8 / 3, 9);
    expect(r.ce[1]).toBeCloseTo(1 + 7 / 3, 9);
  });

  it("5° of rake moves the main's CE aft by its height above the partners × sin 5°", () => {
    // The mast turns about the partners; the boom stays level. The triangle
    // main's CE sits h = BAS + P/3 = 13/3 up the mast and E/3 aft along the
    // boom, so it moves aft by exactly (13/3)·sin 5° = 0.377675 m and down by
    // (13/3)(1 − cos 5°) = 0.016488 m.
    const t0 = buildSailPlan(rig({ type: "cat" })).sails[0];
    const t5 = buildSailPlan(rig({ type: "cat", mast: { aftOfStem: 4, rakeDeg: 5 } })).sails[0];
    const h = 13 / 3;
    expect(t5.ceAbovePartnersM).toBeCloseTo(h, 9);
    expect(t0.ce[0] - t5.ce[0]).toBeCloseTo(0.377675, 6);
    expect(t0.ce[0] - t5.ce[0]).toBeCloseTo(h * Math.sin(5 * deg), 9);
    expect(t0.ce[1] - t5.ce[1]).toBeCloseTo(h * (1 - Math.cos(5 * deg)), 9);
    // With roach the sail is not rigid under rake (the leech turns, the bulge
    // follows it, and the triangle it is a fraction of shrinks by cos 5°), so
    // the rule holds to within 5 mm, using the raked CE's own height.
    const r5 = buildSailPlan(rig({ type: "cat", mast: { aftOfStem: 4, rakeDeg: 5 }, main: { roach: 0.15, reefs: [] } })).sails[0];
    const r0 = buildSailPlan(rig({ type: "cat", main: { roach: 0.15, reefs: [] } })).sails[0];
    expect(Math.abs(r0.ce[0] - r5.ce[0] - r5.ceAbovePartnersM * Math.sin(5 * deg))).toBeLessThan(0.005);
  });

  it("rake moves the masthead aft by its height × sin(rake)", () => {
    const p = buildSailPlan(rig({ mast: { aftOfStem: 4, rakeDeg: 3 } }));
    // mast height max(I 12, BAS + P 11) = 12
    expect(p.mast.heightM).toBe(12);
    expect(p.mast.partners[0] - p.mast.head[0]).toBeCloseTo(12 * Math.sin(3 * deg), 12);
  });
});

describe("foretriangle and headsail", () => {
  it("foretriangle I = 12, J = 4: 24 m², rule and polygon", () => {
    const p = buildSailPlan(rig());
    expect(p.J).toBe(4);
    expect(p.rule.foretriangleM2).toBe(24);
    expect(p.foretriangle.areaM2).toBeCloseTo(24, 12);
    // centroid of (0,0) (−4,12) (−4,0): (−8/3, 4)
    expect(p.foretriangle.ce[0]).toBeCloseTo(-8 / 3, 12);
    expect(p.foretriangle.ce[1]).toBeCloseTo(4, 12);
  });

  it("J follows the mast: aftOfStem − forestayAftOfStem; a bowsprit lengthens it", () => {
    expect(jOf(rig())).toBe(4);
    expect(jOf(rig({ forestayAftOfStem: -1.5 }))).toBe(5.5);
    expect(jOf(rig({ type: "cat" }))).toBe(0);
  });

  it("the designer's CE is the area-weighted centroid of main triangle and foretriangle, to 1e-9", () => {
    // main 20 m² at (−16/3, 13/3); foretriangle 24 m² at (−8/3, 4)
    // x = (20·−16/3 + 24·−8/3)/44 = (−106.667 − 64)/44 = −3.878788
    // z = (20·13/3 + 24·4)/44 = (86.667 + 96)/44 = 4.151515
    const p = buildSailPlan(rig());
    expect(p.designer.areaM2).toBe(44);
    expect(p.designer.ce[0]).toBeCloseTo((20 * (-16 / 3) + 24 * (-8 / 3)) / 44, 9);
    expect(p.designer.ce[1]).toBeCloseTo((20 * (13 / 3) + 24 * 4) / 44, 9);
    const c = combineCE([{ areaM2: 1, ce: [0, 0] }, { areaM2: 3, ce: [4, 8] }]);
    expect(c.ce).toEqual([3, 6]);
  });

  it("a headsail of LP is ½·LP·luff, its clew LP from the luff", () => {
    // luff = √(12² + 4²) = 12.649111; LP 6 → 37.947332 m²
    const p = buildSailPlan(rig({ headsail: { kind: "genoa", LP: 6, clewHeight: 0.5, furl: 0 } }));
    const jib = p.sails.find((s) => s.id === "jib");
    expect(jib.luffM).toBeCloseTo(Math.hypot(12, 4), 12);
    expect(jib.areaM2).toBeCloseTo(0.5 * 6 * Math.hypot(12, 4), 9);
    expect(jib.lpPercent).toBeCloseTo(150, 9);
    const [t, h, c] = jib.polygon;
    const d = [h[0] - t[0], h[1] - t[1]];
    const dist = Math.abs(d[0] * (c[1] - t[1]) - d[1] * (c[0] - t[0])) / Math.hypot(...d);
    expect(dist).toBeCloseTo(6, 9);
    expect(c[1]).toBeCloseTo(0.5, 12);
    expect(c[0]).toBeLessThan(t[0]); // aft of the tack
    expect(p.estimated).toEqual([]);
  });

  it("a headsail with no clew height says its clew height is estimated", () => {
    const p = buildSailPlan(rig({ headsail: { kind: "jib", LP: 4, clewHeight: null, furl: 0 } }));
    expect(p.estimated).toContain("headsail clew height");
  });

  it("a cutter carries a staysail inside the foretriangle; the designer's area ignores it", () => {
    const p = buildSailPlan(
      rig({ type: "cutter", headsail: { kind: "jib", LP: 4, clewHeight: 1, furl: 0 }, staysail: { I2: 9, J2: 2.5, LP2: 2.2, clewHeight: 0.8 } }),
    );
    const st = p.sails.find((s) => s.id === "staysail");
    expect(st.areaM2).toBeCloseTo(0.5 * 2.2 * Math.hypot(9, 2.5), 9);
    expect(p.designer.areaM2).toBe(44);
    expect(p.actual.areaM2).toBeCloseTo(20 + 0.5 * 4 * Math.hypot(12, 4) + st.areaM2, 9);
  });

  it("masthead and fractional rigs say when I contradicts the type", () => {
    expect(buildSailPlan(rig({ I: 8 })).warnings.join(" ")).toMatch(/fractional/);
    expect(buildSailPlan(rig({ type: "fractional", I: 12 })).warnings.join(" ")).toMatch(/masthead/);
    expect(buildSailPlan(rig({ type: "fractional", I: 8 })).warnings).toEqual([]);
  });
});
