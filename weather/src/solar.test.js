// Where the sun is (solar.js), against published values: Meeus's worked
// examples, the NREL SPA paper's worked example and USNO's 2026 equinoxes and
// solstices, each to the tolerance the low-accuracy algorithm claims (0.01°,
// 0.02° where the reference models more than we do). Then structural rows
// (polar day and night, the zenith at an equinox noon, the quadrants) and the
// stage-frame direction over the compass. Finite tables only.
import { describe, expect, it } from "vitest";
import { centuries, julianDay, refraction, siderealTime, sunAt, sunCoordinates, sunDirection } from "./solar.js";
import { instantOf } from "./time.js";

const near = (got, want, tol) => expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(tol);
/** Angular difference in degrees, wrapped to [0, 180]. */
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

describe("julianDay", () => {
  it.each([
    ["J2000.0, 2000-01-01 12:00 UT", Date.UTC(2000, 0, 1, 12), 2_451_545],
    ["Meeus Example 7.a, 1957 Oct 4.81", Date.UTC(1957, 9, 4, 19, 26, 24), 2_436_116.31],
    ["the Unix epoch", 0, 2_440_587.5],
  ])("%s", (_, ms, jd) => near(julianDay(ms), jd, 1e-9));
});

describe("the sun's coordinates, Meeus Example 25.a (1992 Oct 13.0 TD)", () => {
  const s = sunCoordinates(centuries(2_448_908.5));
  it.each([
    ["mean longitude L0", s.meanLongitude, 201.8072, 1e-4],
    ["apparent longitude λ", s.longitude, 199.90895, 1e-4],
    ["corrected obliquity ε", s.obliquity, 23.43999, 1e-4],
    ["apparent right ascension α", s.rightAscension, 198.38083, 0.01],
    ["apparent declination δ", s.declination, -7.78507, 0.01],
  ])("%s", (_, got, want, tol) => near(got, want, tol));
});

describe("sidereal time, Meeus Examples 12.a and 12.b (mean, Δψ = 0)", () => {
  it.each([
    ["1987 Apr 10 0h UT: 13h10m46.3668s", 2_446_895.5, 197.693195],
    ["1987 Apr 10 19h21m UT: 8h34m57.0896s", 2_446_895.5 + (19 + 21 / 60) / 24, 128.7378734],
  ])("%s", (_, jd, want) => near(siderealTime(jd, { nutation: 0, obliquity: 23.44 }), want, 1e-5));
});

describe("sunAt's fields", () => {
  // Two elevations, each named for what it is, so a caller picks one on
  // purpose: the direction is apparent; presence, bands and gates are
  // geometric (WEATHER.md, "sun").
  it("are exactly azimuth, apparent, geometric and declination", () => {
    expect(Object.keys(sunAt(Date.UTC(2026, 6, 15, 22), 48.454, -123.2915)).sort()).toEqual(["apparent", "azimuth", "declination", "geometric"]);
  });
});

describe("the default weather's sun, end to end through instantOf (an independent ephemeris, astronomy-engine 2.1.19: 225.576°, 56.302°)", () => {
  // Cadboro Bay, 2026-07-15 15:00 America/Vancouver (index.js's init).
  const r = sunAt(instantOf({ date: "2026-07-15", hour: 15, offset: -7 }), 48.454, -123.2915);
  it("azimuth 225.57°", () => near(r.azimuth, 225.57, 0.02));
  it("apparent elevation 56.30°", () => near(r.apparent, 56.30, 0.02));
});

describe("the NREL SPA paper's worked example (2003-10-17 12:30:30 at UTC-7, 39.742476 N, 105.1786 W)", () => {
  // SPA is topocentric with refraction at 820 hPa and 11 °C; we are
  // geocentric (parallax 0.002°) with standard air (0.004° more refraction
  // at 40°). 0.02° holds both and the algorithm's 0.01°.
  const r = sunAt(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
  it("zenith 50.11162°", () => near(90 - r.apparent, 50.11162, 0.02));
  it("azimuth 194.34024°", () => near(r.azimuth, 194.34024, 0.02));
});

describe("USNO's 2026 equinoxes and solstices: the apparent longitude is 0, 90, 180, 270 and δ is 0 or ±ε", () => {
  it.each([
    ["March equinox, Mar 20 14:46 UT", Date.UTC(2026, 2, 20, 14, 46), 0, 0],
    ["June solstice, Jun 21 08:24 UT", Date.UTC(2026, 5, 21, 8, 24), 90, 1],
    ["September equinox, Sep 23 00:05 UT", Date.UTC(2026, 8, 23, 0, 5), 180, 0],
    ["December solstice, Dec 21 20:50 UT", Date.UTC(2026, 11, 21, 20, 50), 270, -1],
  ])("%s", (_, ms, longitude, sign) => {
    const s = sunCoordinates(centuries(julianDay(ms)));
    near(angle(s.longitude, longitude), 0, 0.01);
    near(s.declination, sign * s.obliquity, 0.01);
    near(sunAt(ms, 0, 0).declination, s.declination, 1e-12);
  });
});

describe("structural rows", () => {
  it("the equator at the March equinox at local solar noon (Greenwich, 12:00 UT plus the equation of time's 7.4 min): the sun is overhead", () => {
    expect(sunAt(Date.UTC(2026, 2, 20, 12, 7, 25), 0, 0).apparent).toBeGreaterThan(89);
  });
  it("80°N at the June solstice at midnight: polar day, the sun is up", () => {
    expect(sunAt(Date.UTC(2026, 5, 21, 0), 80, 0).apparent).toBeGreaterThan(0);
  });
  it("80°N at the December solstice at noon: polar night, the sun is down", () => {
    expect(sunAt(Date.UTC(2026, 11, 21, 12), 80, 0).apparent).toBeLessThan(0);
  });
  // The March equinox at Greenwich: the sun rises in the east and sets in
  // the west, and crosses the meridian to the south in the north and to the
  // north in the south.
  it.each([
    ["45°N morning: south-east", 45, 9, 90, 180],
    ["45°N afternoon: south-west", 45, 15, 180, 270],
    ["45°S morning: north-east", -45, 9, 0, 90],
    ["45°S afternoon: north-west", -45, 15, 270, 360],
  ])("%s", (_, lat, hour, lo, hi) => {
    const r = sunAt(Date.UTC(2026, 2, 20, hour), lat, 0);
    expect(r.apparent).toBeGreaterThan(0);
    expect(r.azimuth).toBeGreaterThan(lo);
    expect(r.azimuth).toBeLessThan(hi);
  });
  it("Ucluelet at local solar noon on the June solstice (12:00 UT, plus 125.558°/15 h, minus the equation of time's -1.6 min): due south at 90° - lat + ε", () => {
    const r = sunAt(Date.UTC(2026, 5, 21, 12) + ((125.558 / 15) * 60 + 1.6) * 60_000, 48.95, -125.558);
    near(r.azimuth, 180, 0.5);
    near(r.apparent, 90 - 48.95 + 23.44, 0.05);
  });
});

describe("refraction (Sæmundsson, Meeus 16.4)", () => {
  /** Bennett's formula (Meeus 16.3): refraction in arcminutes for an apparent altitude a. */
  const bennett = (a) => 1 / Math.tan(((a + 7.31 / (a + 4.4)) * Math.PI) / 180);
  it.each([0, 1, 5, 10, 30, 60, 89, 90])("at %s° it is Bennett's inverse to 0.1′ (Meeus's stated agreement)", (h) => {
    const R = refraction(h);
    near(bennett(h + R), R * 60, 0.1);
  });
  it("is 0 at the zenith, and lifts a sun 34′ below the horizon onto it (the standard 34′, to 1′)", () => {
    near(refraction(90), 0, 1e-6);
    near(refraction(-34 / 60) * 60, 34, 1);
  });
  it("holds its -1° value below -1°, so it is continuous", () => {
    for (const h of [-1.0000001, -1.5, -5.11, -18, -90]) expect(refraction(h)).toBe(refraction(-1));
  });
  it("is non-increasing, and the apparent elevation is increasing, from -90° to 90° in 0.5° steps", () => {
    for (let h = -90; h < 90; h += 0.5) {
      expect(refraction(h + 0.5)).toBeLessThanOrEqual(refraction(h));
      expect(h + 0.5 + refraction(h + 0.5)).toBeGreaterThan(h + refraction(h));
    }
  });
  it("sunAt's apparent elevation is its geometric elevation refracted", () => {
    const r = sunAt(Date.UTC(2026, 6, 15, 22), 48.454, -123.2915);
    expect(r.apparent).toBe(r.geometric + refraction(r.geometric));
  });
});

describe("sunDirection: north -Z, east +X, up +Y", () => {
  const COMPASS = [
    ["N", 0, 0, -1],
    ["NE", 45, 1, -1],
    ["E", 90, 1, 0],
    ["SE", 135, 1, 1],
    ["S", 180, 0, 1],
    ["SW", 225, -1, 1],
    ["W", 270, -1, 0],
    ["NW", 315, -1, -1],
  ];
  const sign = (v) => (Math.abs(v) < 1e-12 ? 0 : Math.sign(v));
  for (const [name, az, sx, sz] of COMPASS) {
    for (const el of [0, 45, 90]) {
      it(`${name} at ${el}°`, () => {
        const [x, y, z] = sunDirection(az, el);
        near(Math.hypot(x, y, z), 1, 1e-12);
        near(y, Math.sin((el * Math.PI) / 180), 1e-12);
        if (el === 90) expect([sign(x), sign(z)]).toEqual([0, 0]);
        else expect([sign(x), sign(z)]).toEqual([sx, sz]);
        // The horizontal part points along the azimuth.
        if (el < 90) near(angle((Math.atan2(x, -z) * 180) / Math.PI, az), 0, 1e-9);
      });
    }
  }
});
