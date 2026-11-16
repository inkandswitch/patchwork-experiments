// "Cadboro Bay (RVYC)": a scene of the waters off the Royal Victoria Yacht
// Club, to sail somewhere familiar. It fetches the place's data once (into a
// new Terrain doc: fetch-data.js, store.js), puts the terrain in at the
// scene's origin (locked: it is the ground), gives the scene a sea with a
// summer afternoon's breeze, and lays a sloop on the club's moorings, head
// to wind, main down, jib rolled away, her anchor down for a mooring. Then
// it opens in play.
//
// The sloop is sailing's, found in the plugin registry at run time (the
// "sailing.sloop" part), never imported: without sailing the scene is the
// place alone, and says so. Its sea and its stations are written as data
// (sailing's trait vocabulary), as the inspector would.

import { cadboroDoc, ORIGIN, WIND, HOME, GRID, OSM_DATE, EXPECTED } from "./cadboro.js";
import { fetchTerrainData } from "./fetch-data.js";
import { storeTerrainData } from "./store.js";

/** Where the sloop lies: the mooring field, the frame's origin. */
export const MOORING = Object.freeze([0, 0, 0]);
/** sailing's trait keys this writes (its DESIGN.md, "Traits"). */
export const SEA = "sailing.sea", WEATHER = "sailing.weather", SAIL = "sailing.sail", JIB = "sailing.jib", ANCHOR = "sailing.anchor";
/** The water package's object trait (its WATER.md, "Water bodies"): this object is water, its origin the surface at rest; no size, open water. */
export const WATER = "water";

/**
 * The bay's Sea: open water at the chart's y = 0 (mean water level), with
 * sailing's sea on it for its waves. An object with no source: its shape is
 * the water trait's data. Pure.
 */
export function bayWater(seed) {
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
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    traits: { [WATER]: {}, [SEA]: { seed, scale: WIND.scale } },
  };
}
/** This package's: the data's credit at the foot of the view (credit.js). */
export const CREDIT = "terrain.credit";
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

/** The terrain's placeholder box until its GLB arrives (its grid, sea floor to hill tops). */
const HINT = { bounds: { min: [GRID.x0, -150, GRID.z0], max: [GRID.x0 + (GRID.n - 1) * GRID.cell, 90, GRID.z0 + (GRID.n - 1) * GRID.cell] } };

/**
 * Lay the scene out (after the data is in a Terrain doc).
 * @param {object} ctx  the drop context (STAGE.md, "Drops")
 * @param {string} terrainUrl
 * @returns {Promise<{ terrain: string, sea: string, hull: string | null }>} the object ids
 */
export async function layOut(ctx, terrainUrl, { seed = Math.floor(Math.random() * 1e9) } = {}) {
  // locked (it is the ground); its About is the Terrain doc (sources, licences); its credit shows in the view
  const terrain = await ctx.addObject(terrainUrl, { providerId: "terrain-mesh", name: "Cadboro Bay", hint: HINT, fields: { locked: true, infoUrl: terrainUrl, infoToolId: "terrain", traits: { [CREDIT]: {} } } });
  const sea = ctx.newId("o");
  ctx.change((d) => {
    // the world's wind and sky (sailing's weather), and the bay's water: open, at the chart's y = 0, with a sea on it
    d.traits[WEATHER] = { wind: { speed: WIND.speed, from: WIND.from }, seed };
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
