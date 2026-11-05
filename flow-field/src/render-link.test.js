// A flow linked to a scene's render doc (the preferred link), the upstream
// build cache and transitive dependencies of the legacy source-doc link, and
// the compileFlow cache key.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRegistry, resetRegistries } from "@inkandswitch/patchwork-plugins";
import { acquireSection, cleanSection, sectionPathLabel } from "./section.js";
import streamSource from "./scene-streamlines.js";
import sliceSource from "./scene-slice.js";
import { flowDependencies } from "./fingerprint.js";
import { compileFlow } from "./flow.js";
import { clearUpstream, upstreamCacheSize, upstreamDepsOf } from "./upstream.js";
import { FlowFieldDatatype } from "./datatype.js";
import Tool, { HULL_DEBOUNCE_MS } from "./tool.js";
import { parsePatchworkDrop, hasPatchworkDrop } from "./dnd.js";
import { prismGLB, transomWaterline } from "./test/hull-fixtures.js";

const HULL = "automerge:hu11111111111111111111111";
const RENDER = "automerge:rend111111111111111111111";
const GLB1 = "automerge:g1b1111111111111111111111";
const GLB2 = "automerge:g2b2222222222222222222222";
const IMPORT = "automerge:imp1111111111111111111111";
const FLOW = "automerge:f1ow111111111111111111111";

function fakeHandle(url, initial, heads = ["a"]) {
  let doc = initial;
  let n = 0;
  const listeners = new Set();
  return {
    url,
    doc: () => doc,
    heads: () => heads,
    setHeads(h) {
      heads = h;
    },
    change(fn) {
      const next = structuredClone(doc);
      fn(next);
      doc = next;
      heads = [`c${++n}`];
      for (const l of [...listeners]) l({ doc });
    },
    on(ev, fn) {
      if (ev === "change") listeners.add(fn);
    },
    off(ev, fn) {
      if (ev === "change") listeners.delete(fn);
    },
    listeners,
  };
}

/** A repo over handles; counts finds per url. */
function fakeRepo(handles) {
  const finds = {};
  return {
    finds,
    handles,
    async find(url) {
      finds[url] = (finds[url] ?? 0) + 1;
      const h = handles[url];
      if (!h) throw new Error(`unavailable: ${url}`);
      return h;
    },
  };
}

const scaled = (k) => transomWaterline().map(([x, y]) => [x * k, y * k]);
const fileDoc = (bytes) => ({ "@patchwork": { type: "file" }, name: "Hull.glb", extension: "glb", mimeType: "model/gltf-binary", content: bytes });
const renderDoc = (glbUrl, extra = {}) => ({
  "@patchwork": { type: "scene-render" },
  title: "Hull",
  parent: HULL,
  providerId: "test-hull-surface",
  params: { scale: 2 },
  glbUrl,
  builtFrom: glbUrl ? { heads: ["a"], fingerprint: null, paramsKey: "{}" } : null,
  builtAt: glbUrl ? 1 : null,
  status: "idle",
  error: null,
  pinned: false,
  ...extra,
});
const hullDoc = () => ({ "@patchwork": { type: "test-hull" }, name: "Mk 1" });

/** A scene provider for "test-hull" that counts its builds. Its default build is the 10 m hull. */
function registerMesh(spy, extra = {}) {
  getRegistry("scene:source").register({
    type: "scene:source",
    id: "test-hull-surface",
    name: "Test hull",
    supportedDatatypes: ["test-hull"],
    params: [{ key: "scale", kind: "number", default: 1 }],
    async load() {
      return {
        async build({ params }) {
          spy.builds = (spy.builds ?? 0) + 1;
          if (spy.throwOnce) {
            spy.throwOnce = false;
            throw new Error("flaky");
          }
          await new Promise((r) => setTimeout(r, 5));
          return { kind: "glb", glb: prismGLB(scaled(params.scale)) };
        },
        ...extra,
      };
    },
  });
}

const flowDoc = (body) => {
  const d = {};
  FlowFieldDatatype.init(d);
  d.freestream.headingDeg = 180;
  d.elements = {};
  d.domain = { min: [-5, -6, -2], max: [25, 6, 1] };
  d.body = body;
  return d;
};
const link = (url, extra = {}) => ({ url, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 60, ...extra });

const xExtent = (section) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of section.loops) for (const [x] of l.points) ((lo = Math.min(lo, x)), (hi = Math.max(hi, x)));
  return hi - lo;
};

beforeEach(() => {
  resetRegistries();
  clearUpstream();
});

describe("a linked scene render", () => {
  it("slices the render's GLB (the scene's geometry, not the provider's defaults) and never calls a provider", async () => {
    const spy = {};
    registerMesh(spy);
    const repo = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(GLB1)), [GLB1]: fakeHandle(GLB1, fileDoc(prismGLB(scaled(2)))) });
    const r = await acquireSection({ url: RENDER, plane: { kind: "waterline" }, repo });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("render");
    expect(r.renderKey).toBe(`render:${GLB1}`);
    expect(r.datatype).toBe("scene-render");
    expect(xExtent(r.section)).toBeCloseTo(20, 1); // the render was built at scale 2; the default is 10 m
    expect(spy.builds ?? 0).toBe(0);
    expect(repo.finds[RENDER]).toBe(1); // found once, not again by readRender
    expect(sectionPathLabel(r)).toBe("slice of the scene render “Hull”");

    const z = await acquireSection({ url: RENDER, plane: { kind: "z", z: -0.5 }, repo });
    expect(z.section.plane).toEqual({ kind: "z", z: -0.5 });
    expect(z.section.loops).toHaveLength(1);
  });

  it("an unbuilt render gives no body and a note, not a thrown build (the host rebuilds when its glbUrl changes)", async () => {
    const repo = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(null)) });
    const r = await acquireSection({ url: RENDER, plane: {}, repo });
    expect(r).toMatchObject({ ok: false, pending: true, transient: false, renderKey: "render:" });
    expect(r.error).toMatch(/linked body not built yet \(“Hull” has no GLB yet\)/);
    const doc = flowDoc(link(RENDER));
    const res = await sliceSource.build({ doc, params: { resolution: 20 }, repo, url: FLOW });
    expect(res.meta.notes).toMatch(/linked body not built yet .*, so the flow is drawn without it/);
    const lines = await streamSource.build({ doc, params: { seedCount: 4, rakeRows: 1 }, repo, url: FLOW });
    expect(lines.meta.notes).toMatch(/linked body not built yet/);

    const failed = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(null, { status: "error", error: "OpenSCAD crashed" })) });
    expect((await acquireSection({ url: RENDER, repo: failed })).error).toMatch(/its last build failed: OpenSCAD crashed/);
  });

  it("a render whose GLB hasn't synced here fails the build (transient), keeping the last good flow", async () => {
    const repo = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(GLB1)) });
    const r = await acquireSection({ url: RENDER, repo });
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(r.error).toMatch(/couldn't load the linked render's GLB/);
    await expect(sliceSource.build({ doc: flowDoc(link(RENDER)), params: { resolution: 20 }, repo, url: FLOW })).rejects.toThrow(/isn't available here/);
  });

  it("refuses a flow's own render, or any flow render, as its body (the same on every peer)", async () => {
    const own = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(GLB1, { parent: FLOW })) });
    expect(await acquireSection({ url: RENDER, repo: own, selfUrl: FLOW })).toMatchObject({ ok: false, transient: false, error: expect.stringMatching(/its own render/) });
    const flowRender = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(GLB1, { parent: "automerge:other", providerId: "flow-field-slice" })) });
    expect(await acquireSection({ url: RENDER, repo: flowRender })).toMatchObject({ ok: false, transient: false });
  });

  it("builds both providers from the render, with the render (only) as the dependency", async () => {
    const repo = fakeRepo({ [RENDER]: fakeHandle(RENDER, renderDoc(GLB1)), [GLB1]: fakeHandle(GLB1, fileDoc(prismGLB(scaled(1)))) });
    const doc = flowDoc(link(RENDER));
    expect(sliceSource.dependencies(doc)).toEqual([RENDER]);
    const res = await sliceSource.build({ doc, params: { resolution: 40 }, repo, url: FLOW });
    expect(res.meta.notes).toMatch(/body: Waterplane \(2D panels\), \d+ source panels on 1 loop at z = 0\.00 m, from a slice of the scene render “Hull”/);
    expect(streamSource.dependencies(doc)).toEqual([RENDER]);
  });
});

describe("a linked source doc (legacy): the upstream build cache", () => {
  it("one hull edit costs one upstream build, shared by both providers (even concurrently)", async () => {
    const spy = {};
    registerMesh(spy);
    const hull = fakeHandle(HULL, hullDoc(), ["h1"]);
    const repo = fakeRepo({ [HULL]: hull });
    const doc = flowDoc(link(HULL));
    await Promise.all([
      sliceSource.build({ doc, params: { resolution: 20 }, repo, url: FLOW }),
      streamSource.build({ doc, params: { seedCount: 4, rakeRows: 1 }, repo, url: FLOW }),
    ]);
    expect(spy.builds).toBe(1);
    await acquireSection({ url: HULL, plane: { kind: "z", z: -0.3 }, repo }); // another plane: same build
    expect(spy.builds).toBe(1);
    hull.setHeads(["h2"]);
    await sliceSource.build({ doc, params: { resolution: 20 }, repo, url: FLOW });
    await streamSource.build({ doc, params: { seedCount: 4, rakeRows: 1 }, repo, url: FLOW });
    expect(spy.builds).toBe(2);
    expect(upstreamCacheSize()).toBe(2);
  });

  it("keys on the provider's fingerprint when it has one, and on its dependencies' heads", async () => {
    const spy = {};
    const imp = fakeHandle(IMPORT, { text: "cube" }, ["i1"]);
    registerMesh(spy, { fingerprint: () => "same", dependencies: () => [IMPORT] });
    const hull = fakeHandle(HULL, hullDoc(), ["h1"]);
    const repo = fakeRepo({ [HULL]: hull, [IMPORT]: imp });
    await acquireSection({ url: HULL, repo });
    hull.setHeads(["h2"]); // a change the provider's fingerprint says it doesn't read
    await acquireSection({ url: HULL, repo });
    expect(spy.builds).toBe(1);
    imp.setHeads(["i2"]); // an import changed
    await acquireSection({ url: HULL, repo });
    expect(spy.builds).toBe(2);
  });

  it("forgets a failed build, and doesn't cache a body it can't identify", async () => {
    const spy = { throwOnce: true };
    registerMesh(spy);
    const repo = fakeRepo({ [HULL]: fakeHandle(HULL, hullDoc(), ["h1"]) });
    expect((await acquireSection({ url: HULL, repo })).ok).toBe(false);
    expect((await acquireSection({ url: HULL, repo })).ok).toBe(true);
    expect(spy.builds).toBe(2);
    const noHeads = { find: async () => ({ url: HULL, doc: () => hullDoc() }) };
    await acquireSection({ url: HULL, repo: noHeads });
    await acquireSection({ url: HULL, repo: noHeads });
    expect(spy.builds).toBe(4);
  });

  it("lists the upstream provider's dependencies (from the last acquisition) as the flow's own", async () => {
    registerMesh({}, { dependencies: (d) => [IMPORT, HULL, d.extra].filter(Boolean) });
    const doc = flowDoc(link(HULL));
    expect(flowDependencies(doc)).toEqual([HULL]); // not known until the hull has been acquired here
    const repo = fakeRepo({ [HULL]: fakeHandle(HULL, hullDoc()), [IMPORT]: fakeHandle(IMPORT, {}) });
    await sliceSource.build({ doc, params: { resolution: 20 }, repo, url: FLOW });
    expect(upstreamDepsOf(HULL)).toEqual([IMPORT]);
    expect(flowDependencies(doc)).toEqual([HULL, IMPORT]);
    expect(streamSource.dependencies(doc)).toEqual([HULL, IMPORT]);
  });
});

describe("compileFlow's cache", () => {
  it("keys on the section's geometry, so a fresh cut of the same hull reuses the panel solve", () => {
    const doc = flowDoc(link(HULL));
    const cut = (k) => cleanSection({ loops: [{ points: scaled(k), closed: true }] }, { kind: "waterline" });
    const a = cut(1);
    const b = cut(1);
    expect(a).not.toBe(b);
    expect(a.key).toBe(b.key);
    expect(compileFlow(doc, b).body).toBe(compileFlow(doc, a).body);
    expect(cut(1.1).key).not.toBe(a.key);
    expect(compileFlow(doc, cut(1.1)).body).not.toBe(compileFlow(doc, a).body);
    // a hand-made section without a key still caches on its geometry
    const raw = { plane: { kind: "waterline", z: 0 }, loops: [{ points: scaled(1), closed: true }] };
    expect(compileFlow(doc, raw).body).toBe(compileFlow(doc, { ...raw }).body);
  });
});

describe("dropping a render onto the editor", () => {
  let element;
  let cleanup;
  let render;
  let repo;
  beforeEach(() => {
    getRegistry("patchwork:datatype").register({
      type: "patchwork:datatype",
      id: "scene-render",
      async load() {
        return { getTitle: (d) => `${d.title} (3D render)` };
      },
    });
    render = fakeHandle(RENDER, renderDoc(null));
    repo = fakeRepo({ [RENDER]: render, [GLB1]: fakeHandle(GLB1, fileDoc(prismGLB(scaled(1)))), [GLB2]: fakeHandle(GLB2, fileDoc(prismGLB(scaled(1.2)))) });
    globalThis.repo = repo;
    element = document.createElement("div");
    document.body.append(element);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    element.remove();
    delete globalThis.repo;
  });
  const q = (sel) => element.querySelector(sel);
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const drop = (data) => {
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: Object.keys(data), getData: (t) => data[t] ?? "" };
    q(".stage").dispatchEvent(ev);
  };

  it("accepts the scene outline's text/x-patchwork-urls and text/plain", () => {
    const urls = { types: ["text/x-scene-row", "text/x-patchwork-urls", "text/plain"], getData: (t) => (t === "text/x-patchwork-urls" ? JSON.stringify([RENDER]) : t === "text/plain" ? RENDER : "") };
    expect(hasPatchworkDrop(urls)).toBe(true);
    expect(parsePatchworkDrop(urls)).toEqual([{ url: RENDER, name: undefined, type: undefined }]);
    const plain = { types: ["text/plain"], getData: (t) => (t === "text/plain" ? RENDER : "") };
    expect(parsePatchworkDrop(plain).map((i) => i.url)).toEqual([RENDER]);
  });

  it("links it, waits for its first GLB, and re-cuts only when the GLB changes", async () => {
    const h = fakeHandle("automerge:flow", flowDoc(null));
    cleanup = Tool(h, element);
    drop({ "text/x-patchwork-urls": JSON.stringify([RENDER]), "text/plain": RENDER });
    expect(h.doc().body?.url).toBe(RENDER);
    await settle();
    expect(q(".chip-title").textContent).toBe("Hull (3D render)");
    expect(q(".chip-path").textContent).toBe("not built yet");
    expect(q(".body-status").textContent).toMatch(/^Linked body not built yet/);

    render.change((d) => (d.status = "building")); // no GLB yet: nothing to do
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(q(".chip-path").textContent).toBe("not built yet");

    render.change((d) => ((d.status = "idle"), (d.glbUrl = GLB1)));
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(q(".chip-path").textContent).toBe("scene render");
    expect(q(".body-status").textContent).toMatch(/Slice of the scene render “Hull”: 1 loop at z = 0\.00 m/);
    const finds = repo.finds[GLB1];

    // status writes, a rename of nothing that matters: same GLB, no re-cut
    render.change((d) => (d.status = "building"));
    render.change((d) => (d.status = "idle"));
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(repo.finds[GLB1]).toBe(finds);

    render.change((d) => (d.glbUrl = GLB2));
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(repo.finds[GLB2]).toBe(1);
    expect(q(".chip-path").textContent).toBe("scene render");

    cleanup();
    cleanup = null;
    expect(render.listeners.size).toBe(0);
  });
});
