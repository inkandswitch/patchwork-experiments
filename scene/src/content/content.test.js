// @vitest-environment happy-dom
// The stage's content loop, mounted with the model's add and inspector (its
// tree too) (no WebGL): render docs built through the stage, the sync
// settle window, the inspector's build controls (its params, Rebuild through
// the stage, its summary of the build), objects
// fixed at a version of their source (`at`), and what a dragged row carries.
// Ported from tool.test.js / tool-v3.test.js (scene contract v3).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { manualTime } from "../stage/time.js";
import { CLAIM_MS, LISTEN_MS } from "./lock.js";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import add from "../parts/add.js";
import { add as addObject } from "../parts/editor.js";
import inspector from "../parts/inspector.js";
import { Viewport } from "../stage/viewport.js";
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

// the stage's time, stepped (content runs on it: API.md, "`api`")
let clock;
const wait = (ms) => clock.advance(Math.max(ms, 1));

describe("the stage's content loop (mounted, no WebGL)", () => {
  let s, repo, file;
  beforeAll(() => defineStandInView({ plugins, repo: () => repo }));
  // (GLB hashing without WebCrypto: every step of a build lands on the stepped time)
  beforeAll(() => vi.stubGlobal("crypto", {}));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
  });

  async function mount(doc = {}) {
    repo ??= new FakeRepo();
    clock = manualTime();
    s = await mountStage({ repo, extensions: EXTS, doc, time: clock });
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
    expect(s.facet("scene.add").content("a").render.bounds).toEqual(bounds);
    expect(hints.mock.calls.filter(([id]) => id === "a").at(-1)[1]).toEqual(bounds);
    // the scene's own hint wins
    expect(hints.mock.calls.filter(([id]) => id === "b").map(([, b]) => b)).toEqual([{ min: [5, 5, 5], max: [6, 6, 6] }]);
  });

  // One state per object (./state.js), read by everything that shows it: the
  // controls embedded in the stage show the stage's, not one of their own.
  it("the build controls inside a stage show the stage's state of the object: a render a peer built from changes not synced here is up to date in both", async () => {
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "r", parent: file.url, providerId: "file-stl", params: { unit: "mm", up: "z" }, glbUrl: null, builtFrom: { heads: ["a-change-not-synced-here"], fingerprint: null, paramsKey: '{"unit":"mm","up":"z"}', deps: {} }, builtAt: 1, bounds: null, status: "idle", error: null, pinned: false });
    await mount({ objects: { a: object({ name: "a", sourceUrl: file.url, providerId: "file-stl", renderUrl: render.url }) }, order: ["a"] });
    await wait(100);
    expect(s.facet("scene.add").content("a").state).toEqual({ state: "fresh", behind: true });
    expect(s.local.get().status.a).toBeUndefined();
    const { default: Controls } = await import("../controls-tool.js");
    const el = document.createElement("div");
    el.repo = repo;
    s.root.append(el);
    const off = Controls(render, el);
    await wait(100);
    expect(el.querySelector(".status").textContent).toBe("Up to date");
    expect(el.querySelector(".scene-render-controls").hasAttribute("data-standalone")).toBe(false);
    off();
  });

  it("a render made here builds at once only the first time it is tracked: tracked again (an undo), it listens for a builder first", async () => {
    await mount();
    const { add: addIt } = await import("../parts/editor.js");
    const id = await addIt(s.facet("scene.add"), file.url);
    await wait(500);
    const renderUrl = s.doc().objects[id].renderUrl;
    expect((await repo.find(renderUrl)).doc().builtFrom).toBeTruthy(); // at once: nobody else knew of it
    const o = JSON.parse(JSON.stringify(s.doc().objects[id]));
    s.change((d) => delete d.objects[id]);
    await wait(100);
    const builds = repo.created.length;
    file.change((d) => (d.content = STL2)); // (stale now)
    s.change((d) => (d.objects[id] = o));
    await wait(2000);
    expect(repo.created.length).toBe(builds); // listening
    await wait(LISTEN_MS + CLAIM_MS);
    expect(repo.created.length).toBe(builds + 1);
  });

  // ─── fixed versions (`at`) ───

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

  it("each object by the kind its provider makes: a file to the queue, a render doc to the manager, a source that builds with no render doc nowhere (and nothing said); content(id) says which", async () => {
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
    // [object, queued, tracked by the manager, where content(id) says it went]
    const ROWS = [
      ["a", true, false, { content: "file" }],
      ["c", true, false, { content: "file" }],
      ["b", false, true, { content: "built" }],
      ["y", false, false, { content: null }],
      ["g", false, false, null],
      ["nope", false, false, null],
    ];
    for (const [id, inQueue, inManager, load] of ROWS) {
      const got = api().content(id);
      expect([id, queued().includes(id), tracked().includes(id), got && { content: got.route }]).toEqual([id, inQueue, inManager, load]);
    }
    expect(api().content("y")).toMatchObject({ route: null, state: null });
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
    expect(api().content("x")).toMatchObject({ route: null, state: { state: "no-provider", providerId: "t-gltf" } });
    expect(s.local.get().status.x).toMatchObject({ state: "warn", text: "no provider" });
    // drawn as its hint meanwhile, as anything is while its content hasn't arrived
    expect(hints).toHaveBeenCalledWith("x", { min: [0, 0, 0], max: [1, 1, 1] });

    getRegistry("scene:source").register(gltfSource());
    await settle();
    expect(queued()).toEqual(["x"]);
    expect(api().content("x").route).toBe("file");
    expect(s.local.get().status.x?.state).not.toBe("warn");
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/declares no content kind/));

    // and it goes again with its source
    getRegistry("scene:source").unregister("t-gltf");
    await settle();
    expect(queued()).toEqual([]);
    expect(api().content("x")).toMatchObject({ route: null, state: { state: "no-provider", providerId: "t-gltf" } });
  });

  it("a source that declares no content kind is never offered, and is warned about once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s = await mountStage({ repo, extensions: EXTS });
    getRegistry("scene:source").register({ type: "scene:source", id: "t-bare", name: "Bare", supportedDatatypes: ["bare"], params: [], load: async () => ({ build: async () => null }) });
    getRegistry("scene:source").register({ type: "scene:source", id: "t-old", name: "Old", supportedDatatypes: ["old"], params: [], passthrough: true });
    await settle();
    const bare = repo.add({ "@patchwork": { type: "bare" } });
    const old = repo.add({ "@patchwork": { type: "old" } });
    await expect(addObject(api(), bare.url)).rejects.toThrow(/No scene provider/);
    await expect(addObject(api(), old.url, { providerId: "t-old" })).rejects.toThrow(/can't show/);
    getRegistry("scene:source").register(gltfSource());
    await settle();
    const said = warn.mock.calls.map((c) => String(c[0])).filter((t) => /declares no content kind/.test(t));
    expect(said).toEqual([expect.stringContaining("“t-bare”"), expect.stringContaining("“t-old”")]);
  });
});
