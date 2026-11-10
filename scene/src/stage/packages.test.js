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
import packagesPart from "../parts/packages.js";

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
});

// ─── reconcile ──────────────────────────────────────────────────────────────

describe("reconcile: the list names what the doc calls for and this viewer has", () => {
  const SAILING = fakeUrl();
  const TERRAIN = fakeUrl();
  const sea = { meta: { id: "sailing.sea", traits: ["sailing.sea"], importUrl: `${SAILING}#${HEAD}` }, module: { create: () => ({}) } };

  it("adds each package once, bare, and then writes nothing more", async () => {
    const s = await mount({ extensions: [sea], doc: { traits: { "sailing.sea": {} }, objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"] } });
    getRegistry("scene:source").register({ type: "scene:source", id: "terrain-mesh", load: async () => ({}) }, TERRAIN);
    await settle();
    expect(urls(s).sort()).toEqual([SAILING, TERRAIN].sort());
    // every entry is a plain { url }
    expect(s.doc().packages.every((e) => JSON.stringify(Object.keys(e)) === '["url"]')).toBe(true);
    let changes = 0;
    s.handle.on("change", () => changes++);
    s.change((d) => (d.title = "Renamed"));
    getRegistry("scene:source").register({ type: "scene:source", id: "another", load: async () => ({}) }, fakeUrl());
    await settle();
    expect(changes).toBe(1); // the rename, and no write of ours
    expect(urls(s)).toHaveLength(2);
    // this viewer has them, so nothing is offered
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
  });

  it("follows the doc: a trait added later names its package then", async () => {
    const s = await mount({ extensions: [sea] });
    await settle();
    expect(urls(s)).toEqual([]);
    s.change((d) => (d.traits["sailing.sea"] = {}));
    await settle();
    expect(urls(s)).toEqual([SAILING]);
    // and never removes: the trait going leaves the entry
    s.change((d) => delete d.traits["sailing.sea"]);
    await settle();
    expect(urls(s)).toEqual([SAILING]);
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
    const first = await mount({ extensions: [sea], repo });
    const bare = repo.add({ "@patchwork": { type: "scene" }, title: "Old", objects: {}, order: [], dimensions: {}, traits: { "sailing.sea": {} }, assets: {}, view: {} });
    let changes = 0;
    bare.on("change", () => changes++);
    const s = await mount({ handle: bare, repo });
    await settle();
    expect(running(s)).toContain("sailing.sea");
    expect("packages" in s.doc()).toBe(false);
    expect(changes).toBe(0);
    expect(first.doc().packages).toEqual([]);
  });

  it("a view of the scene at a version (read-only) is never written", async () => {
    const repo = new FakeRepo();
    await mount({ extensions: [sea], repo });
    const h = repo.add(emptyScene({ title: "T", traits: { "sailing.sea": {} } }));
    const view = h.view(h.heads()); // change() on it throws
    const v = await mount({ handle: view, repo });
    await settle();
    expect(running(v)).toContain("sailing.sea");
    expect(view.doc().packages).toEqual([]);
    expect(h.doc().packages).toEqual([]);
  });

  it("a part or a template run here names its package, though it leaves no mark of its own", async () => {
    const PARTS = fakeUrl();
    const TEMPLATES = fakeUrl();
    const part = { meta: { id: "buoy", importUrl: PARTS }, module: { create: async (ctx) => (ctx.change((d) => ((d.objects.b = { name: "Buoy", providerId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }), d.order.push("b"))), "b") } };
    const template = { meta: { id: "level", importUrl: TEMPLATES }, module: { create: async (ctx) => ctx.change((d) => (d.title = "Level")) } };
    const user = { meta: { id: "t.user" }, module: { create: (api) => ({ api }) } };
    const s = await mount({ extensions: [user], parts: [part], templates: [template] });
    await settle();
    expect(urls(s)).toEqual([]); // offered in the bin, not used: not listed
    await s.api("t.user").part("buoy", { parent: null });
    await settle();
    expect(urls(s)).toEqual([PARTS]);
    await s.api("t.user").template("level");
    await settle();
    expect(urls(s)).toEqual([PARTS, TEMPLATES]);
  });

  it("two views of one scene: the package is listed once", async () => {
    const one = await mount({ extensions: [sea], doc: { traits: { "sailing.sea": {} } } });
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
      { type: "scene:extension", id: "sailing.sea", name: "Sea", traits: ["sailing.sea"], load: async () => ({ create: () => (started.push("sailing.sea"), {}) }) },
      { type: "scene:part", id: "sailing.buoy", name: "Buoy", load: async () => ({ create: async () => null }) },
    ],
  });
  const terrainPackage = () => ({ plugins: [{ type: "scene:source", id: "terrain-mesh", name: "Terrain", supportedDatatypes: ["terrain"], params: [], load: async () => ({ build: async () => null }) }] });
  const sceneDoc = (extra = {}) => ({ traits: { "sailing.sea": {} }, objects: { a: object({ providerId: "terrain-mesh" }) }, order: ["a"], packages: [{ url: SAILING }, { url: TERRAIN }], ...extra });

  beforeEach(() => {
    repo = new FakeRepo();
    started = [];
    SAILING = folder(repo, "@tiny/sailing").url;
    TERRAIN = folder(repo, "@tiny/terrain").url;
    servePackage(SAILING, sailingPackage());
    servePackage(TERRAIN, terrainPackage());
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
    expect(running(s)).not.toContain("sailing.sea");
    expect(accepted()).toEqual([]);
  });

  it("Load: each package at its heads, registered under its bare URL; its extension starts and its provider is there; remembered", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => state(s).ask.length === 2);
    await settle();
    await press(s, "load");
    await until(() => running(s).includes("sailing.sea"));
    // pinned to the folder docs' heads, as the module watcher loads a package
    const heads = async (url) => `${url}#${(await repo.find(url)).heads().join("|")}`;
    expect([...imported].sort()).toEqual([await heads(SAILING), await heads(TERRAIN)].sort());
    expect(getRegistry("scene:extension").get("sailing.sea").importUrl).toBe(SAILING);
    expect(getRegistry("scene:part").get("sailing.buoy").importUrl).toBe(SAILING);
    expect(getRegistry("scene:source").get("terrain-mesh").importUrl).toBe(TERRAIN);
    expect(started).toEqual(["sailing.sea"]);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(card(s).hidden).toBe(true);
    expect(accepted().sort()).toEqual([SAILING, TERRAIN].sort());
    // nothing was added to the list, and nothing was listed twice
    expect(urls(s)).toEqual([SAILING, TERRAIN]);
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
    expect(running(s)).not.toContain("sailing.sea");
    // opened again
    const again = await mount({ handle: s.handle, repo });
    await until(() => state(again).ask.length === 2);
    expect(imported).toEqual([]);
  });

  it("a package accepted before loads without asking; one that wasn't is still asked about", async () => {
    localStorage.setItem(ACCEPTED_KEY, JSON.stringify([SAILING]));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await until(() => running(s).includes("sailing.sea"));
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
    expect(running(s)).toContain("sailing.sea");
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
    expect(running(s)).toContain("sailing.sea");
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
