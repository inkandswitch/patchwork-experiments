// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildTerrain, shape } from "./build.js";
import { parseGLB } from "./glb.js";
import { decodeTerrain } from "./terrain-sample.js";
import { featuresFromOsm } from "./osm.js";
import { GRID, OSM, frame, features, dem, terrainDoc } from "./test/fixture.js";
import { buoyLook, cardinalBands, markMesh } from "./marks.js";
import { QUALITY_NAMES } from "./burn.js";

function load(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}

describe("featuresFromOsm", () => {
  const f = features();
  it("keeps the coastline ways with their end nodes, in local metres", () => {
    expect(f.coast.map((c) => c.id)).toEqual(["way/1", "way/2"]);
    expect(f.coast[1].a).toBe(201);
    expect(f.coast[1].b).toBe(201);
    expect(f.coast[0].points[0][0]).toBeCloseTo(-400.3, 2);
    expect(f.coast[0].points[0][1]).toBeCloseTo(-120.6, 2);
  });
  it("keeps structures (a float as a line, a breakwater as an area) and the marks it can draw", () => {
    expect(f.structures).toMatchObject([
      { id: "way/3", kind: "pier", floating: true, area: false, name: "A Dock" },
      { id: "way/4", kind: "breakwater", area: true },
    ]);
    expect(f.marks.map((m) => [m.id, m.type])).toEqual([["node/5", "buoy_cardinal"], ["node/6", "lighthouse"], ["node/7", "buoy_lateral"], ["node/8", "notice"]]);
    expect(f.marks[0]).toMatchObject({ category: "north", colours: ["black", "yellow"] });
  });
  it("makes the same bytes from the same OSM", () => {
    expect(JSON.stringify(featuresFromOsm(structuredClone(OSM), frame))).toBe(JSON.stringify(f));
  });
});

describe("buildTerrain", () => {
  const doc = terrainDoc();
  const built = buildTerrain({ doc, dem: dem(), features: features() });

  it("checks itself: every node within tolerance and on its side of the water", () => {
    expect(built.stats.check).toMatchObject({ ok: true, uncovered: 0, out: 0, flipped: 0, area: 64 * 64 });
    expect(built.stats.land).toBeGreaterThan(0);
    expect(built.stats.water).toBeGreaterThan(0);
  });

  it("is a valid GLB that three.js loads: ground, skirt, structures and marks, in metres", async () => {
    const gltf = await load(built.glb);
    const names = [];
    gltf.scene.traverse((o) => o.isMesh && names.push(o.name || o.parent?.name));
    // (three.js writes a name's spaces as underscores)
    expect(names).toEqual(["Ground", "Skirt", "Harbour_structures", "Marks"]);
    const { json } = parseGLB(built.glb);
    expect(json.asset.extras.units).toBe("m");
    expect(json.meshes[0].extras.legend.stops.length).toBe(32);
  });

  it("carries its heightfield in extras.terrain: exactly the burned heights, decodable by the copyable sampler", async () => {
    const gltf = await load(built.glb);
    const t = gltf.scene.userData.terrain;
    expect(t).toMatchObject({ version: 1, outside: null, seaLevel: 0, grid: { nx: 65, nz: 65, x0: -256, z0: -256, cell: 8 } });
    const d = decodeTerrain(t);
    for (let j = 0; j < GRID.n; j++) for (let i = 0; i < GRID.n; i++) expect(d.node(i, j)).toBeCloseTo(built.heights[j * GRID.n + i] * 0.02, 10);
    expect(t.places).toEqual([{ name: "Middle", kind: "mooring", position: [0, 0, 0] }]);
    expect(t.attribution).toBe("tests");
  });

  it("gives land above the water and the sea below it where OSM says, at the shore's nodes too", () => {
    const sh = shape(GRID, dem(), { scale: 0.02, toMWL: doc.demToMWL }, features());
    const d = decodeTerrain(parseGLB(built.glb).json.scenes[0].extras.terrain);
    for (let at = 0; at < GRID.n * GRID.n; at++) {
      const i = at % GRID.n, j = (at - i) / GRID.n;
      expect(Math.sign(d.node(i, j))).toBe(sh.cls.label[at]);
    }
    // the north is land, the bay and round the island water, the island land
    expect(d.heightAt(0, -200)).toBeGreaterThan(0);
    expect(d.heightAt(0, 0)).toBeLessThan(0);
    expect(d.heightAt(30, 160)).toBeGreaterThan(0);
  });

  it("puts the marks it can draw on the water or their rock, and leaves out what it can't", () => {
    const marks = parseGLB(built.glb).json.nodes.find((n) => n.name === "Marks").extras.marks;
    expect(marks.map((m) => [m.id, m.model])).toEqual([["node/5", "cardinal"], ["node/6", "lighthouse"], ["node/7", "buoy"]]);
    const light = marks.find((m) => m.model === "lighthouse");
    expect(light.position[1]).toBeGreaterThan(10);
  });

  it("is deterministic: the same inputs make the same bytes", () => {
    const again = buildTerrain({ doc: terrainDoc(), dem: dem(), features: features() });
    expect(again.glb.byteLength).toBe(built.glb.byteLength);
    expect(Buffer.compare(Buffer.from(again.glb), Buffer.from(built.glb))).toBe(0);
  });

  it("can carry a coarser heightfield, every other node", () => {
    const coarse = buildTerrain({ doc, dem: dem(), features: features(), params: { heightfieldCell: 16 } });
    const t = decodeTerrain(parseGLB(coarse.glb).json.scenes[0].extras.terrain);
    expect(t.grid).toEqual({ nx: 33, nz: 33, x0: -256, z0: -256, cell: 16 });
    expect(t.node(3, 5)).toBeCloseTo(built.heights[10 * GRID.n + 6] * 0.02, 10);
  });

  it("credits its data: asset.copyright and extras.terrain carry the doc's attribution and credit", () => {
    const withCredit = buildTerrain({ doc: terrainDoc({ attribution: "Shore © OpenStreetMap contributors (ODbL)", credit: "© OpenStreetMap contributors" }), dem: dem(), features: features() });
    const { json } = parseGLB(withCredit.glb);
    expect(json.asset.copyright).toBe("Shore © OpenStreetMap contributors (ODbL)");
    expect(json.scenes[0].extras.terrain.credit).toBe("© OpenStreetMap contributors");
  });

  it("says what every node's height is made from, and the sampler reads it back", () => {
    const sh = shape(GRID, dem(), { scale: 0.02, toMWL: doc.demToMWL }, features(), { datum: doc.datum });
    const t = parseGLB(built.glb).json.scenes[0].extras.terrain;
    expect(t.quality.names).toEqual([...QUALITY_NAMES]);
    const d = decodeTerrain(t);
    for (let j = 0; j < GRID.n; j++) for (let i = 0; i < GRID.n; i++) expect(d.qualityAt(GRID.x0 + i * GRID.cell, GRID.z0 + j * GRID.cell)).toBe(QUALITY_NAMES[sh.quality[j * GRID.n + i]]);
    expect(Object.values(t.quality.counts).reduce((a, b) => a + b, 0)).toBe(GRID.n * GRID.n);
    expect(t.quality.counts.dem).toBeGreaterThan(0);
    expect(t.quality.counts.shore).toBeGreaterThan(0);
    expect(d.qualityAt(GRID.x0 - 1, 0)).toBeNull();
  });

  it("refuses heights flipped north–south or mirrored east–west against the coastline, and takes them as they are", () => {
    const n = GRID.n, v = dem();
    const flip = new Int16Array(n * n), mirror = new Int16Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      flip[j * n + i] = v[(n - 1 - j) * n + i];
      mirror[j * n + i] = v[j * n + (n - 1 - i)];
    }
    const agreement = (h) => shape(GRID, h, { scale: 0.02, toMWL: doc.demToMWL }, features(), { datum: doc.datum }).agreement.share;
    expect(agreement(v)).toBeGreaterThanOrEqual(0.98);
    expect(agreement(flip)).toBeLessThan(0.98);
    expect(agreement(mirror)).toBeLessThan(0.98);
    for (const h of [flip, mirror]) expect(() => buildTerrain({ doc, dem: h, features: features() })).toThrow(/flipped, mirrored or shifted/);
  });

  it("raises an OSM islet too small for the band's slope above the highest tide, and draws one with no node as a rock", () => {
    const f = features();
    // a 10 m islet round node (0, 64) and a 3 m rock between nodes, both out in the bay; land on the left (counter-clockwise from above)
    const ccw = (cx, cz, r) => [[cx - r, cz + r], [cx + r, cz + r], [cx + r, cz - r], [cx - r, cz - r], [cx - r, cz + r]];
    f.coast.push({ id: "way/islet", a: 900, b: 900, points: ccw(0.3, 64.2, 5) }, { id: "way/rock", a: 901, b: 901, points: ccw(-44, 20, 1.5) });
    const out = buildTerrain({ doc, dem: dem(), features: f });
    const t = decodeTerrain(parseGLB(out.glb).json.scenes[0].extras.terrain);
    expect(t.heightAt(0, 64)).toBeGreaterThanOrEqual(doc.datum.tide.HHWLT + 0.3);
    expect(t.qualityAt(0, 64)).toBe("raised");
    expect(t.rocks.map((r) => r.id)).toEqual(["way/rock"]);
    expect(t.rockAt(-44, 20)?.top).toBeGreaterThanOrEqual(1.5);
    expect(t.rockAt(-40, 20)).toBeNull();
    expect(parseGLB(out.glb).json.nodes.map((n) => n.name)).toContain("Rocks");
    expect(out.stats).toMatchObject({ isletsRaised: 1, rocks: 1 });
  });

  it("refuses data that can't tell land from water", () => {
    const f = features();
    f.coast = f.coast.filter((c) => c.id !== "way/1").concat([{ ...f.coast[0], points: f.coast[0].points.slice(1, 3) }]);
    expect(() => buildTerrain({ doc, dem: dem(), features: f })).toThrow(/land from water/);
  });
});

describe("marks: drawn as OSM says, and nothing invented", () => {
  const m = (tags) => ({ id: "node/1", type: "buoy_lateral", name: null, x: 0, z: 0, colours: [], light: null, height: null, category: null, shape: null, ...tags });
  it("draws a lateral buoy red and conical, or green and can, only when its colour or side says so; else a grey spar", () => {
    expect(buoyLook(m({ category: "starboard" }))).toEqual({ colour: "red", shape: "cone" });
    expect(buoyLook(m({ category: "port" }))).toEqual({ colour: "green", shape: "can" });
    expect(buoyLook(m({ colours: ["red"] }))).toEqual({ colour: "red", shape: "cone" });
    expect(buoyLook(m({ colours: ["green"], shape: "spar" }))).toEqual({ colour: "green", shape: "spar" });
    expect(buoyLook(m({}))).toEqual({ colour: "grey", shape: "spar" });
    expect(buoyLook(m({ category: "preferred_channel_port" }))).toEqual({ colour: "grey", shape: "spar" });
  });
  it("paints a cardinal's body in its quadrant's bands (three for east and west), whatever OSM lists", () => {
    expect(cardinalBands(m({ type: "buoy_cardinal", category: "north", colours: ["black", "yellow"] }))).toEqual(["black", "yellow"]);
    expect(cardinalBands(m({ type: "buoy_cardinal", category: "south", colours: ["yellow", "black"] }))).toEqual(["yellow", "black"]);
    expect(cardinalBands(m({ type: "buoy_cardinal", category: "east", colours: ["black", "yellow"] }))).toEqual(["black", "yellow", "black"]);
    expect(cardinalBands(m({ type: "buoy_cardinal", category: "west", colours: ["yellow", "black"] }))).toEqual(["yellow", "black", "yellow"]);
    expect(cardinalBands(m({ type: "buoy_cardinal", colours: ["black", "yellow", "black"] }))).toEqual(["black", "yellow", "black"]);
    expect(cardinalBands(m({ type: "buoy_cardinal" }))).toEqual(["grey"]);
    // the model: one band per colour, top to bottom; the east's body is black at its top and bottom, yellow between
    const { positions, colors } = markMesh([m({ type: "buoy_cardinal", category: "east" })], () => -5);
    const colourAt = (y) => {
      for (let v = 0; v < positions.length / 3; v += 3) {
        const ys = [0, 1, 2].map((k) => positions[(v + k) * 3 + 1]);
        const r = Math.hypot(positions[v * 3], positions[v * 3 + 2]);
        if (r > 0.5 && Math.min(...ys) < y && Math.max(...ys) > y) return [0, 1, 2].map((k) => colors[v * 3 + k].toFixed(3)).join(",");
      }
      return null;
    };
    const [top, middle, bottom] = [1.8, 0.7, -0.4].map(colourAt);
    expect(top).toBe(bottom);
    expect(middle).not.toBe(top);
  });
});

describe("tiles: a big mesh in 16-bit pieces", () => {
  it("keeps every triangle, each piece under the limit, with the whole mesh's normals", async () => {
    const { tiles } = await import("./build.js");
    // a 40 × 40 quad grid: 1681 vertices, 3200 triangles
    const m = 41, pos = [], idx = [];
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) pos.push(i, Math.sin(i + j), j);
    for (let j = 0; j + 1 < m; j++) for (let i = 0; i + 1 < m; i++) {
      const a = j * m + i;
      idx.push(a, a + m, a + 1, a + 1, a + m, a + m + 1);
    }
    const positions = new Float32Array(pos), normals = new Float32Array(pos.map((_, k) => k % 3)), colors = new Float32Array(pos.length).fill(0.5);
    const parts = tiles(positions, normals, colors, Uint32Array.from(idx), 500);
    expect(parts.length).toBeGreaterThan(1);
    const seen = new Set();
    for (const p of parts) {
      expect(p.positions.length / 3).toBeLessThanOrEqual(500);
      expect(p.indices).toBeInstanceOf(Uint16Array);
      for (let t = 0; t < p.indices.length; t += 3) {
        const key = [0, 1, 2].map((e) => { const v = p.indices[t + e]; return `${p.positions[v * 3]},${p.positions[v * 3 + 2]}`; }).join("|");
        seen.add(key);
        for (let e = 0; e < 3; e++) expect(p.normals[p.indices[t + e] * 3 + 1]).toBe(1);
      }
    }
    expect(seen.size).toBe(idx.length / 3);
  });
});
