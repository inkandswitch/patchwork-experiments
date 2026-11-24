// Transverse Mercator on the WGS84 ellipsoid, and the terrain's local frame.
//
// The forward and inverse maps are Krüger's series to sixth order in n, as
// Karney gives them ("Transverse Mercator with an accuracy of a few
// nanometers", J. Geodesy 85, 2011): within a few thousand kilometres of the
// central meridian they agree with the exact map to well under a millimetre,
// so over a terrain's few kilometres they are exact for every purpose here.
// tmerc.test.js checks them against a fixed table computed with proj4.
//
// The local frame (what every GLB and every doc in this package uses):
//   x east, y up, z south, in metres; the origin is the projection's own
//   (central meridian through the origin's longitude, latitude of origin its
//   latitude, scale 1, no false easting or northing). So grid north is true
//   north along x = 0, and a bearing measured from −Z toward +X is a compass
//   bearing there (sailing's wind `from` is one). y = 0 is the terrain's
//   vertical datum (mean water level: see the doc's `datum`).

const A_WGS84 = 6378137;
const F_WGS84 = 1 / 298.257223563;
const DEG = Math.PI / 180;

const n = F_WGS84 / (2 - F_WGS84);
const e2 = F_WGS84 * (2 - F_WGS84);
const e = Math.sqrt(e2);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
/** The rectifying radius. */
const RECT = (A_WGS84 / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800,
];

/** tan of the conformal latitude, from tan of the geodetic latitude. */
function tauPrime(tau) {
  const s = Math.hypot(1, tau);
  const sigma = Math.sinh(e * Math.atanh((e * tau) / s));
  return tau * Math.hypot(1, sigma) - sigma * s;
}

/** tan of the geodetic latitude, from tan of the conformal (Newton, Karney's eq. 19–21). */
function tauFromPrime(taup) {
  let tau = taup / (1 - e2);
  for (let i = 0; i < 8; i++) {
    const tp = tauPrime(tau);
    const d = ((taup - tp) / Math.hypot(1, tp)) * ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.hypot(1, tau)));
    tau += d;
    if (Math.abs(d) < 1e-15) break;
  }
  return tau;
}

/** Easting and northing (metres, scale 1, about the central meridian `lon0`) of `lat, lon` in degrees, northing from the equator. */
function forwardRaw(lat, lon, lon0) {
  const phi = lat * DEG;
  const lam = (lon - lon0) * DEG;
  const taup = tauPrime(Math.tan(phi));
  const xip = Math.atan2(taup, Math.cos(lam));
  const etap = Math.asinh(Math.sin(lam) / Math.hypot(taup, Math.cos(lam)));
  let xi = xip, eta = etap;
  for (let j = 1; j <= 6; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
  }
  return [RECT * eta, RECT * xi];
}

/** The inverse of forwardRaw: [lat, lon] in degrees. */
function inverseRaw(E, N, lon0) {
  const xi = N / RECT, eta = E / RECT;
  let xip = xi, etap = eta;
  for (let j = 1; j <= 6; j++) {
    xip -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etap -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const taup = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
  const lam = Math.atan2(Math.sinh(etap), Math.cos(xip));
  return [Math.atan(tauFromPrime(taup)) / DEG, lon0 + lam / DEG];
}

/**
 * The local frame about `origin` ({ lat, lon }, degrees): toLocal(lat, lon)
 * → [x, z] metres (x east, z south), toLatLon(x, z) → [lat, lon].
 * @param {{ lat: number, lon: number }} origin
 */
export function localFrame(origin) {
  const lat0 = Number(origin?.lat), lon0 = Number(origin?.lon);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || Math.abs(lat0) > 84 || Math.abs(lon0) > 180) throw new Error(`Not a place: ${JSON.stringify(origin)}`);
  const N0 = forwardRaw(lat0, lon0, lon0)[1];
  return Object.freeze({
    origin: Object.freeze({ lat: lat0, lon: lon0 }),
    toLocal(lat, lon) {
      const [E, N] = forwardRaw(lat, lon, lon0);
      return [E, -(N - N0)];
    },
    toLatLon(x, z) {
      return inverseRaw(x, N0 - z, lon0);
    },
    /** The frame as a WKT a GIS server understands (Esri's flavour): what NCEI is asked to resample into. */
    wkt: `PROJCS["Local TM",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${lon0}],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",${lat0}],UNIT["Meter",1.0]]`,
    proj4: `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`,
  });
}

export const PROJECTION = "tmerc-wgs84-k1";
