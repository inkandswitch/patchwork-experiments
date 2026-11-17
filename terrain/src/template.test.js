import { describe, it, expect } from "vitest";
import { layOut, headTo, differences, placeWeather, AT_ANCHOR, AFTERNOON, MOORING, RODE, CREDIT, PLACE, WEATHER, BAY_WATER } from "./template.js";
import { WIND, SKY, ORIGIN, OFFSET, HOME, EXPECTED, OSM_DATE, GRID, cadboroDoc } from "./cadboro.js";
import { overpassQuery } from "./fetch-data.js";
import { OFFSET as UCLUELET_OFFSET } from "./ucluelet.js";
import { credits } from "./credit.js";
import { sceneCtx } from "./test/scene-ctx.js";

describe("the Cadboro Bay template's layout", () => {
  it("puts the terrain at the origin, locked; the summer breeze; the bay's Sea at the chart's y = 0; a home view from the club; play", async () => {
    const { ctx, scene } = sceneCtx({ sailing: true });
    const { terrain, sea } = await layOut(ctx, "automerge:terrain", { seed: 7 });
    const d = scene.doc();
    expect(d.objects[terrain]).toMatchObject({ sourceUrl: "automerge:terrain", providerId: "terrain-mesh", locked: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } });
    // its About is the Terrain doc (sources, licences), and its data's credit shows in the view
    // the place (terrain.place) with no sky of its own: exactly its credit and the place
    expect(d.objects[terrain]).toMatchObject({ infoUrl: "automerge:terrain", infoToolId: "terrain" });
    expect(d.objects[terrain].traits).toStrictEqual({ [CREDIT]: {}, [PLACE]: {} });
    // the world's weather: Cadboro Bay (the weather's Place), 15:00 on 15 July on BC's clock, its breeze, a fair afternoon
    expect(d.traits).toStrictEqual({ weather: { lat: 48.454, lon: -123.2915, date: "2026-07-15", hour: 15, offset: -7, wind: 4, from: 235, seed: 7, cover: 0.35, clouds: "cumulus", base: 1200, visibility: 10000 } });
    expect(d.traits["sailing.sea"]).toBeUndefined();
    expect(d.traits.water).toBeUndefined();
    // the Sea keeps the terrain's footprint, from its known grid, down to the hint's deepest seabed, where its world has no open water
    const span = (GRID.n - 1) * GRID.cell;
    expect(d.objects[sea]).toMatchObject({ name: "Sea", sourceUrl: null, providerId: null, transform: { position: [GRID.x0 + span / 2, 0, GRID.z0 + span / 2], rotation: [0, 0, 0], scale: 1 } });
    expect(d.objects[sea].traits).toEqual({ water: { clip: [span, 150, span], colour: { ...BAY_WATER } }, "sailing.sea": { seed: 7, scale: WIND.scale } });
    // every corner of the grid is inside the clip (its centre the Sea's place)
    for (const x of [GRID.x0, GRID.x0 + span]) for (const z of [GRID.z0, GRID.z0 + span]) {
      expect(Math.abs(x - d.objects[sea].transform.position[0])).toBeLessThanOrEqual(span / 2);
      expect(Math.abs(z - d.objects[sea].transform.position[2])).toBeLessThanOrEqual(span / 2);
    }
    // one open water: the sloop brought none of her own
    expect(Object.values(d.objects).filter((o) => o.traits?.water)).toHaveLength(1);
    expect(d.view.start).toEqual({ home: { position: [...HOME.position], target: [...HOME.target] } });
    for (const k of ["activity", "home", "tool"]) expect(k in d.view).toBe(false);
    expect(d.title).toBe("Cadboro Bay");
  });

  it("lays sailing's sloop on the mooring, head to wind, main down, jib rolled away, made fast", async () => {
    const { ctx, scene, placed } = sceneCtx({ sailing: true });
    const { hull } = await layOut(ctx, "automerge:terrain");
    const d = scene.doc();
    expect(placed[0].world.position).toEqual(MOORING);
    expect(placed[0].world.rotation[1]).toBeCloseTo(headTo(WIND.from), 12);
    expect(d.objects[hull].traits["sailing.ship"]).toEqual({});
    const station = (trait) => Object.values(d.objects).find((o) => o.traits?.[trait]).traits[trait];
    expect(station("sailing.sail")).toEqual({ raised: 0, sheet: 0.5 });
    expect(station("sailing.jib")).toEqual({ sheet: 0.5, held: null, furl: 1 });
    expect(station("sailing.anchor")).toEqual({ down: true, rode: RODE });
    // every station the layout sets, and nothing else of the sloop's
    expect(Object.keys(AT_ANCHOR).sort()).toEqual(["sailing.anchor", "sailing.jib", "sailing.sail"]);
    // its own weather, not the part's default (the sloop writes the air only where there is no weather)
    expect(d.traits).toStrictEqual({ weather: placeWeather({ origin: ORIGIN, offset: OFFSET, wind: WIND, sky: SKY }, d.traits.weather.seed) });
    expect(d.traits.weather.from).toBe(WIND.from);
  });

  it("without sailing, is the place alone", async () => {
    const { ctx, scene } = sceneCtx({ sailing: false });
    const { terrain, sea, hull } = await layOut(ctx, "automerge:terrain");
    expect(hull).toBeNull();
    // the place and its water
    expect(Object.keys(scene.doc().objects).sort()).toEqual([terrain, sea].sort());
  });

  it("head to wind: a bow (−Z) turned by headTo(from) points at the bearing the wind comes from", () => {
    for (const from of [0, 90, 180, 235, 315]) {
      const y = headTo(from);
      // −Z turned by y about +Y: (−sin y, 0, −cos y); bearing from −Z toward +X
      const dir = [-Math.sin(y), -Math.cos(y)];
      const bearing = ((Math.atan2(dir[0], -dir[1]) * 180) / Math.PI + 360) % 360;
      expect(bearing).toBeCloseTo(from % 360, 9);
    }
  });
});

describe("a place's weather (placeWeather): the weather package's trait, its fields by name", () => {
  // the weather's own field names (weather/src/index.js): every one this writes is one of them, and only gustiness and rain are left to its defaults
  const FIELDS = ["lat", "lon", "date", "hour", "offset", "wind", "from", "gustiness", "seed", "cover", "clouds", "base", "visibility", "rain"];
  it.each([
    ["Cadboro Bay's", { origin: ORIGIN, offset: OFFSET, wind: WIND, sky: SKY }, 3, { lat: 48.454, lon: -123.2915, date: "2026-07-15", hour: 15, offset: -7, wind: 4, from: 235, seed: 3, cover: 0.35, clouds: "cumulus", base: 1200, visibility: 10000 }],
    ["any place's: where, its clock, its wind, its sky; when is the afternoon on its clock", { origin: { lat: -33.5, lon: 151.25 }, offset: 10, wind: { speed: 0, from: 0, scale: 9, source: "x" }, sky: { cover: 1, clouds: "stratus", base: 50, visibility: 100 } }, 0, { lat: -33.5, lon: 151.25, date: "2026-07-15", hour: 15, offset: 10, wind: 0, from: 0, seed: 0, cover: 1, clouds: "stratus", base: 50, visibility: 100 }],
  ])("%s", (_, place, seed, want) => {
    const w = placeWeather(place, seed);
    expect(w).toStrictEqual(want);
    for (const k of Object.keys(w)) expect(FIELDS).toContain(k);
    expect(FIELDS.filter((k) => !(k in w))).toEqual(["gustiness", "rain"]);
  });
  it("the afternoon is 15:00 on 15 July 2026, on the place's clock (no offset of its own)", () => expect(AFTERNOON).toStrictEqual({ date: "2026-07-15", hour: 15 }));
  // [place, its clock]: both places here are on Pacific Daylight Time in July
  it.each([
    ["Cadboro Bay", OFFSET],
    ["Ucluelet", UCLUELET_OFFSET],
  ])("%s's clock is UTC−7", (_, offset) => expect(offset).toBe(-7));
  it("the trait is the weather package's, unprefixed", () => expect(WEATHER).toBe("weather"));
  it("Cadboro's sky is the weather's four sky fields and nothing else", () => expect(Object.keys(SKY)).toEqual(["cover", "clouds", "base", "visibility"]));
});

describe("the Cadboro Bay data, pinned", () => {
  it("asks OpenStreetMap for the moment it was checked, so every scene gets the same shore", () => {
    expect(cadboroDoc().osmDate).toBe(OSM_DATE);
    const q = overpassQuery({ south: 48.4, west: -123.3, north: 48.5, east: -123.2 }, { date: OSM_DATE });
    expect(q.startsWith(`[out:json][timeout:120][date:"${OSM_DATE}"];`)).toBe(true);
    expect(overpassQuery({ south: 48.4, west: -123.3, north: 48.5, east: -123.2 }).startsWith("[out:json][timeout:120];")).toBe(true);
    expect(() => overpassQuery({ south: 0, west: 0, north: 1, east: 1 }, { date: "last week" })).toThrow(/date/);
  });
  it("says when what came back isn't what was checked", () => {
    const got = (dem, features) => ({ dem: { record: { sha256: dem } }, features: { record: { sha256: features } } });
    expect(differences(got(EXPECTED.dem, EXPECTED.features))).toEqual([]);
    expect(differences(got("x", EXPECTED.features))).toEqual(["NOAA's heights"]);
    expect(differences(got(EXPECTED.dem, "y"))).toHaveLength(1);
  });
});

describe("the credit in the view", () => {
  it("shows each terrain's credit once, for shown objects with the trait", () => {
    const scene = {
      ids: ["a", "b", "c", "d"],
      objects: { a: { traits: { [CREDIT]: {} } }, b: { traits: { [CREDIT]: {} } }, c: {}, d: { traits: { [CREDIT]: {} }, visible: false } },
    };
    const extras = { a: { terrain: { credit: "© OpenStreetMap contributors", attribution: "full" } }, b: { terrain: { credit: "© OpenStreetMap contributors" } }, c: { terrain: { credit: "other" } }, d: { terrain: { credit: "hidden" } } };
    expect(credits(scene, (id) => extras[id])).toEqual([{ text: "© OpenStreetMap contributors", title: "full" }]);
    expect(credits(scene, () => null)).toEqual([]);
  });
});
