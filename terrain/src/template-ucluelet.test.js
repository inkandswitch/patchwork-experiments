import { describe, it, expect } from "vitest";
import { layOut, differences, anchorage, placeDoc, ATTRIBUTION, SHORT_CREDIT, PROVENANCE } from "./template-ucluelet.js";
import { headTo, AT_ANCHOR, CREDIT, PLACE } from "./template.js";
import { WIND, HOME, EXPECTED, ANCHORAGE, ORIGIN, GRID, WATER_COLOUR } from "./ucluelet.js";
import { localFrame } from "./tmerc.js";
import { sceneCtx } from "./test/scene-ctx.js";

/** The weather the template writes under Ukee grey, written out (the weather package's tests draw it: Ukee grey exactly, the sun within a degree of the old hand-set one). */
const UKEE_GREY_WEATHER = (seed) => ({ lat: 48.95, lon: -125.558, date: "2026-07-15", hour: 15, offset: -7, wind: 5, from: 300, seed, cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000 });

describe("the Ucluelet template's layout", () => {
  it("puts the terrain at the origin, locked, the place with its credit; the weather: Ukee grey and the north-westerly; the harbour's open water with a sea at 0.6; the home view over the boatyard", async () => {
    const { ctx, scene } = sceneCtx({ sailing: false });
    const ids = await layOut(ctx, "automerge:terrain", { seed: 7 });
    const d = scene.doc();
    const t = d.objects[ids.terrain];
    expect(t).toMatchObject({ providerId: "terrain-mesh", locked: true, infoUrl: "automerge:terrain", infoToolId: "terrain" });
    // the place, with no sky of its own: exactly its credit and the place
    expect(t.traits).toStrictEqual({ [CREDIT]: {}, [PLACE]: {} });
    // the world's weather: Ucluelet (the weather's Place), 15:00 on 15 July on BC's clock, the north-westerly (ECCC Amphitrite Point), Ukee grey
    expect(d.traits).toStrictEqual({ weather: UKEE_GREY_WEATHER(7) });
    const sea = d.objects[ids.sea];
    // the Sea keeps Ucluelet's footprint (its grid, 20.48 km a side), 130 m deep, where its world has no open water (water/WATER.md, "Clipped open water")
    const span = (GRID.n - 1) * GRID.cell;
    expect(span).toBe(20480);
    // the inlet's own water colour (water's colourOf reads it)
    expect(sea.traits.water).toEqual({ clip: [span, 130, span], colour: { ...WATER_COLOUR } });
    expect(sea.traits["sailing.sea"]).toEqual({ seed: 7, scale: 0.6 });
    expect(sea.transform.position).toEqual([GRID.x0 + span / 2, 0, GRID.z0 + span / 2]);
    // every corner of the grid, and the frame's origin (the boatyard), inside the clip
    for (const x of [GRID.x0, GRID.x0 + span, 0]) for (const z of [GRID.z0, GRID.z0 + span, 0]) {
      expect(Math.abs(x - sea.transform.position[0])).toBeLessThanOrEqual(span / 2);
      expect(Math.abs(z - sea.transform.position[2])).toBeLessThanOrEqual(span / 2);
    }
    expect(d.view.start).toEqual({ home: { position: [...HOME.position], target: [...HOME.target] } });
    expect(d.title).toBe("Ucluelet");
    expect(ids.hull).toBe(null);
  });
  it("lays sailing's sloop at anchor off the dock, head to wind, her stations as at anchor", async () => {
    const { ctx, scene, placed } = sceneCtx({ sailing: true });
    const { hull } = await layOut(ctx, "automerge:terrain", { seed: 7 });
    const d = scene.doc();
    expect(placed[0].world.position).toEqual(anchorage());
    expect(placed[0].world.rotation).toEqual([0, headTo(WIND.from), 0]);
    const [x, z] = localFrame(ORIGIN).toLocal(ANCHORAGE.lat, ANCHORAGE.lon);
    expect(Math.hypot(anchorage()[0] - x, anchorage()[2] - z)).toBeLessThan(0.01);
    expect(d.objects[hull].traits["sailing.ship"]).toBeTruthy();
    const stations = Object.values(d.objects).filter((o) => o.parent && Object.keys(AT_ANCHOR).some((k) => o.traits?.[k]));
    for (const o of stations) for (const [k, set] of Object.entries(AT_ANCHOR)) if (o.traits[k]) expect(o.traits[k]).toMatchObject(set);
    // one open water: the template's (the sloop brings none where there is one)
    expect(Object.values(d.objects).filter((o) => o.traits?.water && !o.traits.water.size)).toHaveLength(1);
  });
  it("says when what came back isn't what was checked", () => {
    const ok = { dem: { record: { sha256: EXPECTED.dem } }, layers: { record: { sha256: EXPECTED.layers } }, features: { record: { sha256: EXPECTED.features } }, look: { record: { sha256: EXPECTED.look } } };
    expect(differences(ok)).toEqual([]);
    expect(differences({ ...ok, look: { record: { sha256: "x" } } })).toHaveLength(1);
    expect(differences({ ...ok, layers: { record: { sha256: "x" } }, features: { record: { sha256: "x" } } })).toHaveLength(2);
  });
  it("its Terrain doc carries the layered heights, the look, the site, its provenance and credits", () => {
    const d = placeDoc();
    expect(d.heights.kind).toBe("layered");
    expect(d.site.structures.length).toBeGreaterThan(10);
    expect(d.landmarks.map((l) => l.id)).toEqual(["amphitrite", "ozzard"]);
    expect(d.provenance.map((p) => p.id)).toEqual(PROVENANCE.map((p) => p.id));
    expect(d.attribution).toBe(ATTRIBUTION);
    expect(d.credit).toBe(SHORT_CREDIT);
    for (const s of ["OpenStreetMap", "Canadian Hydrographic Service", "HRDEM", "NOAA", "Bennett Land Surveying", "Rising Tide Boat Works", "Not for navigation"]) expect(ATTRIBUTION).toContain(s);
  });
});

describe("its skies: a weather preset each (the template's sky option)", () => {
  // [sky, the weather's sky fields it sets]: everything else as under Ukee grey
  it.each([
    ["ukee-grey", { cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000 }],
    ["marine-layer", { cover: 1, clouds: "stratus", base: 100, visibility: 1000 }],
    ["clear-afternoon", { cover: 0, clouds: "cumulus", base: 1200, visibility: 20000 }],
  ])("%s", async (sky, fields) => {
    const { ctx, scene } = sceneCtx({ sailing: true });
    await layOut(ctx, "automerge:terrain", { seed: 7, sky });
    expect(scene.doc().traits).toStrictEqual({ weather: { ...UKEE_GREY_WEATHER(7), ...fields } });
  });
  it.each([["drizzle"], ["toString"], [""]])("a sky it hasn't (%j) is refused, and nothing is written", async (sky) => {
    const { ctx, scene } = sceneCtx({ sailing: true });
    const before = JSON.stringify(scene.doc());
    await expect(layOut(ctx, "automerge:terrain", { seed: 7, sky })).rejects.toThrow(RangeError);
    expect(JSON.stringify(scene.doc())).toBe(before);
  });
});
