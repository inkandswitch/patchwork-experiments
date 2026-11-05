// The stage's content loop, mounted with the model's add, outline and
// inspector (no WebGL, and no <patchwork-view>, so the inspector mounts the
// build controls itself): render docs built through the stage, the sync
// settle window, the embedded controls' rebuild and context events, objects
// fixed at a version of their source (`at`), and what a dragged row carries.
// Ported from tool.test.js / tool-v3.test.js (scene contract v3).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import add from "../parts/add.js";
import outline from "../parts/outline.js";
import inspector from "../parts/inspector.js";
import { Viewport } from "./viewport.js";

// A stand-in for scene.sidebar: mounts every collected panel and updates it each pass.
const sidebar = {
  create(api) {
    const edge = api.edge("right");
    const mounted = new Map();
    const sync = (scene, local) => {
      for (const { value } of api.collect("panels")) {
        for (const p of value ?? []) {
          if (mounted.has(p.id)) continue;
          const section = document.createElement("section");
          section.dataset.panel = p.id;
          edge.append(section);
          mounted.set(p.id, p.mount(section) ?? {});
        }
      }
      for (const m of mounted.values()) m.update?.(scene, local);
    };
    return {
      update: (scene, local) => sync(scene, local),
      dispose: () => {
        for (const m of mounted.values()) m.dispose?.();
      },
    };
  },
};

const EXTS = [
  { meta: { id: "scene.add" }, module: add },
  { meta: { id: "scene.outline" }, module: outline },
  { meta: { id: "scene.inspector" }, module: inspector },
  { meta: { id: "t.sidebar" }, module: sidebar },
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("the stage's content loop (mounted, no WebGL)", () => {
  let s, repo, file;
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
    s = await mountStage({ repo, extensions: EXTS, kits: [{ id: "model", extensions: EXTS.map((e) => e.meta.id) }], doc });
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

  it("embeds the controls, whose edits rebuild through the stage; Rebuild now with the same bytes keeps the GLB doc", async () => {
    await mount();
    await addByUrl(file.url);
    const [id] = Object.keys(s.doc().objects);
    const renderUrl = s.doc().objects[id].renderUrl;
    await wait(20);
    await settle();
    const firstGlb = (await repo.find(renderUrl)).doc().glbUrl;
    expect(firstGlb).toBeTruthy();
    // add selected it; the inspector mounts the controls itself (no <patchwork-view> here)
    const controls = $(".scene-render-controls");
    expect(controls).toBeTruthy();
    const unit = controls.querySelector("select");
    expect(unit.value).toBe("mm");
    unit.value = "in";
    unit.dispatchEvent(new Event("change"));
    expect((await repo.find(renderUrl)).doc().params.unit).toBe("in");
    await wait(300);
    await settle();
    const r = (await repo.find(renderUrl)).doc();
    expect(r.glbUrl).not.toBe(firstGlb);
    expect(JSON.parse(r.builtFrom.paramsKey)).toEqual({ unit: "in", up: "z" });

    // "Rebuild now" goes through the stage (the event is claimed); same bytes, so the same GLB doc
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
    expect(s.api("scene.add").loadState("a").bounds).toEqual(bounds);
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
    // the embedded controls ask the stage, so they don't call it stale
    const controls = $(".scene-render-controls");
    expect(controls.querySelector(".status").textContent).toBe("Up to date");
    expect(controls.querySelector(".built").textContent).toMatch(/fixed version/);
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
    expect($(".scene-render-controls .status").textContent).toBe("Up to date");

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
    const point = api.fixPoint(id);
    expect(point).toEqual({ heads: (await repo.find(s.doc().objects[id].renderUrl)).doc().builtFrom.heads });
    const ids = () => api.collect("commands").flatMap(({ id: ext, value }) => (value ?? []).filter((c) => c.state?.(id, { scene: api.scene(), local: api.local.get() })).map((c) => `${ext}:${c.id}`));
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
    // never for a passthrough object
    expect(api.fixPoint("nope")).toBeNull();
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
});
