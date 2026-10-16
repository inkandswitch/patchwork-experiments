// The tool mounted against an in-memory repo (no WebGL here, so no preview):
// auto re-slicing, what doesn't re-slice, the stale state, drops, and the
// quick view's "Make slice job".
import { describe, it, expect, afterEach, vi } from "vitest";

// No WebGL here: stand in for the viewer and record what the tool shows.
const shown = vi.hoisted(() => ({ previews: [], models: [], beds: [], disposed: 0 }));
vi.mock("./viewer.js", () => ({
  createViewer: () => ({
    setBed: (x, y) => shown.beds.push([x, y]),
    setColors() {},
    showModel: (tris) => shown.models.push(tris ? tris.length / 9 : null),
    showPreview: (p) => shown.previews.push(p?.layers ?? null),
    setLayer() {},
    setModelVisible() {},
    frame() {},
    dispose: () => shown.disposed++,
  }),
}));

import SlicerTool from "./tool.js";
import { newJobDoc } from "./datatype.js";
import { FakeRepo } from "./test/fake-repo.js";
import { boxGlb, boxTris, fileDoc, renderDoc, toBinaryStl } from "./test/models.js";

async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      // keep waiting
    }
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cleanups = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  document.body.replaceChildren();
});

function mount(repo, handle) {
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  cleanups.push(SlicerTool(handle, element));
  return element;
}

function scene({ auto = true } = {}) {
  const repo = new FakeRepo();
  const glb = repo.add(fileDoc("part.glb", boxGlb(0.01, 0.004, 0.01)));
  const render = repo.add(renderDoc({ title: "Part", glbUrl: glb.url }));
  const job = repo.add(newJobDoc({ title: "Part slice", source: render.url, auto }));
  return { repo, glb, render, job };
}

const status = (el) => el.querySelector(".status");

describe("slicer tool on a slice job", () => {
  it("slices by itself, then doesn't re-slice for a rename or a render status write", async () => {
    const { repo, render, job } = scene();
    const el = mount(repo, job);
    await waitFor(() => job.doc().gcodeUrl && job.doc().status === "idle");
    await waitFor(() => /Up to date/.test(status(el).textContent));
    await waitFor(() => shown.previews.at(-1) === 20 && shown.models.at(-1) === 12);
    const { builtAt, gcodeUrl } = job.doc();
    const docs = repo.created.length;
    render.change((d) => {
      d.title = "Part renamed";
      d.status = "building";
    });
    job.change((d) => void (d.title = "Renamed job"));
    await sleep(1300);
    expect(job.doc().builtAt).toBe(builtAt);
    expect(job.doc().gcodeUrl).toBe(gcodeUrl);
    expect(repo.created.length).toBe(docs);
    expect(el.querySelector("h2").textContent).toBe("Renamed job");
  });

  it("re-slices when a setting changes in the form, leaving the first layer height alone", async () => {
    const { repo, job } = scene();
    const el = mount(repo, job);
    await waitFor(() => job.doc().gcodeUrl && job.doc().status === "idle");
    const before = job.doc().builtFrom.settingsKey;
    const input = [...el.querySelectorAll(".row")].find((r) => r.textContent.startsWith("Layer height")).querySelector("input");
    input.value = "0.1";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(job.doc().settings.layerHeight).toBe(0.1);
    expect(job.doc().settings.firstLayerHeight).toBe(0.2);
    await waitFor(() => job.doc().builtFrom.settingsKey !== before && job.doc().status === "idle");
    expect(job.doc().stats.layers).toBe(1 + Math.round((4 - 0.2) / 0.1));
  });

  it("with auto off, a new GLB shows stale and waits for the button", async () => {
    const { repo, render, job } = scene({ auto: false });
    const el = mount(repo, job);
    await waitFor(() => /Not sliced yet/.test(status(el).textContent));
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Slice now");
    btn.click();
    await waitFor(() => job.doc().gcodeUrl && /Up to date/.test(status(el).textContent));
    const first = job.doc().gcodeUrl;
    const glb2 = repo.add(fileDoc("part.glb", boxGlb(0.01, 0.006, 0.01)));
    render.change((d) => void (d.glbUrl = glb2.url));
    await waitFor(() => status(el).dataset.state === "stale" && /the model changed/.test(status(el).textContent));
    await sleep(1100);
    expect(job.doc().gcodeUrl).toBe(first);
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Slice now").click();
    await waitFor(() => job.doc().gcodeUrl !== first && job.doc().status === "idle");
  });

  it("takes a source from a scene outline row dropped on it", async () => {
    const repo = new FakeRepo();
    const glb = repo.add(fileDoc("part.glb", boxGlb(0.01, 0.004, 0.01)));
    const render = repo.add(renderDoc({ glbUrl: glb.url }));
    const sceneDoc = repo.add({ "@patchwork": { type: "scene" }, objects: { o1: { name: "Part", renderUrl: render.url, sourceUrl: null } } });
    const job = repo.add(newJobDoc({ source: null }));
    const el = mount(repo, job);
    await waitFor(() => /No source yet/.test(status(el).textContent));
    const data = { "application/x-scene-object": JSON.stringify({ scene: sceneDoc.url, id: "o1" }) };
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { types: Object.keys(data), getData: (t) => data[t] ?? "", effectAllowed: "move" } });
    el.querySelector(".patchwork-slicer").dispatchEvent(ev);
    await waitFor(() => job.doc().source === render.url);
    await waitFor(() => job.doc().gcodeUrl);
  });

  it("cleans up its listeners", async () => {
    const { repo, render, job } = scene({ auto: false });
    const el = mount(repo, job);
    await waitFor(() => render.listenerCount("change") === 1);
    const disposed = shown.disposed;
    cleanups.pop()();
    expect(shown.disposed).toBe(disposed + 1);
    expect(job.listenerCount("change")).toBe(0);
    expect(render.listenerCount("change")).toBe(0);
    expect(el.querySelector(".patchwork-slicer")).toBe(null);
  });
});

describe("slicer tool on a file", () => {
  it("quick-slices without writing the file, and makes a slice job from it", async () => {
    const repo = new FakeRepo();
    const stl = repo.add(fileDoc("cube.stl", toBinaryStl(boxTris(3, 3, 3))));
    const heads = stl.heads();
    const el = mount(repo, stl);
    await waitFor(() => /Not sliced yet/.test(status(el).textContent));
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Slice now").click();
    await waitFor(() => status(el).dataset.state === "fresh");
    expect(stl.heads()).toEqual(heads);
    expect(el.querySelector(".stats").textContent).toMatch(/Layers15/);

    const opened = [];
    el.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Make slice job").click();
    await waitFor(() => opened.length === 1);
    expect(opened[0].toolId).toBe("patchwork-slicer");
    const job = (await repo.find(opened[0].url)).doc();
    expect(job).toMatchObject({ "@patchwork": { type: "slice-job" }, title: "cube slice", source: stl.url, auto: true });
  });
});
