import { describe, it, expect } from "vitest";
import { siteMesh, doorLeaves } from "./site.js";
import { SITE, LANDMARKS, ORIGIN, GRID, PLACES, HEIGHTS, DATUM, ANCHORAGE, HOME, YARD, uclueletDoc, fromCGVD28, fromSurvey } from "./ucluelet.js";
import { builtRings } from "./build.js";
import { localFrame } from "./tmerc.js";
import { latLonBox } from "./fetch-data.js";
import { orientedBox, classOf, buildingMesh, house, simplify, CLASSES, facade, pileDeck, paletteSoup, deckOf, pileSpots, DECK_REACH, DETAIL } from "./buildings.js";
import { COVER } from "./cover.js";

const frame = localFrame(ORIGIN);
// flat ground at the yard's level on land (south of the shore at z ≈ 0 near the site), the harbour 8 m deep north of it
const groundAt = (x, z) => (z > 0 ? 3.06 : -8);
const site = siteMesh(SITE, LANDMARKS, frame, groundAt, () => 0.5);
const M = site.measures;

describe("the boatyard, against its spec (README, \"Ucluelet\"; the survey and Rising Tide's plans)", () => {
  it("the hangar: 39.1–39.3 by 34.8–34.95 m, 1,369 m², its ridge north-west–south-east, floor +3.06, eave +13.66, ridge +14.87 about MWL (the survey's, conformed to the lidar), a 4° gable, doors 7.39 m high", () => {
    expect(M.hangar.length).toBeGreaterThan(39.1);
    expect(M.hangar.length).toBeLessThan(39.3);
    expect(M.hangar.span).toBeGreaterThan(34.8);
    expect(M.hangar.span).toBeLessThan(34.95);
    expect(Math.abs(M.hangar.area - 1369)).toBeLessThan(5);
    expect(M.hangar.floor).toBe(3.06);
    expect(M.hangar.ridge).toBe(14.87);
    expect(M.hangar.eave).toBeCloseTo(13.66, 9);
    expect(M.hangar.pitch).toBeGreaterThan(3.5);
    expect(M.hangar.pitch).toBeLessThan(4.5);
    expect(M.hangar.doorHead).toBe(7.39);
    // the ridge runs from the door face (north-west) to the south-east: a true bearing near 157° (158.5° grid less the convergence)
    expect(Math.abs(M.hangar.bearing - 156.8)).toBeLessThan(1);
  });
  it("heights from the survey's CGVD28 become heights about MWL by +0.08 m (CHS 08595), then drop 1.14 m to the lidar's ground", () => {
    expect(fromCGVD28(4.12)).toBe(4.2);
    expect(fromCGVD28(15.93)).toBe(16.01);
    expect(DATUM.mwlAboveCGVD28).toBe(-0.08);
    expect(fromSurvey(4.12)).toBe(3.06);
    expect(fromSurvey(15.93)).toBe(14.87);
    expect(M.B.top).toBe(9.55);
    expect(M.D.top).toBe(11.97);
  });
  it("the survey and the lidar disagree under the yard, and the site stands on the lidar's ground: the slab within 0.3 m of it, the survey's differences kept", () => {
    const hs = YARD.lidar.points.map((p) => p[2]);
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    expect(Math.abs(mean - YARD.lidar.mean)).toBeLessThan(0.005);
    expect(YARD.surveySlab).toBe(fromCGVD28(4.12));
    expect(YARD.offset).toBe(Math.round((YARD.lidar.mean - YARD.surveySlab) * 100) / 100);
    expect(YARD.offset).toBeLessThan(-0.9);
    expect(Math.abs(M.hangar.floor - YARD.lidar.mean)).toBeLessThanOrEqual(0.3);
    // every survey height drops the same, so the survey's differences hold
    expect(M.hangar.ridge - M.hangar.floor).toBeCloseTo(15.93 - 4.12, 9);
    expect(M.B.top - M.hangar.floor).toBeCloseTo(10.61 - 4.12, 9);
    // what is built at yard level is at the conformed level, and the doc carries the record
    for (const id of ["wharf", "lpier-leg", "lpier-arm", "haulout"]) expect([id, SITE.structures.find((st) => st.id === id).deck]).toEqual([id, M.hangar.floor]);
    expect(SITE.structures.find((st) => st.id === "gangway").from).toBe(M.hangar.floor);
    for (const id of ["hangar", "B", "D"]) expect([id, SITE.structures.find((st) => st.id === id).floor ?? SITE.structures.find((st) => st.id === id).base]).toEqual([id, M.hangar.floor]);
    expect(uclueletDoc().site.ground).toEqual(JSON.parse(JSON.stringify(YARD)));
    expect(SITE.structures.find((st) => st.id === "hangar").assumed).toMatch(/conformed to the lidar/);
    expect(SITE.structures.find((st) => st.id === "wharf").assumed).toMatch(/conformed to the lidar/);
  });
  it("the haul-out pier: two runways about 40 and 39 m long, about north, 12.7 m apart centre to centre, 2.4 m wide, a 10.3 m well, at yard level", () => {
    expect(Math.abs(M.haulout.lengths[0] - 40)).toBeLessThan(1);
    expect(Math.abs(M.haulout.lengths[1] - 39)).toBeLessThan(1);
    expect(Math.abs(M.haulout.spacing - 12.7)).toBeLessThan(0.7);
    expect(M.haulout.width).toBe(2.4);
    expect(Math.abs(M.haulout.well - 10.3)).toBeLessThan(0.7);
    expect(M.haulout.deck).toBe(3.06);
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
    expect([...site.replaces]).toEqual(["way/374651008", "way/1423469476"]);
  });
  it("the lighthouse: a squat tower on its rock, its gallery, lantern and dome to 5.6 + 0.25 + 1.4 + 0.9 m over the ground; the radome a ball to OSM's 17 m", () => {
    // each says its ground and its top
    const lh = M.amphitrite, oz = M.ozzard;
    const Z = LANDMARKS[0].size;
    expect(lh.top - lh.ground).toBeCloseTo(Z.height + 0.25 + Z.lanternHeight + Z.dome, 9);
    const R = LANDMARKS[1].size;
    expect(oz.top - oz.ground).toBeCloseTo(R.building[2] + R.radius * Math.sin(Math.PI / 3) + R.radius, 6);
    expect(oz.top - oz.ground).toBeCloseTo(17, 1);
    // the radome's ball is OSM's footprint across
    expect(2 * R.radius).toBeCloseTo(16.8, 9);
    for (const lm of LANDMARKS) expect(lm.assumed.length).toBeGreaterThan(40);
  });
  it("the hangar stands on its floor and reaches its ridge: its mesh's top is the ridge", () => {
    const P = site.layers["boatyard.kept"].positions;
    let top = -Infinity;
    for (let v = 1; v < P.length; v += 3) top = Math.max(top, P[v]);
    expect(top).toBeCloseTo(14.87, 4);
  });
  it("the hangar's sliding leaves cover the main door's span but for the small door, none over it, the stretches either side sharing eight by length", () => {
    const { main, small } = SITE.structures.find((st) => st.id === "hangar").doors;
    expect(M.hangar.small).toEqual([small.from, small.to]);
    const L = M.hangar.leaves;
    expect(L.length).toBe(8);
    for (const [a, b] of L) expect(b <= small.from + 1e-9 || a >= small.to - 1e-9).toBe(true);
    const covered = L.reduce((t, [a, b]) => t + (b - a), 0);
    expect(covered).toBeCloseTo(main.to - main.from - (small.to - small.from), 9);
    for (let q = 1; q < L.length; q++) expect(L[q][0]).toBeGreaterThanOrEqual(L[q - 1][1] - 1e-9);
    expect(L[0][0]).toBe(main.from);
    expect(L.at(-1)[1]).toBe(main.to);
    // every way a small door can sit against the main span: before, overlapping either end, inside, after, none
    for (const sm of [null, { from: -5, to: -1 }, { from: -1, to: 2 }, { from: 5, to: 8 }, { from: 32, to: 36 }, { from: 40, to: 42 }]) {
      const ls = doorLeaves(main, sm, 8);
      for (const [a, b] of ls) {
        expect(b).toBeGreaterThan(a);
        if (sm) expect(b <= sm.from + 1e-9 || a >= sm.to - 1e-9).toBe(true);
        expect(a >= main.from - 1e-9 && b <= main.to + 1e-9).toBe(true);
      }
    }
  });
  it("today's harbour: the pier's east arm, as OSM draws it, on its own layer (hidden by default, as the planned dock replaces it), from the north leg's end", () => {
    const arm = SITE.structures.find((st) => st.id === "lpier-arm");
    const leg = SITE.structures.find((st) => st.id === "lpier-leg");
    expect(arm.layer).toBe("boatyard.today");
    expect(SITE.layers.find((l) => l.id === "boatyard.today")).toMatchObject({ parent: "boatyard", visible: false });
    expect(arm.line[0]).toEqual(leg.line[1]);
    // OSM way 751431449's second segment, in the frame: (70.91, −19.48) → (135.03, −9.39)
    const [a, b] = arm.line.map(([lat, lon]) => frame.toLocal(lat, lon));
    expect(Math.hypot(a[0] - 70.91, a[1] + 19.48)).toBeLessThan(0.1);
    expect(Math.hypot(b[0] - 135.03, b[1] + 9.39)).toBeLessThan(0.1);
    expect(Math.abs(M["lpier-arm"].length - 64.9)).toBeLessThan(0.5);
    expect(site.layers["boatyard.today"].positions.length).toBeGreaterThan(0);
    // every layer but the plan's: the harbour as it is, with an arm off the leg
    expect(SITE.structures.filter((st) => st.layer !== "boatyard.planned" && st.kind === "pier").map((st) => st.id)).toEqual(["lpier-leg", "lpier-arm"]);
  });
  it("the haul-out's head records how shallow the heights are there, as evidence its position is uncertain", () => {
    const h = SITE.structures.find((st) => st.id === "haulout");
    expect(h.headDepth.mwl).toHaveLength(2);
    // under 3 m at the lowest normal tide, at both heads: what the confidence says
    for (const d of h.headDepth.mwl) expect(-(d - DATUM.tide.LLWLT)).toBeLessThan(3);
    expect(h.confidence).toMatch(/headDepth/);
    expect(h.assumed).toMatch(/headDepth/);
  });
  it("tells the build what is built on: OSM's footprints, the site's lot and each structure with corners", () => {
    const fp = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const rings = builtRings(uclueletDoc(), { buildings: [{ points: fp }] }, frame);
    const withCorners = SITE.structures.filter((st) => st.corners?.length >= 3).length;
    expect(rings.length).toBe(1 + 1 + withCorners);
    expect(rings[0]).toBe(fp);
    // the lot's box holds the hangar
    const [hx, hz] = frame.toLocal(48.9491, -125.557758);
    const box = rings[1];
    expect(hx > Math.min(...box.map((p) => p[0])) && hx < Math.max(...box.map((p) => p[0])) && hz > Math.min(...box.map((p) => p[1])) && hz < Math.max(...box.map((p) => p[1]))).toBe(true);
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
  it("trims a house's walls: two corner boards and an eave band a wall, and a row of windows a storey (one every 3 m), all proud of the walls (both windings)", () => {
    for (const ring of [[[0, 0], [12, 0], [12, 7], [0, 7]], [[0, 0], [0, 7], [12, 7], [12, 0]]]) {
      const s = soup();
      // two storeys: floor 0, eave 5.6
      const quads = facade(s, ring, { floor: 0, eave: 5.6 });
      // per wall 3 trims, and windows: a 12 m wall 3 a storey, a 7 m wall 1, two storeys
      expect(quads).toBe(4 * 3 + 2 * (3 + 1) * 2);
      const m = s.done();
      for (let v = 0; v < m.positions.length; v += 3) {
        const x = m.positions[v], z = m.positions[v + 2];
        // on or just outside the footprint's walls, never inside it
        const inside = x > 0.001 && x < 11.999 && z > 0.001 && z < 6.999;
        expect(inside).toBe(false);
        expect(Math.min(Math.abs(x), Math.abs(x - 12), Math.abs(z), Math.abs(z - 7))).toBeLessThanOrEqual(0.051);
      }
      // ribs instead of trim and windows: one every 0.9 m a wall
      expect(facade(soup(), ring, { floor: 0, eave: 5, ribs: "#d8d2bf" })).toBe(2 * 12 + 2 * 7);
    }
  });
  it("stands a building at the water on a pile deck: piles no more than 4 m apart, a row at each edge, only where the ground is under the deck", () => {
    const s = soup();
    // the ground falls from 5 m at z = 0 to 1 m at z = 8 (the water's side +z, the long side along x)
    const groundAt = (x, z) => 5 - z / 2;
    const d = deckOf([[0, 0], [20, 0], [20, 8], [0, 8]], groundAt, { mlw: -1.2 });
    expect(d.side).toBeGreaterThan(0);
    // the water half a metre under the lower low water (−1.7) under the outer row (inset 0.3) from z = 13.4: the deck reaches 6 m out (in 2 m steps)
    expect(d.reached).toBe(true);
    expect(d.out).toBe(6);
    const count = pileDeck(s, d, { deck: 3, groundAt });
    const spots = pileSpots(d.box, d.side);
    expect(count).toBe(spots.filter((p) => groundAt(p.x, p.z) <= 3 - 0.5 - 0.3).length);
    // a row at each long edge, 0.3 in, and none more than 4 m apart
    const zs = [...new Set(spots.map((p) => Math.round(p.z * 1000) / 1000))].sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(0.3, 6);
    expect(zs.at(-1)).toBeCloseTo(14 - 0.3, 6);
    for (let q = 1; q < zs.length; q++) expect(zs[q] - zs[q - 1]).toBeLessThanOrEqual(4 + 1e-9);
  });
  it("reaches every deck out until its outer piles stand a metre under the lowest tide, or not at all (every slope, shore direction and offset)", () => {
    const mlw = -1.2;
    let reachedSome = 0;
    for (const slope of [1 / 3, 1 / 5, 1 / 10, 1 / 20]) for (let a = 0; a < 8; a++) for (const off of [-6, 0, 6]) {
      const th = (a * Math.PI) / 4 + 0.1;
      const n = [Math.cos(th), Math.sin(th)];
      // the ground falls toward n: 0 at the line through (off·n)
      const groundAt = (x, z) => -slope * (x * n[0] + z * n[1] - off);
      const pts = [[-12, -5], [12, -5], [12, 5], [-12, 5]];
      const d = deckOf(pts, groundAt, { mlw });
      if (d.reached) {
        reachedSome++;
        for (const p of pileSpots(d.box, d.side).filter((p) => p.outer)) expect(groundAt(p.x, p.z)).toBeLessThanOrEqual(mlw - DECK_REACH.depth + 1e-9);
        expect(d.out).toBeLessThanOrEqual(DECK_REACH.reach);
      } else expect(d.out).toBe(0);
      // steep enough shores are always reached
      if (slope >= 1 / 10) expect(d.reached).toBe(true);
    }
    expect(reachedSome).toBeGreaterThan(48);
  });
  it("draws every building on a deck as a fish plant (cream ribs, no window grid, roller doors) unless the place draws it itself, its piles to the seabed (every kind)", () => {
    const groundAt = (x, z) => 4 - z / 2;
    const palette = { walls: [["#7a5a40", 1]], roofs: [["#3d3f42", 1]], cladding: [["#b8bcbc", 1]], metalRoofs: [["#9ea3a6", 1]], plant: "#d8d2bf" };
    const lin = (hex) => [1, 3, 5].map((k) => ((parseInt(hex.slice(k, k + 2), 16) / 255 + 0.055) / 1.055) ** 2.4);
    const has = (out, hex) => out.primitives.some((p) => p.color.every((c, i) => Math.abs(c - lin(hex)[i]) < 1e-4));
    for (const kind of ["house", "commercial", "hotel", "warehouse", "yes"]) {
      const out = buildingMesh([{ id: `way/${kind}`, kind, points: [[0, 0], [20, 0], [20, 8], [0, 8]] }], { groundAt, sinkAt: () => 0.5, coverAt: () => 0, deckAbove: 3.1, details: true, palette });
      expect(out.decks).toBe(1);
      expect(out.reached).toBe(1);
      expect(has(out, "#d8d2bf")).toBe(true);
      expect(has(out, DETAIL.glass)).toBe(false);
      expect(has(out, "#3d6f9a") || has(out, "#c9b04a")).toBe(true);
      // the piles go into the seabed (half a metre under it at least, never above −6)
      let lo = Infinity;
      for (const p of out.primitives) for (let v = 1; v < p.positions.length; v += 3) lo = Math.min(lo, p.positions[v]);
      expect(lo).toBeLessThanOrEqual(-6);
    }
    // a building the place draws itself (an override's colour) keeps its own form and windows
    const own = buildingMesh([{ id: "way/1", kind: "house", colour: "#6b4a2e", points: [[0, 0], [20, 0], [20, 8], [0, 8]] }], { groundAt, sinkAt: () => 0.5, coverAt: () => 0, deckAbove: 3.1, details: true, palette });
    expect(has(own, DETAIL.glass)).toBe(true);
    void paletteSoup;
  });
  it("simplifies a footprint's jogs under 0.4 m, and keeps its corners", () => {
    const ring = [[0, 0], [5, 0.1], [10, 0], [10, 10], [5, 10.2], [0, 10]];
    expect(simplify(ring, 0.4)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    void house;
  });
});

import { cladding } from "./site.js";
import { soup } from "./shapes.js";
describe("corrugated cladding", () => {
  it("ribs every wall every 0.9 m (none at the corners) and bands it under the eave, all just outside the walls", () => {
    for (const ring of [[[0, 0], [10, 0], [10, 6], [0, 6]], [[0, 0], [0, 6], [10, 6], [10, 0]]]) {
      const s = soup();
      const ribs = cladding(s, ring, 2, 8, { walls: "#cccccc", trim: "#555555" });
      // 10 m walls: 10 ribs each; 6 m walls: 5 each
      expect(ribs).toBe(30);
      const { positions } = s.done();
      // two triangles a rib and a band a wall
      expect(positions.length / 18).toBe(30 + 4);
      for (let v = 0; v < positions.length; v += 3) {
        const [x, y, z] = [positions[v], positions[v + 1], positions[v + 2]];
        expect(y).toBeGreaterThanOrEqual(2);
        expect(y).toBeLessThanOrEqual(8);
        // off the wall, outside the footprint: 4 or 6 cm
        const out = Math.max(-x, x - 10, -z, z - 6);
        expect(out).toBeGreaterThan(0.03);
        expect(out).toBeLessThan(0.07);
      }
    }
  });
});

import { quonset, slab, QUONSET } from "./site.js";
import { soup as soupOf } from "./shapes.js";
describe("Quonsets and the courtyard's slab", () => {
  // rectangles turned to 8 headings, 12 × 7 m and 15 × 16 m (span wider than long)
  const rect = (L, W, t, cx = 3, cz = -2) => {
    const u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
    return [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([a, b]) => [cx + u[0] * a + v[0] * b, cz + u[1] * a + v[1] * b]);
  };
  const inside = (P, x, z) => {
    // a convex ring either way round: every edge's cross product the same sign (or on it, to float32 positions' millimetre)
    let pos = 0, neg = 0;
    for (let a = 0; a < 4; a++) {
      const [x0, z0] = P[a], [x1, z1] = P[(a + 1) % 4];
      const c = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
      if (c > 1e-3) pos++;
      if (c < -1e-3) neg++;
    }
    return !(pos && neg);
  };
  it("lies inside its outline, from its base to its rise, ribbed every 0.6 m, every heading and size, each door end", () => {
    for (const [L, W, H] of [[12, 7, 4], [15.2, 16, 8.9]]) for (let h = 0; h < 8; h++) for (const door of [0, 1, null]) {
      const P = rect(L, W, (h * Math.PI) / 4 + 0.1);
      const s = soupOf();
      const m = quonset(s, P, 3, H, { shell: "#b82a26", arch: "#ecebe6", door });
      const mesh = s.done();
      for (let v = 0; v < mesh.positions.length; v += 3) {
        expect(inside(P, mesh.positions[v], mesh.positions[v + 2])).toBe(true);
        expect(mesh.positions[v + 1]).toBeGreaterThanOrEqual(3 - 1e-6);
        expect(mesh.positions[v + 1]).toBeLessThanOrEqual(3 + H + 1e-6);
      }
      expect(m.ribs).toBe(Math.floor((L - 2 * QUONSET.inset - QUONSET.ribWidth) / QUONSET.ribEvery) + 1);
      // shell, ribs and two end fans; a door end adds a rim band and a door
      const N = QUONSET.segments;
      expect(mesh.positions.length / 9).toBe(2 * N + 2 * N * m.ribs + 2 * N + (door == null ? 0 : 2 * N + 2));
    }
  });
  it("lays a slab's seams every 6 m both ways inside it, over its top (every heading)", () => {
    for (let h = 0; h < 8; h++) {
      const P = rect(40, 45, (h * Math.PI) / 4 + 0.2);
      const s = soupOf();
      const m = slab(s, P, 2.8, 3.3, { colour: "#8a8a86", seams: { every: 6, colour: "#6c6c69", width: 0.12 } });
      expect(m.seams).toBe(Math.floor(40 / 6) + Math.floor(45 / 6) - (40 % 6 === 0 ? 1 : 0) - (45 % 6 === 0 ? 1 : 0));
      const mesh = s.done();
      for (let v = 0; v < mesh.positions.length; v += 3) {
        expect(inside(P, mesh.positions[v], mesh.positions[v + 2])).toBe(true);
        expect(mesh.positions[v + 1]).toBeLessThanOrEqual(3.31 + 1e-6);
      }
    }
  });
});
