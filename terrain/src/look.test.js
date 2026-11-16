import { describe, it, expect } from "vitest";
import { coverOf, joinRings, lookFromOsm, lookQuery } from "./look-osm.js";
import { coverGrid, distanceToWater, COVER, ringArea } from "./cover.js";
import { bands, groundRGB, COLOURS, hash01 } from "./palette.js";
import { localFrame } from "./tmerc.js";
import { latLonBox } from "./fetch-data.js";
import { GRID, OSM_DATE } from "./ucluelet.js";

describe("coverOf", () => {
  it("says what the ground is for every tag it knows, and nothing for the rest", () => {
    const table = [
      [{ natural: "wood" }, "wood"], [{ landuse: "forest" }, "wood"], [{ natural: "wetland" }, "wetland"], [{ natural: "beach" }, "beach"], [{ natural: "shingle" }, "beach"],
      [{ natural: "bare_rock" }, "rock"], [{ natural: "water" }, "lake"], [{ landuse: "reservoir" }, "lake"], [{ natural: "scrub" }, "scrub"], [{ natural: "heath" }, "scrub"],
      [{ landuse: "industrial" }, "yard"], [{ landuse: "quarry" }, "yard"], [{ landuse: "military" }, "yard"], [{ landuse: "residential" }, "residential"],
      [{ landuse: "grass" }, "grass"], [{ leisure: "park" }, "grass"], [{ natural: "grassland" }, "grass"], [{ landuse: "cemetery" }, "grass"],
      [{ leisure: "park", natural: "wood" }, "wood"], [{ natural: "peak" }, null], [{ leisure: "marina" }, null], [{ building: "yes" }, null], [{}, null],
    ];
    for (const [tags, want] of table) expect(coverOf(tags)).toBe(want);
  });
});

describe("joinRings", () => {
  it("joins ways end to end, either way round and in any order, into closed rings; drops what can't close", () => {
    const rings = joinRings([[[0, 0], [10, 0]], [[10, 10], [0, 10], [0, 0]], [[10, 10], [10, 0]], [[50, 50], [60, 50]]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(ringArea(rings[0])).toBe(100);
  });
});

describe("lookFromOsm", () => {
  const frame = localFrame({ lat: 48.95, lon: -125.558 });
  const ll = (x, z) => {
    const [lat, lon] = frame.toLatLon(x, z);
    return { lat, lon };
  };
  const sq = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]].map(([a, b]) => ll(a, b));
  const json = {
    elements: [
      { type: "way", id: 9, tags: { building: "house", "building:levels": "2" }, nodes: [1, 2, 3, 4, 1], geometry: sq(0, 0, 10) },
      { type: "way", id: 3, tags: { natural: "wood" }, nodes: [5, 6, 7, 8, 5], geometry: sq(-100, -100, 200) },
      { type: "way", id: 4, tags: { landuse: "residential" }, nodes: [5, 6, 7], geometry: sq(0, 0, 50).slice(0, 3) },
      { type: "relation", id: 2, tags: { type: "multipolygon", natural: "wood" }, members: [{ type: "way", role: "outer", geometry: sq(300, 300, 100).slice(0, 3) }, { type: "way", role: "outer", geometry: sq(300, 300, 100).slice(2) }, { type: "way", role: "inner", geometry: sq(320, 320, 10) }] },
      { type: "relation", id: 1, tags: { type: "multipolygon", building: "yes" }, members: [{ type: "way", role: "outer", geometry: sq(500, 500, 10) }, { type: "way", role: "outer", geometry: sq(520, 500, 10) }] },
    ],
  };
  const look = lookFromOsm(json, frame, { osmBase: OSM_DATE });
  it("keeps buildings (a multipolygon's every outer ring) and covered areas with their holes, sorted by id, in centimetres", () => {
    expect(look.osmBase).toBe(OSM_DATE);
    expect(look.buildings.map((b) => b.id)).toEqual(["relation/1#0", "relation/1#1", "way/9"]);
    expect(look.buildings[2]).toMatchObject({ kind: "house", levels: 2 });
    expect(look.areas.map((a) => [a.id, a.cover, a.rings.length, a.holes.length])).toEqual([["relation/2", "wood", 1, 1], ["way/3", "wood", 1, 0]]);
    for (const b of look.buildings) for (const [x, z] of b.points) (expect(Math.round(x * 100) / 100).toBe(x), expect(Math.round(z * 100) / 100).toBe(z));
  });
  it("makes the same bytes from the same OSM", () => {
    expect(JSON.stringify(lookFromOsm(structuredClone(json), frame, { osmBase: OSM_DATE }))).toBe(JSON.stringify(look));
  });
});

describe("lookQuery", () => {
  it("is, for Ucluelet's box and date, exactly the query whose answer was checked (a recording replays by its text)", () => {
    const q = lookQuery(latLonBox(GRID, localFrame({ lat: 48.95, lon: -125.558 }), 600), { date: OSM_DATE });
    expect(q.split("\n")[0]).toBe('[out:json][timeout:180][date:"2026-11-16T05:30:00Z"];');
    expect(q).toContain('  way["building"](48.822240,-125.613232,49.017427,-125.316840);\n');
    expect(q.endsWith(");\nout geom;\n")).toBe(true);
    expect(q.split("\n")).toHaveLength(22);
    expect(() => lookQuery({ south: 0, west: 0, north: 1, east: 1 }, { date: "yesterday" })).toThrow(/must be like/);
  });
});

describe("coverGrid", () => {
  const grid = { n: 17, cell: 10, x0: -80, z0: -80 };
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const look = {
    areas: [
      { id: "way/1", cover: "residential", rings: [rect(-75, -75, 75, 75)], holes: [] },
      { id: "way/2", cover: "grass", rings: [rect(-25, -25, 25, 25)], holes: [] },
      { id: "way/3", cover: "wood", rings: [rect(30, -75, 75, 75)], holes: [rect(45, -15, 65, 15)] },
    ],
  };
  it("paints the larger first, so a smaller area wins where they overlap, and leaves a hole as the larger had it: at every node", () => {
    const c = coverGrid(grid, look);
    const inside = (r, x, z) => x > r[0][0] && x < r[1][0] && z > r[0][1] && z < r[2][1];
    for (let j = 0; j < grid.n; j++) for (let i = 0; i < grid.n; i++) {
      const x = grid.x0 + i * grid.cell, z = grid.z0 + j * grid.cell;
      let want = COVER.none;
      if (inside(rect(-75, -75, 75, 75), x, z)) want = COVER.residential;
      if (inside(rect(30, -75, 75, 75), x, z) && !inside(rect(45, -15, 65, 15), x, z)) want = COVER.wood;
      if (inside(rect(-25, -25, 25, 25), x, z)) want = COVER.grass;
      expect(c[j * grid.n + i]).toBe(want);
    }
  });
});

describe("distanceToWater", () => {
  it("is within 8.3% above the true distance at every node, and never below it (to float32)", () => {
    const n = 21, cell = 5;
    const label = new Int8Array(n * n).fill(1);
    const wet = [[10, 10], [3, 17]];
    for (const [i, j] of wet) label[j * n + i] = -1;
    const d = distanceToWater(n, label, cell);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const e = Math.min(...wet.map(([a, b]) => Math.hypot(i - a, j - b))) * cell;
      expect(d[j * n + i]).toBeGreaterThanOrEqual(e * (1 - 1e-6)); // (float32)
      expect(d[j * n + i]).toBeLessThanOrEqual(e * 1.0824 + 1e-9);
    }
  });
});

describe("the ground's palette", () => {
  const ukee = { MLLW: -1.33, MHHW: 1.22, HHWLT: 1.93 }, cadboro = { MLLW: -1.22, MHHW: 0.84, HHWLT: 1.2 };
  it("bands the shore by the place's own tide: each band's top above the one before, kelp to MLLW, barnacle to MHHW", () => {
    for (const tide of [ukee, cadboro]) {
      const b = bands(tide);
      for (let k = 1; k < b.length; k++) expect(b[k][0]).toBeGreaterThan(b[k - 1][0]);
      expect(b[0]).toEqual([tide.MLLW, "kelp"]);
      expect(b[3]).toEqual([tide.MHHW, "barnacle"]);
      // the middle of each band is that band's colour on bare rock
      const hex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      for (let k = 1; k < b.length; k++) expect(hex(groundRGB((b[k - 1][0] + b[k][0]) / 2, COVER.none, 0, tide, COLOURS, -1))).toBe(COLOURS[b[k][1]]);
    }
  });
  it("darkens the sea floor with depth, and draws a beach above the water as beach, not rock", () => {
    const lum = (h) => groundRGB(h, COVER.none, 0, ukee, COLOURS, -1).reduce((a, b) => a + b, 0);
    for (let d = 3; d < 300; d += 3) expect(lum(-d - 3)).toBeLessThanOrEqual(lum(-d) + 1e-9);
    expect(groundRGB(1.5, COVER.beach, 0, ukee, COLOURS, -1).map(Math.round)).toEqual([0x7d, 0x77, 0x6c]);
  });
  it("varies a node's colour by its index alone, by at most 6%", () => {
    for (let k = 0; k < 2000; k++) expect(Math.abs(hash01(k, 7) - hash01(k, 7))).toBe(0), expect(hash01(k, 7)).toBeLessThan(1);
  });
});
