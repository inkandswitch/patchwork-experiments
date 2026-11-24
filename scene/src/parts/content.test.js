// @vitest-environment happy-dom
// The stage's content loop, mounted with the model's add and inspector (its
// tree too) (no WebGL): a render doc's bounds standing in for its box,
// objects fixed at a version of their source (`at`) and the inspector's Fix
// and Follow, a dragged row let go over the view, and where content is
// routed at sync. (How a render doc is built is ../render-manager.test.js's.)
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import add from "./add.js";
import { add as addObject } from "./editor.js";
import inspector from "./inspector.js";
import { Viewport } from "../stage/viewport.js";
import { getRegistry } from "../test/plugins-mock.js";
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

  it("inspector: Fix at this version freezes what is built; Follow latest (its button, or its command) catches up", async () => {
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

    // Follow latest is a command too (the menu's): run as one
    s.api("scene.inspector").run({ ext: "scene.inspector", command: "follow-latest", target: id });
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

  it("a row's drag (its render doc, for other tools) let go over the view adds nothing", async () => {
    await mount();
    await addByUrl(file.url);
    await wait(20);
    const [id] = Object.keys(s.doc().objects);
    const renderUrl = s.doc().objects[id].renderUrl;
    const data = {};
    const start = new Event("dragstart", { bubbles: true });
    start.dataTransfer = { setData: (t, v) => (data[t] = v), effectAllowed: "" };
    $(`.object-row[data-id="${id}"] .row-main`).dispatchEvent(start);
    expect(data["text/plain"]).toBe(renderUrl);
    const before = Object.keys(s.doc().objects).length;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: Object.keys(data), files: [], getData: (t) => data[t] ?? "" } });
    s.canvas.dispatchEvent(drop);
    await flush();
    await flush();
    expect(Object.keys(s.doc().objects).length).toBe(before);
    expect(drop.defaultPrevented).toBe(false);
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

  it("each object by the kind its provider makes: a file to the queue, a render doc to the manager, a source that builds with no render doc nowhere (and nothing said); loadState says which", async () => {
    const glb = glbFile();
    const gltf = glbFile("part.gltf", "gltf");
    const stl = repo.add({ "@patchwork": { type: "file" }, name: "x.stl", extension: "stl", content: STL });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: stl.url, providerId: "file-stl", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    const objects = {
      a: object({ sourceUrl: glb.url }),
      c: object({ sourceUrl: gltf.url, providerId: "t-gltf" }), // another package's file source
      b: object({ sourceUrl: stl.url, providerId: "file-stl", renderUrl: render.url }),
      y: object({ sourceUrl: stl.url, providerId: "file-stl" }),
      g: { kind: "group", name: "G", visible: true, group: null },
    };
    s = await mountStage({ repo, extensions: EXTS, doc: { objects } });
    getRegistry("scene:source").register(gltfSource());
    await settle();
    // [object, queued, tracked by the manager, loadState]
    const ROWS = [
      ["a", true, false, { content: "file" }],
      ["c", true, false, { content: "file" }],
      ["b", false, true, { content: "built" }],
      ["y", false, false, { content: null }],
      ["g", false, false, null],
      ["nope", false, false, null],
    ];
    for (const [id, inQueue, inManager, load] of ROWS) {
      const got = api().loadState(id);
      expect([id, queued().includes(id), tracked().includes(id), got && { content: got.content }]).toEqual([id, inQueue, inManager, load]);
    }
    expect(api().loadState("y")).toEqual({ content: null });
    expect(s.local.get().status.y).toBeUndefined();
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
