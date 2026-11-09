// A small made-up terrain for tests: a 65 × 65 grid 8 m apart round the
// origin of the Cadboro frame, a mainland shore across the north, an
// island in the south, a float and a breakwater off the shore, and marks.
// The DEM is a smooth function; the OSM features are hand-written Overpass
// JSON put through osm.js, as fetched data would be.

import { localFrame } from "../tmerc.js";
import { featuresFromOsm } from "../osm.js";
import { quantize } from "../fetch-data.js";
import { bytesToInt16 } from "../terrain-sample.js";
import { cadboroDoc } from "../cadboro.js";

export const GRID = { n: 65, cell: 8, x0: -256, z0: -256 };
export const frame = localFrame(cadboroDoc().origin);

const ll = (x, z) => {
  const [lat, lon] = frame.toLatLon(x, z);
  return { lat, lon };
};
const way = (id, tags, pts, nodes) => ({ type: "way", id, tags, nodes: nodes ?? pts.map((_, k) => id * 100 + k), geometry: pts.map(([x, z]) => ll(x, z)) });

// the mainland, west to east: land on its left, to the north
const MAIN = [[-400.3, -120.6], [-100.2, -90.1], [60.7, -130.4], [400.1, -100.2]];
// an island, counter-clockwise seen from above
const ISLAND = [[40.2, 120.3], [-30.4, 140.1], [-20.6, 190.2], [60.3, 200.7], [90.1, 160.4], [40.2, 120.3]];

export const OSM = {
  osm3s: { timestamp_osm_base: "2026-11-09T00:00:00Z" },
  elements: [
    way(1, { natural: "coastline" }, MAIN),
    way(2, { natural: "coastline" }, ISLAND, [201, 202, 203, 204, 205, 201]),
    way(3, { man_made: "pier", floating: "yes", name: "A Dock" }, [[-60.2, -95.3], [-60.4, -40.1], [-20.3, -40.6]]),
    way(4, { man_made: "breakwater" }, [[0.1, -70.2], [30.3, -70.1], [30.6, -60.4], [0.4, -60.2], [0.1, -70.2]], [401, 402, 403, 404, 401]),
    { type: "node", id: 5, lat: ll(-10, 30).lat, lon: ll(-10, 30).lon, tags: { "seamark:type": "buoy_cardinal", "seamark:buoy_cardinal:category": "north", "seamark:buoy_cardinal:colour": "black;yellow" } },
    { type: "node", id: 6, lat: ll(30, 160).lat, lon: ll(30, 160).lon, tags: { man_made: "lighthouse", name: "Islet light", height: "10", "seamark:light:colour": "white" } },
    { type: "node", id: 7, lat: ll(100, 40).lat, lon: ll(100, 40).lon, tags: { "seamark:type": "buoy_lateral", "seamark:buoy_lateral:colour": "red", "seamark:buoy_lateral:category": "starboard" } },
    { type: "node", id: 8, lat: ll(0, 0).lat, lon: ll(0, 0).lon, tags: { "seamark:type": "notice" } },
  ],
};

export const features = () => featuresFromOsm(OSM, frame);

/**
 * The DEM (NAVD88-ish metres): hills to the north of the mainland shore,
 * a basin to the south, a hill on the island. It agrees with the coastline
 * (as a real DEM nearly does) except within a few metres of it, where a
 * ripple puts the DEM's 0 m contour off OSM's line.
 */
export function demValues() {
  const { n, cell, x0, z0 } = GRID;
  const v = new Float32Array(n * n);
  // the mainland shore's z at x, along MAIN
  const shoreZ = (x) => {
    for (let k = 0; k + 1 < MAIN.length; k++) {
      const [xa, za] = MAIN[k], [xb, zb] = MAIN[k + 1];
      if (x >= xa && x <= xb) return za + ((x - xa) / (xb - xa)) * (zb - za);
    }
    return x < MAIN[0][0] ? MAIN[0][1] : MAIN.at(-1)[1];
  };
  const ring = ISLAND.slice(0, -1);
  const inIsland = (x, z) => {
    let c = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, za] = ring[a], [xb, zb] = ring[b];
      if (za > z !== zb > z && x < xa + ((z - za) * (xb - xa)) / (zb - za)) c = !c;
    }
    return c;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      const h = inIsland(x, z) ? Math.max(2.5, 9 - Math.hypot(x - 30, z - 160) / 8) : -(z - shoreZ(x)) / 12 + 0.4 * Math.sin(x / 37);
      v[j * n + i] = h + 0.68; // NAVD88 is 0.68 m above mean water here (demToMWL)
    }
  }
  return v;
}
export const dem = () => bytesToInt16(quantize(demValues(), 0.02));

export function terrainDoc(extra = {}) {
  const d = cadboroDoc();
  return {
    "@patchwork": { type: "terrain" },
    ...d,
    title: "Test bay",
    grid: { ...GRID },
    places: [{ name: "Middle", kind: "mooring", lat: ll(0, 0).lat, lon: ll(0, 0).lon }],
    data: { dem: { scale: 0.02, offset: 0, n: GRID.n, cell: GRID.cell, x0: GRID.x0, z0: GRID.z0, origin: { ...d.origin } }, features: { origin: { ...d.origin } } },
    sources: [{ id: "test", name: "made up", licence: "none", attribution: "tests" }],
    attribution: "tests",
    ...extra,
  };
}
