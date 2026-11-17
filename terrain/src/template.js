// "Cadboro Bay (RVYC)": a scene of the waters off the Royal Victoria Yacht
// Club, to sail somewhere familiar. It fetches the place's data once (into a
// new Terrain doc: fetch-data.js, store.js), puts the terrain in at the
// scene's origin (locked: it is the ground), gives the scene a sea with a
// summer afternoon's breeze, and lays a sloop on the club's moorings, head
// to wind, main down, jib rolled away, her anchor down for a mooring. Then
// it opens in play. The world's weather is a summer afternoon here, written
// as the weather package's trait (placeWeather): data, which that package
// turns into the sky, the sun and the wind; without it installed the scene
// has the stage's own sky and no wind.
//
// The sloop is sailing's, found in the plugin registry at run time (the
// "sailing.sloop" part), never imported: without sailing the scene is the
// place alone, and says so. Its sea and its stations are written as data
// (sailing's trait vocabulary), as the inspector would.

import { cadboroDoc, ORIGIN, WIND, SKY, HOME, GRID, OSM_DATE, EXPECTED } from "./cadboro.js";
import { fetchTerrainData } from "./fetch-data.js";
import { storeTerrainData } from "./store.js";

/** Where the sloop lies: the mooring field, the frame's origin. */
export const MOORING = Object.freeze([0, 0, 0]);
/** sailing's trait keys this writes (its DESIGN.md, "Traits"). */
export const SEA = "sailing.sea", SAIL = "sailing.sail", JIB = "sailing.jib", ANCHOR = "sailing.anchor";
/** The weather package's scene trait (its WEATHER.md, "The data"): the world's weather, flat plain data. */
export const WEATHER = "weather";
/**
 * When a place is shown: a summer afternoon, 15 July 2026 at 15:00 on
 * British Columbia's clock (UTC−7), inside the hours both places' wind
 * climatologies are of (13:00–18:00 PDT). The weather's `date`, `hour` and
 * `offset`: the sun is where it is then.
 */
export const AFTERNOON = Object.freeze({ date: "2026-07-15", hour: 15, offset: -7 });

/**
 * A place's weather, the weather package's trait: where (the place's frame
 * origin, so the weather's Place picker knows it), when (AFTERNOON), the air
 * (its wind climatology's speed and direction; the gust seed) and the sky
 * (`sky`: cover, cloud kind, base, visibility). Nothing else: the
 * gustiness and the rain are the weather's defaults (a missing field is its
 * default). Pure.
 */
export function placeWeather({ origin, wind, sky }, seed) {
  return { lat: origin.lat, lon: origin.lon, ...AFTERNOON, wind: wind.speed, from: wind.from, seed, cover: sky.cover, clouds: sky.clouds, base: sky.base, visibility: sky.visibility };
}
/** The water package's object trait (its WATER.md, "Water bodies"): this object is water, its origin the surface at rest; no size, open water (with a clip: the box it keeps where its world has none). */
export const WATER = "water";

/** The terrain's placeholder box until its GLB arrives (its grid, sea floor to hill tops). */
const HINT = { bounds: { min: [GRID.x0, -150, GRID.z0], max: [GRID.x0 + (GRID.n - 1) * GRID.cell, 90, GRID.z0 + (GRID.n - 1) * GRID.cell] } };

/**
 * The box the bay's Sea keeps where the world it is placed in offers no open
 * water (the water package's clip: its WATER.md, "Clipped open water"): the
 * terrain's footprint, from its known grid as data (never the loaded GLB),
 * down to the deepest seabed in it, so the bay on a chart table is a block
 * of its own sea. Its centre is where the Sea stands. Another place passes
 * its own placeholder box (template-ucluelet.js). Pure.
 */
export function bayClip(hint = HINT) {
  const { min, max } = hint.bounds;
  return { clip: [max[0] - min[0], -min[1], max[2] - min[2]], position: [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2] };
}

/**
 * The bay's Sea: open water at the chart's y = 0 (mean water level), with
 * sailing's sea on it for its waves, keeping the terrain's footprint where
 * its world offers no open water (bayClip of the place's hint). An object
 * with no source: its shape is the water trait's data. Pure.
 */
export function bayWater(seed, hint = HINT, colour = BAY_WATER) {
  const { clip, position } = bayClip(hint);
  return {
    name: "Sea",
    sourceUrl: null,
    providerId: null,
    renderUrl: null,
    parent: null,
    group: null,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked: true,
    transform: { position, rotation: [0, 0, 0], scale: 1 },
    traits: { [WATER]: { clip, colour: { ...colour } }, [SEA]: { seed, scale: WIND.scale } },
  };
}
/** The bay's own water colour (the water trait's `colour`: water/WATER.md): the Salish Sea's grey-green under a summer sky, not the open ocean's blue; the shore's tint where it shows in the water (the oaks' and firs' dark olive). Art direction, from the place's photographs' general look. */
export const BAY_WATER = Object.freeze({ deep: "#183b3c", scatter: "#2f7566", shore: "#26302a" });
/** This package's: the data's credit at the foot of the view (credit.js). */
export const CREDIT = "terrain.credit";
/** This package's: the object that is the place (place.js: the shore in the water, the water's shelter, the ground's grain). */
export const PLACE = "terrain.place";
/** Chain out on the mooring (sailing's RODE: 25 m; the water is ~8 m deep). */
export const RODE = 25;
/**
 * Her stations on the mooring, as sailing's own ship at anchor has them (its
 * layout.js AT_ANCHOR, copied by trait key): the main down, the jib rolled
 * away, the anchor down with its rode out. Each trait's other fields (a
 * sheet's trim) stay as the sloop part made them.
 */
export const AT_ANCHOR = Object.freeze({ [SAIL]: Object.freeze({ raised: 0 }), [JIB]: Object.freeze({ furl: 1 }), [ANCHOR]: Object.freeze({ down: true, rode: RODE }) });

/** Everything attached under `id`, at any depth (the sail hangs from the mast, not the hull). */
export function aboard(objects, id) {
  const out = [];
  const seen = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [k, o] of Object.entries(objects)) {
      if (!seen.has(k) && seen.has(o.parent)) {
        seen.add(k);
        out.push(o);
        grew = true;
      }
    }
  }
  return out;
}

/** The yaw (about +Y) that points a bow (−Z) at compass bearing `from`: head to wind. */
export const headTo = (from) => (-from * Math.PI) / 180;

export async function newCadboroTerrain(repo) {
  return repo.create2({ "@patchwork": { type: "terrain" }, ...cadboroDoc(), data: null, sources: [], attribution: "" });
}

/**
 * Lay the scene out (after the data is in a Terrain doc).
 * @param {object} ctx  the drop context (STAGE.md, "Drops")
 * @param {string} terrainUrl
 * @returns {Promise<{ terrain: string, sea: string, hull: string | null }>} the object ids
 */
export async function layOut(ctx, terrainUrl, { seed = Math.floor(Math.random() * 1e9) } = {}) {
  // locked (it is the ground); its About is the Terrain doc (sources, licences); its credit shows in the view
  // the place (terrain.place, place.js): the shore in the water, the water's shelter behind the breakwater and the ground's grain
  const terrain = await ctx.addObject(terrainUrl, { providerId: "terrain-mesh", name: "Cadboro Bay", hint: HINT, fields: { locked: true, infoUrl: terrainUrl, infoToolId: "terrain", traits: { [CREDIT]: {}, [PLACE]: {} } } });
  const sea = ctx.newId("o");
  ctx.change((d) => {
    // the world's weather (a fair summer afternoon), and the bay's water: open, at the chart's y = 0, with a sea on it
    d.traits[WEATHER] = placeWeather({ origin: ORIGIN, wind: WIND, sky: SKY }, seed);
    d.objects[sea] = bayWater(seed);
    d.order.push(sea);
    // people start in Look over the bay (no body named: view.start, TOOLS.md §2); a click on the sloop comes aboard
    d.view.start = { home: { position: [...HOME.position], target: [...HOME.target] } };
    if (!d.title || /^untitled/i.test(d.title)) d.title = "Cadboro Bay";
  });
  let hull = null;
  // (the sloop finds the bay's open water there, and brings none of her own)
  const parts = await ctx.registry?.("scene:part");
  let loaded = null;
  try {
    loaded = (await parts?.load?.("sailing.sloop")) ?? null;
  } catch {
    loaded = null; // not installed
  }
  if (loaded) {
    const sloop = loaded?.module?.default ?? loaded?.module;
    const place = { position: [...MOORING], rotation: [0, headTo(WIND.from), 0], scale: 1 };
    hull = (await sloop?.create?.(ctx, { parent: null, transform: place, world: place })) ?? null;
    if (hull) {
      // on her mooring: sails down, made fast (sailing has no mooring, so her anchor holds her)
      ctx.change((d) => {
        for (const o of aboard(d.objects ?? {}, hull)) {
          for (const [trait, set] of Object.entries(AT_ANCHOR)) {
            if (o.traits?.[trait]) for (const [k, v] of Object.entries(set)) o.traits[trait][k] = v;
          }
        }
      });
    }
  }
  return { terrain, sea, hull };
}

/** Whether fetched data is the data checked on 2026-11-09 (cadboro.js EXPECTED): [] or what differs. */
export function differences(fetched) {
  const out = [];
  if (fetched.dem.record.sha256 !== EXPECTED.dem) out.push("NOAA's heights");
  if (fetched.features.record.sha256 !== EXPECTED.features) out.push(`OpenStreetMap's shore and docks (as of ${OSM_DATE})`);
  if (fetched.look && fetched.look.record.sha256 !== EXPECTED.look) out.push(`OpenStreetMap's buildings and land cover (as of ${OSM_DATE})`);
  return out;
}

export default {
  async create(ctx) {
    ctx.notify?.("Fetching Cadboro Bay: heights from NOAA, the shore and the docks from OpenStreetMap (up to a minute)…", "info");
    const handle = await newCadboroTerrain(ctx.repo);
    const fetched = await fetchTerrainData(cadboroDoc(), { fetch: (...a) => globalThis.fetch(...a) });
    const changed = differences(fetched);
    fetched.summary.matchesChecked = !changed.length;
    if (changed.length) ctx.notify?.(`The data has changed since this place was checked (2026-11-09): ${changed.join(" and ")} came back different. Built from what came back; the shore and depths may differ from the checked ones.`, "warning");
    await storeTerrainData(ctx.repo, handle, fetched);
    const { hull } = await layOut(ctx, handle.url);
    ctx.notify?.(
      hull
        ? "Cadboro Bay, a summer afternoon: a 4 m/s south-westerly. Your sloop is on the club's moorings, head to wind, sails down. Click her (or press Enter) to come aboard; raise the sail and let go the mooring (hold F at the windlass) to sail."
        : "Cadboro Bay, with no boat: install the sailing tools to sail here.",
      "info",
    );
  },
};

export { ORIGIN };
