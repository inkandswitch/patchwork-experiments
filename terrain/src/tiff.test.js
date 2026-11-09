import { describe, it, expect } from "vitest";
import { readTiff } from "./tiff.js";
import { checkDem, quantize, nceiUrl } from "./fetch-data.js";
import { localFrame } from "./tmerc.js";
import { bytesToInt16 } from "./terrain-sample.js";

/** A little-endian float32 GeoTIFF in strips of `rps` rows, as NCEI sends one. */
function makeTiff(w, h, values, { rps = 2, scale = [8, 8, 0], tie = [0, 0, 0, -4, 4, 0], nodata = "-99999", compression = 1 } = {}) {
  const entries = [];
  const strips = Math.ceil(h / rps);
  const extra = [];
  let tail = 8 + 2 + 12 * 14 + 4;
  const put = (bytes) => {
    const at = tail;
    extra.push([at, bytes]);
    tail += bytes.length + (bytes.length % 2);
    return at;
  };
  const f64 = (arr) => new Uint8Array(new Float64Array(arr).buffer);
  const u32 = (arr) => new Uint8Array(new Uint32Array(arr).buffer);
  const data = new Uint8Array(new Float32Array(values).buffer);
  const offsets = [], counts = [];
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rps, h - s * rps);
    offsets.push(put(data.slice(s * rps * w * 4, (s * rps + rows) * w * 4)));
    counts.push(rows * w * 4);
  }
  const offAt = put(u32(offsets)), cntAt = put(u32(counts));
  const scaleAt = put(f64(scale)), tieAt = put(f64(tie));
  const nd = new TextEncoder().encode(nodata + "\0");
  const ndAt = put(nd);
  entries.push([256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, 32], [259, 3, 1, compression], [273, 4, strips, strips === 1 ? offsets[0] : offAt], [277, 3, 1, 1], [278, 4, 1, rps], [279, 4, strips, strips === 1 ? counts[0] : cntAt], [284, 3, 1, 1], [339, 3, 1, 3], [33550, 12, 3, scaleAt], [33922, 12, 6, tieAt], [42113, 2, nd.length, ndAt], [262, 3, 1, 1]);
  entries.sort((a, b) => a[0] - b[0]);
  const out = new Uint8Array(tail);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49]);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 10 + 12 * i;
    dv.setUint16(at, tag, true);
    dv.setUint16(at + 2, type, true);
    dv.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(at + 8, value, true);
    else dv.setUint32(at + 8, value, true);
  });
  for (const [at, bytes] of extra) out.set(bytes, at);
  return out;
}

describe("readTiff", () => {
  const vals = Array.from({ length: 15 }, (_, k) => k * 1.5 - 7.25);

  it("reads float32 strips, the pixel scale, the tie point and nodata", () => {
    const t = readTiff(makeTiff(5, 3, vals));
    expect(t.width).toBe(5);
    expect(t.height).toBe(3);
    expect([...t.data]).toEqual(vals);
    expect(t.pixelScale).toEqual([8, 8, 0]);
    expect(t.tiepoint).toEqual([0, 0, 0, -4, 4, 0]);
    expect(t.nodata).toBe(-99999);
  });

  it("reads the same values whatever the strip height", () => {
    for (const rps of [1, 2, 3]) expect([...readTiff(makeTiff(5, 3, vals, { rps })).data]).toEqual(vals);
  });

  it("refuses a compressed TIFF, and something that isn't one", () => {
    expect(() => readTiff(makeTiff(5, 3, vals, { compression: 5 }))).toThrow(/compressed/);
    expect(() => readTiff(new TextEncoder().encode("<html>502</html>"))).toThrow(/Not a TIFF/);
  });
});

describe("checkDem: the answer is the grid asked for, or refused", () => {
  const grid = { n: 3, cell: 8, x0: -8, z0: -8 };
  const ok = { scale: [8, 8, 0], tie: [0, 0, 0, -12, 12, 0] };
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("takes the right grid: tied half a cell outside the north-west node", () => {
    expect([...checkDem(readTiff(makeTiff(3, 3, v, ok)), grid)]).toEqual(v);
  });
  it("refuses another size, another cell, another tie point, or missing heights", () => {
    expect(() => checkDem(readTiff(makeTiff(3, 2, v.slice(0, 6), ok)), grid)).toThrow(/3 × 2/);
    expect(() => checkDem(readTiff(makeTiff(3, 3, v, { ...ok, scale: [10, 10, 0] })), grid)).toThrow(/pixels/);
    expect(() => checkDem(readTiff(makeTiff(3, 3, v, { ...ok, tie: [0, 0, 0, -8, 8, 0] })), grid)).toThrow(/tied/);
    expect(() => checkDem(readTiff(makeTiff(3, 3, [1, 2, -99999, 4, 5, 6, 7, 8, NaN], ok)), grid)).toThrow(/2 of/);
  });
});

describe("quantize", () => {
  it("rounds to 2 cm steps, exactly at the extremes it allows, and refuses what doesn't fit", () => {
    const q = bytesToInt16(quantize([0, 0.011, -0.011, 0.031, 0.009, 655.34, -655.34, 1.234], 0.02));
    expect([...q]).toEqual([0, 1, -1, 2, 0, 32767, -32767, 62]);
    expect(() => quantize([700], 0.02)).toThrow(/fit/);
  });
});

describe("nceiUrl", () => {
  it("asks for the grid's nodes as pixel centres, in the local frame, from the locked NAVD88 raster", () => {
    const f = localFrame({ lat: 48.454, lon: -123.2915 });
    const u = new URL(nceiUrl({ n: 1025, cell: 8, x0: -1600, z0: -2400 }, f));
    expect(u.searchParams.get("bbox")).toBe("-1604,-5796,6596,2404");
    expect(u.searchParams.get("size")).toBe("1025,1025");
    expect(JSON.parse(u.searchParams.get("mosaicRule")).lockRasterIds).toEqual([171]);
    expect(JSON.parse(u.searchParams.get("imageSR")).wkt).toContain('PARAMETER["Central_Meridian",-123.2915]');
    expect(u.searchParams.get("compression")).toBe("None");
  });

  it("asks in the frame toLocal is: the WKT's parameters are exactly the proj4 definition tmerc.test checks toLocal against", () => {
    const f = localFrame({ lat: 48.454, lon: -123.2915 });
    const u = new URL(nceiUrl({ n: 1025, cell: 8, x0: -1600, z0: -2400 }, f));
    for (const key of ["bboxSR", "imageSR"]) {
      const wkt = JSON.parse(u.searchParams.get(key)).wkt;
      const param = (name) => Number(wkt.match(new RegExp(`PARAMETER\\["${name}",(-?[0-9.]+)\\]`))?.[1]);
      expect(wkt).toMatch(/PROJECTION\["Transverse_Mercator"\]/);
      expect(wkt).toMatch(/SPHEROID\["WGS_1984",6378137\.0,298\.257223563\]/);
      expect(wkt).toMatch(/UNIT\["Meter",1\.0\]\]$/);
      const proj4 = `+proj=tmerc +lat_0=${param("Latitude_Of_Origin")} +lon_0=${param("Central_Meridian")} +k=${param("Scale_Factor")} +x_0=${param("False_Easting")} +y_0=${param("False_Northing")} +ellps=WGS84 +units=m +no_defs`;
      // the definition tmerc.test.js's proj4 table was computed with
      expect(proj4).toBe("+proj=tmerc +lat_0=48.454 +lon_0=-123.2915 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs");
      expect(proj4).toBe(f.proj4);
    }
  });

  it("puts pixel (i, j) on node (i, j): easting x, northing −z, row 0 the north", () => {
    const grid = { n: 1025, cell: 8, x0: -1600, z0: -2400 };
    const u = new URL(nceiUrl(grid, localFrame({ lat: 48.454, lon: -123.2915 })));
    const [xmin, ymin, xmax, ymax] = u.searchParams.get("bbox").split(",").map(Number);
    const [w, h] = u.searchParams.get("size").split(",").map(Number);
    for (const [i, j] of [[0, 0], [1024, 0], [0, 1024], [1024, 1024], [200, 300], [512, 512]]) {
      // a raster's pixel centre: columns west to east, rows north to south
      const e = xmin + ((i + 0.5) * (xmax - xmin)) / w, nth = ymax - ((j + 0.5) * (ymax - ymin)) / h;
      expect(e).toBeCloseTo(grid.x0 + i * grid.cell, 9);
      expect(-nth).toBeCloseTo(grid.z0 + j * grid.cell, 9);
    }
  });
});
