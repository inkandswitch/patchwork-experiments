import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const registered = { "patchwork:datatype": [], "patchwork:tool": [] };
vi.mock("@inkandswitch/patchwork-plugins", () => ({ getRegistry: (type) => ({ filter: (fn) => (registered[type] ?? []).filter(fn) }) }));
import { OWN_SOURCES, PUBLISHED, callsForTabletop, importUrlOf, namePackages, packageUrls, patchworkOf, sceneImportUrl, scenePatchwork, shareableImportUrl } from "./scene-package.js";
import { plugins } from "./index.js";

const A = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const HEAD = "H".repeat(48);

describe("a package's URL on the docs made here (scene docs the scene's; die and bag docs this one's)", () => {
  it("an automerge URL goes on bare, whatever heads it was registered at; a public https URL as it is", () => {
    for (const [url, want] of [
      [A, A],
      [`${A}#${HEAD}`, A],
      [`${A}#${HEAD}|${HEAD}`, A],
      ["https://tools.example.com/scene/", "https://tools.example.com/scene/"],
      ["https://tools.example.com/scene/index.js#v2", "https://tools.example.com/scene/index.js"],
    ]) {
      expect([url, shareableImportUrl(url)]).toEqual([url, want]);
      expect(scenePatchwork(url)).toEqual({ type: "scene", suggestedImportUrl: want });
      expect(patchworkOf("die", url)).toEqual({ type: "die", suggestedImportUrl: want });
    }
  });

  it("what another viewer couldn't load is left off: the doc still says it's a scene", () => {
    for (const url of [
      "http://localhost:5173/",
      "http://tools.example.com/scene/",
      "https://localhost:5173/",
      "https://127.0.0.1/x",
      "https://192.168.1.4/x",
      "https://10.1.2.3/x",
      "https://172.20.0.1/x",
      "https://my-mac.local/x",
      "https://devbox/x",
      "https://[::1]/x",
      "https://me:pw@tools.example.com/",
      "blob:https://tools.example.com/1",
      "data:text/javascript,1",
      "javascript:alert(1)",
      "./dist/index.js",
      `${A}/dist/index.js`,
      "automerge:not-an-id",
      "",
      null,
      undefined,
      7,
    ]) {
      expect([url, shareableImportUrl(url)]).toEqual([url, null]);
      expect(scenePatchwork(url)).toEqual({ type: "scene" });
      expect(patchworkOf("die", url)).toEqual({ type: "die" });
    }
  });

  it("is read from the registry: the scene datatype's importUrl, else the scene tool's, else nothing", async () => {
    expect(await sceneImportUrl()).toBeNull();
    registered["patchwork:tool"] = [{ id: "other", importUrl: "automerge:x" }, { id: "scene", importUrl: `${A}#${HEAD}` }];
    expect(await sceneImportUrl()).toBe(`${A}#${HEAD}`);
    registered["patchwork:datatype"] = [{ id: "scene", importUrl: "https://tools.example.com/scene/" }];
    expect(await sceneImportUrl()).toBe("https://tools.example.com/scene/");
    registered["patchwork:datatype"] = [{ id: "scene" }]; // registered without one: the tool's
    expect(await sceneImportUrl()).toBe(`${A}#${HEAD}`);
    registered["patchwork:datatype"] = [{ id: "die", importUrl: "https://tools.example.com/tabletop/" }];
    expect(await importUrlOf("die")).toBe("https://tools.example.com/tabletop/");
  });
});

describe("the packages a scene doc made here names, whatever is installed", () => {
  const SCENE = PUBLISHED.scene;
  const SEATS = PUBLISHED.seats;
  const TABLETOP = PUBLISHED.tabletop;
  const OTHER = A.replace("2zt6", "2zt7");
  const clear = () => {
    for (const k of Object.keys(registered)) registered[k] = [];
  };

  // each must match where its package is published: its pushwork rootUrl
  // (checked where the sibling packages are checked out beside this one)
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  for (const pkg of ["scene", "seats", "tabletop"]) {
    const config = join(root, pkg, ".pushwork", "config.json");
    it.skipIf(!existsSync(config))(`${pkg}'s published URL is its pushwork rootUrl`, () => {
      expect(PUBLISHED[pkg]).toBe(JSON.parse(readFileSync(config, "utf8")).rootUrl);
    });
  }

  it("the scene's and this package's URLs are the registry's when another viewer could load them, else where they're published", async () => {
    clear();
    expect(await packageUrls()).toEqual({ scene: SCENE, tabletop: TABLETOP });
    registered["patchwork:datatype"] = [{ id: "scene", importUrl: `${OTHER}#${HEAD}` }, { id: "tabletop-game", importUrl: "http://localhost:5173/" }];
    expect(await packageUrls()).toEqual({ scene: OTHER, tabletop: TABLETOP });
    clear();
  });

  it("the seats' are their owner's, given: where it was loaded from, else the seats package's published URL for the seats package alone", async () => {
    clear();
    expect((await packageUrls({ seatsBy: { id: "seats", importUrl: `${OTHER}#${HEAD}` } })).seats).toBe(OTHER);
    for (const importUrl of [null, undefined, "http://localhost:5174/"]) expect((await packageUrls({ seatsBy: { id: "seats", importUrl } })).seats).toBe(SEATS);
    expect((await packageUrls({ seatsBy: { id: "someone-elses-seats", importUrl: "https://tools.example.com/seats/" } })).seats).toBe("https://tools.example.com/seats/");
    // another owner nobody else could load: nothing to name
    for (const seatsBy of [{ id: "t.seats", importUrl: null }, { id: "t.seats", importUrl: "http://localhost:1/" }, null, undefined]) expect(await packageUrls({ seatsBy })).not.toHaveProperty("seats");
  });

  it("a doc calls for this package where anything has one of its traits or is built by one of its sources", () => {
    const obj = (o) => ({ objects: { a: o } });
    for (const d of [{}, { traits: { seats: {} } }, obj({ providerId: "file-glb", traits: { "scene.carry": {} } }), obj({ traits: { tabletopish: {}, "dicey.x": {} }, providerId: "dice" })]) expect(callsForTabletop(d)).toBe(false);
    for (const t of ["tabletop.card", "dice.die", "bag.container", "keep.plain", "card-table.kept", "tabletop.start"]) {
      expect(callsForTabletop(obj({ traits: { [t]: {} } }))).toBe(true);
      expect(callsForTabletop({ traits: { [t]: {} } })).toBe(true);
    }
    for (const id of OWN_SOURCES) expect(callsForTabletop(obj({ providerId: id }))).toBe(true);
  });

  it("every trait and source this package registers is one it answers for", () => {
    for (const p of plugins) if (p.type === "scene:extension") for (const t of p.traits ?? []) expect([t, callsForTabletop({ traits: { [t]: {} } })]).toEqual([t, true]);
    expect(plugins.filter((p) => p.type === "scene:source").map((p) => p.id).sort()).toEqual([...OWN_SOURCES].sort());
  });

  it("names them on a doc: the scene as its suggested import where it has none, each needed listed once, nothing taken off", () => {
    const urls = { scene: SCENE, seats: SEATS, tabletop: TABLETOP };
    const d = { "@patchwork": { type: "scene" }, packages: [], objects: { a: { traits: { "tabletop.card": {} } } } };
    namePackages(d, urls);
    expect(d["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: SCENE });
    expect(d.packages).toEqual([{ url: SCENE }, { url: SEATS }, { url: TABLETOP }]);
    namePackages(d, urls);
    expect(d.packages).toHaveLength(3);
    // this package only where the doc calls for it; the seats only where given
    const bare = { "@patchwork": { type: "scene" }, packages: [] };
    namePackages(bare, { scene: SCENE, tabletop: TABLETOP });
    expect(bare.packages).toEqual([{ url: SCENE }]);
    // listed already (at heads), or another's: kept as it is
    const e = { "@patchwork": { type: "scene", suggestedImportUrl: "https://tools.example.com/scene/" }, packages: [{ url: `${SEATS}#${HEAD}` }, { url: "automerge:other" }] };
    namePackages(e, urls);
    expect(e["@patchwork"].suggestedImportUrl).toBe("https://tools.example.com/scene/");
    expect(e.packages).toEqual([{ url: `${SEATS}#${HEAD}` }, { url: "automerge:other" }, { url: SCENE }]);
    // a suggestion nobody else could load is replaced; a doc made without the list gets none
    const f = { "@patchwork": { type: "scene", suggestedImportUrl: "http://localhost:5173/" } };
    namePackages(f, urls);
    expect(f).toEqual({ "@patchwork": { type: "scene", suggestedImportUrl: SCENE } });
  });
});
