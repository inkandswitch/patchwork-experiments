import { describe, it, expect } from "vitest";
import { layOut, headTo, differences, MOORING, RODE, CREDIT } from "./template.js";
import { WIND, HOME, EXPECTED, OSM_DATE, cadboroDoc } from "./cadboro.js";
import { overpassQuery } from "./fetch-data.js";
import { credits } from "./credit.js";
import { FakeRepo } from "./test/fake-repo.js";

/** A drop context on a fake scene, with a registry that may or may not have sailing's sloop (a stand-in that writes a hull and two stations as sailing's would). */
function sceneCtx({ sailing }) {
  const repo = new FakeRepo();
  const scene = repo.add({ "@patchwork": { type: "scene" }, title: "Untitled scene", objects: {}, order: [], dimensions: {}, traits: {}, assets: {}, view: {} });
  let k = 0;
  const newId = (p = "o") => `${p}${++k}`;
  const placed = [];
  const sloop = {
    async create(ctx, at) {
      placed.push(at);
      const hull = ctx.newId("o");
      ctx.change((d) => {
        if (!d.traits["sailing.sea"]) d.traits["sailing.sea"] = { wind: { speed: 7, from: 45 }, seed: 1, scale: 1 };
        d.objects[hull] = { name: "Sloop", parent: null, transform: { position: [...at.world.position], rotation: [...at.world.rotation], scale: 1 }, traits: { "sailing.ship": {} } };
        const mast = ctx.newId("o");
        d.objects[mast] = { name: "Mast", parent: hull };
        d.objects[ctx.newId("o")] = { name: "Boom and sail", parent: mast, traits: { "sailing.sail": { raised: 1, sheet: 0.5 } } };
        d.objects[ctx.newId("o")] = { name: "Windlass", parent: hull, traits: { "sailing.anchor": { down: false, rode: 0 } } };
        d.order.push(hull);
      });
      return hull;
    },
  };
  const ctx = {
    repo,
    handle: scene,
    url: scene.url,
    doc: () => scene.doc(),
    scene: () => scene.doc(),
    change: (fn) => scene.change(fn),
    newId,
    notify: () => {},
    async addObject(url, opts) {
      const id = newId("o");
      scene.change((d) => {
        d.objects[id] = { name: opts.name, sourceUrl: url, providerId: opts.providerId, parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...opts.fields, hint: opts.hint };
        d.order.push(id);
      });
      return id;
    },
    async registry(type) {
      return {
        async load(id) {
          if (type === "scene:part" && id === "sailing.sloop" && sailing) return { module: sloop };
          return undefined;
        },
      };
    },
  };
  return { ctx, scene, placed };
}

describe("the Cadboro Bay template's layout", () => {
  it("puts the terrain at the origin, locked; a sea with the summer breeze; a home view from the club; play", async () => {
    const { ctx, scene } = sceneCtx({ sailing: true });
    const { terrain } = await layOut(ctx, "automerge:terrain", { seed: 7 });
    const d = scene.doc();
    expect(d.objects[terrain]).toMatchObject({ sourceUrl: "automerge:terrain", providerId: "terrain-mesh", locked: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } });
    // its About is the Terrain doc (sources, licences), and its data's credit shows in the view
    expect(d.objects[terrain]).toMatchObject({ infoUrl: "automerge:terrain", infoToolId: "terrain", traits: { [CREDIT]: {} } });
    expect(d.traits["sailing.sea"]).toEqual({ wind: { speed: WIND.speed, from: WIND.from }, seed: 7, scale: WIND.scale });
    expect(d.view).toMatchObject({ activity: "play", home: { position: [...HOME.position], target: [...HOME.target] } });
    expect(d.title).toBe("Cadboro Bay");
  });

  it("lays sailing's sloop on the mooring, head to wind, sail down, made fast", async () => {
    const { ctx, scene, placed } = sceneCtx({ sailing: true });
    const { hull } = await layOut(ctx, "automerge:terrain");
    const d = scene.doc();
    expect(placed[0].world.position).toEqual(MOORING);
    expect(placed[0].world.rotation[1]).toBeCloseTo(headTo(WIND.from), 12);
    expect(d.objects[hull].traits["sailing.ship"]).toEqual({});
    const aboard = Object.values(d.objects).filter((o) => o.traits?.["sailing.sail"] || o.traits?.["sailing.anchor"]);
    expect(aboard.find((o) => o.traits["sailing.sail"]).traits["sailing.sail"]).toEqual({ raised: 0, sheet: 0.5 });
    expect(aboard.find((o) => o.traits["sailing.anchor"]).traits["sailing.anchor"]).toEqual({ down: true, rode: RODE });
    // its own sea, not the part's default
    expect(d.traits["sailing.sea"].wind.from).toBe(WIND.from);
  });

  it("without sailing, is the place alone", async () => {
    const { ctx, scene } = sceneCtx({ sailing: false });
    const { terrain, hull } = await layOut(ctx, "automerge:terrain");
    expect(hull).toBeNull();
    expect(Object.keys(scene.doc().objects)).toEqual([terrain]);
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
