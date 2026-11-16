// "Ucluelet (Rising Tide Boat Works)": the waters in and around Ucluelet,
// with Rising Tide's boatyard at the former RCAF seaplane base (the hangar,
// the planned haul-out pier, travel lift and electrified dock: ucluelet.js
// SITE). It fetches the place's data once into a new Terrain doc (layered
// heights from CHS, NRCan and NOAA; OpenStreetMap's shore, docks, marks,
// buildings and land cover), puts the terrain in at the scene's origin
// (locked), gives it Ucluelet's sky (terrain.sky: overcast but bright, as
// most summer afternoons are), the world a summer afternoon's north-westerly
// (sailing.weather), the harbour its open water with sailing's sea on it,
// and lays sailing's sloop at anchor off the new dock, if sailing is
// installed (found by its part's id in the registry, never imported).

import { uclueletDoc, WIND, HOME, GRID, OSM_DATE, EXPECTED, SKIES, ANCHORAGE, ORIGIN } from "./ucluelet.js";
import { fetchTerrainData } from "./fetch-data.js";
import { storeTerrainData } from "./store.js";
import { localFrame } from "./tmerc.js";
import { bayWater, aboard, headTo, AT_ANCHOR, CREDIT, WEATHER } from "./template.js";

/** This package's: the place's sky (sky.js). */
export const SKY = "terrain.sky";

/** The full credit and the short one a scene shows (fetched data's attribution, extras.terrain). */
export const ATTRIBUTION =
  "Bathymetry: Fisheries and Oceans Canada, Canadian Hydrographic Service, NONNA-10 and NONNA-100 (non-navigational). Land heights and canopy: Natural Resources Canada, HRDEM (lidar). Elevation and bathymetry where neither has any: NOAA National Centers for Environmental Information, Barkley Sound 1″ and British Columbia 3″ DEMs. Shoreline, harbour structures, marks, buildings and land cover © OpenStreetMap contributors (ODbL). Datum and tide levels: CHS (gauge 08595 Ucluelet). Wind climatology: Environment and Climate Change Canada (Amphitrite Point). The boatyard: as-built survey by Bennett Land Surveying Ltd. (District of Ucluelet, TUP 26-07 public notice), and Rising Tide Boat Works' public plans (preliminary design). Not for navigation.";
export const SHORT_CREDIT = "Terrain: © OpenStreetMap contributors (ODbL) · CHS NONNA · NRCan HRDEM · NOAA NCEI · ECCC · site: Bennett Land Surveying, Rising Tide Boat Works · not for navigation";

/** The hand-fetched sources the doc's numbers rest on (fetched by hand on 2026-11-15; the values are in the doc and ucluelet.js). */
export const PROVENANCE = Object.freeze([
  {
    id: "chs-iwls",
    name: "Canadian Hydrographic Service water level station 08595 Ucluelet",
    url: "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/5cebf1e23d0f4a073c4bc075/metadata",
    requests: ["https://api-iwls.dfo-mpo.gc.ca/api/v1/stations?code=08595", "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/5cebf1e23d0f4a073c4bc075/metadata", "https://api-iwls.dfo-mpo.gc.ca/api/v1/height-types"],
    derivation: "08595's heights above chart datum: MWL 2.04, HAT 4.02, HHWLT 3.97, MHHW 3.26, MLLW 0.71, LLWLT −0.07; datums: CGVD2013 −1.92, CGVD28 −2.12. So MWL is 0.12 m above CGVD2013 and 0.08 m below CGVD28's zero: a CGVD28 height + 0.08 m is its height about MWL. The tide about MWL: HHWLT +1.93, MHHW +1.22, MLLW −1.33, LLWLT −2.11.",
    fetched: "2026-11-15",
    licence: "Open Government Licence – Canada",
    attribution: "Datum and tide levels: Fisheries and Oceans Canada, Canadian Hydrographic Service",
  },
  {
    id: "eccc-climate-hourly",
    name: "ECCC climate-hourly, station 1030426 Amphitrite Point",
    url: "https://api.weather.gc.ca/collections/climate-hourly/items?f=json&CLIMATE_IDENTIFIER=1030426&datetime=1991-06-15T00%3A00%3A00Z%2F1991-09-15T23%3A00%3A00Z&limit=10000&properties=LOCAL_DATE,LOCAL_HOUR,WIND_DIRECTION,WIND_SPEED,LOCAL_MONTH,UTC_DATE",
    requests: [1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999].map((y) => `https://api.weather.gc.ca/collections/climate-hourly/items?f=json&CLIMATE_IDENTIFIER=1030426&datetime=${y}-06-15T00%3A00%3A00Z%2F${y}-09-15T23%3A00%3A00Z&limit=10000&properties=LOCAL_DATE,LOCAL_HOUR,WIND_DIRECTION,WIND_SPEED,LOCAL_MONTH,UTC_DATE`),
    derivation: "LOCAL_MONTH 7 or 8, LOCAL_HOUR 12–17 LST (13:00–18:00 PDT), with speed and direction: 2,565 hours; resultant from 299° speed-weighted, 288° unweighted; median 4.2 m/s, p75 5.6, p90 7.2. Sky: the same station's WEATHER_ENG_DESC and VISIBILITY for 1991–96, 732 hours (mostly cloudy 23%, cloudy 19%, fog 20%, mainly clear 22%, clear 13%; visibility median 19 km). Swell: DFO MEDS buoy C46206 (La Perouse Bank), 2017–21, the same hours.",
    fetched: "2026-11-15",
    licence: "Open Government Licence – Canada",
    attribution: "Wind and sky climatology: Environment and Climate Change Canada; waves: Fisheries and Oceans Canada (MEDS)",
  },
  {
    id: "site-survey",
    name: "As-built plan of Lot 5, Plan 20323 (1970 Harbour Crescent), Bennett Land Surveying Ltd., R4 2026-03-12, in the District of Ucluelet's TUP 26-07 application",
    url: "https://ucluelet.ca/wp-content/uploads/2026/07/Application-Documents-TUP-26-07-1970-Harbour-Crescent.pdf",
    requests: ["https://ucluelet.ca/public-notice/public-notice-temporary-use-permit-26-07/"],
    derivation: "Page 2: building outlines, the wharf, the present natural boundary and lot lines read as vectors from the PDF; georeferenced from GNSS base MAG nail 11087 (UTM 10N NAD83(CSRS) E 312718.403 N 5425039.122, ground scale 1.00003312), grid north page-left, 2.3597 pt a metre (checked on the scale bar and on the hangar's labelled 39.1/39.2/34.8 m edges). Elevations CGVD28. Overlaid on imagery within 1–2 m.",
    fetched: "2026-11-15",
    licence: "A surveyor's plan in a public permit notice (all rights reserved by its author); used here for research, credited",
    attribution: "Boatyard outlines and heights: Bennett Land Surveying Ltd., via the District of Ucluelet",
  },
  {
    id: "rising-tide-public",
    name: "Rising Tide Boat Works' public media: one-pager (2026-08-23), introduction deck (2026-09-04), website; news (Ha-Shilth-Sa 2026-07-01, The Regional, CHEK)",
    url: "https://www.risingtideboatworks.com/",
    requests: ["https://www.risingtideboatworks.com/media/media", "https://hashilthsa.com/node/20276", "https://www.theregional.com/new-marine-electrification-hub-in-the-works-on-vancouver-island/"],
    derivation: "The planned haul-out pier (110 t electric travel lift, 30 ft beam), the electrified dock (1,000 linear ft, 3 × 150 kW DC chargers, solar canopy) and zones, from schematics registered to the existing L-pier (OSM way 751431449); preliminary design renders (Michael Green Architecture). Positions low confidence: see each structure's `assumed`.",
    fetched: "2026-11-15",
    licence: "Public media of Rising Tide Boat Works Ltd.; used for research, credited",
    attribution: "Planned pier and dock: Rising Tide Boat Works (preliminary design)",
  },
]);

/** Where the sloop lies, in the frame (x, z), and her heading: head to wind. */
export function anchorage() {
  const [x, z] = localFrame(ORIGIN).toLocal(ANCHORAGE.lat, ANCHORAGE.lon);
  return [Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100];
}

/** The terrain's placeholder box until its GLB arrives. */
const HINT = { bounds: { min: [GRID.x0, -130, GRID.z0], max: [GRID.x0 + (GRID.n - 1) * GRID.cell, 780, GRID.z0 + (GRID.n - 1) * GRID.cell] } };

/** The Terrain doc's preset, with its provenance and credits. */
export function placeDoc() {
  return { ...uclueletDoc(), provenance: JSON.parse(JSON.stringify(PROVENANCE)), attribution: ATTRIBUTION, credit: SHORT_CREDIT };
}

export async function newUclueletTerrain(repo) {
  // its credits from the start: they are the place's (the tool's Fetch data passes them on)
  return repo.create2({ "@patchwork": { type: "terrain" }, ...placeDoc(), data: null, sources: [] });
}

/**
 * Lay the scene out (after the data is in a Terrain doc).
 * @returns {Promise<{ terrain: string, sea: string, hull: string | null }>}
 */
export async function layOut(ctx, terrainUrl, { seed = Math.floor(Math.random() * 1e9), sky = "ukee-grey" } = {}) {
  const atmosphere = JSON.parse(JSON.stringify(SKIES[sky]));
  const terrain = await ctx.addObject(terrainUrl, { providerId: "terrain-mesh", name: "Ucluelet", hint: HINT, fields: { locked: true, infoUrl: terrainUrl, infoToolId: "terrain", traits: { [CREDIT]: {}, [SKY]: atmosphere } } });
  const sea = ctx.newId("o");
  ctx.change((d) => {
    d.traits[WEATHER] = { wind: { speed: WIND.speed, from: WIND.from }, seed };
    const water = bayWater(seed);
    water.name = "Ucluelet Harbour and the open coast";
    water.traits["sailing.sea"].scale = WIND.scale;
    d.objects[sea] = water;
    d.order.push(sea);
    d.view.start = { home: { position: [...HOME.position], target: [...HOME.target] } };
    if (!d.title || /^untitled/i.test(d.title)) d.title = "Ucluelet";
  });
  let hull = null;
  const parts = await ctx.registry?.("scene:part");
  let loaded = null;
  try {
    loaded = (await parts?.load?.("sailing.sloop")) ?? null;
  } catch {
    loaded = null;
  }
  if (loaded) {
    const sloop = loaded?.module?.default ?? loaded?.module;
    const place = { position: anchorage(), rotation: [0, headTo(WIND.from), 0], scale: 1 };
    hull = (await sloop?.create?.(ctx, { parent: null, transform: place, world: place })) ?? null;
    if (hull) {
      ctx.change((d) => {
        for (const o of aboard(d.objects ?? {}, hull)) {
          for (const [trait, set] of Object.entries(AT_ANCHOR)) if (o.traits?.[trait]) for (const [k, v] of Object.entries(set)) o.traits[trait][k] = v;
        }
      });
    }
  }
  return { terrain, sea, hull };
}

/** Whether fetched data is the data checked on 2026-11-15 (ucluelet.js EXPECTED): [] or what differs. */
export function differences(fetched) {
  const out = [];
  if (fetched.dem.record.sha256 !== EXPECTED.dem || fetched.layers?.record.sha256 !== EXPECTED.layers) out.push("the heights (CHS, NRCan, NOAA)");
  if (fetched.features.record.sha256 !== EXPECTED.features) out.push(`OpenStreetMap's shore and docks (as of ${OSM_DATE})`);
  if (fetched.look?.record.sha256 !== EXPECTED.look) out.push(`OpenStreetMap's buildings and land cover (as of ${OSM_DATE})`);
  return out;
}

export default {
  async create(ctx) {
    ctx.notify?.("Fetching Ucluelet: depths from CHS, land and forest from NRCan's lidar, the shore, docks and town from OpenStreetMap (about 66 MB; a minute or two)…", "info");
    const handle = await newUclueletTerrain(ctx.repo);
    const fetched = await fetchTerrainData(placeDoc(), { fetch: (...a) => globalThis.fetch(...a) });
    const changed = differences(fetched);
    fetched.summary.matchesChecked = !changed.length;
    if (changed.length) ctx.notify?.(`The data has changed since this place was checked (2026-11-15): ${changed.join(", ")} came back different. Built from what came back.`, "warning");
    await storeTerrainData(ctx.repo, handle, fetched);
    const { hull } = await layOut(ctx, handle.url);
    ctx.notify?.(
      hull
        ? "Ucluelet on an overcast summer afternoon: a 5 m/s north-westerly down the harbour. Rising Tide's hangar and their planned pier and dock are at the old seaplane base; your sloop lies at anchor off the dock. Click her (or press Enter) to come aboard."
        : "Ucluelet, with no boat: install the sailing tools to sail here.",
      "info",
    );
  },
};
