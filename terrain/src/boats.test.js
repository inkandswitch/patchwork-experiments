import { describe, it, expect } from "vitest";
import { mooredBoats, boatMesh, BOATS } from "./boats.js";
import { floatPiles, structureMesh, KINDS } from "./structures.js";
import { soup } from "./shapes.js";

describe("boats on the floats (dressing)", () => {
  const floats = [
    { id: "way/1", kind: "pier", floating: true, area: false, width: null, points: [[0, 0], [120, 0], [120, 60]] },
    { id: "way/2", kind: "pier", floating: false, area: false, width: null, points: [[0, 50], [100, 50]] },
    { id: "way/3", kind: "breakwater", floating: false, area: true, width: null, points: [[0, 90], [10, 90], [10, 95]] },
  ];
  const boats = mooredBoats(floats);
  it("moors boats only along floats, beside them (half the float, half the boat and 0.4 m off its line), at the middle of 12 m slips", () => {
    expect(boats.length).toBeGreaterThan(0);
    for (const b of boats) {
      expect(b.id.startsWith("way/1#")).toBe(true);
      const B = BOATS[b.type];
      expect(b.length).toBeGreaterThanOrEqual(B.length[0]);
      expect(b.length).toBeLessThanOrEqual(B.length[1] + 1e-9);
      const off = 1.2 + b.beam / 2 + 0.4;
      const onFirst = Math.abs(Math.abs(b.z) - off) < 0.02 && b.x > 0 && b.x < 120;
      const onSecond = Math.abs(Math.abs(b.x - 120) - off) < 0.02 && b.z > 0 && b.z < 60;
      expect(onFirst || onSecond).toBe(true);
      if (onFirst) expect(((b.x - 6) / 12) % 1).toBeCloseTo(0, 6);
    }
  });
  it("fills each slip by its own hash: the same boats every time, and the same whatever other floats there are", () => {
    expect(mooredBoats(structuredClone(floats))).toEqual(boats);
    expect(mooredBoats([floats[0]])).toEqual(boats);
  });
  it("draws them as a soup, a few dozen triangles a boat", () => {
    const m = boatMesh(boats);
    expect(m.positions.length / 9 / boats.length).toBeGreaterThan(20);
    expect(m.positions.length / 9 / boats.length).toBeLessThan(120);
  });
  it("draws every kind: a troller's poles about 1.5 times her length, a sailboat's mast about 1.3, a seiner's short mast about 0.55, each above her (every kind, both headings)", () => {
    for (const type of Object.keys(BOATS)) for (const heading of [0, 2]) {
      const b = { id: `t-${type}`, type, x: 0, z: 0, heading, length: 10, beam: BOATS[type].beam * 10, trim: BOATS[type].trim[0] };
      const m = boatMesh([b]);
      let top = -Infinity, bottom = Infinity;
      for (let v = 1; v < m.positions.length; v += 3) (top = Math.max(top, m.positions[v])), (bottom = Math.min(bottom, m.positions[v]));
      expect(bottom).toBeCloseTo(-0.6, 6);
      const want = BOATS[type].poles ? 1.5 * 10 * 0.94 : BOATS[type].mast ? BOATS[type].mast * 10 : BOATS[type].derrick ? BOATS[type].derrick * 10 : 0;
      if (want) expect(top).toBeGreaterThan(want);
      else expect(top).toBeLessThan(5);
    }
  });
  it("stands a float among its guide piles: at its edges, alternating sides, at most `every` apart, 5 to 7 m tall, from 6 m under (every pile)", () => {
    const sp = soup();
    floatPiles(sp, floats[0], 2.4, KINDS.float.piles);
    const m = sp.done();
    // each pile a six-sided cylinder: 6 sides of two triangles and two caps of six
    const per = 6 * 4 * 9;
    expect(m.positions.length % per).toBe(0);
    const piles = m.positions.length / per;
    expect(piles).toBe(9 + 4);
    for (let q = 0; q < piles; q++) {
      const P = m.positions.subarray(q * per, (q + 1) * per);
      let cx = 0, cz = 0, lo = Infinity, hi = -Infinity;
      for (let v = 0; v < P.length; v += 3) (cx += P[v] / (P.length / 3)), (cz += P[v + 2] / (P.length / 3)), (lo = Math.min(lo, P[v + 1])), (hi = Math.max(hi, P[v + 1]));
      expect(lo).toBeCloseTo(-6, 6);
      expect(hi).toBeGreaterThanOrEqual(5);
      expect(hi).toBeLessThanOrEqual(7);
      // 1.1 m off the float's line, on one leg or the other
      const onFirst = Math.abs(Math.abs(cz) - 1.1) < 0.05 && cx > -0.1 && cx < 120.1;
      const onSecond = Math.abs(Math.abs(cx - 120) - 1.1) < 0.05 && cz > -0.1 && cz < 60.1;
      expect(onFirst || onSecond).toBe(true);
    }
    // a fixed pier gets none
    expect(structureMesh([floats[1]]).positions.length).toBe(structureMesh([{ ...floats[1], id: "x" }]).positions.length);
  });
});

import { paintOf, WORKING, SPAR } from "./boats.js";
describe("the fleet painted the right way round (every boat of every type over 400 slips)", () => {
  // 200 slips a side of a long float: every type of the MIX, by hash
  const long = [{ id: "way/9", kind: "pier", floating: true, area: false, width: 2.4, points: [[0, 0], [2400, 0]] }];
  const fleet = mooredBoats(long, { taken: 1 });
  it("moors every slip when the share is 1, and a place's share where it says (takenAt), by the float's first point", () => {
    expect(fleet.length).toBe(2 * 200);
    const none = mooredBoats(long, { taken: 1, takenAt: (x, z) => (x === 0 && z === 0 ? 0 : null) });
    expect(none.length).toBe(0);
    expect(mooredBoats(long, { taken: 0, takenAt: () => null }).length).toBe(0);
  });
  it("paints a working boat's hull navy, green, red, black or light blue (about 60%) or white, her wheelhouse and its top white or pale grey, never the trim colour, red bottom paint under a white boot stripe, and hangs 2 to 4 buoys", () => {
    const working = fleet.filter((b) => BOATS[b.type].working);
    expect(new Set(working.map((b) => b.type))).toEqual(new Set(["troller", "seiner"]));
    let painted = 0;
    for (const b of working) {
      const p = paintOf(b);
      expect([...WORKING.hulls, WORKING.white]).toContain(p.hull);
      if (p.hull !== WORKING.white) painted++;
      expect(WORKING.houses).toContain(p.house);
      expect(p.roof).toBe(p.house);
      expect(p.bottom).toBe(WORKING.bottom);
      expect(p.stripe).toBe(WORKING.stripe);
      expect(p.buoys).toBeGreaterThanOrEqual(2);
      expect(p.buoys).toBeLessThanOrEqual(4);
      expect(BOATS[b.type].trim).toContain(b.trim);
      expect(p.roof).not.toBe(b.trim);
    }
    const share = painted / working.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.75);
    // every hull colour occurs
    expect(new Set(working.map((b) => paintOf(b).hull)).size).toBe(WORKING.hulls.length + 1);
  });
  it("roofs no boat of any type in her trim colour but a sportfisher's dark top (every boat)", () => {
    for (const b of fleet) {
      const p = paintOf(b);
      if (b.type === "sportfisher") expect(p.roof).toBe(b.trim);
      else expect(WORKING.houses).toContain(p.roof);
    }
  });
  it("draws the paint it says: the roof's colour on the wheelhouse top, the buoys' orange, and every spar at least 0.12 m across (every type, both headings)", () => {
    const lin = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    expect(SPAR).toBeGreaterThanOrEqual(0.12);
    for (const b of fleet.slice(0, 60)) {
      const m = boatMesh([b]);
      const cols = new Set();
      for (let v = 0; v < m.colors.length; v += 3) cols.add([m.colors[v], m.colors[v + 1], m.colors[v + 2]].map((c) => c.toFixed(4)).join(","));
      const has = (h) => cols.has(lin(h).map((c) => Math.fround(c).toFixed(4)).join(","));
      const p = paintOf(b);
      expect(has(p.roof)).toBe(true);
      expect(has(p.hull)).toBe(true);
      if (p.buoys) expect(has(WORKING.buoy)).toBe(true);
      else expect(has(WORKING.buoy)).toBe(false);
    }
  });
});

import { PIER_MOORING, MIX } from "./boats.js";
import { insideRing } from "./terrain-sample.js";
describe("every pier and float lined with boats", () => {
  // the ground falls away from the shore (z = 0) at 1 in 8: 2 m deep from z = 16
  const groundAt = (x, z) => 1 - z / 8;
  const piers = { within: () => true, taken: PIER_MOORING.taken, depth: 2, groundAt, datum: 0 };
  // twelve piers straight out from the shore, 60 to 170 m long, and twelve area piers (a wharf's outline) out in the water
  const lines = Array.from({ length: 12 }, (_, q) => ({ id: `way/${100 + q}`, kind: "pier", points: [[q * 300, 0], [q * 300 + 10, 60 + q * 10]] }));
  const areas = Array.from({ length: 12 }, (_, q) => ({ id: `way/${200 + q}`, kind: "pier", area: true, points: q % 2 ? [[q * 300, 60], [q * 300 + 40, 60], [q * 300 + 40, 90], [q * 300, 90]] : [[q * 300, 90], [q * 300 + 40, 90], [q * 300 + 40, 60], [q * 300, 60]] }));
  const floats = Array.from({ length: 12 }, (_, q) => ({ id: `way/${300 + q}`, kind: "pier", floating: true, points: [[q * 300, 120], [q * 300 + 80, 120]] }));
  const boats = mooredBoats([...lines, ...areas, ...floats], { piers });
  const of = (st) => boats.filter((b) => b.id.startsWith(`${st.id}#`));
  it("puts a boat only where the water under her, at her ends and her middle, is at least the depth (every pier boat)", () => {
    for (const b of boats.filter((b) => b.pier)) {
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
      for (const f of [-0.45, 0, 0.45]) expect(groundAt(b.x + fx * f * b.length, b.z + fz * f * b.length)).toBeLessThanOrEqual(-2 + 0.02);
    }
  });
  it("lines every pier: at least one boat per 25 m of edge where the water is deep enough alongside (every pier and float)", () => {
    for (const st of lines) {
      // the deep part of its two sides
      const L = Math.hypot(10, 60 + (Number(st.id.slice(4)) - 100) * 10), deep = L * (1 - (24 + 6) / (60 + (Number(st.id.slice(4)) - 100) * 10));
      expect(of(st).length, st.id).toBeGreaterThanOrEqual(Math.floor((2 * deep) / 25));
    }
    for (const st of areas) expect(of(st).length, st.id).toBeGreaterThanOrEqual(Math.floor((2 * (40 + 30)) / 25));
    for (const st of floats) expect(of(st).length, st.id).toBeGreaterThanOrEqual(Math.floor((2 * 80) / 25));
  });
  it("keeps an area pier's boats outside its outline, whichever way it winds (every boat)", () => {
    for (const st of areas) for (const b of of(st)) expect(insideRing(st.points, b.x, b.z)).toBe(false);
    expect(areas.every((st) => of(st).length > 0)).toBe(true);
  });
  it("moors no boat along a fixed pier unless the place asks (piers: null), and takes a place's own mix where it gives one (every slip)", () => {
    expect(mooredBoats([...lines, ...areas]).length).toBe(0);
    const mix = [["whalewatch", 1], ["watertaxi", 1]];
    const mixed = mooredBoats([...lines, ...floats], { piers, mixAt: (x) => (x < 1500 ? mix : null) });
    for (const b of mixed) {
      const x0 = Number(b.id.match(/way\/\d(\d\d)/)[1]) * 300;
      if (x0 < 1500) expect(["whalewatch", "watertaxi"]).toContain(b.type);
      else expect(MIX.map(([t]) => t)).toContain(b.type);
    }
    expect(new Set(mixed.map((b) => b.type)).has("whalewatch")).toBe(true);
  });
});
