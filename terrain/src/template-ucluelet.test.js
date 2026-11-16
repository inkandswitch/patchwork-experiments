import { describe, it, expect } from "vitest";
import { layOut, differences, anchorage, placeDoc, SKY, ATTRIBUTION, SHORT_CREDIT, PROVENANCE } from "./template-ucluelet.js";
import { headTo, AT_ANCHOR, CREDIT } from "./template.js";
import { WIND, HOME, SKIES, EXPECTED, ANCHORAGE, ORIGIN, GRID, WATER_COLOUR } from "./ucluelet.js";
import { skyOffer, skyTrait } from "./sky.js";
import { localFrame } from "./tmerc.js";
import { sceneCtx } from "./test/scene-ctx.js";

describe("the Ucluelet template's layout", () => {
  it("puts the terrain at the origin, locked, with its credit and Ucluelet's sky; the north-westerly; the harbour's open water with a sea at 0.6; the home view over the boatyard", async () => {
    const { ctx, scene } = sceneCtx({ sailing: false });
    const ids = await layOut(ctx, "automerge:terrain", { seed: 7 });
    const d = scene.doc();
    const t = d.objects[ids.terrain];
    expect(t).toMatchObject({ providerId: "terrain-mesh", locked: true, infoUrl: "automerge:terrain", infoToolId: "terrain" });
    expect(t.traits[CREDIT]).toEqual({});
    expect(t.traits[SKY]).toEqual(SKIES["ukee-grey"]);
    expect(d.traits["sailing.weather"]).toEqual({ wind: { speed: 5, from: 300 }, seed: 7 });
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

describe("terrain.sky", () => {
  it("offers its sky, fog, sun and exposure as the atmosphere, and nothing else", () => {
    expect(skyOffer({ ...SKIES["ukee-grey"], extra: 1 })).toEqual({ sky: SKIES["ukee-grey"].sky, fog: SKIES["ukee-grey"].fog, sun: SKIES["ukee-grey"].sun, exposure: 1.05 });
    expect(skyOffer({})).toBe(null);
    expect(skyOffer(null)).toBe(null);
  });
  it("takes the lowest id's among shown objects", () => {
    const doc = { objects: { b: { traits: { "terrain.sky": { fog: { far: 2 } } } }, a: { visible: false, traits: { "terrain.sky": { fog: { far: 1 } } } }, c: { traits: { "terrain.sky": { fog: { far: 3 } } } } } };
    expect(skyTrait(doc)).toEqual({ fog: { far: 2 } });
    expect(skyTrait({ objects: {} })).toBe(null);
  });
  it("offers it through ambient(), a new value only when the trait changes", async () => {
    const { default: ext } = await import("./sky.js");
    let doc = { objects: { o1: { traits: { "terrain.sky": SKIES["marine-layer"] } } } };
    const inst = ext.create({ doc: () => doc });
    const a = inst.ambient();
    expect(a.atmosphere.fog).toEqual(SKIES["marine-layer"].fog);
    expect(inst.ambient()).toBe(a);
    doc = { objects: {} };
    expect(inst.ambient()).toBe(null);
  });
});
