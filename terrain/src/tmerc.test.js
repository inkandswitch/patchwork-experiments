import { describe, it, expect } from "vitest";
import { localFrame } from "./tmerc.js";

// proj4 2.12.1, "+proj=tmerc +lat_0=48.454 +lon_0=-123.2915 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs",
// computed 2026-11-09: [name, lat, lon, easting, −northing] (x east, z south, metres)
const PROJ4 = [
  ["mooring field (the origin)", 48.454, -123.2915, 0, 0],
  ["RVYC clubhouse", 48.45137, -123.2968, -392.052, 292.4401],
  ["breakwater", 48.45211, -123.29399, -184.1878, 210.1634],
  ["V dock", 48.45307, -123.29501, -259.6333, 103.4092],
  ["Ten Mile Point", 48.45543, -123.26561, 1914.9842, -159.3386],
  ["Discovery Island lighthouse", 48.42459, -123.22566, 4872.8815, 3268.264],
  ["Oak Bay Marina", 48.42546, -123.30185, -766.0004, 3173.564],
  ["Haro Strait VD buoy", 48.45147, -123.18075, 8192.3902, 275.4082],
  ["Finnerty Cove gauge", 48.473583, -123.296083, -338.8661, -2177.6268],
  ["grid NW corner", 48.47558, -123.31314, -1599.9945, -2399.9083],
  ["grid SE corner", 48.40188, -123.20247, 6592.1305, 5791.8431],
  ["70 km away", 48, -122.5, 59065.7735, 50179.216],
];

describe("the local frame (transverse Mercator about the origin)", () => {
  const f = localFrame({ lat: 48.454, lon: -123.2915 });

  it.each(PROJ4)("%s: forward agrees with proj4 to under a millimetre", (name, lat, lon, x, z) => {
    const [gx, gz] = f.toLocal(lat, lon);
    expect(Math.abs(gx - x)).toBeLessThan(1e-3);
    expect(Math.abs(gz - z)).toBeLessThan(1e-3);
  });

  it.each(PROJ4)("%s: inverse takes proj4's metres back to the place, within a millimetre", (name, lat, lon, x, z) => {
    const [la, lo] = f.toLatLon(x, z);
    // a millimetre is ~9e-9° of latitude, ~1.4e-8° of longitude here
    expect(Math.abs(la - lat) * 111_200).toBeLessThan(1e-3);
    expect(Math.abs(lo - lon) * 73_800).toBeLessThan(1e-3);
  });

  it("is x east, z south: north of the origin is −z, east is +x", () => {
    const [xn, zn] = f.toLocal(48.464, -123.2915);
    expect(Math.abs(xn)).toBeLessThan(1e-9);
    expect(zn).toBeCloseTo(-1112.0, 0);
    const [xe, ze] = f.toLocal(48.454, -123.2815);
    expect(xe).toBeGreaterThan(700);
    expect(Math.abs(ze)).toBeLessThan(2);
  });

  it("refuses a place that isn't one", () => {
    expect(() => localFrame({ lat: 91, lon: 0 })).toThrow();
    expect(() => localFrame({ lat: "x", lon: 0 })).toThrow();
  });
});
