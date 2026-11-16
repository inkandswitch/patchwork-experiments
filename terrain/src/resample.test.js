import { describe, it, expect } from "vitest";
import { readTiff } from "./tiff.js";
import { resampleLatLon, atNodes, canopyAtNodes, sampleModel } from "./resample.js";
import { localFrame } from "./tmerc.js";
import { writeTiff } from "./test/tiff-writer.js";

const frame = localFrame({ lat: 48.95, lon: -125.558 });
const GRID = { n: 17, cell: 20, x0: -160, z0: -160 };
// a lat/lon raster round the grid: 30 × 24 pixels of 0.0003° × 0.0002°
const W = 30, H = 24, LON0 = -125.5625, LAT0 = 48.9524, DLON = 0.0003, DLAT = 0.0002;
const field = (lon, lat) => 3 + 1000 * (lon - LON0) - 700 * (lat - LAT0);

function raster({ point = false, le = true, tile = null, nodataAt = [] } = {}) {
  const c = point ? 0 : 0.5;
  const v = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) v[r * W + q] = field(LON0 + (q + c) * DLON, LAT0 - (r + c) * DLAT);
  for (const k of nodataAt) v[k] = -99999;
  return readTiff(writeTiff(W, H, v, { le, tile, point, transformation: [DLON, 0, 0, LON0, 0, -DLAT, 0, LAT0, 0, 0, 0, 0, 0, 0, 0, 1] }));
}

describe("resampleLatLon", () => {
  for (const [name, o] of [["pixel is area, little-endian strips", {}], ["pixel is point, big-endian tiles", { point: true, le: false, tile: [16, 16] }]]) {
    it(`returns a field linear in lon and lat exactly, at every node (${name})`, () => {
      const t = raster(o);
      const v = resampleLatLon(t, GRID, frame, -2);
      for (let j = 0; j < GRID.n; j++) {
        for (let i = 0; i < GRID.n; i++) {
          const [lat, lon] = frame.toLatLon(GRID.x0 + i * GRID.cell, GRID.z0 + j * GRID.cell);
          expect(Math.abs(v[j * GRID.n + i] - (field(lon, lat) - 2))).toBeLessThan(2e-4);
        }
      }
    });
  }

  it("gives nothing exactly where a missing pixel is weighed: every node within one pixel of its centre in both axes", () => {
    const missing = 11 * W + 13;
    const t = raster({ nodataAt: [missing] });
    const v = resampleLatLon(t, GRID, frame);
    const pc = 13.5, pr = 11.5; // the missing pixel's centre, in pixels
    let none = 0;
    for (let j = 0; j < GRID.n; j++) {
      for (let i = 0; i < GRID.n; i++) {
        const [lat, lon] = frame.toLatLon(GRID.x0 + i * GRID.cell, GRID.z0 + j * GRID.cell);
        const fx = (lon - LON0) / DLON, fy = (LAT0 - lat) / DLAT;
        const touches = Math.abs(fx - pc) < 1 && Math.abs(fy - pr) < 1;
        expect(Number.isNaN(v[j * GRID.n + i])).toBe(touches);
        if (touches) none++;
      }
    }
    expect(none).toBeGreaterThan(0);
  });

  it("gives nothing off the raster", () => {
    const t = raster();
    expect(sampleModel(t, LON0 - 0.001, LAT0 - 0.001)).toBeNaN();
    expect(sampleModel(t, LON0 + 0.001, LAT0 + 0.0001)).toBeNaN();
  });
});

describe("atNodes", () => {
  const n = 5, cell = 20, x0 = -40, z0 = -40;
  const vals = Float32Array.from({ length: n * n }, (_, k) => (k === 7 ? -99999 : k * 0.5));
  const make = (dx = 0) => readTiff(writeTiff(n, n, vals, { scale: [cell, cell, 0], tie: [0, 0, 0, x0 - cell / 2 + dx, -z0 + cell / 2, 0], crs: 32767 }));
  it("takes pixel (i, j) as node (i, j), adds the offset, and has nothing where the raster has nothing", () => {
    const v = atNodes(make(), { n, cell, x0, z0 }, 1);
    for (let k = 0; k < n * n; k++) k === 7 ? expect(v[k]).toBeNaN() : expect(v[k]).toBe(k * 0.5 + 1);
  });
  it("refuses a raster half a cell off the grid", () => {
    expect(() => atNodes(make(10), { n, cell, x0, z0 })).toThrow(/aren't the grid's nodes/);
  });
});

describe("canopyAtNodes", () => {
  it("is the largest surface-less-terrain of the pixels whose centres fall in each node's cell, 0 where none has both", () => {
    const dtmV = new Float32Array(W * H).fill(10);
    const dsmV = Float32Array.from({ length: W * H }, (_, k) => 10 + ((k * 7) % 31));
    dsmV[5] = -99999;
    const geo = { transformation: [DLON, 0, 0, LON0, 0, -DLAT, 0, LAT0, 0, 0, 0, 0, 0, 0, 0, 1] };
    const dtm = readTiff(writeTiff(W, H, dtmV, geo)), dsm = readTiff(writeTiff(W, H, dsmV, geo));
    const c = canopyAtNodes(dtm, dsm, GRID, frame);
    for (let j = 0; j < GRID.n; j++) {
      for (let i = 0; i < GRID.n; i++) {
        const x = GRID.x0 + i * GRID.cell, z = GRID.z0 + j * GRID.cell;
        const [la0, lo0] = frame.toLatLon(x - 10, z - 10), [la1, lo1] = frame.toLatLon(x + 10, z + 10);
        let best = 0;
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
          const lon = LON0 + (q + 0.5) * DLON, lat = LAT0 - (r + 0.5) * DLAT;
          if (lon < Math.min(lo0, lo1) || lon > Math.max(lo0, lo1) || lat < Math.min(la0, la1) || lat > Math.max(la0, la1)) continue;
          if (r * W + q === 5) continue;
          best = Math.max(best, dsmV[r * W + q] - dtmV[r * W + q]);
        }
        expect(c[j * GRID.n + i]).toBe(best);
      }
    }
  });
});
