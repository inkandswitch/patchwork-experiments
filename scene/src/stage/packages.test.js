// The stage and a scene's packages (STAGE.md, "Packages"), mounted with the
// fakes: the list kept true to what the doc calls for (reconcile), and the
// listed packages this viewer doesn't have offered once, loaded on a yes or
// a remembered yes, and never otherwise.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { FakeRepo, fakeUrl } from "../test/fake-repo.js";
import { emptyScene } from "../test/empty-scene.js";
import { getRegistry } from "../test/plugins-mock.js";
import { imported, resetPackagesServed, servePackage } from "../test/filesystem-mock.js";
import { ACCEPTED_KEY, resetPackages } from "./packages.js";
import { ARRIVE_WAIT_MS } from "./stage.js";
import packagesPart from "../parts/packages.js";
import * as editor from "../parts/editor.js";
import { LINK } from "../native/link-graph.js";

const HEAD = "H".repeat(48);
const PROMPT = { meta: { id: "scene.packages" }, module: packagesPart };
const urls = (s) => (s.doc().packages ?? []).map((e) => e.url);
const state = (s) => {
  const p = s.local.get().packages;
  return { ask: p.ask.map((e) => e.url), loading: p.loading.map((e) => e.url), failed: p.failed.map((e) => e.url) };
};
const running = (s) => s.local.get().running.map((r) => r.id);
const card = (s) => s.root.querySelector(".packages-card");
const press = async (s, action) => {
  card(s).querySelector(`[data-action="${action}"]`).click();
  await settle();
};
const accepted = () => JSON.parse(localStorage.getItem(ACCEPTED_KEY) ?? "[]");

/** A package folder in the repo, as pushwork lays one out: a folder doc naming its package.json. */
function folder(repo, name, url = fakeUrl()) {
  const pj = repo.add({ "@patchwork": { type: "file" }, name: "package.json", content: JSON.stringify({ name }) });
  return repo.add({ title: name, docs: [{ name: "package.json", type: "file", url: pj.url }] }, url);
}

let mounted = [];
const mount = async (o) => {
  const s = await mountStage(o);
  mounted.push(s);
  return s;
};

beforeEach(() => {
  localStorage.clear();
  resetPackages();
  resetPackagesServed();
});
afterEach(() => {
  for (const s of mounted) s.unmount();
  mounted = [];
  vi.restoreAllMocks();
});

// ─── reconcile ──────────────────────────────────────────────────────────────

describe("reconcile: the list names what the doc calls for and this viewer has", () => {
  const SAILING = fakeUrl();
  const TERRAIN = fakeUrl();
  const weather = { meta: { id: "tiny.weather", traits: ["tiny.weather"], importUrl: `${SAILING}#${HEAD}` }, module: { create: () => ({}) } };

  it("adds each package once, bare, and then writes nothing more", async () => {
    const s = await mount({ extensions: [weather], doc: { traits: { "tiny.weather": {} }, objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"] } });
    getRegistry("scene:source").register({ type: "scene:source", id: "terrain-mesh", content: "built", load: async () => ({}) }, TERRAIN);
    await settle();
    expect(urls(s).sort()).toEqual([SAILING, TERRAIN].sort());
    // every entry is a plain { url }
    expect(s.doc().packages.every((e) => JSON.stringify(Object.keys(e)) === '["url"]')).toBe(true);
    let changes = 0;
    s.handle.on("change", () => changes++);
    s.change((d) => (d.title = "Renamed"));
    getRegistry("scene:source").register({ type: "scene:source", id: "another", content: "built", load: async () => ({}) }, fakeUrl());
    await settle();
    expect(changes).toBe(1); // the rename, and no write of ours
    expect(urls(s)).toHaveLength(2);
    // this viewer has them, so nothing is offered
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
  });

  it("follows the doc: a trait added later names its package then", async () => {
    const s = await mount({ extensions: [weather] });
    await settle();
    expect(urls(s)).toEqual([]);
    s.change((d) => (d.traits["tiny.weather"] = {}));
    await settle();
    expect(urls(s)).toEqual([SAILING]);
    // and the trait going takes the entry off: nothing here calls for it now
    s.change((d) => delete d.traits["tiny.weather"]);
    await settle();
    expect(urls(s)).toEqual([]);
  });

  it("takes off only what this viewer has and nothing calls for, every entry naming it, in one change; a package missing here and the scene package stay, and a part lists only what it made calls for", async () => {
    const JOINTS = fakeUrl();
    const TRAVERSAL = fakeUrl();
    const MISSING = fakeUrl();
    const SCENE = fakeUrl();
    const PARTS = fakeUrl();
    const ext = (id, url) => ({ meta: { id, traits: [id], importUrl: `${url}#${HEAD}` }, module: { create: () => ({}) } });
    const part = { meta: { id: "buoy", importUrl: PARTS }, module: { create: async (ctx) => (ctx.change((d) => ((d.objects.b = { name: "Buoy", providerId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }), d.order.push("b"))), "b") } };
    const user = { meta: { id: "t.user" }, module: { create: (api) => ({ api }) } };
    const repo = new FakeRepo();
    await mount({ extensions: [weather, ext("joints.slide", JOINTS), ext("traversal.exit", TRAVERSAL), user], parts: [part], repo });
    getRegistry("patchwork:datatype").register({ type: "patchwork:datatype", id: "scene", load: async () => ({}) }, SCENE);
    // a boat as the tools made her: her companionway's joints and traversal listed, nothing of theirs left in her
    const h = repo.add(emptyScene({ title: "Boat", traits: { "tiny.weather": {} }, packages: [{ url: SAILING }, { url: JOINTS }, { url: MISSING }, { url: `${TRAVERSAL}#${HEAD}` }, { url: JOINTS }, { url: SCENE }] }));
    let changes = 0;
    h.on("change", () => changes++);
    const s = await mount({ handle: h, repo });
    await settle();
    expect(urls(s)).toEqual([SAILING, MISSING, SCENE]);
    expect(changes).toBe(1); // the entries off and the suggested import on, together
    expect(s.doc()["@patchwork"].suggestedImportUrl).toBe(SCENE);
    // taking off is never a way to stop asking: the one missing here is still asked about
    expect(state(s).ask).toEqual([MISSING]);
    // a part run here: what it made calls for nothing, so nothing of the part's is listed
    await editor.part(s.api("t.user"), "buoy", { parent: null });
    await settle();
    s.change((d) => (d.title = "Fitted"));
    await settle();
    expect(s.doc().objects.b?.name).toBe("Buoy");
    expect(urls(s)).toEqual([SAILING, MISSING, SCENE]);
  });

  it("not before the registry has gone quiet: the viewer's own packages may still be on their way", async () => {
    const JOINTS = fakeUrl();
    const s = await mount({ extensions: [weather], packageSettleMs: 200, doc: { traits: { "tiny.weather": {} }, packages: [{ url: JOINTS }] } });
    getRegistry("scene:extension").register({ type: "scene:extension", id: "joints", traits: ["joints.slide"], load: async () => ({ create: () => ({}) }) }, JOINTS);
    await settle();
    expect(urls(s)).toEqual([JOINTS, SAILING]); // added at once, nothing taken off
    await until(() => urls(s).length === 1, 2000);
    expect(urls(s)).toEqual([SAILING]);
  });

  it("while a need goes unanswered here nothing is taken off: a package listed for it may be what answers it elsewhere", async () => {
    const JOINTS = fakeUrl();
    const s = await mount({ extensions: [weather, { meta: { id: "joints", traits: ["joints.slide"], importUrl: JOINTS }, module: { create: () => ({}) } }], doc: { traits: { "joints.hinge": {} }, packages: [{ url: JOINTS }] } });
    await settle();
    // (a hinge: an older joints here has no plugin for it, a newer one elsewhere may)
    expect(urls(s)).toEqual([JOINTS]);
    s.change((d) => (d.title = "Again"));
    await settle();
    expect(urls(s)).toEqual([JOINTS]);
    // every need answered here: joints answers none of them, so it goes
    s.change((d) => delete d.traits["joints.hinge"]);
    await settle();
    expect(urls(s)).toEqual([]);
    // a peer listing it again changes nothing that decides it: taken off again
    s.change((d) => d.packages.push({ url: JOINTS }));
    await settle();
    expect(urls(s)).toEqual([]);
  });

  it("a render doc names its provider: that provider's package is listed though the object's field names another, and no source package goes before every render doc built here has said", async () => {
    const P = fakeUrl();
    const Q = fakeUrl();
    const R = fakeUrl();
    const repo = new FakeRepo();
    await mount({ repo });
    for (const [id, url] of [["p-mesh", P], ["q-mesh", Q], ["r-mesh", R]]) getRegistry("scene:source").register({ type: "scene:source", id, content: "built", load: async () => ({}) }, url);
    const source = repo.add({ "@patchwork": { type: "thing" }, title: "Thing" });
    const render = repo.add({ providerId: "p-mesh", status: "idle" });
    // hidden, so its render doc isn't loaded yet: P and R are both sources, so both stay
    const h = repo.add(emptyScene({ title: "T", objects: { a: object({ providerId: "q-mesh", sourceUrl: source.url, renderUrl: render.url, visible: false }) }, order: ["a"], packages: [{ url: P }, { url: R }] }));
    const seen = [];
    h.on("change", () => seen.push(urls({ doc: () => h.doc() })));
    const s = await mount({ handle: h, repo });
    await settle();
    expect(urls(s)).toEqual([P, R, Q]);
    // shown: its render doc says p-mesh, so P is called for, and R, called for by nothing, goes
    s.change((d) => (d.objects.a.visible = true));
    await until(() => !urls(s).includes(R), 2000);
    await settle();
    expect(urls(s)).toEqual([P, Q]);
    // P was never off the list on the way
    expect(seen.every((list) => list.includes(P))).toBe(true);
  });

  it("the scene's own plugins, registered here without an importUrl, and a dev server's, name nothing", async () => {
    const dev = { meta: { id: "dev.ext", traits: ["dev.t"], importUrl: "http://localhost:5173/" }, module: { create: () => ({}) } };
    const s = await mount({ extensions: [dev], doc: { traits: { "dev.t": {} }, objects: { a: object() }, order: ["a"] } });
    await settle();
    expect(running(s)).toContain("dev.ext");
    expect(urls(s)).toEqual([]);
  });

  it("a scene made without the list gets none: nothing is written, nothing made", async () => {
    const repo = new FakeRepo();
    getRegistry("scene:extension"); // (registries are reset by the first mount below)
    const first = await mount({ extensions: [weather], repo });
    const bare = repo.add({ "@patchwork": { type: "scene" }, title: "Old", objects: {}, order: [], dimensions: {}, traits: { "tiny.weather": {} }, assets: {}, view: {} });
    let changes = 0;
    bare.on("change", () => changes++);
    const s = await mount({ handle: bare, repo });
    await settle();
    expect(running(s)).toContain("tiny.weather");
    expect("packages" in s.doc()).toBe(false);
    expect(changes).toBe(0);
    expect(first.doc().packages).toEqual([]);
  });

  it("a view of the scene at a version (read-only) is never written", async () => {
    const repo = new FakeRepo();
    await mount({ extensions: [weather], repo });
    const h = repo.add(emptyScene({ title: "T", traits: { "tiny.weather": {} } }));
    const view = h.view(h.heads()); // change() on it throws
    const v = await mount({ handle: view, repo });
    await settle();
    expect(running(v)).toContain("tiny.weather");
    expect(view.doc().packages).toEqual([]);
    expect(h.doc().packages).toEqual([]);
    // nor taken off from: a version listing what nothing in it calls for
    const listing = repo.add(emptyScene({ title: "L", packages: [{ url: SAILING }] }));
    const lv = listing.view(listing.heads());
    await mount({ handle: lv, repo });
    await settle();
    expect(lv.doc().packages).toEqual([{ url: SAILING }]);
    expect(listing.doc().packages).toEqual([{ url: SAILING }]);
  });

  it("a part or a template run here lists what it made calls for, and nothing of its own", async () => {
    const PARTS = fakeUrl();
    const TEMPLATES = fakeUrl();
    const at = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    const part = { meta: { id: "buoy", importUrl: PARTS }, module: { create: async (ctx) => (ctx.change((d) => ((d.objects.b = { name: "Buoy", providerId: null, transform: at }), d.order.push("b"))), "b") } };
    const lit = { meta: { id: "lit-buoy", importUrl: PARTS }, module: { create: async (ctx) => (ctx.change((d) => ((d.objects.c = { name: "Lit buoy", providerId: null, transform: at, traits: { "buoy.light": {} } }), d.order.push("c"))), "c") } };
    const light = { meta: { id: "buoy.light", traits: ["buoy.light"], importUrl: PARTS }, module: { create: () => ({}) } };
    const template = { meta: { id: "level", importUrl: TEMPLATES }, module: { create: async (ctx) => ctx.change((d) => (d.title = "Level")) } };
    const user = { meta: { id: "t.user" }, module: { create: (api) => ({ api }) } };
    const s = await mount({ extensions: [user, light], parts: [part, lit], templates: [template] });
    await settle();
    expect(urls(s)).toEqual([]); // offered in the bin, not used: not listed
    await editor.part(s.api("t.user"), "buoy", { parent: null });
    await editor.template(s.api("t.user"), "level");
    await settle();
    expect(urls(s)).toEqual([]); // what they made calls for nothing
    await editor.part(s.api("t.user"), "lit-buoy", { parent: null });
    await settle();
    expect(urls(s)).toEqual([PARTS]); // the light the lit buoy carries is the package's
    s.change((d) => delete d.objects.c);
    await settle();
    expect(urls(s)).toEqual([]);
  });

  it("two views of one scene: the package is listed once", async () => {
    const one = await mount({ extensions: [weather], doc: { traits: { "tiny.weather": {} } } });
    const two = await mount({ handle: one.handle, repo: one.repo });
    await settle();
    expect(urls(two)).toEqual([SAILING]);
  });
});

// ─── the scene package as the suggested import ─────────────────────────────

describe("reconcile: the doc suggests the scene package", () => {
  const SCENE = fakeUrl();
  const meta = (s) => s.doc()["@patchwork"];
  const registerScene = (importUrl) => getRegistry("patchwork:tool").register({ type: "patchwork:tool", id: "scene", load: async () => () => {} }, importUrl);

  it("a scene without one gets the scene package's URL, bare, once; the scene package is then listed like any other the doc calls for", async () => {
    const s = await mount({ doc: { objects: { a: object() }, order: ["a"] } });
    await settle();
    expect(meta(s)).toEqual({ type: "scene" }); // registered here with no importUrl: nothing to say
    let changes = 0;
    s.handle.on("change", () => changes++);
    registerScene(`${SCENE}#${HEAD}`);
    getRegistry("scene:source").register({ ...getRegistry("scene:source").get("file-glb"), importUrl: undefined }, `${SCENE}#${HEAD}`);
    await settle();
    expect(meta(s)).toEqual({ type: "scene", suggestedImportUrl: SCENE });
    expect(urls(s)).toEqual([SCENE]); // its file-glb provider shows object a
    expect(changes).toBe(1); // both in one change
    s.change((d) => (d.title = "Renamed"));
    await settle();
    expect(changes).toBe(2);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
  });

  it("one that names a loadable package is left alone; a dev server's is replaced; a dev copy of the scene package writes nothing", async () => {
    const OTHER = fakeUrl();
    const kept = await mount({ doc: { "@patchwork": { type: "scene", suggestedImportUrl: OTHER } } });
    registerScene(SCENE);
    await settle();
    expect(meta(kept).suggestedImportUrl).toBe(OTHER);
    const dev = await mount({ handle: kept.repo.add(emptyScene({ "@patchwork": { suggestedImportUrl: "http://localhost:5173/" }, title: "T" })), repo: kept.repo });
    await settle();
    expect(meta(dev).suggestedImportUrl).toBe(SCENE);
    registerScene("http://localhost:5173/");
    const bare = await mount({ handle: kept.repo.add(emptyScene({ title: "T" })), repo: kept.repo });
    await settle();
    expect(meta(bare)).toEqual({ type: "scene" });
  });

  it("a read-only view is never written", async () => {
    const first = await mount({});
    registerScene(SCENE);
    const h = first.repo.add(emptyScene({ title: "T" }));
    const view = h.view(h.heads());
    await mount({ handle: view, repo: first.repo });
    await settle();
    expect(view.doc()["@patchwork"]).toEqual({ type: "scene" });
    expect(h.doc()["@patchwork"]).toEqual({ type: "scene" });
  });
});

// ─── loading ────────────────────────────────────────────────────────────────

describe("loading: the listed packages this viewer doesn't have", () => {
  let repo, SAILING, TERRAIN, started;
  const sailingPackage = () => ({
    plugins: [
      { type: "scene:extension", id: "tiny.weather", name: "Weather", traits: ["tiny.weather"], load: async () => ({ create: () => (started.push("tiny.weather"), {}) }) },
      { type: "scene:part", id: "sailing.buoy", name: "Buoy", load: async () => ({ create: async () => null }) },
    ],
  });
  const terrainPackage = () => ({ plugins: [{ type: "scene:source", id: "terrain-mesh", content: "built", name: "Terrain", supportedDatatypes: ["terrain"], params: [], load: async () => ({ build: async () => null }) }] });
  const sceneDoc = (extra = {}) => ({ traits: { "tiny.weather": {} }, objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"], packages: [{ url: SAILING }, { url: TERRAIN }], ...extra });

  beforeEach(() => {
    repo = new FakeRepo();
    started = [];
    SAILING = folder(repo, "@tiny/sailing").url;
    TERRAIN = folder(repo, "@tiny/terrain").url;
    servePackage(SAILING, sailingPackage());
    servePackage(TERRAIN, terrainPackage());
  });

  // Every open doc's packages are one prompt (the view's: view.packages,
  // which only the general parts see): a host listing one package, a game it
  // links live listing another, and the same game pinned (a drawn stage,
  // which asks too) — the card offers both once; a yes loads both, each for
  // the stage that asked; a not now quiets both. An extension that isn't
  // general sees its own doc's only.
  describe("every open doc's packages, one prompt", () => {
    const OWN = { meta: { id: "t.own", traits: ["tiny.weather"] }, module: { create: () => ({}) } };
    const linked = async (extra = []) => {
      const game = repo.add(emptyScene({ title: "G", objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"], packages: [{ url: TERRAIN }] }));
      const link = (o) => object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null, ...o });
      const doc = { traits: { "tiny.weather": {} }, packages: [{ url: SAILING }], objects: { L: link({}), P: link({ at: { heads: game.heads() } }) }, order: ["L", "P"] };
      const s = await mount({ extensions: [PROMPT, OWN, ...extra], repo, doc });
      await until(() => s.debug.view.stages().length === 3);
      return { s, game };
    };
    const viewAsks = (s) => s.debug.view.atom.get().packages.ask.map((e) => e.url);
    const stageAsks = (s) => s.debug.view.stages().map((st) => st.reader.packages().ask.map((e) => e.url));

    it("the card offers the host's and the linked game's, each once, by name", async () => {
      const { s } = await linked();
      await until(() => viewAsks(s).length === 2 && s.debug.view.atom.get().packages.ask.every((e) => e.name));
      await settle();
      expect(stageAsks(s)).toEqual([[SAILING], [TERRAIN], [TERRAIN]]);
      expect([...card(s).querySelectorAll(".package")].map((li) => [li.dataset.url, li.querySelector(".package-name").textContent])).toEqual([
        [SAILING, "@tiny/sailing"],
        [TERRAIN, "@tiny/terrain"],
      ]);
      expect(card(s).querySelector(".packages-title").textContent).toBe("This scene uses 2 packages you don't have.");
      // a doc's part sees no union, and its api.packages is its own doc's; a view plugin's is every open doc's
      expect("packages" in s.api("t.own").view.get()).toBe(false);
      expect("packages" in s.api("scene.packages").view.get()).toBe(true);
      // nor the other stages' readers (their packages, scenes, runs): api.path is the view plugins'
      expect(typeof s.api("scene.packages").path).toBe("function");
      for (const st of s.debug.view.stages()) for (const r of st.debug.host.running()) expect(st.debug.host.record(r.id).api.path).toBeUndefined();
      await s.api("t.own").packages.load();
      await settle();
      expect(imported.map((u) => u.split("#")[0])).toEqual([SAILING]);
      expect(viewAsks(s)).toEqual([TERRAIN]);
    });

    it("Load loads every doc's; each stage that asked has it then", async () => {
      const { s } = await linked();
      await until(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "load");
      await until(() => getRegistry("scene:source").has("terrain-mesh") && running(s).includes("tiny.weather"));
      await settle();
      expect(imported.map((u) => u.split("#")[0]).sort()).toEqual([SAILING, TERRAIN].sort());
      expect(stageAsks(s)).toEqual([[], [], []]);
      expect(s.debug.view.atom.get().packages).toEqual({ ask: [], loading: [], failed: [], missing: false });
      expect(card(s).hidden).toBe(true);
      expect(accepted().sort()).toEqual([SAILING, TERRAIN].sort());
    });

    it("Not now quiets every doc's, and loads nothing", async () => {
      const { s } = await linked();
      await until(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "dismiss");
      expect(stageAsks(s)).toEqual([[], [], []]);
      expect(card(s).hidden).toBe(true);
      expect(imported).toEqual([]);
    });

    // "Not now" is the view's: a doc opened after the click (here a second
    // link, to a game listing the dismissed package and one more) asks only
    // about what wasn't dismissed
    it("Not now holds for a doc opened after it", async () => {
      const { s } = await linked();
      await until(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "dismiss");
      const OTHER = folder(repo, "@tiny/other").url;
      const g2 = repo.add(emptyScene({ title: "G2", objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"], packages: [{ url: TERRAIN }, { url: OTHER }] }));
      s.change((d) => {
        d.objects.M = object({ name: "Game 2", sourceUrl: g2.url, providerId: LINK, renderUrl: null });
        d.order.push("M");
      });
      await until(() => s.debug.view.stages().length === 4);
      await until(() => viewAsks(s).length === 1);
      await settle();
      expect(viewAsks(s)).toEqual([OTHER]);
      expect(stageAsks(s)).toEqual([[], [], [], [OTHER]]);
      expect([...card(s).querySelectorAll(".package")].map((li) => li.dataset.url)).toEqual([OTHER]);
      await press(s, "dismiss");
      expect(card(s).hidden).toBe(true);
      expect(imported).toEqual([]);
    });
  });

  it("asks once, for all of them, by name and URL; nothing is imported before a yes", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => s.local.get().packages.ask.every((e) => e.name) && state(s).ask.length === 2);
    expect(s.local.get().packages.ask).toEqual([
      { url: SAILING, name: "@tiny/sailing" },
      { url: TERRAIN, name: "@tiny/terrain" },
    ]);
    await settle();
    expect(s.root.querySelectorAll(".packages-card")).toHaveLength(1);
    expect(card(s).hidden).toBe(false);
    expect(card(s).querySelector(".packages-title").textContent).toBe("This scene uses 2 packages you don't have.");
    expect([...card(s).querySelectorAll(".package")].map((li) => [li.dataset.url, li.querySelector(".package-name").textContent])).toEqual([
      [SAILING, "@tiny/sailing"],
      [TERRAIN, "@tiny/terrain"],
    ]);
    expect([...card(s).querySelectorAll("[data-action]")].map((b) => b.textContent)).toEqual(["Not now", "Load them"]);
    expect(imported).toEqual([]);
    expect(running(s)).not.toContain("tiny.weather");
    expect(accepted()).toEqual([]);
  });

  it("Load: each package at its heads, registered under its bare URL; its extension starts and its provider is there; remembered", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await settle();
    await press(s, "load");
    // (each folder is loaded once it has gone FOLDER_QUIET_MS without a change)
    await until(() => running(s).includes("tiny.weather") && state(s).loading.length === 0, 3000);
    await settle();
    // pinned to the folder docs' heads, as the module watcher loads a package
    const heads = async (url) => `${url}#${(await repo.find(url)).heads().join("|")}`;
    expect([...imported].sort()).toEqual([await heads(SAILING), await heads(TERRAIN)].sort());
    expect(getRegistry("scene:extension").get("tiny.weather").importUrl).toBe(SAILING);
    expect(getRegistry("scene:part").get("sailing.buoy").importUrl).toBe(SAILING);
    expect(getRegistry("scene:source").get("terrain-mesh").importUrl).toBe(TERRAIN);
    expect(started).toEqual(["tiny.weather"]);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(card(s).hidden).toBe(true);
    expect(accepted().sort()).toEqual([SAILING, TERRAIN].sort());
    // nothing was added to the list, and nothing was listed twice
    expect(urls(s)).toEqual([SAILING, TERRAIN]);
  });

  // A doc found fresh is still catching up: found at a prefix of its history
  // (an old build), the rest a moment later. Loaded at the found heads, the
  // old build would run against this scene (FOLDER_QUIET_MS).
  it("Load: a folder still catching up when found is loaded at the heads it settles on, not those it was found at", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await settle();
    const sailing = await repo.find(SAILING);
    const found = sailing.heads().join("|");
    await press(s, "load");
    // the rest of its history arrives after it was found: two changes, 150 ms apart
    sailing.change((d) => (d.title = "@tiny/sailing, newer"));
    await new Promise((r) => setTimeout(r, 150));
    sailing.change((d) => (d.title = "@tiny/sailing, newest"));
    await until(() => running(s).includes("tiny.weather"), 3000);
    const at = imported.find((u) => u.startsWith(SAILING)).split("#")[1];
    expect(at).toBe(sailing.heads().join("|"));
    expect(at).not.toBe(found);
  });

  it("Not now: nothing loads, nothing is remembered, and it isn't asked again in this view; the next open asks again", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await settle();
    await press(s, "dismiss");
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(card(s).hidden).toBe(true);
    s.change((d) => (d.title = "Still here"));
    await settle();
    expect(state(s).ask).toEqual([]);
    expect(imported).toEqual([]);
    expect(accepted()).toEqual([]);
    expect(running(s)).not.toContain("tiny.weather");
    // opened again
    const again = await mount({ handle: s.handle, repo });
    await until(() => state(again).ask.length === 2);
    expect(imported).toEqual([]);
  });

  it("arriving waits on the prompt: a body whose package is accepted long after opening (> ARRIVE_WAIT_MS) is still entered; declined, nothing is", async () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const SEATS = folder(repo, "@tiny/seats").url;
    const seat = { id: "seat", label: "Seat", lock: false, enter: () => ({ input: {}, eye: () => null }) };
    servePackage(SEATS, { plugins: [{ type: "scene:extension", id: "t.seats", name: "Seats", traits: ["t.seats"], load: async () => ({ create: () => ({ bodies: [seat] }) }) }] });
    const doc = { traits: { "t.seats": {} }, packages: [{ url: SEATS }], view: { start: { body: "seat" } } };
    const s = await mount({ extensions: [PROMPT], repo, doc });
    await until(() => state(s).ask.length === 1);
    t = ARRIVE_WAIT_MS + 5_000;
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(s.local.get().body.id).toBe("look");
    await press(s, "load");
    await until(() => running(s).includes("t.seats"), 3000);
    await settle();
    expect(s.local.get().body.id).toBe("seat");
    // another visit, saying not now: Look, and the arrival waits on nothing
    localStorage.clear();
    resetPackages();
    const d = await mount({ extensions: [PROMPT], repo, doc });
    await until(() => state(d).ask.length === 1);
    await press(d, "dismiss");
    await settle();
    expect(d.local.get().body.id).toBe("look");
    expect(running(d)).not.toContain("t.seats");
  });

  it("a package accepted before loads without asking; one that wasn't is still asked about", async () => {
    localStorage.setItem(ACCEPTED_KEY, JSON.stringify([SAILING]));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => running(s).includes("tiny.weather"), 3000);
    await until(() => state(s).ask.length === 1);
    expect(state(s)).toEqual({ ask: [TERRAIN], loading: [], failed: [] });
    expect(imported.map((u) => u.split("#")[0])).toEqual([SAILING]);
    expect(getRegistry("scene:source").has("terrain-mesh")).toBe(false);
    expect(card(s).querySelector(".packages-title").textContent).toBe("This scene uses a package you don't have.");
  });

  it("one that fails says so and doesn't stop the other; it isn't remembered; Try again loads it", async () => {
    servePackage(TERRAIN, new Error("the chunk was missing"));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await settle();
    await press(s, "load");
    await until(() => state(s).failed.length === 1);
    expect(running(s)).toContain("tiny.weather");
    expect(s.local.get().packages.failed).toEqual([{ url: TERRAIN, name: "@tiny/terrain", error: "the chunk was missing" }]);
    await settle();
    expect(card(s).querySelector(".packages-title").textContent).toBe("A package this scene uses couldn't be loaded.");
    expect(card(s).querySelector(".package-error").textContent).toBe("the chunk was missing");
    expect(accepted()).toEqual([SAILING]);
    // a failure isn't retried on its own
    s.change((d) => (d.title = "Later"));
    await settle();
    expect(imported.filter((u) => u.startsWith(TERRAIN))).toHaveLength(1);
    servePackage(TERRAIN, terrainPackage());
    await press(s, "load");
    await until(() => getRegistry("scene:source").has("terrain-mesh"));
    await settle();
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(accepted().sort()).toEqual([SAILING, TERRAIN].sort());
  });

  it("a module without a plugins list is a failure; a package with an empty one is loaded and not asked about again", async () => {
    servePackage(SAILING, { nothing: true });
    servePackage(TERRAIN, { plugins: [] });
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await s.debug.packages.load();
    await settle();
    expect(s.local.get().packages.failed.map((e) => [e.url, e.error])).toEqual([[SAILING, "it has no plugins list"]]);
    expect(state(s).ask).toEqual([]);
    expect(imported.filter((u) => u.startsWith(TERRAIN))).toHaveLength(1);
  });

  it("only what the doc lists is ever loaded: an entry that names nothing loadable isn't offered, and load() takes no URL of its own", async () => {
    const STRAY = folder(repo, "@tiny/stray").url;
    servePackage(STRAY, { plugins: [] });
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: "http://localhost:5173/" }, { url: "javascript:alert(1)" }, { url: "data:text/javascript,1" }, { url: SAILING }, { url: SAILING }] }) });
    await until(() => state(s).ask.length === 1);
    expect(state(s).ask).toEqual([SAILING]);
    await s.debug.packages.load([STRAY, "https://evil.example/x.js"]);
    await settle();
    expect(imported).toEqual([]);
    await s.debug.packages.load([`${SAILING}#${HEAD}`]); // the same package, named at heads
    await settle();
    expect(imported.map((u) => u.split("#")[0])).toEqual([SAILING]);
  });

  it("waits for the registry to go quiet: a package the shell registers as the scene opens is never asked about", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: SAILING }] }), packageSettleMs: 500 });
    const look = () => s.debug.packages.inspect();
    expect([look().settled, look().missing, state(s).ask]).toEqual([false, [SAILING], []]); // missing, and not offered yet
    // the viewer's own copy arrives, at the heads the module watcher loaded
    for (const p of sailingPackage().plugins) getRegistry(p.type).register(p, `${SAILING}#${HEAD}`);
    await until(() => look().settled, 3000);
    await settle();
    expect([look().missing, state(s).ask]).toEqual([[], []]);
    expect(imported).toEqual([]);
    expect(running(s)).toContain("tiny.weather");
  });

  it("with nothing arriving, the prompt comes once the registry has been quiet; a remembered package waits as long", async () => {
    localStorage.setItem(ACCEPTED_KEY, JSON.stringify([TERRAIN]));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc(), packageSettleMs: 500 });
    expect([s.debug.packages.inspect().settled, state(s).ask, [...imported]]).toEqual([false, [], []]);
    await until(() => state(s).ask.length === 1, 3000);
    expect(state(s).ask).toEqual([SAILING]);
    await until(() => getRegistry("scene:source").has("terrain-mesh"));
    expect(imported.map((u) => u.split("#")[0])).toEqual([TERRAIN]);
  });

  it("a package listed while the scene is open is asked about then; two scenes on a page load a package once", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [] }) });
    await settle();
    expect(state(s).ask).toEqual([]);
    s.change((d) => d.packages.push({ url: SAILING }));
    await until(() => state(s).ask.length === 1);
    const other = await mount({ handle: s.handle, repo });
    await until(() => state(other).ask.length === 1);
    await Promise.all([s.debug.packages.load(), other.debug.packages.load()]);
    await settle();
    expect(imported).toHaveLength(1);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(state(other)).toEqual({ ask: [], loading: [], failed: [] });
  });

  it("a folder that can't be found is that package's failure", async () => {
    const GONE = fakeUrl();
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: GONE }] }) });
    await until(() => state(s).ask.length === 1);
    expect(s.local.get().packages.ask).toEqual([{ url: GONE, name: null }]);
    await s.debug.packages.load();
    await settle();
    expect(s.local.get().packages.failed).toEqual([{ url: GONE, name: null, error: `unavailable: ${GONE}` }]);
    expect(accepted()).toEqual([]);
  });
});
