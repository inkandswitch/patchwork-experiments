// Ucluelet ("Ukee"), on the west coast of Vancouver Island: the harbour and
// Ucluelet Inlet, Amphitrite Point and the Wild Pacific Trail coast, out to
// Loudoun Channel and the western Broken Group; and at the frame's origin
// the former RCAF seaplane base at 1970 Harbour Crescent, where Rising Tide
// Boat Works is redeveloping the waterfront (the hangar as their boatshed,
// a new haul-out pier for an electric travel lift, a dock with DC fast
// chargers). Everything here is what research found on 2026-11-15, from
// public sources only (README, "Ucluelet"); the data is fetched by
// layered.js and cached in the Terrain doc, never read from here at build
// time. Every dimension or position that is a guess says so, with its basis.

/**
 * The frame's origin: in the water off the former seaplane base piers (OSM
 * node 1042023560, Ucluelet Water Aerodrome, is 8 m south-east). The
 * haul-out pier's head is about 55 m east of it.
 */
export const ORIGIN = Object.freeze({ lat: 48.95, lon: -125.558 });

/**
 * 1025 × 1025 nodes 20 m apart, 20.48 km a side: x −3440…17040, z
 * −6900…13580 (48.8277–49.0120 N, 125.6050–125.3251 W). 20 m is the finest
 * spacing at which the grid still reaches the western Broken Group across
 * Loudoun Channel; the harbour reads finely anyway because its shore, floats
 * and piers come from vectors.
 */
export const GRID = Object.freeze({ n: 1025, cell: 20, x0: -3440, z0: -6900 });

/**
 * CHS gauge 08595 Ucluelet (48.947 N, 125.552 W, 450 m from the boatyard):
 * MWL 2.04 m above chart datum, CGVD2013 zero 1.92 m above it (so MWL is
 * 0.12 m above CGVD2013), CGVD28 zero 2.12 m above it (a survey's CGVD28
 * height is 0.08 m below the same height about MWL). The tide's levels are
 * the gauge's, about MWL. (Assumption: one chart datum over the whole grid;
 * in the Broken Group it may be out by tenths of a metre.)
 */
export const DATUM = Object.freeze({
  zero: "MWL",
  station: "CHS 08595 Ucluelet",
  mwlAboveChartDatum: 2.04,
  mwlAboveCGVD2013: 0.12,
  mwlAboveCGVD28: -0.08,
  tide: Object.freeze({ HAT: 1.98, HHWLT: 1.93, MHHW: 1.22, MLLW: -1.33, LLWLT: -2.11 }),
});

/** A survey height (CGVD28, as the as-built plan gives them) about MWL, as the survey states it. */
export const fromCGVD28 = (h) => Math.round((h + 0.08) * 100) / 100;

/**
 * The survey and the lidar disagree under the yard by about a metre, and
 * the site is drawn on the lidar's ground. The survey's slab (AVG. SLAB EL
 * 4.12, CGVD28, the hangar's floor and building B's; test pits 4.08–4.22)
 * is +4.20 about MWL; the HRDEM lidar's bare earth (the 10 m mosaic the
 * place fetches; the 5 m and 1 m site tiles read within 0.05 m of it), at
 * the hangar's and building B's corners and middles, is +2.96 to +3.24,
 * mean +3.06: the survey is 1.14 m above the lidar. CGVD28 against
 * CGVD2013 is only 0.20 m here, so the datums don't explain it; which of
 * the two is right is not settled from public data (a survey's local
 * benchmark, or the lidar's vertical bias, could each do it). The scene's
 * ground is the lidar's, so the site is conformed to it: every survey
 * height drops by the same 1.14 m, keeping the survey's differences (the
 * slab, the door head, the ridge, the roofs), and the decks built at yard
 * level go with it. probes/fetch-ucluelet.mjs measures these again from
 * the fetched lidar and checks the hangar's slab is within 0.3 m of the
 * drawn ground.
 */
export const YARD = Object.freeze({
  surveySlab: 4.2,
  lidar: Object.freeze({
    source: "nrcan-hrdem-dtm",
    // [lat, lon, metres about MWL]: the hangar's corners N, E, S, W and its middle, then building B's four corners and middle
    points: Object.freeze([
      [48.949323, -125.5576443, 2.99], [48.9489995, -125.5574334, 3.08], [48.9488756, -125.5578714, 3.1], [48.9492002, -125.5580829, 3.02], [48.9490996, -125.557758, 3.24],
      [48.9489373, -125.5576566, 3.12], [48.9490182, -125.5573702, 3.08], [48.9488633, -125.5572702, 2.98], [48.9487821, -125.5575579, 2.96], [48.9489002, -125.5574637, 3.02],
    ].map((p) => Object.freeze(p))),
    mean: 3.06,
  }),
  offset: -1.14,
  decision: "conformed to the lidar: every survey height less 1.14 m (the survey's differences kept); the decks at yard level go with it",
});

/** A survey height (CGVD28) as drawn: about MWL, conformed to the lidar's ground (YARD). */
export const fromSurvey = (h) => Math.round((h + 0.08 + YARD.offset) * 100) / 100;

const NCEI_LICENCE = "Public domain (U.S. Government work); please cite NOAA NCEI";
const NONNA = (res) => `https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs?service=WCS&version=2.0.1&request=GetCoverage&format=image/tiff&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&outputCrs=http://www.opengis.net/def/crs/EPSG/0/4326&subset=Long(-125.6060,-125.3240)&subset=Lat(48.8266,49.0131)&coverageId=nonna__NONNA%20${res}%20Coverage`;
const HRDEM = (layer) => `https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic?service=WCS&request=GetCoverage&version=1.1.1&identifier=${layer}&format=image/geotiff&BoundingBox=48.8266,-125.6060,49.0131,-125.3240,urn:ogc:def:crs:EPSG::4326&GridBaseCRS=urn:ogc:def:crs:EPSG::4326&GridOffsets=-0.00014,0.00009`;

/**
 * Where the heights come from (layered.js): each node takes the first of
 * its side's sources (OSM's coastline says which side) that has a value
 * there. Water: CHS NONNA-10, NONNA-100, then NCEI's Barkley Sound 1″ and
 * BC 3″ DEMs; what none covers (the inner inlet's head) is filled
 * harmonically and flagged. Land: NRCan's HRDEM lidar, then NCEI 1″; what
 * neither covers is held at the land floor and flagged. The canopy (and
 * roofs) is the lidar's first return less its bare earth.
 *
 * NCEI and CHS disagree here (NONNA-10 − NCEI 1″ over 37,488 water nodes:
 * median −6.1 m, p10 −23.8, p90 +2.0; NCEI reads about 0.68 of NONNA's depth
 * in 10–30 m), unlike in Cadboro Bay. It is not registration (no shift
 * helps, and 100.00% of 172,206 off-shore NONNA nodes are on OSM water) and
 * NCEI's 3″ BC DEM agrees with NONNA within 5–10% at 20–100 m, so NONNA is
 * first. NCEI is NAVD88 with no trustworthy local offset: used as it is,
 * only where nothing better is, and the per-node source layer says so.
 */
export const HEIGHTS = Object.freeze({
  kind: "layered",
  water: ["chs-nonna-10", "chs-nonna-100", "ncei-barkley-sound-1s", "ncei-british-columbia-3s"],
  land: ["nrcan-hrdem-dtm", "ncei-barkley-sound-1s"],
  canopy: { dtm: "nrcan-hrdem-dtm", dsm: "nrcan-hrdem-dsm" },
  // the position check (build.js shape()) runs on the land's first source: OSM sets every node's side, so only a source's own heights can show it is flipped or shifted
  check: "nrcan-hrdem-dtm",
  rasters: {
    "chs-nonna-10": {
      name: "Canadian Hydrographic Service NONNA-10 bathymetry (10 m, chart datum)",
      url: NONNA(10),
      crs: "EPSG:4326",
      toMWL: -2.04,
      licence: "CHS NONNA data licence: non-navigational use only (the dataset is listed under the Open Government Licence – Canada; its third-party clause applies to redistribution)",
      attribution: "Bathymetry: Fisheries and Oceans Canada, Canadian Hydrographic Service, NONNA-10 (non-navigational)",
      accuracy: "CHS survey compilation at about 10 m (12.6 m east–west here). Heights above chart datum, negative below it, positive a drying height; to MWL: −2.04 m (gauge 08595).",
    },
    "chs-nonna-100": {
      name: "Canadian Hydrographic Service NONNA-100 bathymetry (100 m, chart datum)",
      url: NONNA(100),
      crs: "EPSG:4326",
      toMWL: -2.04,
      licence: "CHS NONNA data licence: non-navigational use only",
      attribution: "Bathymetry: Fisheries and Oceans Canada, Canadian Hydrographic Service, NONNA-100 (non-navigational)",
      accuracy: "CHS compilation at about 100 m: where NONNA-10 has no value.",
    },
    "ncei-barkley-sound-1s": {
      name: "NOAA NCEI Barkley Sound 1 arc-second coastal DEM (2016), raster 147",
      ncei: 147,
      crs: "frame",
      toMWL: 0,
      // NCEI writes exactly 0 along its shoreline and where it has no sounding: on a water node that is no value (layered.js)
      zeroIsNoValueOnWater: true,
      licence: NCEI_LICENCE,
      attribution: "Elevation and bathymetry: NOAA National Centers for Environmental Information, Barkley Sound 1 arc-second DEM (2016)",
      accuracy: "NAVD88 with no trustworthy local offset (used as it is); reads shallow against CHS here (median 6.1 m); its land is CDED-era, a median 3.1 m above the lidar. Ends at 125.570 W.",
    },
    "ncei-british-columbia-3s": {
      name: "NOAA NCEI British Columbia 3 arc-second DEM, raster 182",
      ncei: 182,
      crs: "frame",
      toMWL: 0,
      zeroIsNoValueOnWater: true,
      licence: NCEI_LICENCE,
      attribution: "Bathymetry: NOAA National Centers for Environmental Information, British Columbia 3 arc-second DEM",
      accuracy: "About 90 m; agrees with NONNA within 5–10% at 20–100 m. Used for the strip west of 125.600 W where NONNA's tile ends.",
    },
    "nrcan-hrdem-dtm": {
      name: "NRCan HRDEM mosaic, digital terrain model (lidar, 1 m native; BC-Vancouver_Island_Sunshine_Coast_2018-1m, 2019-10-01; asked for at about 10 m)",
      url: HRDEM("dtm"),
      crs: "EPSG:4326",
      toMWL: -0.12,
      licence: "Open Government Licence – Canada",
      attribution: "Land heights: Natural Resources Canada, High Resolution Digital Elevation Model (HRDEM), lidar",
      accuracy: "Lidar bare earth, CGVD2013; to MWL −0.12 m. Off the shore band it is above +1 m exactly where OSM is land at 99.69% of 91,422 nodes. Covers the peninsula, the inlet shores and the Broken Group, not the interior hills.",
    },
    "nrcan-hrdem-dsm": {
      name: "NRCan HRDEM mosaic, digital surface model (lidar first return; same project and grid)",
      url: HRDEM("dsm"),
      crs: "EPSG:4326",
      toMWL: -0.12,
      licence: "Open Government Licence – Canada",
      attribution: "Canopy: Natural Resources Canada, HRDEM digital surface model, lidar",
      accuracy: "The canopy is the surface less the terrain, the largest over the 10 m pixels round each node: median 16.5 m, p90 30 m on land.",
    },
  },
});

/**
 * OpenStreetMap as it was when this place was fetched and checked
 * (probes/fetch-ucluelet.mjs). Both Overpass queries ask for this moment.
 */
export const OSM_DATE = "2026-11-16T05:30:00Z";

/**
 * The SHA-256 of what was fetched and checked on 2026-11-15 (the probe's
 * recording): a fetch that differs is reported.
 */
export const EXPECTED = Object.freeze({
  dem: "2ec2843cc64d1d877d9c7158a7c2b97a545358b3888069deb552a96df36ab073",
  layers: "0cca4de40cba09b5c731a22efcae5ac63a0e2eaf68fc90eb56c5f7389a1994c2",
  features: "4df73675db33aece3d0272a2dcec434ac061e193a733c6388496a6bb57a02225",
  look: "cdf2364026c1d86dd26bd305b8dd36254d625d80220756ba246e5ebec8099a52",
});

/**
 * A summer afternoon's breeze. ECCC climate-hourly 1030426 Amphitrite
 * Point, July–August 1991–1999 (the hourly record ends in 2001; 1997–99
 * partial), LOCAL_HOUR 12–17 LST (13:00–18:00 PDT), 2,565 hours: from 299°
 * speed-weighted (288° unweighted), median 4.2 m/s, p75 5.6, p90 7.2; NW
 * sector 49%, SE 17%, W 16%, S 9%. The La Perouse Bank buoy (C46206), the
 * same hours 2017–21, agrees: from 290°, median 5.1. Ucluelet Inlet runs
 * NW–SE, so it blows along the harbour. Scale 0.6: one open water serves the
 * sheltered harbour and the exposed outer coast (a compromise).
 */
export const WIND = Object.freeze({ speed: 5, from: 300, scale: 0.6, source: "ECCC climate-hourly 1030426 Amphitrite Point, Jul–Aug 1991–1999, 13:00–18:00 PDT, 2,565 h: from 299° speed-weighted (288° unweighted), median 4.2 m/s, p75 5.6, p90 7.2; buoy C46206 La Perouse Bank 2017–21, same hours: 290°, median 5.1 m/s" });

/**
 * The swell the outer coast gets (not modelled: sailing.sea has no swell
 * yet): DFO MEDS C46206, Jul–Aug 2017–21, 20:00–00:59 UTC, 1,072 records:
 * Hs p10 0.7 / median 1.2 / p90 2.0 m; Tp p10 6.0 / median 8.3 / p90 14.2 s;
 * from about 285° (an assumption: the open Pacific).
 */
export const SWELL = Object.freeze({ hs: 1.2, tp: 8.3, from: 285, note: "not modelled (sailing.sea has no swell); direction assumed" });

/**
 * The sky (terrain.sky, sky.js): Amphitrite Point's July–August afternoons
 * (ECCC 1030426, 1991–96, 13:00–18:00 PDT, the 732 hours with a weather
 * report): mostly cloudy 23%, cloudy 19%, fog 20%, mainly clear 22%, clear
 * 13%; visibility median 19 km, p10 1.2 km. "Ukee grey", overcast but
 * bright, is how it looks most afternoons. The sun is where it is on 15 July
 * at 15:00 PDT at 48.95 N (elevation 57°, azimuth 222°). Colours are art
 * direction, not measurements, but an overcast's gradient is the CIE
 * standard overcast sky's way round: brightest overhead, darker toward the
 * horizon (there about a third of the zenith's luminance; here gentler), so
 * the far water, which reflects the horizon at a grazing angle, reads as
 * pewter, not a white band, and the far hills fade into a grey that matches
 * it (the fog is the horizon's colour). Ukee grey's overcast is a
 * stratocumulus deck about 600 m up, its cells' undersides a little lighter
 * and darker (±12%: scene STAGE.md's atmosphere clouds), not a flat grey.
 */
export const SKIES = Object.freeze({
  "ukee-grey": { name: "Ukee grey (overcast, bright)", sky: { top: "#c4cacc", horizon: "#959ea1", bottom: "#7a8487" }, fog: { color: "#959ea1", near: 400, far: 9000 }, sun: { direction: [-0.36, 0.84, 0.4], color: "#eef0f0", intensity: 1.1, shadows: false }, exposure: 1.05, clouds: { cover: 1, contrast: 0.12, scale: 500, base: 600 } },
  "marine-layer": { name: "Marine layer (fog, 20% of afternoons)", sky: { top: "#bfc6c7", horizon: "#c9cfcf", bottom: "#b4bbbb" }, fog: { color: "#c9cfcf", near: 30, far: 900 }, sun: { direction: [-0.36, 0.84, 0.4], color: "#f2f3f2", intensity: 0.6, shadows: false }, exposure: 1 },
  "clear-afternoon": { name: "Clear afternoon", sky: { top: "#5b86b0", horizon: "#d5e0e4", bottom: "#a9bcc4" }, fog: { color: "#d5e0e4", near: 800, far: 18000 }, sun: { direction: [-0.36, 0.84, 0.4], color: "#fff4e2", intensity: 2.2, shadows: true }, exposure: 1 },
});

/** Named places (lat, lon from OSM unless noted). */
/** The inlet's water (the water trait's `colour`): dark grey-green that holds the forest's darkness, as photographs of the harbour and inlet under cloud show, and the shore's tint where the calm water mirrors the forest (the dark band under every shore in Ucluelet_Dock.jpg); art direction. */
export const WATER_COLOUR = Object.freeze({ deep: "#1e3a3c", scatter: "#3d6a5f", shore: "#1a231d" });

export const PLACES = Object.freeze([
  { name: "Rising Tide Boat Works (the hangar), 1970 Harbour Crescent", kind: "site", lat: 48.9491, lon: -125.557758, note: "the survey's building A" },
  { name: "Ucluelet Water Aerodrome (former RCAF seaplane base)", kind: "aerodrome", lat: 48.94993, lon: -125.55797, osm: "node/1042023560" },
  { name: "Pat Leslie Public Boat Launch", kind: "slipway", lat: 48.949868, lon: -125.558968, osm: "way/762350793" },
  { name: "CHS gauge 08595 Ucluelet", kind: "gauge", lat: 48.947, lon: -125.552 },
  { name: "Inner Basin", kind: "marina", lat: 48.94508, lon: -125.553, osm: "way/1528008864" },
  { name: "Outer Basin", kind: "marina", lat: 48.94646, lon: -125.5522, osm: "way/1528008866" },
  { name: "Whiskey Dock", kind: "wharf", lat: 48.94367, lon: -125.54552, osm: "way/1528008867" },
  { name: "52 Steps Dock", kind: "float", lat: 48.94111, lon: -125.54128, osm: "way/156132276" },
  { name: "Lyche Island", kind: "islet", lat: 48.94591, lon: -125.54429, osm: "way/160015189" },
  { name: "Hitacu", kind: "village", lat: 48.9383, lon: -125.52535, osm: "node/5516843819" },
  { name: "Amphitrite Point Lighthouse", kind: "light", lat: 48.9212, lon: -125.54125, osm: "way/374651008" },
  { name: "Spring Cove", kind: "cove", lat: 48.928, lon: -125.536, note: "approximate: OSM names no cove; the Spring Cove Interpretive Trail (way 1328162087)" },
  { name: "Mount Ozzard radar dome", kind: "landmark", lat: 48.95939, lon: -125.49298, osm: "way/1423469476" },
  { name: "Loudoun Channel", kind: "channel", lat: 48.93972, lon: -125.37206, osm: "relation/8371200" },
  { name: "Benson Island", kind: "island", lat: 48.88318, lon: -125.38193, osm: "relation/8369295" },
  { name: "Turret Island", kind: "island", lat: 48.8992, lon: -125.34089, osm: "relation/8369305" },
  { name: "Great Bear Rock", kind: "rock", lat: 48.89237, lon: -125.4552, osm: "relation/8371201" },
]);

// ─── the boatyard (1970 Harbour Crescent) ────────────────────────────────────

const SURVEY = "Bennett Land Surveying as-built plan R4 (2026-03-12), District of Ucluelet TUP 26-07 application p. 2; outlines read as vectors, georeferenced from GNSS base MAG nail 11087 (UTM 10N NAD83(CSRS) E 312718.403 N 5425039.122), NAD83(CSRS) taken as WGS84 (~1–1.5 m)";
const RTBW = "Rising Tide Boat Works one-pager (2026-08-23) and introduction deck (2026-09-04), site-plan schematics registered to the existing L-pier (OSM way 751431449); preliminary design";
const TBR = "marked \"to be removed\" on the March 2026 survey";

/**
 * The site's structures, as data (site.js draws them): lat, lon WGS84,
 * heights about MWL, the survey's conformed to the lidar's ground (YARD:
 * CGVD28 + 0.08 − 1.14). Each says where it is from, how sure that is, and
 * what is assumed. `layer` is the GLB layer it is drawn on (README,
 * "Layers"): what the survey says is staying, what it marks to be removed
 * and the pier's arm the plan replaces (both hidden by default: the scene
 * shows the plan), the existing wharf, and Rising Tide's planned pier and
 * dock. Today's harbour is the plan's layer off and those two on.
 *
 * Nothing here is private: the survey is in the District's public permit
 * file, the plans are Rising Tide's public media, the photos are the
 * press's (Ha-Shilth-Sa, 2026-07-01).
 */
export const SITE = Object.freeze({
  name: "Rising Tide Boat Works, 1970 Harbour Crescent (Lot 5, Plan VIP20323)",
  credit: "Site: Bennett Land Surveying as-built plan (District of Ucluelet TUP 26-07, public notice) · Rising Tide Boat Works public media (preliminary design)",
  // OSM's drawing of what the survey draws better: left out inside the lot (buildings), and by id (the L-pier, which the plan rebuilds)
  clear: {
    box: { south: 48.94833, west: -125.55867, north: 48.94989, east: -125.55482 },
    osm: ["way/751431449"],
    note: "OSM's buildings inside the lot's extent (the survey's shoreline and lot lines: 48.94833–48.94989 N, 125.55867–125.55482 W) are left out: the survey draws them. OSM's L-pier (way 751431449) is drawn from the site's data: its north leg as existing, its east arm on boatyard.today (the planned dock replaces it). No trees stand in the box (forest.js builtMask).",
  },
  ground: YARD,
  // the yard's ground inside the lot's box, above the highest normal tide: one even gravel tone, its edge the shore's cut at MHHW (build.js apronMask)
  apron: { colour: "#8a8a86", wet: "#7b7b77", wetShare: 0.35, verge: { colour: "#4b5734", width: 14 }, shore: "#55524b", assumed: "Pale wet concrete and gravel with darker wet patches (the courtyard photographs are concrete, not asphalt), a grass verge along the waterfront and cobble below it (the seaplane-base courtyard photographs' and imagery's general look; the surface isn't surveyed)" },
  layers: [
    { id: "boatyard", name: "Boatyard (1970 Harbour Crescent)" },
    { id: "boatyard.kept", name: "Buildings staying (March 2026 survey)", parent: "boatyard" },
    { id: "boatyard.removed", name: "Buildings marked to be removed (March 2026 survey)", parent: "boatyard", visible: false },
    { id: "boatyard.wharf", name: "Existing wharf and pier", parent: "boatyard" },
    { id: "boatyard.planned", name: "Planned haul-out pier and electrified dock (Rising Tide, preliminary)", parent: "boatyard" },
    { id: "boatyard.today", name: "Today's pier arm, which the planned dock replaces", parent: "boatyard", visible: false },
    { id: "boatyard.gear", name: "Yard gear (dressing: assumed)", parent: "boatyard" },
  ],
  structures: [
    // yard gear: dressing, so the yard reads as a working one (imagery's rows of bins east of building J; a log pile by the gravel west of the hangar): positions read off the Esri z18 imagery, sizes, stacks and colours assumed
    { id: "totes", kind: "totes", name: "Fish totes and bins in rows (dressing)", layer: "boatyard.gear", size: 1.2, rows: [{ from: [48.9492, -125.5567145], to: [48.9489004, -125.556248], stack: 3 }, { from: [48.949288, -125.5564463], to: [48.9489357, -125.5561405], stack: 2 }], colours: ["#2f5f8f", "#e3e4df", "#2f5f8f", "#c9cbc6", "#2a4f78"], source: "Esri World Imagery z18 (the rows of white bins east of building J)", assumed: "Bins 1.2 m, stacked one to three high by hash, blue and white: assumed (dressing)" },
    { id: "logpile", kind: "logpile", name: "A pile of logs (dressing)", layer: "boatyard.gear", at: [48.9489004, -125.5584741], heading: 62, rows: 4, length: 12, radius: 0.4, colour: "#8a6e52", source: "the seaplane-base courtyard photographs' general look", assumed: "Position, size and colour assumed (dressing)" },
    {
      id: "hangar",
      kind: "hangar",
      name: "Restored RCAF seaplane hangar (survey building A): Rising Tide's boatshed",
      layer: "boatyard.kept",
      // corners N, E, S, W; the faces W→N (north-west, the doors) and E→S (south-east) are the gable ends
      corners: [[48.949323, -125.5576443], [48.9489995, -125.5574334], [48.9488756, -125.5578714], [48.9492002, -125.5580829]],
      floor: fromSurvey(4.12),
      eave: fromSurvey(4.12) + 10.6,
      ridge: fromSurvey(15.93),
      doors: { face: 3, main: { from: 0.8, to: 34.0, head: 7.39 }, small: { from: 12.7, to: 15.8, head: 3.26 } },
      colours: { walls: ["#8a5a3e", "#9c6248", "#7d5238"], header: "#6b5241", doors: ["#4f7658", "#5b7f5f", "#8f6a4c"], roof: "#4a4e52", trim: "#e9e6de", slab: "#9b9890" },
      source: SURVEY,
      confidence: "footprint high (edges 39.15, 39.28, 34.92, 34.91 m against the labelled 39.1/39.2/34.8; 1,369 m²); floor EL 4.08–4.22 test pits; ridge EL 15.93; door head EL 11.51. Absolute height in doubt: the survey's slab (+4.20 about MWL) is 1.14 m above the lidar's ground here (+3.06, YARD)",
      assumed: "Heights conformed to the lidar's ground (YARD): floor +3.06 about MWL, not the survey's +4.20; the survey's differences kept (door head 7.39 m, ridge 11.81 m above the floor). Eave 10.6 m above the floor, from the July 2026 photo's proportions (±0.5 m), so a 4° gable with the ridge north-west–south-east and the trusses spanning the 34.8 m faces. Main doors: sliding leaves across nearly the whole north-west face to the 7.4 m door head (the photo; leaves and their number not surveyed), painted green with some stripped. The spec gives that face two ways, as 12.7 + 3.1 + 19.0 m (the 3.1 m small door between two stretches) and as leaves across 0.8–34.0 m; drawn as leaves either side of the small door (0.8–12.7 and 15.8–34.0 m), which is both if the small door is a wicket in its own panel. Walls: diagonal timber sheathing, stripped and weathered cedar brown and red (Ha-Shilth-Sa photo, 2026-07-01). Roof dark grey.",
    },
    { id: "B", kind: "box", name: "Building B (former cold storage; Rising Tide's office and event space?)", layer: "boatyard.kept", corners: [[48.9489373, -125.5576566], [48.9490182, -125.5573702], [48.9488633, -125.5572702], [48.9487821, -125.5575579]], base: fromSurvey(4.12), top: fromSurvey(10.61), roof: "flat", cladding: "corrugated", colours: { walls: "#cfd3cf", roof: "#8e9295", trim: "#5d6266" }, source: SURVEY, assumed: `${TBR}, but Rising Tide's office is a "remediation of former cold storage" of this size: drawn as staying until a newer source says. Colours and cladding assumed (pale corrugated, a dark trim at the roof).` },
    { id: "D", kind: "quonset", name: "Building D (a galvanised Quonset hut)", layer: "boatyard.kept", corners: [[48.9491696, -125.5582186], [48.9492953, -125.5583005], [48.9493521, -125.5580994], [48.9492262, -125.5580181]], base: fromSurvey(4.12), top: fromSurvey(13.03), door: 1, colours: { shell: "#a9adaf", end: "#9ea2a4", door: "#6f7477" }, source: `${SURVEY}; its form from the Ha-Shilth-Sa photo (2026-07-01: a galvanised Quonset west of the hangar, its arched end to the shore)`, assumed: "Survey \"(TO PL)\", not marked to be removed; roof EL 13.03 taken as the arch's crown and the slab at the hangar's (assumed). A Quonset (the photo): its length along the survey's north-north-west edge, its arch over the other, ribbed every 0.6 m; galvanised grey; a door in its end toward the shore (assumed)." },
    { id: "red-quonset", kind: "quonset", name: "A red Quonset hut (the courtyard photographs)", layer: "boatyard.kept", corners: [[48.9490475, -125.5581683], [48.9489482, -125.5581038], [48.9489235, -125.5581919], [48.9490228, -125.5582564]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 4, door: 0, colours: { shell: "#b82a26", end: "#b82a26", arch: "#ecebe6", door: "#ecebe6" }, source: "the seaplane-base courtyard photograph (On This Spot): a red Quonset with a white end arch and door before a mint-green corrugated building (lean-to C)", assumed: "Not on the survey: position (about 10 m south-west of lean-to C, along it), size (12 × 7 m, 4 m high) and orientation assumed from the photograph; it may be gone." },
    { id: "courtyard", kind: "slab", name: "The courtyard's concrete slab (the photographs)", layer: "boatyard.kept", corners: [[48.949323, -125.5576443], [48.9489995, -125.5574334], [48.9491585, -125.5568674], [48.949482, -125.5570783]], colour: "#8a8a86", seams: { every: 6, colour: "#6c6c69", width: 0.12 }, source: "the seaplane-base courtyard photographs: wet concrete, its joints in lines", assumed: "The slab's extent (the hangar's north-east face out 45 m), its level (a hand over the highest ground under it) and its joints every 6 m: assumed." },
    { id: "C", kind: "box", name: "Lean-to C along the hangar's south-west wall", layer: "boatyard.removed", corners: [[48.9492073, -125.5580862], [48.9488781, -125.5578716], [48.9488559, -125.5579466], [48.9491857, -125.5581619]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 5, eave: fromSurvey(4.12) + 3.6, roof: "shed", colours: { walls: "#9cc3ae", roof: "#8e9295" }, source: SURVEY, assumed: `${TBR}. Heights assumed (5 m against the hangar, 3.6 m outside); mint-green corrugated as in the 2025 drone photo.` },
    { id: "E", kind: "box", name: "Building E", layer: "boatyard.removed", corners: [[48.9490173, -125.5573702], [48.9490389, -125.5572908], [48.9488837, -125.5571916], [48.9488621, -125.557271]], base: fromSurvey(4.12), top: fromSurvey(7.37), roof: "flat", colours: { walls: "#d9dbd8", roof: "#9ea3a6" }, source: SURVEY, assumed: `${TBR}; roof EL 7.37; colours assumed.` },
    { id: "F", kind: "box", name: "Building F", layer: "boatyard.removed", corners: [[48.9489589, -125.5571331], [48.9489359, -125.5572157], [48.9490412, -125.5572837], [48.9490645, -125.5572005]], base: fromSurvey(4.12), top: fromSurvey(9.5), eave: fromSurvey(8.6), roof: "gable", colours: { walls: "#b8bcbc", roof: "#9ea3a6" }, source: SURVEY, assumed: `${TBR}; roof EL 9.50 as the ridge; colours assumed.` },
    { id: "G", kind: "box", name: "Building G", layer: "boatyard.removed", corners: [[48.9491253, -125.5575162], [48.9491561, -125.5573814], [48.9490379, -125.5573025], [48.9490006, -125.5574356]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 5, roof: "flat", colours: { walls: "#9cc3ae", roof: "#8e9295" }, source: SURVEY, assumed: `${TBR}; 5 m high assumed; colours assumed.` },
    { id: "H", kind: "box", name: "Building H", layer: "boatyard.removed", corners: [[48.9492601, -125.5569078], [48.9492101, -125.5570816], [48.9492747, -125.5571213], [48.9493241, -125.55695]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 4.5, eave: fromSurvey(4.12) + 3.5, roof: "gable", colours: { walls: "#d9dbd8", roof: "#9ea3a6" }, source: SURVEY, assumed: `${TBR}; heights and colours assumed.` },
    { id: "I", kind: "box", name: "Building I (white roof)", layer: "boatyard.removed", corners: [[48.9493656, -125.5569849], [48.9493314, -125.5571078], [48.9495136, -125.557225], [48.9495477, -125.5571011]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 5.5, eave: fromSurvey(4.12) + 4.5, roof: "gable", colours: { walls: "#d9dbd8", roof: "#eceeed" }, source: SURVEY, assumed: `${TBR}; white roof from imagery; heights assumed.` },
    { id: "J", kind: "box", name: "Building J (rust-red roof)", layer: "boatyard.removed", corners: [[48.9492129, -125.5570315], [48.949255, -125.5568774], [48.9490122, -125.5567238], [48.9489702, -125.5568779]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 6, eave: fromSurvey(4.12) + 4.8, roof: "gable", colours: { walls: "#b8bcbc", roof: "#8b3a26" }, source: SURVEY, assumed: `${TBR}; rust-red roof from imagery; heights assumed.` },
    { id: "K", kind: "box", name: "Building K", layer: "boatyard.removed", corners: [[48.9497435, -125.5567595], [48.9496834, -125.5567454], [48.9496591, -125.556977], [48.9497191, -125.5569911]], base: fromSurvey(4.12), top: fromSurvey(4.12) + 4, roof: "flat", colours: { walls: "#d9dbd8", roof: "#9ea3a6" }, source: SURVEY, assumed: `${TBR}; heights and colours assumed.` },
    { id: "Q", kind: "box", name: "Building Q", layer: "boatyard.removed", corners: [[48.9489191, -125.5577208], [48.9489373, -125.557656], [48.9488379, -125.5575924], [48.9488202, -125.5576582]], base: fromSurvey(4.12), top: fromSurvey(9.3), roof: "flat", colours: { walls: "#d9dbd8", roof: "#9ea3a6" }, source: SURVEY, assumed: `${TBR}; roof EL 9.30; colours assumed.` },
    {
      id: "wharf",
      kind: "wharf",
      name: "Existing pile wharf (survey \"LOADING DOCK\", water lot DL 2137), with its shed",
      layer: "boatyard.wharf",
      corners: [[48.94982, -125.5572937], [48.9502144, -125.5573043], [48.9502116, -125.5575711], [48.9498421, -125.557566]],
      deck: fromSurvey(4.12),
      shed: { along: [0.82, 0.98], across: [0.15, 0.85], height: 4.5, colour: "#eceae4", roof: "#8e9295", cladding: "corrugated", trim: "#5d6266" },
      colours: { deck: "#6f675c", piles: "#2e2721" },
      source: SURVEY,
      confidence: "position high: 43.9 × 19.5 m, its axis about due north",
      assumed: "Deck at yard level (the hangar's slab, EL 4.12, conformed to the lidar: +3.06 about MWL; the deck itself not surveyed); creosote piles about 4 m apart; the shed on its outer end from imagery, its size assumed. Whether it stays, is cut back or is replaced by the haul-out pier is not public: drawn as existing.",
    },
    {
      id: "lpier-leg",
      kind: "pier",
      name: "Existing pier (OSM way 751431449, its north leg): the root of the planned dock",
      layer: "boatyard.wharf",
      line: [[48.949796, -125.557057], [48.950175, -125.557032]],
      width: 3.6,
      deck: fromSurvey(4.12),
      colours: { deck: "#6f675c", piles: "#2e2721" },
      source: "OpenStreetMap way 751431449 (ODbL); matches imagery within about 2 m",
      assumed: "A fixed timber pier on piles at yard level (+3.06, as the wharf), 3.6 m wide (the schematic's dock width); the deck height is assumed.",
    },
    {
      id: "lpier-arm",
      kind: "pier",
      name: "Existing pier's east arm (OSM way 751431449): today's harbour",
      layer: "boatyard.today",
      line: [[48.950175, -125.557032], [48.9500844, -125.5561565]],
      width: 3.6,
      deck: fromSurvey(4.12),
      colours: { deck: "#6f675c", piles: "#2e2721" },
      source: "OpenStreetMap way 751431449 (ODbL), its second segment (64 m east-north-east from the north leg's end)",
      assumed: "A fixed pier at yard level like its north leg (OSM doesn't tag it floating, so no boats are dressed along it: boats.js moors them at floats), 3.6 m wide; width and deck height assumed. Rising Tide's dock arm starts at the same corner on a bearing of 92–96° against this arm's 81°: the plan is taken to replace it, so it is hidden by default (turn 'planned' off and this on for today's harbour).",
    },
    {
      id: "haulout",
      kind: "haulout",
      name: "Planned haul-out pier for a 110 t electric travel lift (Rising Tide item C)",
      layer: "boatyard.planned",
      runways: [[[48.949624, -125.557324], [48.949979, -125.557309]], [[48.949617, -125.557152], [48.949971, -125.557125]]],
      width: 2.4,
      deck: fromSurvey(4.12),
      colours: { concrete: "#a19f98", screen: "#8a4b2a", piles: "#3a3633" },
      source: RTBW,
      confidence: "low: position ±15 m, bearing ±5°, length ±10 m (a whole-site fit of the schematic puts the pair about 12 m further west, over the existing wharf's east half). The depth at the drawn head is evidence the position is uncertain too: −1.7 and −2.5 m about MWL (headDepth), which dries or leaves 0.3 m at the lowest normal tide, too shallow for a 110 t lift's well without dredging",
      // the fetched heights at each runway's seaward end, west then east: bilinear on the 20 m grid, whose nodes round them are CHS NONNA-10 and NCEI 1″ water and, for the west head, lidar land; checked by probes/fetch-ucluelet.mjs
      headDepth: { mwl: [-1.68, -2.45], note: "At LLWLT (−2.11) the west runway's head dries 0.43 m and the east's has 0.34 m of water; at MLLW (−1.33), 0.35 and 1.12 m. At 20 m a cell, with land nodes among the four round the west head, and ±15 m, that may be the grid's; but a 110 t lift's well wants 3 m or more at low water: the schematic's position, or the 12 m-west fit, or dredging not in the public plans." },
      assumed: "Two parallel concrete runway walls on piles about 40 m long, running about north, 12.7 m apart centre to centre (schematic), 2.4 m wide (the schematic's bar), the clear well about 10.3 m (a 30 ft beam plus about 0.6 m a side), the deck at yard level (+3.06, YARD); perforated Corten-look screens along their outer faces (render). No dimensions, piles or permit drawings are public. Drawn where the schematic registers, although the heights there are only 1.7–2.5 m below mean water (headDepth): neither that position nor the 12 m-west fit is settled.",
    },
    {
      id: "travelift",
      kind: "travelift",
      name: "110 t electric travel lift (Rising Tide; capacity 110 t per their deck, 100 t in the news)",
      layer: "boatyard.planned",
      on: "haulout",
      at: 0.72,
      size: { length: 9, height: 11.5, clear: 9.6 },
      colours: { frame: "#2a5b9a", slings: "#2b2b2b", wheels: "#1d1d1d" },
      source: RTBW,
      assumed: "A typical 110 t mobile boat hoist's proportions, not a particular make: wheels on the two runways, about 9 m long, 11.5 m high, 9.6 m clear under the beams; standing near the pier head. Blue is assumed. Make, model and colour are not public.",
    },
    {
      id: "gangway",
      kind: "ramp",
      name: "Gangway from the pier down to the dock (assumed)",
      layer: "boatyard.planned",
      line: [[48.950175, -125.557032], [48.950172, -125.556832]],
      width: 1.5,
      from: fromSurvey(4.12),
      to: 0.5,
      colours: { deck: "#8d8a83" },
      source: RTBW,
      assumed: "A floating dock needs a way down to it: a 15 m gangway is assumed; the plan doesn't show one.",
    },
    {
      id: "dock",
      kind: "dock",
      name: "Planned electrified marina dock with solar canopy (Rising Tide item D)",
      layer: "boatyard.planned",
      line: [[48.950172, -125.556832], [48.950137, -125.555294]],
      width: 3.6,
      top: 0.5,
      canopy: { height: 3.6, width: 4.4, every: 8, colour: "#1d2633", frame: "#bfc3c6" },
      guidePiles: { every: 12, colour: "#5a5f63" },
      colours: { deck: "#8a8478", rail: "#e9e9e6" },
      source: RTBW,
      confidence: "low: the arm about 127–146 m at a bearing of 92–96°, only \"1,000 linear ft\" of dock is a stated figure",
      assumed: "Floats (timber deck, steel guide piles, from the renders) along the schematic's arm, 3.6 m wide at +0.5 m (floats here don't ride the tide), with a solar canopy on posts over it (\"marine solar\"). The fingers and other floats making up the 1,000 ft are not shown in any public plan and aren't drawn.",
    },
    ...[[48.9501674, -125.5566844], [48.9501564, -125.5561804], [48.9501457, -125.5556937]].map((p, k) => ({
      id: `charger-${k + 1}`,
      kind: "charger",
      name: `Marine DC fast charger ${k + 1} of 3 (150 kW, planned)`,
      layer: "boatyard.planned",
      at: p,
      on: "dock",
      colours: { body: "#2c3136", face: "#3fae6a" },
      source: RTBW,
      confidence: "very low: positions are icon spacing on the deck's page 9",
      assumed: "A pedestal 0.6 × 0.4 × 1.7 m on the dock's south edge, assumed.",
    })),
    {
      id: "launch",
      kind: "ramp",
      name: "Pat Leslie Public Boat Launch (District of Ucluelet)",
      layer: "boatyard.wharf",
      line: [[48.949607, -125.559139], [48.950131, -125.558798]],
      width: 6,
      from: 3.2,
      to: -2.6,
      colours: { deck: "#a8a59d" },
      source: "OpenStreetMap way 762350793 (ODbL)",
      assumed: "A concrete ramp 6 m wide falling from +3.2 m to −2.6 m about MWL (to below the lowest normal tide): width and levels assumed.",
    },
  ],
});

/**
 * Landmarks OSM has but can't shape (site.js): drawn from these and not as
 * OSM's generic marks.
 */
export const LANDMARKS = Object.freeze([
  {
    id: "amphitrite",
    kind: "squat-lighthouse",
    name: "Amphitrite Point Lighthouse (1915)",
    replaces: "way/374651008",
    at: [48.9212, -125.54125],
    size: { base: 4.4, top: 3.8, height: 5.6, gallery: 5.0, rail: 1.0, lantern: 1.0, lanternHeight: 1.4, dome: 0.9, rock: { radius: 9, height: 4, colour: "#262523" } },
    colours: { walls: "#f2f1ec", gallery: "#e4e2dc", rail: "#d8d6d0", lantern: "#b0292a", glass: "#2b3338", roof: "#b0292a" },
    source: "OpenStreetMap way 374651008 (ODbL; Fl W 12 s, focal height 15 m, range 15 nm, ref G 5246); a squat 1915 concrete tower built to stand the storms on black volcanic rock (Lighthouse Digest; the Wild Pacific Trail's descriptions)",
    assumed: "A square concrete tower battered from 4.4 m at its foot to 3.8 m at 5.6 m up, a projecting gallery 5 m square with a 1 m railing, a round red lantern 2 m across and 1.4 m tall with its glazing, a red dome: proportions from photographs' general look, not surveyed. On a dark rock outcrop 9 m across falling 4 m to the sea (dressing; the rock's shape assumed). OSM's footprint of it (way 374651008) is left out of the buildings: this draws it.",
  },
  {
    id: "ozzard",
    kind: "dome",
    name: "Mount Ozzard radar dome",
    replaces: "way/1423469476",
    at: [48.95939, -125.49298],
    size: { radius: 8.4, building: [10, 10, 1.3] },
    colours: { dome: "#f4f4f1", building: "#c9cbc8" },
    source: "OpenStreetMap way 1423469476 (ODbL): a round footprint 16.8 m across, height=17; the 'golf ball' locals point to (District of Ucluelet)",
    assumed: "Drawn as a white ball 16.8 m across (OSM's footprint), its foot cut off 60° below its equator, on a 1.3 m plinth so its top is OSM's 17 m: the shape assumed (OSM draws a cylinder). OSM's footprint is left out of the buildings: this draws it.",
  },
]);

/**
 * What the place looks like (look.js): Ucluelet's ground, forest and town.
 * Colours are art direction for the general West Coast vernacular, not
 * checked house by house; the tree mixes are assumptions on the Coastal
 * Western Hemlock very-wet hypermaritime zone (CWHvh1).
 *
 * The ground's colours are darker than the default palette's: this coast
 * is black rock (the splash zone's lichen, wet basalt and greywacke) with
 * dark conifers standing on it, not a sand-and-mud shore, and the town's
 * lots are among trees, not lawns. The fringe at the water is stands of
 * four to six crowns a node; the forest roof is darker and ragged (±3 m a
 * node). Surf where the coast is open to the swell (surf.js), and low
 * cloud on the hills and mist in the forest's hollows (cloud.js). All art
 * direction, from the District's own photographs' general look and
 * descriptions ("a true working harbour", Mount Ozzard "looming over" it),
 * not measurements.
 */
export const LOOK = Object.freeze({
  palette: "west-coast",
  // the shore is rock under the town's lots too: a dark bank above the lichen, not lawn to the waterline (palette.js groundRGB shoreRock)
  shoreRock: true,
  // the forest floor's shade wherever the canopy is over 2 m (not 5) and under every town tree: no mid-grey ground between the crowns on the lots and the hill behind the basins
  shade: { over: 2, towns: true },
  colours: {
    rockweed: "#35311f",
    // the barnacles' band darker than bare grey: on the 20 m grid's gentle slopes it is a wide strip along every shore, which in grey reads as a pale beach
    barnacle: "#47463f",
    lichen: "#1b1b1a",
    rock: "#33322f",
    forestFloor: "#1e281b",
    // the ground in the trees' shade (canopy over 5 m), between the crowns: nearly black
    forestShade: "#0c120c",
    shrub: "#2b3524",
    // a lot without trees: lawn and garden, mottled, a third of its nodes dark shrub (palette.js groundRGB)
    lawn: "#4a5638",
    lawnPatch: "#2a3326",
    yard: "#55585a",
    grass: "#3f4a30",
    bog: "#4a4831",
    beach: "#5d5850",
    bareRock: "#403f3b",
  },
  trees: {
    fringe: { spruce: 45, hemlock: 25, cedar: 20, pine: 10 },
    inland: { hemlock: 50, cedar: 35, spruce: 10, alder: 5 },
    // conifers among the houses: alder is the only broadleaf here, and rare
    town: { hemlock: 35, cedar: 35, spruce: 25, alder: 5 },
    wetland: { pine: 100 },
    // the canopy grid is the truth for where trees stand and how tall: they're placed only where it is over 5 m
    canopy: true,
    fringeWidth: 40,
    // a stand of 4 to 6 crowns on each fringe node (forest.js standMesh)
    stands: [4, 6],
    // three trees a residential node (20 m) where none is built: the town peeking out of spruce, hemlock and cedar
    townPerHectare: 80,
    // the roof under the crowns as dark and as blue-green as they are, so a gap between them doesn't read
    roofColours: ["#131e17", "#16241c", "#1a281e", "#1c2a1f", "#182519"],
    roofJitter: 3,
    // the fringe's first, then the rest by hash: room for the town's trees among the edges'
    max: 55000,
    // the forest's skin (forest.js skinAt): a clump of 3–4 crowns on every roof node within these circles, so the ridgelines and shores seen from the water are serrated, not smooth: the harbour and Ucluelet Inlet to Hitacu, and the Wild Pacific Trail's coast round Amphitrite Point (where people sail and walk; art direction, not data)
    skin: {
      within: [
        { at: [48.945, -125.548], radius: 2300, note: "the harbour, the inlet to Hitacu and its far shore" },
        { at: [48.928, -125.558], radius: 2000, note: "the Wild Pacific Trail's coast and Amphitrite Point" },
      ],
      // a low clump's 3 or 4 crowns (a roof's and the scrub's are always 4: forest.js SKIN_PROFILES)
      crowns: [3, 4],
      // every forest node in the circles, not only the roof's: low crowns down to a metre over the ground where the forest is too patchy for a roof (the second growth among the town's lots and behind the basins), and shore pine and salal where the lidar's canopy is 3 to 5 m (Amphitrite's headland)
      all: true,
      // shore pine and salal, four bushes a node, wherever the lidar's canopy is 1 to 5 m (Amphitrite's headland): a lumpy dark mass over the scrub's sheet
      scrub: { min: 1 },
      // the roof under the crowns at 0.6 of the canopy, so most of each crown stands out of it and the canopy closes over it (forest.js forestRoof `depth`)
      roofDepth: 0.6,
      max: 60000,
    },
    // the detail falls off with the distance beyond the skin's circles (forest.js treesAt): stands at the water within them, the roof's edge trees to 2 km beyond, the shore's single trees to 5 km, then the roof alone (the far hills are grey shapes in the fog)
    bands: { stands: 0, edges: 2000, fringe: 5000 },
    // the instances cut into 1 km tiles inside the circles, 4 km beyond, so the stage culls the forest a tile at a time
    tiles: { near: 1024, far: 4096 },
    // salal and shore pine where the lidar's canopy is under 5 m (forest.js scrubCover): a bumpy low skin, not turf; darker than salal's own #3e4a2c, which lit flat read as lawn
    // darker still (#232b20), finer inside the skin's circles (tolerance 0.3, not 0.6), barely bumped (±0.6 m: the bushes are the lumps), every vertex mottled ±15%
    // and darker again under the crowns standing on it (no sky reaches it there: the overcast's light baked in): ["#1b2318", …]
    scrub: { min: 0.8, lift: 1, jitter: 0.6, fine: 0.3, colours: ["#1b2318", "#19211a", "#1d261a", "#171e15", "#1c2419"] },
  },
  // foam where the coast is open to the swell (doc.swell.from), fading to the water's grey as the stage draws it under Ukee grey: surf.js's ribbons, white water over the exposed shallows under 2.5 m, and black boulders at the most exposed waterline (dressing, assumed)
  // broken into bursts (surf.js BURSTS: about 45% of a run white at full width, the rest a lull of grey-white a quarter as wide or less, domes of spray over the exposed white), the boulders stretched on each axis and turned, no two alike
  surf: { fade: "#64737c", bursts: true, reef: { depth: 2.5, reef: 0.6, chance: 0.4 }, boulders: { exposure: 0.6, chance: 0.3, sides: [7, 9], sizes: [0.6, 1.1, 1.6], colours: ["#3f3d3a", "#4d4b47"], stretch: [0.6, 1.4] } },
  // the town's buildings (buildings.js): West Coast siding, muted (weathered cedar, grey-green, barn red, slate blue, white), white corner boards and eave trim and a row of dark windows a storey; buildings at the water on pile decks, an industrial one there in cream corrugated cladding (a fish plant). Art direction, from photographs of the waterfront
  buildings: {
    palette: { walls: [["#7a5a40", 26], ["#5d6b5e", 18], ["#7d2f28", 12], ["#4f6070", 14], ["#e6e4dd", 18], ["#8d867b", 12]] },
    details: true,
    decks: true,
    // the waterfront's two landmarks, drawn from photographs (UclueletHarbour.JPG, Wharf_in_Ucluelet_showing_aquarium_on_the_left.jpg): assumed, not surveyed
    overrides: {
      "way/360389716": { note: "Whiskey Landing Lodge: three storeys of timber-brown walls on a grey stone base, a bright red metal roof with four cross-gables to the water, white-framed glazing (assumed from photographs)", levels: 3, colour: "#6b4a2e", roofColour: "#c0432c", form: "gables", gables: 4, stone: "#7c7a74", stoneHeight: 1.6, trim: "#f2f1ec" },
      "way/334446398": { note: "The Ucluelet Aquarium at the head of the Whiskey Dock: navy and white, a curved metal roof (assumed from photographs)", levels: 2, colour: "#2d3f66", roofColour: "#c9cccd", form: "curved", trim: "#f2f1ec" },
    },
  },
  // the Whiskey Dock's red railings over a yellow curb (the waterfront photographs; assumed)
  structures: { "way/1528008867": { rail: "#b8302a", curb: "#e0b62c", every: 2.5 } },
  // the harbour's shores (shore-dressing.js): silver-grey drift logs at the top of the tide, and boulders along the sheltered waterline (dressing, assumed): the harbour and inlet, and the coves round Amphitrite
  shore: {
    within: [
      { at: [48.945, -125.548], radius: 2300, note: "the harbour and the inlet to Hitacu" },
      { at: [48.928, -125.558], radius: 2000, note: "the Wild Pacific Trail's coves and Amphitrite Point" },
    ],
    // silver logs 0.8 to 1.2 m across, a third buried in the cobble, their sawn ends darker
    logs: { chance: 0.22, diameter: [0.8, 1.2], colour: "#a8a49a", cap: 0.55, bury: 0.35 },
    // grey stones, not black nuts: three sizes, 7- or 9-sided, squashed
    boulders: { chance: 0.1, sides: [7, 9], sizes: [0.45, 0.9, 1.4], colours: ["#4d4b47", "#5a5752"], stretch: [0.6, 1.4] },
    // the yard's frontage from the launch to the wharf: three to five stones on every piece of its shore (the courtyard photographs' riprap and cobble, assumed)
    frontage: { within: [{ at: [48.9496, -125.558], radius: 150, note: "the boatyard's frontage" }], chance: 1, count: [3, 5] },
  },
  // a band of stratus across the hills, baked into their colours (cloud.js bakeStratus, stratusAt): no sheets or lenses at all (seen from the town, a lens was a pale saucer over it)
  clouds: {
    // from 280 m rising to its thickest at 420 m and easing back to 0.5 above, torn into wisps along the slopes (cloud.js WISPS: about 40% of the band whole, the rest at most a quarter of it), so Ozzard's and the Mackenzie Range's dark forest and the radome show between them; toward the grey the horizon reads as once lit (#737b7e, under the horizon's #959ea1), so a summit is never brighter than the sky behind it, as snow
    // and mist low on the hills (from 60 m, at most 0.35 at 120 m) only round the valley behind the town, the hill south of the basins and Ozzard's lower flank, torn by the same noise: no sheets
    bake: {
      from: 280, peak: 420, span: 200, max: 0.75, above: 0.5, colour: "#737b7e", wisps: true,
      low: { from: 60, peak: 120, span: 120, max: 0.35, above: 0.12, within: [
        { at: [48.9445, -125.5395], radius: 700, note: "the valley behind the town" },
        { at: [48.9415, -125.553], radius: 450, note: "the hill south of the basins" },
        { at: [48.9555, -125.505], radius: 1200, note: "Mount Ozzard's lower flank" },
      ] },
    },
    sheets: null,
    mist: null,
    caps: [],
  },
  // the Inner Basin's floats full of the fleet (boats.js mooredBoats: 19 in 20 slips taken there, against five in six elsewhere; the photographs' general look, assumed)
  moored: [{ at: [48.94508, -125.553], radius: 160, taken: 0.95, note: "the Inner Basin" }],
  // boats alongside every fixed pier in the harbour too (boats.js PIER_MOORING), six slips in ten taken, wherever the water under a boat is at least 2 m at mean water (the level drawn; read from the heights, whose 20 m grid smooths the dredged berths beside a pier to a metre or two shallower than they are, so 2 m at chart datum would leave nearly every pier bare): every float and pier head lined with boats, as in the photographs (assumed)
  moorPiers: { within: [{ at: [48.945, -125.548], radius: 1600, note: "the harbour" }], taken: 0.6, depth: 2 },
  // whale-watching boats and water taxis (grey aluminium) at the piers and floats round the Whiskey Dock and the 52 Steps (assumed)
  moorMix: [{ at: [48.9437, -125.5452], radius: 260, note: "the Whiskey Dock and the 52 Steps", mix: [["whalewatch", 30], ["watertaxi", 25], ["sportfisher", 25], ["troller", 20]] }],
  // dressing about the harbour (boats.js), not data: assumed, each in at least 10 m of water (checked against the heights)
  boats: [
    { id: "troller-outbound", type: "troller", lat: 48.9485, lon: -125.551, heading: 125, length: 12, trim: "#8e2f27", note: "a troller under way, outbound down the harbour" },
    { id: "whalewatch", type: "whalewatch", lat: 48.9445, lon: -125.5415, heading: 140, length: 12, note: "a whale-watching boat heading out past Lyche Island" },
    { id: "water-taxi", type: "watertaxi", lat: 48.943, lon: -125.5385, heading: 305, length: 9, note: "a water taxi coming in" },
    { id: "seiner-anchored", type: "seiner", lat: 48.95, lon: -125.548, heading: 300, length: 14, trim: "#2f3e55", note: "a seiner at anchor, head to the north-westerly (in about 7 m)" },
  ],
});

/** Where the scene opens: 30 m over the water 140 m off the old seaplane base's frontage, looking south-south-east (about 159°) and down about 7.7° (the target on the water 222 m off), over the planned dock and the sloop at anchor to the basins and the forested hill behind the town, which fill the frame rather than the sky; the hangar, the wharf and the haul-out pier at the frame's right. */
export const HOME = Object.freeze({ position: Object.freeze([60, 30, -140]), target: Object.freeze([139, 0, 67]) });

/**
 * Where the sloop lies: at anchor in the harbour about 70 m north of the
 * planned dock's arm, clear of it on her swing, in water deep enough for a
 * 2 m keel at the lowest normal tide (checked against the data).
 */
export const ANCHORAGE = Object.freeze({ lat: 48.95078, lon: -125.5561, note: "assumed: a plausible spot to lie near the new dock; no anchorage is charted here" });

/** The preset as a Terrain doc's fields (before any data is fetched). */
export function uclueletDoc() {
  return {
    title: "Ucluelet",
    origin: { ...ORIGIN },
    grid: { ...GRID },
    exaggeration: 1,
    datum: { ...DATUM, tide: { ...DATUM.tide } },
    demToMWL: 0,
    // 2.5 cm a step: int16 then holds ±819 m (Mount Ozzard is 701 m)
    heightScale: 0.025,
    heights: JSON.parse(JSON.stringify(HEIGHTS)),
    places: PLACES.map((p) => ({ ...p })),
    wind: { ...WIND },
    swell: { ...SWELL },
    osmDate: OSM_DATE,
    look: JSON.parse(JSON.stringify(LOOK)),
    site: JSON.parse(JSON.stringify(SITE)),
    landmarks: JSON.parse(JSON.stringify(LANDMARKS)),
  };
}

