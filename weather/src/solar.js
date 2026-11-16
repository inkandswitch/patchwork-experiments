// Where the sun is (WEATHER.md, "What it offers"): the sun's apparent
// position for an instant and a place on Earth, and its direction in the
// stage's frame. Pure arithmetic, no tables.
//
// The algorithm is Meeus's low-accuracy one (Astronomical Algorithms, 2nd
// ed.), the same one NOAA's solar calculator implements, good to about 0.01°
// for 1900-2100:
//   - the sun's apparent right ascension and declination, ch. 25 ("Solar
//     coordinates, low accuracy");
//   - the hour angle from apparent sidereal time, ch. 12 with the nutation in
//     longitude's principal term (ch. 22), rather than NOAA's equation-of-time
//     shortcut, which errs by up to a few seconds of time;
//   - the equation of time, ch. 28 (eq. 28.3), reported, not used;
//   - refraction, Sæmundsson's formula, ch. 16 (eq. 16.4), the true-to-
//     apparent inverse of Bennett's, zeroed at the zenith as Meeus advises.
// Time is UT throughout: the sun moves 0.003° in ΔT (about 69 s today),
// a third of the algorithm's own error (Decision 14).

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const tan = (d) => Math.tan(d * RAD);
const deg = (r) => r / RAD;
const norm = (d) => ((d % 360) + 360) % 360;

/** The Julian Day of an instant in Unix ms. */
export function julianDay(ms) {
  return ms / 86_400_000 + 2_440_587.5;
}

/** Julian centuries from J2000.0 for a Julian Day. */
export function centuries(jd) {
  return (jd - 2_451_545) / 36_525;
}

/**
 * The sun's apparent geocentric coordinates at T Julian centuries from
 * J2000.0 (Meeus ch. 25, low accuracy). Degrees.
 */
export function sunCoordinates(T) {
  const L0 = norm(280.46646 + T * (36000.76983 + T * 0.0003032)); // mean longitude
  const M = 357.52911 + T * (35999.05029 - T * 0.0001537); // mean anomaly
  const C =
    (1.914602 - T * (0.004817 + T * 0.000014)) * sin(M) +
    (0.019993 - T * 0.000101) * sin(2 * M) +
    0.000289 * sin(3 * M); // equation of centre
  const omega = 125.04 - 1934.136 * T; // the Moon's ascending node
  const longitude = norm(L0 + C - 0.00569 - 0.00478 * sin(omega)); // apparent: aberration and nutation
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliquity = eps0 + 0.00256 * cos(omega); // corrected for nutation
  const rightAscension = norm(deg(Math.atan2(cos(obliquity) * sin(longitude), cos(longitude))));
  const declination = deg(Math.asin(sin(obliquity) * sin(longitude)));
  const nutation = (-17.2 / 3600) * sin(omega); // Δψ, its principal term (ch. 22)
  return { meanLongitude: L0, longitude, obliquity, rightAscension, declination, nutation };
}

/** Greenwich apparent sidereal time at Julian Day jd (UT), degrees (Meeus 12.4 plus Δψ·cos ε). */
export function siderealTime(jd, { nutation, obliquity }) {
  const T = centuries(jd);
  const mean = 280.46061837 + 360.98564736629 * (jd - 2_451_545) + T * T * (0.000387933 - T / 38_710_000);
  return norm(mean + nutation * cos(obliquity));
}

/**
 * Atmospheric refraction in degrees for a true (geometric) elevation h in
 * degrees: Sæmundsson's formula (Meeus 16.4), standard air (1010 hPa, 10 °C),
 * shifted by Meeus's +0.0019279′ so it is 0 at the zenith. Below -1° the
 * formula leaves its domain (it diverges at -5.11°), so the refraction holds
 * its -1° value: continuous everywhere, and it only ever moves a sun that is
 * below the horizon, where nothing is lit by it.
 */
export function refraction(h) {
  const a = Math.max(h, -1);
  return (1.02 / tan(a + 10.3 / (a + 5.11)) + 0.0019279) / 60;
}

/**
 * The sun seen from latitude lat, longitude lon (degrees, north and east
 * positive) at instant ms (Unix ms, UT):
 *   azimuth: degrees from true north, clockwise (east 90);
 *   elevation: apparent, refraction included (what the eye and the light see);
 *   geometric: true elevation of the sun's centre (sunrise is -0.833°);
 *   declination: degrees;
 *   eqTime: the equation of time, minutes (apparent minus mean solar time).
 */
export function sunAt(ms, lat, lon) {
  const jd = julianDay(ms);
  const s = sunCoordinates(centuries(jd));
  const H = siderealTime(jd, s) + lon - s.rightAscension; // local hour angle
  const d = s.declination;
  const geometric = deg(Math.asin(Math.max(-1, Math.min(1, sin(lat) * sin(d) + cos(lat) * cos(d) * cos(H)))));
  // Meeus 13.5 measures azimuth from the south, westward; +180 is from north, clockwise.
  const azimuth = norm(deg(Math.atan2(sin(H), cos(H) * sin(lat) - tan(d) * cos(lat))) + 180);
  const E = s.meanLongitude - 0.0057183 - s.rightAscension + s.nutation * cos(s.obliquity); // Meeus 28.3
  const eqTime = 4 * (norm(E + 180) - 180);
  return { azimuth, elevation: geometric + refraction(geometric), geometric, declination: d, eqTime };
}

/**
 * The unit vector toward the sun in the stage's frame (north -Z, east +X,
 * up +Y; terrain tmerc.js, sailing wind.js) for azimuth A and elevation E
 * in degrees: [sin A cos E, sin E, -cos A cos E].
 */
export function sunDirection(azimuth, elevation) {
  const ce = cos(elevation);
  return [sin(azimuth) * ce, sin(elevation), -cos(azimuth) * ce];
}
