// The layered fetch end to end, on a made-up place whose every answer is a
// fixture (rasters written here, OSM the test fixture's): what it takes from
// which source, what it refuses, and the bytes it makes, pinned.
import { describe, it, expect } from "vitest";
import { fetchTerrainData, nceiUrl, overpassQuery, latLonBox } from "./fetch-data.js";
import { lookQuery } from "./look-osm.js";
import { unpackLayers } from "./layered.js";
import { GRID, OSM, frame, heightAtLocal } from "./test/fixture.js";
import { writeTiff } from "./test/tiff-writer.js";

const DATE = "2026-11-09T00:00:00Z";
const box = latLonBox(GRID, frame, 600);
const [S, W] = [box.south, box.west], [N, E] = [box.north, box.east];
const span = { lon: E - W, lat: N - S };

/** A 4326 raster of `f(x, z)` (local metres) at w × h pixels over the box, nothing where `has(x, z)` is false. */
function latLonRaster(w, h, f, has = () => true) {
  const dlon = span.lon / w, dlat = span.lat / h;
  const v = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const [x, z] = frame.toLocal(N - (r + 0.5) * dlat, W + (q + 0.5) * dlon);
    v[r * w + q] = has(x, z) ? f(x, z) : -32767;
  }
  return writeTiff(w, h, v, { transformation: [dlon, 0, 0, W, 0, -dlat, 0, N, 0, 0, 0, 0, 0, 0, 0, 1], nodata: "-32767" });
}
const frameRaster = (f) => {
  const { n, cell, x0, z0 } = GRID;
  const v = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = f(x0 + i * cell, z0 + j * cell);
  return writeTiff(n, n, v, { scale: [cell, cell, 0], tie: [0, 0, 0, x0 - cell / 2, -z0 + cell / 2, 0], crs: 32767 });
};

const LOOK = { elements: [{ type: "way", id: 77, tags: { natural: "wood" }, nodes: [1, 2, 3, 1], geometry: [[-250, -250], [250, -250], [250, -150], [-250, -250]].map(([x, z]) => { const [lat, lon] = frame.toLatLon(x, z); return { lat, lon }; }) }] };

function spec({ flip = false } = {}) {
  const land = (x, z) => heightAtLocal(x, flip ? -z : z) + 0.12;
  return {
    origin: { ...frame.origin },
    grid: { ...GRID },
    datum: { tide: { HHWLT: 1.2, MHHW: 0.84, MLLW: -1.22, LLWLT: -2.14 } },
    osmDate: DATE,
    look: { trees: {} },
    heights: {
      kind: "layered",
      water: ["w10", "w100"],
      land: ["l1", "f1"],
      canopy: { dtm: "l1", dsm: "s1" },
      check: "l1",
      rasters: {
        w10: { name: "fine bathymetry (east half)", url: "https://example.org/w10", crs: "EPSG:4326", toMWL: -2, licence: "test", attribution: "test" },
        w100: { name: "coarse bathymetry", url: "https://example.org/w100", crs: "EPSG:4326", toMWL: -2, licence: "test", attribution: "test" },
        l1: { name: "lidar (not the far west)", url: "https://example.org/l1", crs: "EPSG:4326", toMWL: -0.12, licence: "test", attribution: "test" },
        s1: { name: "lidar surface", url: "https://example.org/s1", crs: "EPSG:4326", toMWL: -0.12, licence: "test", attribution: "test" },
        f1: { name: "a DEM in the frame", ncei: 999, crs: "frame", toMWL: 0, licence: "test", attribution: "test" },
      },
      _land: land,
    },
  };
}

function fakeFetch(s) {
  const land = s.heights._land;
  const answers = {
    "https://example.org/w10": latLonRaster(48, 40, (x, z) => heightAtLocal(x, z) + 2, (x) => x > 0),
    "https://example.org/w100": latLonRaster(12, 10, (x, z) => heightAtLocal(x, z) + 2),
    "https://example.org/l1": latLonRaster(48, 40, land, (x) => x > -220),
    "https://example.org/s1": latLonRaster(48, 40, (x, z) => land(x, z) + (z < -150 ? 12 : 0), (x) => x > -220),
    [nceiUrl(GRID, frame, 999)]: frameRaster((x, z) => heightAtLocal(x, z) + 0.3),
  };
  const asked = [];
  const fetch = async (url, init = {}) => {
    asked.push(url);
    if (init.method === "POST") {
      const q = decodeURIComponent(init.body.slice(5));
      if (q === overpassQuery(box, { date: DATE })) return new Response(JSON.stringify(OSM), { status: 200 });
      if (q === lookQuery(box, { date: DATE })) return new Response(JSON.stringify(LOOK), { status: 200 });
      return new Response("?", { status: 400 });
    }
    if (!answers[url]) return new Response("not found", { status: 404 });
    return new Response(answers[url], { status: 200 });
  };
  return { fetch, asked };
}

describe("a layered fetch", () => {
  const s = spec();
  const io = fakeFetch(s);
  const run = fetchTerrainData(s, { fetch: io.fetch, now: () => new Date("2026-11-15T12:00:00Z") });

  it("asks for each source once: the shore, the look, then every raster in the place's order", async () => {
    await run;
    expect(io.asked).toEqual(["https://overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter", "https://example.org/w10", "https://example.org/w100", "https://example.org/l1", nceiUrl(GRID, frame, 999), "https://example.org/s1"]);
  });
  it("takes each node from the first source on its side that has it, and keeps which, with the canopy", async () => {
    const got = await run;
    const N = GRID.n ** 2;
    const { source, canopy } = unpackLayers(got.layers.bytes, N);
    const names = got.layers.record.names;
    expect(names).toEqual(["w10", "w100", "l1", "f1", "filled", "land-floor"]);
    const counts = got.layers.record.counts;
    expect(counts.w10).toBeGreaterThan(0);
    expect(counts.w100).toBeGreaterThan(0);
    expect(counts.l1).toBeGreaterThan(0);
    expect(counts.f1).toBeGreaterThan(0);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(N);
    // the frame DEM only within a pixel (~27 m) of the lidar's west edge (x = −220) or beyond; the coarse survey only within one of the fine one's (x = 0) or west of it
    for (let k = 0; k < N; k++) {
      const x = GRID.x0 + (k % GRID.n) * GRID.cell;
      if (names[source[k]] === "f1") expect(x).toBeLessThan(-220 + 28);
      if (names[source[k]] === "w100") expect(x).toBeLessThan(28);
    }
    let tall = 0;
    for (let k = 0; k < N; k++) if (canopy[k] >= 11) tall++;
    expect(tall).toBeGreaterThan(0);
    expect(got.summary.check.share).toBeGreaterThan(0.98);
    expect(got.dem.record).toMatchObject({ datum: "MWL", layered: true, n: GRID.n });
    expect(got.sources.map((x) => x.id)).toEqual(["w10", "w100", "l1", "s1", "f1", "osm-overpass", "osm-overpass-look"]);
  });
  it("makes the bytes it made when this was checked (pinned)", async () => {
    const got = await run;
    expect({ dem: got.dem.record.sha256, layers: got.layers.record.sha256, look: got.look.record.sha256 }).toEqual(PINNED);
  });
  it("refuses heights its land source puts upside down against OSM's coastline", async () => {
    const f = spec({ flip: true });
    await expect(fetchTerrainData(f, { fetch: fakeFetch(f).fetch })).rejects.toThrow(/doesn't line up with OpenStreetMap's coastline/);
  });
});

// recorded on 2026-11-15 from this fixture
const PINNED = { dem: "4b6c41bc7efe0b9b4620516e93d8fce5383c0cf6ee01b160e711cdf7dadb0be3", layers: "3834c54d3a872a08b5f5c4aa2bc3e489d44ea2a5c5157eed40b8be21bdb2e90d", look: "5afd0a5afbb36f45c8f892fdc78619c9a9f2d4283164765bee5a90c748fb80be" };
