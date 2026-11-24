// @vitest-environment happy-dom
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
import { writerOf } from "./provenance.js";
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
  const s = await mountStage({ natives: true, ...o });
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
  const PKG_A = fakeUrl();
  const PKG_B = fakeUrl();
  const extA = { meta: { id: "t.ext-a", traits: ["t.ext-a"], importUrl: `${PKG_A}#${HEAD}` }, module: { create: () => ({}) } };

  it("adds each package once, bare, and then writes nothing more", async () => {
    const s = await mount({ extensions: [extA], doc: { traits: { "t.ext-a": {} }, objects: { a: object({ providerId: "b-mesh" }) }, order: ["a"] } });
    getRegistry("scene:source").register({ type: "scene:source", id: "b-mesh", content: "built", load: async () => ({}) }, PKG_B);
    await settle();
    expect(urls(s).sort()).toEqual([PKG_A, PKG_B].sort());
    // every entry is a plain { url }
    expect(s.doc().packages.every((e) => JSON.stringify(Object.keys(e)) === '["url"]')).toBe(true);
    // written as the kernel's (write provenance: ./provenance.js)
    expect(s.handle.messages.map(writerOf)).toContainEqual({ kernel: "packages" });
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
    const s = await mount({ extensions: [extA] });
    await settle();
    expect(urls(s)).toEqual([]);
    s.change((d) => (d.traits["t.ext-a"] = {}));
    await settle();
    expect(urls(s)).toEqual([PKG_A]);
    // and the trait going takes the entry off: nothing here calls for it now
    s.change((d) => delete d.traits["t.ext-a"]);
    await settle();
    expect(urls(s)).toEqual([]);
  });

  it("takes off what nothing calls for, every entry naming it, in one change: one this viewer has, and one missing here once every need is answered here; the scene package stays", async () => {
    const PKG_C = fakeUrl();
    const PKG_D = fakeUrl();
    const MISSING = fakeUrl();
    const SCENE = fakeUrl();
    const ext = (id, url) => ({ meta: { id, traits: [id], importUrl: `${url}#${HEAD}` }, module: { create: () => ({}) } });
    const repo = new FakeRepo();
    await mount({ extensions: [extA, ext("t.slide", PKG_C), ext("t.exit", PKG_D)], repo });
    getRegistry("patchwork:datatype").register({ type: "patchwork:datatype", id: "scene", load: async () => ({}) }, SCENE);
    // a scene as the tools left it: two packages listed whose plugins nothing in it uses any more
    const h = repo.add(emptyScene({ title: "Made", traits: { "t.ext-a": {} }, packages: [{ url: PKG_A }, { url: PKG_C }, { url: MISSING }, { url: `${PKG_D}#${HEAD}` }, { url: PKG_C }, { url: SCENE }] }));
    let changes = 0;
    h.on("change", () => changes++);
    const s = await mount({ handle: h, repo });
    await settle();
    // (MISSING, too: whatever it was listed for, extA answers here now)
    expect(urls(s)).toEqual([PKG_A, SCENE]);
    expect(changes).toBe(1); // the entries off and the suggested import on, together
    expect(s.doc()["@patchwork"].suggestedImportUrl).toBe(SCENE);
    expect(state(s).ask).toEqual([]);
  });

  it("not before the registry has gone quiet: the viewer's own packages may still be on their way", async () => {
    const PKG_C = fakeUrl();
    const s = await mount({ extensions: [extA], packageSettleMs: 200, doc: { traits: { "t.ext-a": {} }, packages: [{ url: PKG_C }] } });
    getRegistry("scene:extension").register({ type: "scene:extension", id: "t.slider", traits: ["t.slide"], load: async () => ({ create: () => ({}) }) }, PKG_C);
    await settle();
    expect(urls(s)).toEqual([PKG_C, PKG_A]); // added at once, nothing taken off
    await until(() => urls(s).length === 1, 2000);
    expect(urls(s)).toEqual([PKG_A]);
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

  it("a view of the scene at a version (read-only) is never written: neither the list nor the suggested import", async () => {
    const repo = new FakeRepo();
    await mount({ extensions: [extA], repo });
    // a scene package that could be suggested
    getRegistry("patchwork:tool").register({ type: "patchwork:tool", id: "scene", load: async () => () => {} }, fakeUrl());
    const h = repo.add(emptyScene({ title: "T", traits: { "t.ext-a": {} } }));
    const view = h.view(h.heads()); // change() on it throws
    const v = await mount({ handle: view, repo });
    await settle();
    expect(running(v)).toContain("t.ext-a");
    expect(view.doc().packages).toEqual([]);
    expect(h.doc().packages).toEqual([]);
    expect([view.doc()["@patchwork"], h.doc()["@patchwork"]]).toEqual([{ type: "scene" }, { type: "scene" }]);
    // nor taken off from: a version listing what nothing in it calls for
    const listing = repo.add(emptyScene({ title: "L", packages: [{ url: PKG_A }] }));
    const lv = listing.view(listing.heads());
    await mount({ handle: lv, repo });
    await settle();
    expect(lv.doc().packages).toEqual([{ url: PKG_A }]);
    expect(listing.doc().packages).toEqual([{ url: PKG_A }]);
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
});

// ─── loading ────────────────────────────────────────────────────────────────

describe("loading: the listed packages this viewer doesn't have", () => {
  let repo, PKG_A, PKG_B, started;
  const packageA = () => ({
    plugins: [
      { type: "scene:extension", id: "t.ext-a", name: "Ext A", traits: ["t.ext-a"], load: async () => ({ create: () => (started.push("t.ext-a"), {}) }) },
      { type: "scene:part", id: "pkg-a.buoy", name: "Buoy", load: async () => ({ create: async () => null }) },
    ],
  });
  const packageB = () => ({ plugins: [{ type: "scene:source", id: "b-mesh", content: "built", name: "Mesh B", supportedDatatypes: ["shape-b"], params: [], load: async () => ({ build: async () => null }) }] });
  const sceneDoc = (extra = {}) => ({ traits: { "t.ext-a": {} }, objects: { a: object({ providerId: "b-mesh" }) }, order: ["a"], packages: [{ url: PKG_A }, { url: PKG_B }], ...extra });

  // Loading waits on the page's timers (a folder going quiet, the registry settling, a find's
  // timeout): faked here, and moved on 25 ms at a time while a test waits for what follows.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    repo = new FakeRepo();
    started = [];
    PKG_A = folder(repo, "@tiny/pkg-a").url;
    PKG_B = folder(repo, "@tiny/pkg-b").url;
    servePackage(PKG_A, packageA());
    servePackage(PKG_B, packageB());
  });
  afterEach(() => vi.useRealTimers());
  /** Until fn() holds, the fake clock moving on 25 ms a step; fails past `ms` of it. */
  const untilT = async (fn, ms = 1000) => {
    for (let waited = 0; !fn(); waited += 25) {
      if (waited > ms) throw new Error("timed out");
      await vi.advanceTimersByTimeAsync(25);
    }
  };
  /** A promise's value, the fake clock moving on while it waits (a load waits for its folder to go quiet). */
  const advancing = async (p) => {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    await untilT(() => done, 5000);
    return p;
  };

  // Every open doc's packages are one prompt (the view's: view.packages,
  // which only the general parts see): a host listing one package, a game it
  // links live listing another, and the same game pinned (a drawn stage,
  // which asks too) — the card offers both once; a yes loads both, each for
  // the stage that asked; a not now quiets both. An extension that isn't
  // general sees its own doc's only.
  const OWN = { meta: { id: "t.own", traits: ["t.ext-a"] }, module: { create: () => ({}) } };
  /** A host listing one package, linking live and pinned a game that lists another: three stages, each asking. */
  const linked = async (extra = []) => {
    const game = repo.add(emptyScene({ title: "G", objects: { a: object({ providerId: "b-mesh" }) }, order: ["a"], packages: [{ url: PKG_B }] }));
    const link = (o) => object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null, ...o });
    const doc = { traits: { "t.ext-a": {} }, packages: [{ url: PKG_A }], objects: { L: link({}), P: link({ at: { heads: game.heads() } }) }, order: ["L", "P"] };
    const s = await mount({ extensions: [PROMPT, OWN, ...extra], repo, doc });
    await untilT(() => s.debug.view.stages().length === 3);
    return { s, game };
  };
  const viewAsks = (s) => s.debug.view.atom.get().packages.ask.map((e) => e.url);
  const stageAsks = (s) => s.debug.view.stages().map((st) => st.reader.packages().ask.map((e) => e.url));

  describe("every open doc's packages, one prompt", () => {

    it("the card offers the host's and the linked game's, each once, by name", async () => {
      const { s } = await linked();
      await untilT(() => viewAsks(s).length === 2 && s.debug.view.atom.get().packages.ask.every((e) => e.name));
      await settle();
      expect(stageAsks(s)).toEqual([[PKG_A], [PKG_B], [PKG_B]]);
      expect(s.debug.view.atom.get().packages.ask).toEqual([
        { url: PKG_A, name: "@tiny/pkg-a" },
        { url: PKG_B, name: "@tiny/pkg-b" },
      ]);
      expect([...card(s).querySelectorAll(".package")].map((li) => li.dataset.url)).toEqual([PKG_A, PKG_B]);
      // a doc's part sees no union; a view plugin's is every open doc's, and loading through the stage loads its own doc's
      expect("packages" in s.api("t.own").view.get()).toBe(false);
      expect("packages" in s.api("scene.packages").view.get()).toBe(true);
      // nor the other stages' readers (their packages, scenes, runs): api.path is the view plugins'
      expect(typeof s.api("scene.packages").path).toBe("function");
      for (const st of s.debug.view.stages()) for (const r of st.debug.host.running()) expect(st.debug.host.record(r.id).api.path).toBeUndefined();
      await advancing(s.debug.packages.load());
      await settle();
      expect(imported.map((u) => u.split("#")[0])).toEqual([PKG_A]);
      expect(viewAsks(s)).toEqual([PKG_B]);
    });

    it("Load loads every doc's; each stage that asked has it then", async () => {
      const { s } = await linked();
      await untilT(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "load");
      await untilT(() => getRegistry("scene:source").has("b-mesh") && running(s).includes("t.ext-a"));
      await settle();
      expect(imported.map((u) => u.split("#")[0]).sort()).toEqual([PKG_A, PKG_B].sort());
      expect(stageAsks(s)).toEqual([[], [], []]);
      expect(s.debug.view.atom.get().packages).toEqual({ ask: [], loading: [], failed: [], missing: false });
      expect(card(s).hidden).toBe(true);
      expect(accepted().sort()).toEqual([PKG_A, PKG_B].sort());
    });

    // "Not now" is the view's: a doc opened after the click (here a second
    // link, to a game listing the dismissed package and one more) asks only
    // about what wasn't dismissed
    it("Not now holds for a doc opened after it", async () => {
      const { s } = await linked();
      await untilT(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "dismiss");
      const OTHER = folder(repo, "@tiny/other").url;
      const g2 = repo.add(emptyScene({ title: "G2", objects: { a: object({ providerId: "b-mesh" }) }, order: ["a"], packages: [{ url: PKG_B }, { url: OTHER }] }));
      s.change((d) => {
        d.objects.M = object({ name: "Game 2", sourceUrl: g2.url, providerId: LINK, renderUrl: null });
        d.order.push("M");
      });
      await untilT(() => s.debug.view.stages().length === 4);
      await untilT(() => viewAsks(s).length === 1);
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
    await untilT(() => s.local.get().packages.ask.every((e) => e.name) && state(s).ask.length === 2);
    expect(s.local.get().packages.ask).toEqual([
      { url: PKG_A, name: "@tiny/pkg-a" },
      { url: PKG_B, name: "@tiny/pkg-b" },
    ]);
    await settle();
    expect(s.root.querySelectorAll(".packages-card")).toHaveLength(1);
    expect(card(s).hidden).toBe(false);
    expect(imported).toEqual([]);
    expect(running(s)).not.toContain("t.ext-a");
    expect(accepted()).toEqual([]);
  });

  it("Load: each package at its heads, registered under its bare URL; its extension starts and its provider is there; remembered", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await untilT(() => state(s).ask.length === 2);
    await settle();
    await press(s, "load");
    // (each folder is loaded once it has gone FOLDER_QUIET_MS without a change)
    await untilT(() => running(s).includes("t.ext-a") && state(s).loading.length === 0, 3000);
    await settle();
    // pinned to the folder docs' heads, as the module watcher loads a package
    const heads = async (url) => `${url}#${(await repo.find(url)).heads().join("|")}`;
    expect([...imported].sort()).toEqual([await heads(PKG_A), await heads(PKG_B)].sort());
    expect(getRegistry("scene:extension").get("t.ext-a").importUrl).toBe(PKG_A);
    expect(getRegistry("scene:part").get("pkg-a.buoy").importUrl).toBe(PKG_A);
    expect(getRegistry("scene:source").get("b-mesh").importUrl).toBe(PKG_B);
    expect(started).toEqual(["t.ext-a"]);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(card(s).hidden).toBe(true);
    expect(accepted().sort()).toEqual([PKG_A, PKG_B].sort());
    // nothing was added to the list, and nothing was listed twice
    expect(urls(s)).toEqual([PKG_A, PKG_B]);
  });

  // A doc found fresh is still catching up: found at a prefix of its history
  // (an old build), the rest a moment later. Loaded at the found heads, the
  // old build would run against this scene (FOLDER_QUIET_MS).
  it("Load: a folder still catching up when found is loaded at the heads it settles on, not those it was found at", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await untilT(() => state(s).ask.length === 2);
    await settle();
    const folderA = await repo.find(PKG_A);
    const found = folderA.heads().join("|");
    await press(s, "load");
    // the rest of its history arrives after it was found: two changes, 150 ms apart
    folderA.change((d) => (d.title = "@tiny/pkg-a, newer"));
    await vi.advanceTimersByTimeAsync(150);
    folderA.change((d) => (d.title = "@tiny/pkg-a, newest"));
    await untilT(() => running(s).includes("t.ext-a"), 3000);
    const at = imported.find((u) => u.startsWith(PKG_A)).split("#")[1];
    expect(at).toBe(folderA.heads().join("|"));
    expect(at).not.toBe(found);
  });

  it("Not now: nothing loads, nothing is remembered, and it isn't asked again in this view, for any open doc; the next open asks again", async () => {
    const ROWS = [
      ["one doc", () => mount({ extensions: [PROMPT], repo, doc: sceneDoc() })],
      ["a host and the game it links, live and pinned", async () => (await linked()).s],
    ];
    for (const [label, open] of ROWS) {
      const s = await open();
      await untilT(() => viewAsks(s).length === 2);
      await settle();
      await press(s, "dismiss");
      expect([label, state(s), viewAsks(s), stageAsks(s).flat()]).toEqual([label, { ask: [], loading: [], failed: [] }, [], []]);
      expect(card(s).hidden).toBe(true);
      s.change((d) => (d.title = "Still here"));
      await settle();
      expect([label, viewAsks(s)]).toEqual([label, []]);
      expect(imported).toEqual([]);
      expect(accepted()).toEqual([]);
      expect(running(s)).not.toContain("t.ext-a");
      // opened again
      const again = await mount({ handle: s.handle, repo });
      await untilT(() => viewAsks(again).length === 2);
      expect(imported).toEqual([]);
    }
  });

  it("arriving waits on the prompt: a body whose package is accepted long after opening (> ARRIVE_WAIT_MS) is still entered; declined, nothing is", async () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const PKG_S = folder(repo, "@tiny/pkg-s").url;
    const seat = { id: "seat", label: "Seat", lock: false, enter: () => ({ input: {}, eye: () => null }) };
    servePackage(PKG_S, { plugins: [{ type: "scene:extension", id: "t.sit", name: "Sit", traits: ["t.sit"], load: async () => ({ create: () => ({ bodies: [seat] }) }) }] });
    const doc = { traits: { "t.sit": {} }, packages: [{ url: PKG_S }], view: { start: { body: "seat" } } };
    const s = await mount({ extensions: [PROMPT], repo, doc });
    await untilT(() => state(s).ask.length === 1);
    t = ARRIVE_WAIT_MS + 5_000;
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(s.local.get().body.id).toBe("look");
    await press(s, "load");
    await untilT(() => running(s).includes("t.sit"), 3000);
    await settle();
    expect(s.local.get().body.id).toBe("seat");
    // another visit, saying not now: Look, and the arrival waits on nothing
    localStorage.clear();
    resetPackages();
    const d = await mount({ extensions: [PROMPT], repo, doc });
    await untilT(() => state(d).ask.length === 1);
    await press(d, "dismiss");
    await settle();
    expect(d.local.get().body.id).toBe("look");
    expect(running(d)).not.toContain("t.sit");
  });

  it("a package accepted before loads without asking; one that wasn't is still asked about", async () => {
    localStorage.setItem(ACCEPTED_KEY, JSON.stringify([PKG_A]));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await untilT(() => running(s).includes("t.ext-a"), 3000);
    await untilT(() => state(s).ask.length === 1);
    expect(state(s)).toEqual({ ask: [PKG_B], loading: [], failed: [] });
    expect(imported.map((u) => u.split("#")[0])).toEqual([PKG_A]);
    expect(getRegistry("scene:source").has("b-mesh")).toBe(false);
  });

  it("one that fails says so and doesn't stop the other; it isn't remembered; Try again loads it", async () => {
    servePackage(PKG_B, new Error("the chunk was missing"));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await untilT(() => state(s).ask.length === 2);
    await settle();
    await press(s, "load");
    await untilT(() => state(s).failed.length === 1);
    expect(running(s)).toContain("t.ext-a");
    expect(s.local.get().packages.failed).toEqual([{ url: PKG_B, name: "@tiny/pkg-b", error: "the chunk was missing" }]);
    await settle();
    expect(accepted()).toEqual([PKG_A]);
    // a failure isn't retried on its own
    s.change((d) => (d.title = "Later"));
    await settle();
    expect(imported.filter((u) => u.startsWith(PKG_B))).toHaveLength(1);
    servePackage(PKG_B, packageB());
    await press(s, "load");
    await untilT(() => getRegistry("scene:source").has("b-mesh"));
    await settle();
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(accepted().sort()).toEqual([PKG_A, PKG_B].sort());
  });

  it("a module without a plugins list is a failure; a package with an empty one is loaded and not asked about again", async () => {
    servePackage(PKG_A, { nothing: true });
    servePackage(PKG_B, { plugins: [] });
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc() });
    await untilT(() => state(s).ask.length === 2);
    await advancing(s.debug.packages.load());
    await settle();
    expect(s.local.get().packages.failed.map((e) => [e.url, e.error])).toEqual([[PKG_A, "it has no plugins list"]]);
    expect(state(s).ask).toEqual([]);
    expect(imported.filter((u) => u.startsWith(PKG_B))).toHaveLength(1);
  });

  it("only what the doc lists is ever loaded: an entry that names nothing loadable isn't offered, and load() takes no URL of its own", async () => {
    const STRAY = folder(repo, "@tiny/stray").url;
    servePackage(STRAY, { plugins: [] });
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: "http://localhost:5173/" }, { url: "javascript:alert(1)" }, { url: "data:text/javascript,1" }, { url: PKG_A }, { url: PKG_A }] }) });
    await untilT(() => state(s).ask.length === 1);
    expect(state(s).ask).toEqual([PKG_A]);
    await advancing(s.debug.packages.load([STRAY, "https://evil.example/x.js"]));
    await settle();
    expect(imported).toEqual([]);
    await advancing(s.debug.packages.load([`${PKG_A}#${HEAD}`])); // the same package, named at heads
    await settle();
    expect(imported.map((u) => u.split("#")[0])).toEqual([PKG_A]);
  });

  it("waits for the registry to go quiet: a package the shell registers as the scene opens is never asked about", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: PKG_A }] }), packageSettleMs: 500 });
    const look = () => s.debug.packages.inspect();
    expect([look().settled, look().missing, state(s).ask]).toEqual([false, [PKG_A], []]); // missing, and not offered yet
    // the viewer's own copy arrives, at the heads the module watcher loaded
    for (const p of packageA().plugins) getRegistry(p.type).register(p, `${PKG_A}#${HEAD}`);
    await untilT(() => look().settled, 3000);
    await settle();
    expect([look().missing, state(s).ask]).toEqual([[], []]);
    expect(imported).toEqual([]);
    expect(running(s)).toContain("t.ext-a");
  });

  it("with nothing arriving, the prompt comes once the registry has been quiet; a remembered package waits as long", async () => {
    localStorage.setItem(ACCEPTED_KEY, JSON.stringify([PKG_B]));
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc(), packageSettleMs: 500 });
    expect([s.debug.packages.inspect().settled, state(s).ask, [...imported]]).toEqual([false, [], []]);
    await untilT(() => state(s).ask.length === 1, 3000);
    expect(state(s).ask).toEqual([PKG_A]);
    await untilT(() => getRegistry("scene:source").has("b-mesh"));
    expect(imported.map((u) => u.split("#")[0])).toEqual([PKG_B]);
  });

  it("a package listed while the scene is open is asked about then; two scenes on a page load a package once", async () => {
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [] }) });
    await settle();
    expect(state(s).ask).toEqual([]);
    s.change((d) => d.packages.push({ url: PKG_A }));
    await untilT(() => state(s).ask.length === 1);
    const other = await mount({ handle: s.handle, repo });
    await untilT(() => state(other).ask.length === 1);
    await advancing(Promise.all([s.debug.packages.load(), other.debug.packages.load()]));
    await settle();
    expect(imported).toHaveLength(1);
    expect(state(s)).toEqual({ ask: [], loading: [], failed: [] });
    expect(state(other)).toEqual({ ask: [], loading: [], failed: [] });
  });

  it("a folder that can't be found is that package's failure", async () => {
    const GONE = fakeUrl();
    const s = await mount({ extensions: [PROMPT], repo, doc: sceneDoc({ packages: [{ url: GONE }] }) });
    await untilT(() => state(s).ask.length === 1);
    expect(s.local.get().packages.ask).toEqual([{ url: GONE, name: null }]);
    await advancing(s.debug.packages.load());
    await settle();
    expect(s.local.get().packages.failed).toEqual([{ url: GONE, name: null, error: `unavailable: ${GONE}` }]);
    expect(accepted()).toEqual([]);
  });
});
