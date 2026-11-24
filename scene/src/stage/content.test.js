// The stage's content loop, mounted with the model's add and inspector (its
// tree too) (no WebGL): render docs built through the stage, the sync
// settle window, the inspector's build controls (its params, Rebuild through
// the stage, its summary of the build), objects
// fixed at a version of their source (`at`), and what a dragged row carries.
// Ported from tool.test.js / tool-v3.test.js (scene contract v3).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import add from "../parts/add.js";
import { add as addObject } from "../parts/editor.js";
import inspector from "../parts/inspector.js";
import { Viewport } from "./viewport.js";
import { getRegistry, resetRegistries } from "../test/plugins-mock.js";
import { emptyScene } from "../test/empty-scene.js";
import { encodeGLB } from "../glb.js";
import { plugins } from "../index.js";
import { defineStandInView } from "../test/patchwork-view.js";

// The inspector's pane (the tree and the fields): these tests have it open, as the toolbar's Inspector does.
const opener = {
  create(api) {
    let asked = false;
    return {
      update() {
        if (!asked) asked = api.run({ ext: "scene.inspector", command: "inspector", value: true });
      },
    };
  },
};

const EXTS = [
  { meta: { id: "scene.add" }, module: add },
  { meta: { id: "scene.inspector" }, module: inspector },
  { meta: { id: "t.opener" }, module: opener },
];

const STL = `solid part
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid part
`;
const STL2 = STL.replace("vertex 10 0 0", "vertex 30 0 0");

// The render manager's timers and clock are the page's (setTimeout, Date): faked here, so its settle
// window and debounce pass when the test says, not on the wall.
const wait = (ms) => vi.advanceTimersByTimeAsync(ms);

describe("the stage's content loop (mounted, no WebGL)", () => {
  let s, repo, file;
  beforeAll(() => defineStandInView({ plugins, repo: () => repo }));
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function mount(doc = {}) {
    repo ??= new FakeRepo();
    s = await mountStage({ repo, extensions: EXTS, doc });
    return s;
  }
  beforeEach(() => {
    repo = new FakeRepo();
    file = repo.add({ "@patchwork": { type: "file" }, name: "part.stl", extension: "stl", mimeType: "model/stl", content: STL });
  });

  /** A drag of `url` from the sidebar, dropped on the port. */
  async function addByUrl(url) {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["text/plain"], files: [], getData: (t) => (t === "text/plain" ? url : "") } });
    s.canvas.dispatchEvent(e);
    await settle();
  }
  const $ = (sel) => s.root.querySelector(sel);
  const versionText = () => $(".inspector .version-text")?.textContent;
  const button = (cls) => $(`.inspector .${cls}`);

  it("the inspector's build controls: a param's edit rebuilds through the stage; Rebuild with the same bytes keeps the GLB doc", async () => {
    await mount();
    await addByUrl(file.url);
    const [id] = Object.keys(s.doc().objects);
    const renderUrl = s.doc().objects[id].renderUrl;
    await wait(20);
    await settle();
    const firstGlb = (await repo.find(renderUrl)).doc().glbUrl;
    expect(firstGlb).toBeTruthy();
    // add selected it; "Built from" has its build's controls, fields of the inspector's own
    const controls = $(".inspector .build-controls");
    expect(controls).toBeTruthy();
    expect(controls.querySelector(".build-summary").textContent).toMatch(/^Up to date · built /);
    const unit = controls.querySelector('.param[data-key="unit"] select');
    expect(unit.value).toBe("mm");
    unit.value = "in";
    unit.dispatchEvent(new Event("change"));
    expect((await repo.find(renderUrl)).doc().params.unit).toBe("in");
    await wait(300);
    await settle();
    const r = (await repo.find(renderUrl)).doc();
    expect(r.glbUrl).not.toBe(firstGlb);
    expect(JSON.parse(r.builtFrom.paramsKey)).toEqual({ unit: "in", up: "z" });

    // Rebuild goes through the stage (the event is claimed); same bytes, so the same GLB doc
    const before = repo.created.length;
    const builtAt = r.builtAt;
    await wait(5);
    controls.querySelector(".rebuild").click();
    await wait(20);
    await settle();
    expect((await repo.find(renderUrl)).doc().builtAt).toBeGreaterThan(builtAt);
    expect(repo.created.length).toBe(before);
  });

  it("a render doc the scene didn't make waits out the sync settle window before building", async () => {
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "old", parent: file.url, providerId: "file-stl", params: { unit: "mm", up: "z" }, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    await mount({ objects: { old: object({ name: "old", sourceUrl: file.url, providerId: "file-stl", renderUrl: render.url }) }, order: ["old"] });
    await wait(300);
    await settle();
    expect(render.doc().glbUrl).toBeNull(); // a fresh peer might not have its history yet
    await wait(2_500);
    await settle();
    expect(render.doc().glbUrl).toBeTruthy(); // then built by the provider, as before
    expect(render.doc().status).toBe("idle");
  });

  it("a render doc's own bounds stand in for its box until its GLB loads", async () => {
    const bounds = { min: [0, 0, 0], max: [1, 2, 3] };
    // pinned and never built: it won't build, so only the bounds can say where it is
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "r", parent: file.url, providerId: "file-stl", params: { unit: "mm", up: "z" }, glbUrl: null, builtFrom: null, builtAt: null, bounds, status: "idle", error: null, pinned: true });
    // (no WebGL here, so the viewport keeps no boxes: watch what it is told)
    const hints = vi.spyOn(Viewport.prototype, "setHint");
    await mount({ objects: { a: object({ name: "a", sourceUrl: file.url, providerId: "file-stl", renderUrl: render.url }), b: object({ name: "b", sourceUrl: file.url, providerId: "file-stl", renderUrl: render.url, hint: { bounds: { min: [5, 5, 5], max: [6, 6, 6] } } }) }, order: ["a", "b"] });
    await wait(20);
    await settle();
    expect(s.facet("scene.add").loadState("a").bounds).toEqual(bounds);
    expect(hints.mock.calls.filter(([id]) => id === "a").at(-1)[1]).toEqual(bounds);
    // the scene's own hint wins
    expect(hints.mock.calls.filter(([id]) => id === "b").map(([, b]) => b)).toEqual([{ min: [5, 5, 5], max: [6, 6, 6] }]);
  });

  // ─── fixed versions (`at`) ───

  it("a URL with heads adds the object fixed at that version, built from it", async () => {
    await mount();
    const h1 = file.heads();
    file.change((d) => (d.content = STL2));
    await addByUrl(`${file.url}#${h1[0]}`);
    const [id] = Object.keys(s.doc().objects);
    const o = s.doc().objects[id];
    expect(o.sourceUrl).toBe(file.url);
    expect(o.at).toEqual({ heads: h1 });
    await wait(20);
    await settle();
    const render = (await repo.find(o.renderUrl)).doc();
    expect(render.builtFrom.heads).toEqual(h1);
    expect(render.bounds.max[0]).toBeCloseTo(0.01); // 10 mm: the old triangle, not the 30 mm one
    expect($(`.object-row[data-id="${id}"] .fixed-mark`)).toBeTruthy();
    expect(versionText()).toMatch(/^Fixed at /);
    // the build's summary is the stage's: fixed, so not out of date
    expect($(".inspector .build-summary").textContent).toMatch(/^Built .* · fixed version$/);
  });

  it("inspector: Fix at this version freezes what is built; Follow latest catches up", async () => {
    await mount();
    await addByUrl(file.url);
    await wait(20);
    await settle();
    const [id] = Object.keys(s.doc().objects);
    const renderUrl = s.doc().objects[id].renderUrl;
    const built = (await repo.find(renderUrl)).doc();
    expect(versionText()).toBe("Latest");
    expect(button("fix-version").disabled).toBe(false);
    expect(button("follow-latest").disabled).toBe(true);
    expect($(".fixed-mark")).toBeNull();

    const created = repo.created.length;
    button("fix-version").click();
    await settle();
    expect(s.doc().objects[id].at).toEqual({ heads: built.builtFrom.heads });
    expect(versionText()).toMatch(/^Fixed at .* · built /);
    expect(button("fix-version").disabled).toBe(true);
    expect(button("follow-latest").disabled).toBe(false);
    expect($(`.object-row[data-id="${id}"] .fixed-mark`)).toBeTruthy();

    // edits to the source no longer rebuild it, and the GLB never changed
    file.change((d) => (d.content = STL2));
    await wait(300);
    await settle();
    const after = (await repo.find(renderUrl)).doc();
    expect(after.glbUrl).toBe(built.glbUrl);
    expect(after.builtAt).toBe(built.builtAt);
    expect(repo.created.length).toBe(created);
    expect($(".inspector .build-summary").textContent).toMatch(/· fixed version$/);

    button("follow-latest").click();
    await settle();
    expect("at" in s.doc().objects[id]).toBe(false);
    expect(versionText()).toBe("Latest");
    expect($(".fixed-mark")).toBeNull();
    await wait(300);
    await settle();
    const latest = (await repo.find(renderUrl)).doc();
    expect(latest.builtFrom.heads).toEqual(file.heads());
    expect(latest.glbUrl).not.toBe(built.glbUrl);
  });

  it("the inspector's fix and follow are commands too (for the menu); api.fixPoint says where", async () => {
    await mount();
    await addByUrl(file.url);
    await wait(20);
    await settle();
    const [id] = Object.keys(s.doc().objects);
    const api = s.api("scene.inspector");
    const f = s.facet("scene.inspector");
    const point = f.fixPoint(id);
    expect(point).toEqual({ heads: (await repo.find(s.doc().objects[id].renderUrl)).doc().builtFrom.heads });
    const ids = () => api.collect("commands").flatMap(({ id: ext, value }) => (value ?? []).filter((c) => c.state?.(id, { scene: f.scene(), local: f.local.get() })).map((c) => `${ext}:${c.id}`));
    expect(ids()).toContain("scene.inspector:fix-version");
    expect(ids()).not.toContain("scene.inspector:follow-latest");
    api.run({ ext: "scene.inspector", command: "fix-version", target: id });
    await settle();
    expect(s.doc().objects[id].at).toEqual(point);
    expect(ids()).toContain("scene.inspector:follow-latest");
    expect(ids()).not.toContain("scene.inspector:fix-version");
    api.run({ ext: "scene.inspector", command: "follow-latest", target: id });
    await settle();
    expect("at" in s.doc().objects[id]).toBe(false);
    // never for what isn't built content
    expect(f.fixPoint("nope")).toBeNull();
  });

  it("a dragged row carries its render doc for other tools, and the stage itself ignores that", async () => {
    await mount();
    await addByUrl(file.url);
    await wait(20);
    const [id] = Object.keys(s.doc().objects);
    const renderUrl = s.doc().objects[id].renderUrl;
    const data = {};
    const start = new Event("dragstart", { bubbles: true });
    start.dataTransfer = { setData: (t, v) => (data[t] = v), effectAllowed: "" };
    $(`.object-row[data-id="${id}"] .row-main`).dispatchEvent(start);
    expect(JSON.parse(data["text/x-patchwork-urls"])).toEqual([renderUrl]);
    expect(data["text/plain"]).toBe(renderUrl);
    expect(JSON.parse(data["text/x-patchwork-dnd"]).items[0]).toMatchObject({ url: renderUrl, type: "scene-render" });

    // the same drag released over the viewport adds nothing
    const before = Object.keys(s.doc().objects).length;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: Object.keys(data), files: [], getData: (t) => data[t] ?? "" } });
    s.canvas.dispatchEvent(drop);
    await flush();
    await flush();
    expect(Object.keys(s.doc().objects).length).toBe(before);
    expect(drop.defaultPrevented).toBe(false);
  });
  // ─── contract v3 through the stage: what loadProvider hands the manager ───

  /** A provider registered after mount (the stage lists providers live), with a version, a clamped param and a dependency. */
  function thingProvider() {
    const calls = [];
    const p = {
      abortNext: false,
      calls,
      build: vi.fn(async ({ params }) => {
        calls.push({ ...params });
        if (p.abortNext) {
          p.abortNext = false;
          throw Object.assign(new Error("superseded"), { name: "AbortError" });
        }
        return { kind: "glb", glb: encodeGLB({ meshes: [{ positions: [0, 0, 0, params.n, 0, 0, 0, 1, 0] }] }) };
      }),
    };
    getRegistry("scene:source").register({
      type: "scene:source",
      id: "t-thing",
      content: "built",
      name: "Thing",
      supportedDatatypes: ["thing"],
      version: 3,
      params: [{ key: "n", kind: "integer", default: 4, min: 1, max: 10, cost: "cheap" }],
      load: async () => ({ build: p.build, dependencies: (doc) => (doc.link ? [doc.link] : []) }),
    });
    return p;
  }

  it("builds with the provider's version, its params clamped to their specs, and its dependencies keyed", async () => {
    await mount();
    const p = thingProvider();
    const dep = repo.add({ "@patchwork": { type: "hull" }, length: 1 });
    const source = repo.add({ "@patchwork": { type: "thing" }, title: "Thing", link: dep.url });
    await addByUrl(source.url);
    const [id] = Object.keys(s.doc().objects);
    expect(s.doc().objects[id].providerId).toBe("t-thing");
    const render = await repo.find(s.doc().objects[id].renderUrl);
    await wait(20);
    await settle();
    expect(p.calls).toEqual([{ n: 4 }]);
    expect(render.doc().builtFrom.providerVersion).toBe(3);
    expect(render.doc().builtFrom.deps).toEqual({ [dep.url]: dep.heads() });

    // out of range in the doc, clamped for build(); the stored value is kept as written
    render.change((d) => (d.params.n = 999));
    await wait(300);
    await settle();
    expect(p.calls.at(-1)).toEqual({ n: 10 });
    expect(JSON.parse(render.doc().builtFrom.paramsKey)).toEqual({ n: 999 });

    // a dependency edit rebuilds (debounced like a source edit), recording its new heads
    const n = p.calls.length;
    dep.change((d) => (d.length = 2));
    await wait(1_000);
    await settle();
    expect(p.calls.length).toBe(n + 1);
    expect(render.doc().builtFrom.deps).toEqual({ [dep.url]: dep.heads() });
  });

  it("a build the provider aborts (AbortError) is cancelled, not failed: no error shown, tried again", async () => {
    await mount();
    const p = thingProvider();
    const source = repo.add({ "@patchwork": { type: "thing" }, title: "Thing" });
    await addByUrl(source.url);
    const [id] = Object.keys(s.doc().objects);
    const render = await repo.find(s.doc().objects[id].renderUrl);
    await wait(20);
    await settle();
    const built = render.doc().builtAt;
    p.abortNext = true;
    const n = p.calls.length;
    render.change((d) => (d.params.n = 7));
    await wait(400);
    await settle();
    expect(p.calls.length).toBe(n + 2); // the aborted one, then again at once
    expect(render.doc()).toMatchObject({ status: "idle", error: null });
    expect(render.doc().builtAt).toBeGreaterThan(built);
    expect(s.facet("scene.add").loadState(id)).toMatchObject({ status: "idle", error: null });
    expect($(`.object-row[data-id="${id}"]`).textContent).not.toMatch(/error/);
  });

  it("never auto-rebuilds over a peer's build made from source changes this client hasn't synced", async () => {
    await mount();
    await addByUrl(file.url);
    const [id] = Object.keys(s.doc().objects);
    const render = await repo.find(s.doc().objects[id].renderUrl);
    await wait(20);
    await settle();
    const built = render.doc().builtAt;
    // a peer one edit ahead rebuilt; we see its build, not yet its edit
    render.change((d) => {
      d.builtFrom = { ...JSON.parse(JSON.stringify(d.builtFrom)), heads: ["a-change-we-have-not-synced"] };
    });
    await wait(1_000);
    await settle();
    expect(render.doc().builtAt).toBe(built);
    expect(render.doc().builtFrom.heads).toEqual(["a-change-we-have-not-synced"]);
    expect(s.facet("scene.add").loadState(id)).toMatchObject({ behind: true, stale: false });
  });
});

// ─── routing at sync: by the kind of content the object's provider makes ────

describe("content is routed at sync by its provider's kind (STAGE.md, “Views, stages and links”)", () => {
  let s, repo;
  beforeEach(() => {
    repo = new FakeRepo();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
  });

  const glbBytes = () => encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
  const glbFile = (name = "part.glb", extension = "glb") => repo.add({ "@patchwork": { type: "file" }, name, extension, mimeType: "model/gltf-binary", content: glbBytes() });
  /** Another package's source of GLB files: shown as they are, like the scene's own file-glb. */
  const gltfSource = (extra = {}) => ({ type: "scene:source", id: "t-gltf", content: "file", name: "glTF", supportedDatatypes: ["file"], extensions: ["gltf"], params: [], ...extra });
  const queued = () => s.debug.queue.ids();
  const tracked = () => s.debug.manager.ids();
  const api = () => s.facet("scene.add");

  it("routes at the first sync: a GLB file object is queued as the stage mounts, before anything awaits", async () => {
    const glb = glbFile();
    resetRegistries();
    const { plugins } = await import("../index.js");
    for (const p of plugins) if (p.type === "scene:source") getRegistry(p.type).register(p);
    const { default: Stage } = await import("./stage.js");
    const handle = repo.add(emptyScene({ objects: { a: object({ sourceUrl: glb.url }) } }));
    const element = document.createElement("div");
    element.repo = repo;
    element.packageSettleMs = 0;
    document.body.append(element);
    const cleanup = Stage(handle, element);
    try {
      expect(element.querySelector(".scene-stage").__sceneDebug.queue.ids()).toEqual(["a"]);
    } finally {
      cleanup();
      element.remove();
    }
  });

  it("a GLB file object goes to the queue and a render-doc object to the manager, and loadState says which", async () => {
    const glb = glbFile();
    const stl = repo.add({ "@patchwork": { type: "file" }, name: "x.stl", extension: "stl", content: STL });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: stl.url, providerId: "file-stl", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    s = await mountStage({ repo, extensions: EXTS, doc: { objects: { a: object({ sourceUrl: glb.url }), b: object({ sourceUrl: stl.url, providerId: "file-stl", renderUrl: render.url }), g: { kind: "group", name: "G", visible: true, group: null } } } });
    await settle();
    expect(queued()).toEqual(["a"]);
    expect(tracked()).toEqual(["b"]);
    expect(api().loadState("a").content).toBe("file");
    expect(api().loadState("b").content).toBe("built");
    expect(api().loadState("g")).toBeNull();
    expect(api().loadState("nope")).toBeNull();
  });

  it("an object whose provider isn't here loads nothing and says so; it loads once a source of that id arrives, by the kind it makes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hints = vi.spyOn(Viewport.prototype, "setHint");
    const file = glbFile("part.gltf", "gltf");
    s = await mountStage({ repo, extensions: EXTS, doc: { objects: { x: object({ sourceUrl: file.url, providerId: "t-gltf", hint: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } }) } } });
    await settle();
    expect(queued()).toEqual([]);
    expect(tracked()).toEqual([]);
    expect(api().loadState("x")).toEqual({ content: null, phase: "no-provider", providerId: "t-gltf" });
    expect(s.local.get().status.x).toMatchObject({ state: "warn", text: "no provider" });
    // drawn as its hint meanwhile, as anything is while its content hasn't arrived
    expect(hints).toHaveBeenCalledWith("x", { min: [0, 0, 0], max: [1, 1, 1] });

    getRegistry("scene:source").register(gltfSource());
    await settle();
    expect(queued()).toEqual(["x"]);
    expect(api().loadState("x").content).toBe("file");
    expect(s.local.get().status.x?.state).not.toBe("warn");
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/declares no content kind/));

    // and it goes again with its source
    getRegistry("scene:source").unregister("t-gltf");
    await settle();
    expect(queued()).toEqual([]);
    expect(api().loadState("x")).toEqual({ content: null, phase: "no-provider", providerId: "t-gltf" });
  });

  it("a source that builds, for an object with no render doc: nothing to load, and nothing to say", async () => {
    const stl = repo.add({ "@patchwork": { type: "file" }, name: "x.stl", extension: "stl", content: STL });
    s = await mountStage({ repo, extensions: EXTS, doc: { objects: { y: object({ sourceUrl: stl.url, providerId: "file-stl" }) } } });
    await settle();
    expect(queued()).toEqual([]);
    expect(tracked()).toEqual([]);
    expect(api().loadState("y")).toEqual({ content: null });
    expect(s.local.get().status.y).toBeUndefined();
  });

  it("addObject through another package's file source makes no render doc and shows the file", async () => {
    s = await mountStage({ repo, extensions: EXTS });
    getRegistry("scene:source").register(gltfSource());
    await settle();
    const file = glbFile("part.gltf", "gltf");
    expect((await api().providersFor(file.url, file.doc())).map((p) => p.id)).toEqual(["t-gltf"]);
    const id = await addObject(api(), file.url);
    await settle();
    expect(s.doc().objects[id]).toMatchObject({ sourceUrl: file.url, providerId: "t-gltf", renderUrl: null });
    expect(queued()).toEqual([id]);
    expect(api().loadState(id).content).toBe("file");
  });

  it("a source that declares no content kind is never offered, and is warned about once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s = await mountStage({ repo, extensions: EXTS });
    getRegistry("scene:source").register({ type: "scene:source", id: "t-bare", name: "Bare", supportedDatatypes: ["bare"], params: [], load: async () => ({ build: async () => null }) });
    getRegistry("scene:source").register({ type: "scene:source", id: "t-old", name: "Old", supportedDatatypes: ["old"], params: [], passthrough: true });
    await settle();
    const bare = repo.add({ "@patchwork": { type: "bare" } });
    const old = repo.add({ "@patchwork": { type: "old" } });
    expect(await api().providersFor(bare.url, bare.doc())).toEqual([]);
    expect(await api().providersFor(old.url, old.doc())).toEqual([]);
    await expect(addObject(api(), bare.url)).rejects.toThrow(/No scene provider/);
    await expect(addObject(api(), old.url, { providerId: "t-old" })).rejects.toThrow(/can't show/);
    getRegistry("scene:source").register(gltfSource());
    await settle();
    const said = warn.mock.calls.map((c) => String(c[0])).filter((t) => /declares no content kind/.test(t));
    expect(said).toEqual([expect.stringContaining("“t-bare”"), expect.stringContaining("“t-old”")]);
  });
});
