// @vitest-environment happy-dom
// Editor features on content, mounted with the add and inspector parts (no
// WebGL): a URL with heads added fixed at that version, the inspector's Fix
// and Follow (its button, or its command), a row's drag let go over the view.
// The content pipeline's own tests are ../content/content.test.js.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { manualTime } from "../stage/time.js";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import add from "./add.js";
import inspector from "./inspector.js";
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

// content runs on the stage's time: stepped here, so a build's debounce and claim pass when the test says
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
    s = await mountStage({ editor: true, natives: true, repo, extensions: EXTS, doc, time: clock });
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
    await wait(2000);
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
    await wait(2000);
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
