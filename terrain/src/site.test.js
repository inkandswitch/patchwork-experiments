import { describe, it, expect } from "vitest";
import { siteMesh } from "./site.js";
import { SITE, LANDMARKS, ORIGIN, GRID, PLACES, HEIGHTS, DATUM, ANCHORAGE, HOME, uclueletDoc, fromCGVD28 } from "./ucluelet.js";
import { localFrame } from "./tmerc.js";
import { latLonBox } from "./fetch-data.js";
import { orientedBox, classOf, buildingMesh, house, simplify, CLASSES } from "./buildings.js";
import { COVER } from "./cover.js";

const frame = localFrame(ORIGIN);
// flat ground at the yard's level on land (south of the shore at z ≈ 0 near the site), the harbour 8 m deep north of it
const groundAt = (x, z) => (z > 0 ? 4.2 : -8);
const site = siteMesh(SITE, LANDMARKS, frame, groundAt, () => 0.5);
const M = site.measures;

describe("the boatyard, against its spec (README, \"Ucluelet\"; the survey and Rising Tide's plans)", () => {
  it("the hangar: 39.1–39.3 by 34.8–34.95 m, 1,369 m², its ridge north-west–south-east, floor +4.20, eave +14.8, ridge +16.01 about MWL, a 4° gable, doors 7.39 m high", () => {
    expect(M.hangar.length).toBeGreaterThan(39.1);
    expect(M.hangar.length).toBeLessThan(39.3);
    expect(M.hangar.span).toBeGreaterThan(34.8);
    expect(M.hangar.span).toBeLessThan(34.95);
    expect(Math.abs(M.hangar.area - 1369)).toBeLessThan(5);
    expect(M.hangar.floor).toBe(4.2);
    expect(M.hangar.ridge).toBe(16.01);
    expect(M.hangar.eave).toBeCloseTo(14.8, 9);
    expect(M.hangar.pitch).toBeGreaterThan(3.5);
    expect(M.hangar.pitch).toBeLessThan(4.5);
    expect(M.hangar.doorHead).toBe(7.39);
    // the ridge runs from the door face (north-west) to the south-east: a true bearing near 157° (158.5° grid less the convergence)
    expect(Math.abs(M.hangar.bearing - 156.8)).toBeLessThan(1);
  });
  it("heights from the survey's CGVD28 become heights about MWL by +0.08 m (CHS 08595)", () => {
    expect(fromCGVD28(4.12)).toBe(4.2);
    expect(fromCGVD28(15.93)).toBe(16.01);
    expect(DATUM.mwlAboveCGVD28).toBe(-0.08);
    expect(M.B.top).toBe(10.69);
    expect(M.D.top).toBe(13.11);
  });
  it("the haul-out pier: two runways about 40 and 39 m long, about north, 12.7 m apart centre to centre, 2.4 m wide, a 10.3 m well, at yard level", () => {
    expect(Math.abs(M.haulout.lengths[0] - 40)).toBeLessThan(1);
    expect(Math.abs(M.haulout.lengths[1] - 39)).toBeLessThan(1);
    expect(Math.abs(M.haulout.spacing - 12.7)).toBeLessThan(0.7);
    expect(M.haulout.width).toBe(2.4);
    expect(Math.abs(M.haulout.well - 10.3)).toBeLessThan(0.7);
    expect(M.haulout.deck).toBe(4.2);
    expect(Math.min(M.haulout.bearing, 360 - M.haulout.bearing)).toBeLessThan(7);
  });
  it("the travel lift straddles the runways (its wheel gauge their spacing where it stands: the schematic's runways aren't quite parallel), its beams clear a 30 ft beam boat", () => {
    expect(Math.abs(M.travelift.gauge - M.haulout.spacing)).toBeLessThan(0.3);
    expect(M.travelift.gauge - 2.4).toBeGreaterThan(9.14);
    expect(M.travelift.clear).toBeLessThan(M.travelift.height);
  });
  it("the existing wharf: 43.9 by 19.5 m at yard level; the pier's north leg 42 m", () => {
    expect(Math.abs(M.wharf.length - 43.9)).toBeLessThan(0.5);
    expect(Math.abs(M.wharf.width - 19.6)).toBeLessThan(0.5);
    expect(Math.abs(M["lpier-leg"].length - 42)).toBeLessThan(1.5);
  });
  it("the dock: its arm at a bearing of 92–96°, 3.6 m wide, floats at +0.5 m; with the gangway, the pier's corner to the schematic's end, 127–146 m", () => {
    expect(M.dock.bearing).toBeGreaterThan(90);
    expect(M.dock.bearing).toBeLessThan(96);
    expect(M.dock.width).toBe(3.6);
    expect(M.dock.top).toBe(0.5);
    expect(M.dock.length + M.gangway.length).toBeGreaterThan(125);
    expect(M.dock.length + M.gangway.length).toBeLessThan(146);
  });
  it("three chargers on the dock, in order along it", () => {
    const along = [1, 2, 3].map((k) => M[`charger-${k}`].along);
    expect(along.every((a) => a > 0 && a < M.dock.length)).toBe(true);
    expect(along[0] < along[1] && along[1] < along[2]).toBe(true);
  });
  it("draws every structure on a layer the site declares, and says where each comes from and what it assumes", () => {
    const declared = new Set(SITE.layers.map((l) => l.id));
    for (const st of SITE.structures) {
      expect(declared.has(st.layer)).toBe(true);
      expect(st.source.length).toBeGreaterThan(10);
      expect(st.assumed?.length ?? 0).toBeGreaterThan(10);
    }
    expect(site.made.map((m) => m.id)).toEqual([...SITE.structures.map((s) => s.id), ...LANDMARKS.map((l) => l.id)]);
    expect(SITE.layers.find((l) => l.id === "boatyard.removed").visible).toBe(false);
    expect(SITE.structures.filter((s) => s.layer === "boatyard.removed").map((s) => s.id)).toEqual(["C", "E", "F", "G", "H", "I", "J", "K", "Q"]);
    expect([...site.replaces]).toEqual(["way/374651008"]);
  });
  it("the hangar stands on its floor and reaches its ridge: its mesh's top is the ridge", () => {
    const P = site.layers["boatyard.kept"].positions;
    let top = -Infinity;
    for (let v = 1; v < P.length; v += 3) top = Math.max(top, P[v]);
    expect(top).toBeCloseTo(16.01, 4);
  });
});

describe("Ucluelet's extent", () => {
  it("is 1025 × 1025 nodes 20 m apart, 20.48 km a side, over 48.8277–49.0120 N, 125.6050–125.3251 W", () => {
    expect(GRID.n).toBe(1025);
    expect(Number.isInteger(Math.log2(GRID.n - 1))).toBe(true);
    expect((GRID.n - 1) * GRID.cell).toBe(20480);
    const box = latLonBox(GRID, frame);
    expect(box.south).toBeCloseTo(48.8277, 4);
    expect(box.north).toBeCloseTo(49.012, 4);
    expect(box.west).toBeCloseTo(-125.605, 3);
    expect(box.east).toBeCloseTo(-125.3251, 3);
  });
  it("holds every named place, the anchorage and the home view", () => {
    const inside = (x, z) => x > GRID.x0 && z > GRID.z0 && x < GRID.x0 + (GRID.n - 1) * GRID.cell && z < GRID.z0 + (GRID.n - 1) * GRID.cell;
    for (const p of PLACES) expect(inside(...frame.toLocal(p.lat, p.lon))).toBe(true);
    expect(inside(...frame.toLocal(ANCHORAGE.lat, ANCHORAGE.lon))).toBe(true);
    expect(inside(HOME.position[0], HOME.position[2])).toBe(true);
  });
  it("keeps heights to Mount Ozzard (701 m) in int16 at its step", () => {
    const d = uclueletDoc();
    expect(32767 * d.heightScale).toBeGreaterThan(780);
    expect(-32767 * d.heightScale).toBeLessThan(-130);
  });
  it("describes every height source it names, at most 14, and checks its position on the land's first", () => {
    const ids = [...HEIGHTS.water, ...HEIGHTS.land, HEIGHTS.canopy.dtm, HEIGHTS.canopy.dsm];
    for (const id of ids) expect(HEIGHTS.rasters[id]).toBeTruthy();
    for (const r of Object.values(HEIGHTS.rasters)) {
      expect(r.licence).toBeTruthy();
      expect(r.attribution).toBeTruthy();
      expect(r.crs === "frame" ? Number.isInteger(r.ncei) : /^https:\/\//.test(r.url)).toBe(true);
    }
    expect(HEIGHTS.check).toBe(HEIGHTS.land[0]);
  });
});

describe("buildings", () => {
  it("finds a rotated rectangle's own box, whichever corner it starts at, its long side as u", () => {
    for (let a = 0; a < 12; a++) {
      const t = (a * Math.PI) / 12, c = Math.cos(t), s = Math.sin(t);
      const rect = [[-10, -4], [10, -4], [10, 4], [-10, 4]].map(([x, z]) => [100 + x * c - z * s, 50 + x * s + z * c]);
      for (let r = 0; r < 4; r++) {
        const b = orientedBox([...rect.slice(r), ...rect.slice(0, r)]);
        expect(b.hu).toBeCloseTo(10, 6);
        expect(b.hv).toBeCloseTo(4, 6);
        expect(Math.abs(b.u[0] * c + b.u[1] * s)).toBeCloseTo(1, 6);
        expect(b.c[0]).toBeCloseTo(100, 6);
      }
    }
  });
  it("classes a building by its tags and the ground's cover", () => {
    const table = [[{ kind: "house" }, COVER.none, "house"], [{ kind: "yes" }, COVER.residential, "house"], [{ kind: "yes" }, COVER.yard, "industrial"], [{ kind: "warehouse" }, COVER.none, "industrial"], [{ kind: "yes", use: "hotel" }, COVER.none, "hotel"], [{ kind: "shed" }, COVER.residential, "shed"], [{ kind: "retail" }, COVER.none, "commercial"], [{ kind: "church" }, COVER.none, "civic"]];
    for (const [b, c, want] of table) expect(classOf(b, c)).toBe(want);
    for (const c of Object.values(CLASSES)) expect(c.eave).toBeGreaterThan(2);
  });
  it("draws a house as walls to its eave and a gable to its ridge, on the lowest ground under it, less the sink", () => {
    const pts = [[0, 0], [12, 0], [12, 8], [0, 8]];
    const ground = (x) => 10 + x * 0.1;
    const out = buildingMesh([{ id: "way/1", kind: "house", points: pts }], { groundAt: (x, z) => ground(x, z), sinkAt: () => 0.5, coverAt: () => COVER.residential });
    expect(out.made).toBe(1);
    let lo = Infinity, hi = -Infinity;
    for (const p of out.primitives) for (let v = 1; v < p.positions.length; v += 3) (lo = Math.min(lo, p.positions[v])), (hi = Math.max(hi, p.positions[v]));
    expect(lo).toBeCloseTo(10 - 0.5, 4);
    // eave 5.5 m above the highest ground (11.2), then a 32° gable over a 4 m half-span
    expect(hi).toBeCloseTo(11.2 + 5.5 + Math.tan((32 * Math.PI) / 180) * 4, 3);
  });
  it("leaves out what it's told to (a site that draws its own), and what's off the ground", () => {
    const b = [{ id: "way/1", kind: "house", points: [[0, 0], [12, 0], [12, 8], [0, 8]] }, { id: "way/2", kind: "house", points: [[0, 0], [12, 0], [12, 8], [0, 8]] }];
    const out = buildingMesh(b, { groundAt: (x) => (x > 100 ? null : 5), sinkAt: () => 0.5, coverAt: () => 0, leaveOut: (q) => q.id === "way/1" });
    expect(out.made).toBe(1);
  });
  it("simplifies a footprint's jogs under 0.4 m, and keeps its corners", () => {
    const ring = [[0, 0], [5, 0.1], [10, 0], [10, 10], [5, 10.2], [0, 10]];
    expect(simplify(ring, 0.4)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    void house;
  });
});
