// Cadboro Bay, Victoria BC: the waters off the Royal Victoria Yacht Club
// (3475 Ripon Road), out through Baynes Channel to Discovery Island, and
// south to Oak Bay. Everything here is what research found on 2026-11-09
// (README, "Cadboro Bay"); the data itself is fetched by fetch-data.js and
// cached in the Terrain doc, never read from here at build time.

/** The frame's origin: the club's mooring field (an estimate: OSM maps no moorings in the bay). */
export const ORIGIN = Object.freeze({ lat: 48.454, lon: -123.2915 });

/**
 * The grid: 1025 × 1025 nodes 8 m apart, 8.192 km a side, node (i, j) at
 * (x0 + i·cell, z0 + j·cell), row 0 the northernmost. x −1600…6592 (west of
 * the club to Haro Strait), z −2400…5792 (Finnerty Cove to Oak Bay).
 */
export const GRID = Object.freeze({ n: 1025, cell: 8, x0: -1600, z0: -2400 });

/**
 * Heights are above mean water level (MWL). The CHS gauge at Finnerty Cove
 * (07140), 2 km north of the club, puts MWL 1.99 m above chart datum and
 * 0.11 m above CGVD2013; the tide's levels are its, relative to MWL.
 */
export const DATUM = Object.freeze({
  zero: "MWL",
  station: "CHS 07140 Finnerty Cove",
  mwlAboveChartDatum: 1.99,
  mwlAboveCGVD2013: 0.11,
  tide: Object.freeze({ HHWLT: 1.2, MHHW: 0.84, MLLW: -1.22, LLWLT: -2.14 }),
});

/**
 * NCEI's DEM is in NAVD88. Over 207,000 water cells of this grid, CHS's
 * NONNA-10 (converted to CGVD2013) minus NCEI has a median of −0.57 m, and
 * MWL is 0.11 m above CGVD2013, so a height above MWL is the DEM's less
 * 0.68 m. (A median of two surveys, good to a few decimetres, not a
 * geodetic transformation.)
 */
export const DEM_TO_MWL = -0.68;

/**
 * A summer afternoon's breeze: ECCC's Discovery Island station (1012475),
 * July and August 2019–2025, 13:00–18:00 PDT, 2,599 hours: from the WSW
 * (resultant 235° weighted by speed, 237° unweighted), median 3.3 m/s, 75th
 * percentile 4.2, 90th 5.3. The exact requests and the filter are
 * fetch-data.js WINDS. A south-westerly reaches the bay over Uplands and
 * Oak Bay, so the bay is a lee: short, small waves (scale 0.5).
 */
export const WIND = Object.freeze({ speed: 4, from: 235, scale: 0.5, source: "ECCC climate-hourly, station 1012475 (Discovery Island), Jul–Aug 2019–2025, 13:00–18:00 PDT (LOCAL_HOUR 12–17 LST), 2,599 hours: from 235° (speed-weighted resultant; 237° unweighted), median 3.3 m/s, p75 4.2, p90 5.3" });

/**
 * OpenStreetMap as it was when this place was fetched and checked
 * (probes/fetch-cadboro.mjs): the template and Fetch data ask Overpass for
 * this moment ([date:…]), so every scene gets the same shore, and an edit
 * that leaves the coastline open for a while can't break it.
 */
export const OSM_DATE = "2026-11-09T20:32:33Z";

/** The SHA-256 of the data as fetched and checked on 2026-11-09: a fetch that differs is reported (the template says so). */
export const EXPECTED = Object.freeze({
  dem: "5996f0c4172db54e4ba7a3d8574e22bfbc6fb5faf27f38461ab3c00661ddc7c3",
  features: "706a6df7e40965019c223b586fe9fd2190b5c10cefc8eeeffa390e85eeabd2b5",
});

/** Named places, for a scene's views and labels (lat, lon from OSM, except the mooring field). */
export const PLACES = Object.freeze([
  { name: "RVYC mooring field", kind: "mooring", lat: 48.454, lon: -123.2915, note: "estimated: OSM maps no moorings in Cadboro Bay" },
  { name: "Royal Victoria Yacht Club", kind: "club", lat: 48.45137, lon: -123.2968, osm: "way/104662258" },
  { name: "RVYC breakwater", kind: "breakwater", lat: 48.45211, lon: -123.29399, osm: "way/305932901" },
  { name: "RVYC V dock", kind: "float", lat: 48.45307, lon: -123.29501, osm: "way/154004231" },
  { name: "Ten Mile Point", kind: "point", lat: 48.45543, lon: -123.26561 },
  { name: "Cadboro Point", kind: "point", lat: 48.45137, lon: -123.2657 },
  { name: "Baynes Channel North light", kind: "light", lat: 48.45025, lon: -123.26389, osm: "node/4291664955" },
  { name: "Strongtide Islet", kind: "islet", lat: 48.44166, lon: -123.25427 },
  { name: "Chatham Islands", kind: "island", lat: 48.4368, lon: -123.24437 },
  { name: "Fulford Reef north cardinal", kind: "buoy", lat: 48.44792, lon: -123.23964, osm: "node/3158597219" },
  { name: "Discovery Island lighthouse", kind: "light", lat: 48.42459, lon: -123.22566, osm: "way/258991733" },
  { name: "Oak Bay Marina", kind: "marina", lat: 48.42546, lon: -123.30185 },
  { name: "Fiddle Reef light", kind: "light", lat: 48.42933, lon: -123.28392, osm: "node/1666136773" },
  { name: "Lewis Reef light", kind: "light", lat: 48.42547, lon: -123.27975, osm: "node/4291664950" },
  { name: "Mary Tod Island light", kind: "light", lat: 48.42578, lon: -123.29858, osm: "node/4291664952" },
]);

/** Where the scene opens in the editor: above the clubhouse (its ground is ~10 m up), looking out over the docks to the moorings and Ten Mile Point. */
export const HOME = Object.freeze({ position: Object.freeze([-400, 22, 300]), target: Object.freeze([120, 0, -40]) });

/** The preset as a Terrain doc's fields (before any data is fetched). */
export function cadboroDoc() {
  return {
    title: "Cadboro Bay",
    origin: { ...ORIGIN },
    grid: { ...GRID },
    exaggeration: 1,
    datum: { ...DATUM, tide: { ...DATUM.tide } },
    demToMWL: DEM_TO_MWL,
    places: PLACES.map((p) => ({ ...p })),
    wind: { ...WIND },
    osmDate: OSM_DATE,
  };
}
