import { describe, it, expect, beforeEach } from "vitest";
import { getRegistry, resetRegistries } from "@inkandswitch/patchwork-plugins";
import { acquireSection, sectionPathLabel, sectionPathChip, defaultParams, isGlbFile, matchProviders } from "./section.js";
import streamSource from "./scene-streamlines.js";
import sliceSource from "./scene-slice.js";
import { flowFingerprint, flowDependencies, hashString, stableStringify } from "./fingerprint.js";
import { FlowFieldDatatype } from "./datatype.js";
import { parseGLB } from "./glb.js";
import { readAccessor } from "./mesh-section.js";
import { prismGLB, transomWaterline, halfBreadth, circleLoop } from "./test/hull-fixtures.js";

const HULL = "automerge:hull1111111111111111111111";
const FLOW = "automerge:flow1111111111111111111111";

function fakeHandle(url, doc) {
  return { url, doc: () => doc, on() {}, off() {} };
}
function fakeRepo(docs) {
  const found = [];
  return {
    found,
    async find(url) {
      found.push(url);
      if (!docs[url]) throw new Error(`unavailable: ${url}`);
      return fakeHandle(url, docs[url]);
    },
  };
}
const hullDoc = (scale = 1) => ({ "@patchwork": { type: "test-hull" }, title: "Test hull", scale });

/**
 * A geometry:section provider for "test-hull", as camber registers one. The
 * flow must never load or call it: it cuts geometry itself.
 */
const sectionProvider = (spy = {}) => ({
  type: "geometry:section",
  id: "test-hull-section",
  name: "Test hull section",
  supportedDatatypes: ["test-hull"],
  planes: ["waterline", "z"],
  async load() {
    spy.loads = (spy.loads ?? 0) + 1;
    return {
      section() {
        spy.calls = (spy.calls ?? 0) + 1;
        return { frame: "floating", units: "m", plane: { kind: "waterline", z: 0 }, loops: [{ points: circleLoop(8), closed: true }] };
      },
    };
  },
});
/** A scene provider for "test-hull": a prism of the waterline from z = −1 to 0.5. */
const meshProvider = (spy = {}) => ({
  type: "scene:source",
  id: "test-hull-surface",
  name: "Test hull",
  supportedDatatypes: ["test-hull"],
  params: [{ key: "detail", kind: "integer", default: 7 }],
  async load() {
    return {
      async build({ params }) {
        spy.params = params;
        return { kind: "glb", glb: prismGLB(transomWaterline()) };
      },
    };
  },
});

const flowDoc = (body) => {
  const d = {};
  FlowFieldDatatype.init(d);
  d.freestream.headingDeg = 180;
  d.elements = {};
  d.domain = { min: [-5, -4, -2], max: [15, 4, 1] };
  d.body = body;
  return d;
};

beforeEach(() => resetRegistries());

describe("acquireSection", () => {
  it("builds a source doc with its scene:source provider's default params and cuts the GLB, at the plane asked for", async () => {
    const spy = {};
    getRegistry("scene:source").register(meshProvider(spy));
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const r = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("source");
    expect(r.providerId).toBe("test-hull-surface");
    expect(spy.params).toEqual({ detail: 7 });
    expect(r.section.loops).toHaveLength(1);
    expect(sectionPathLabel(r)).toBe("slice of Test hull's build (default params)");
    expect(sectionPathChip(r)).toBe("built from Test hull (defaults)");

    const z = await acquireSection({ url: HULL, plane: { kind: "z", z: -0.3 }, repo });
    expect(z.section.plane).toEqual({ kind: "z", z: -0.3 });
    expect(z.section.loops).toHaveLength(1);
  });

  it("never asks a geometry:section provider, even one that matches", async () => {
    const sections = {};
    getRegistry("geometry:section").register(sectionProvider(sections));
    getRegistry("scene:source").register(meshProvider());
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const r = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo });
    expect(r.path).toBe("source");
    expect(r.section.loops[0].points.length).toBeGreaterThan(8); // the prism's cut, not the provider's octagon
    expect(sections).toEqual({}); // never loaded, never called
    // with only a section provider there is no body: nothing here can build the doc
    resetRegistries();
    getRegistry("geometry:section").register(sectionProvider(sections));
    const none = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo });
    expect(none).toMatchObject({ ok: false, transient: true });
    expect(none.error).toMatch(/nothing installed here can build “test-hull” documents/);
    expect(sections).toEqual({});
  });

  it("prefers the most specific scene:source provider, as the scene host does, and falls through one that fails", async () => {
    const wild = {};
    getRegistry("scene:source").register({
      type: "scene:source",
      id: "anything",
      name: "Anything",
      supportedDatatypes: "*",
      params: [],
      async load() {
        return { build: async () => ((wild.builds = (wild.builds ?? 0) + 1), { kind: "glb", glb: prismGLB(circleLoop(12)) }) };
      },
    });
    const spy = {};
    getRegistry("scene:source").register(meshProvider(spy));
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const r = await acquireSection({ url: HULL, repo });
    expect(r.providerId).toBe("test-hull-surface"); // registered second, but names the datatype
    expect(wild.builds ?? 0).toBe(0);
    expect(matchProviders([{ id: "w", supportedDatatypes: "*" }, { id: "f", supportedDatatypes: ["file"], extensions: ["stl"] }, { id: "d", supportedDatatypes: ["file"] }], { datatype: "file", extension: "stl" }).map((p) => p.id)).toEqual(["f", "d", "w"]);

    resetRegistries();
    getRegistry("scene:source").register({ ...meshProvider(), load: async () => ({ build: async () => { throw new Error("boom"); } }) });
    getRegistry("scene:source").register({
      type: "scene:source",
      id: "anything",
      name: "Anything",
      supportedDatatypes: "*",
      params: [],
      load: async () => ({ build: async () => ({ kind: "glb", glb: prismGLB(circleLoop(12)) }) }),
    });
    const again = await acquireSection({ url: HULL, repo: fakeRepo({ [HULL]: hullDoc(2) }) });
    expect(again.providerId).toBe("anything");
    expect(again.section.meta.notes).toMatch(/Test hull failed \(boom\)/);
  });

  it("says why when there is nothing to build the body with, or the link is bad", async () => {
    const repo = fakeRepo({ [HULL]: hullDoc(), [FLOW]: { ...flowDoc(null), "@patchwork": { type: "flow-field" } } });
    expect(await acquireSection({ url: HULL, plane: {}, repo })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/nothing installed here can build “test-hull” documents/),
    });
    expect((await acquireSection({ url: "automerge:missing", repo })).error).toMatch(/couldn't load/);
    expect((await acquireSection({ url: FLOW, repo })).error).toMatch(/can't be the body/);
    expect((await acquireSection({ url: FLOW, repo, selfUrl: FLOW })).error).toMatch(/itself/);
    // a flow provider is never used to build a body (it would recurse)
    getRegistry("scene:source").register({ type: "scene:source", id: "flow-field-slice", supportedDatatypes: ["flow-field", "test-hull"], load: async () => ({}) });
    expect((await acquireSection({ url: HULL, repo })).error).toMatch(/nothing installed here can build/);
    expect(defaultParams([{ key: "a", default: 1 }, { key: "b", default: "x" }])).toEqual({ a: 1, b: "x" });
  });
});

describe("a GLB file as the body", () => {
  const FILE = "automerge:fi1e111111111111111111111";
  const fileDoc = (bytes, extra = {}) => ({ "@patchwork": { type: "file" }, name: "Hull.glb", extension: "glb", mimeType: "model/gltf-binary", content: bytes, ...extra });

  it("cuts the file's own bytes, with no scene:source provider (and no registry) at all", async () => {
    const repo = fakeRepo({ [FILE]: fileDoc(prismGLB(transomWaterline())) });
    const r = await acquireSection({ url: FILE, plane: { kind: "waterline" }, repo, getRegistry: () => { throw new Error("not asked"); } });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("file");
    expect(r.datatype).toBe("file");
    expect(r.title).toBe("Hull.glb");
    expect(r.section.loops).toHaveLength(1);
    expect(r.section.meta.lengthWL).toBeCloseTo(10, 6);
    expect(sectionPathLabel(r)).toBe("slice of the GLB file “Hull.glb”");
    expect(sectionPathChip(r)).toBe("GLB file");
    // a file-glb scene:source (the scene's passthrough) is never asked to build it
    const spy = {};
    getRegistry("scene:source").register({ type: "scene:source", id: "file-glb", supportedDatatypes: ["file"], extensions: ["glb"], params: [], passthrough: true, load: async () => ((spy.loaded = true), {}) });
    expect((await acquireSection({ url: FILE, repo })).path).toBe("file");
    expect(spy.loaded).toBeUndefined();
  });

  it("knows a GLB by its extension, its name, or its magic bytes", async () => {
    const glb = prismGLB(transomWaterline());
    expect(isGlbFile(fileDoc(glb))).toBe(true);
    expect(isGlbFile(fileDoc(glb, { extension: undefined }))).toBe(true); // name "Hull.glb"
    expect(isGlbFile(fileDoc(glb, { extension: undefined, name: "hull" }))).toBe(true); // sniffed
    expect(isGlbFile(fileDoc(glb, { extension: ".GLB" }))).toBe(true);
    expect(isGlbFile(fileDoc(glb, { extension: "stl", name: "Hull.stl" }))).toBe(false);
    expect(isGlbFile(fileDoc(new TextEncoder().encode("solid x"), { extension: undefined, name: "hull" }))).toBe(false);
    expect(isGlbFile({ "@patchwork": { type: "test-hull" }, extension: "glb" })).toBe(false);
    const named = await acquireSection({ url: FILE, plane: { kind: "waterline" }, repo: fakeRepo({ [FILE]: fileDoc(glb, { extension: undefined }) }) });
    expect(named.path).toBe("file");
  });

  it("scales a GLB that declares its units to metres", async () => {
    const mm = transomWaterline().map(([x, y]) => [x * 1000, y * 1000]);
    const glb = prismGLB(mm, { levels: [-1000, 500], units: "mm" });
    const r = await acquireSection({ url: FILE, plane: { kind: "z", z: -0.5 }, repo: fakeRepo({ [FILE]: fileDoc(glb) }) });
    expect(r.section.loops).toHaveLength(1);
    expect(r.section.meta.lengthWL).toBeCloseTo(10, 6);
    expect(r.section.meta.notes).toMatch(/GLB in mm, scaled to metres/);
  });

  it("says where the body is when the plane misses it, and still builds (the same on every peer)", async () => {
    const glb = prismGLB(transomWaterline(), { levels: [0.2, 1.4] }); // floats above the waterline
    const repo = fakeRepo({ [FILE]: fileDoc(glb) });
    const r = await acquireSection({ url: FILE, plane: { kind: "waterline" }, repo });
    expect(r.ok).toBe(true);
    expect(r.section.loops).toEqual([]);
    expect(r.miss).toBe("the body spans z = 0.20 m to 1.40 m, and the plane at z = 0.00 m is below it");
    const above = await acquireSection({ url: FILE, plane: { kind: "z", z: 2 }, repo });
    expect(above.miss).toMatch(/plane at z = 2\.00 m is above it/);
    const res = await sliceSource.build({ doc: flowDoc({ url: FILE, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 60 }), params: { resolution: 20 }, repo, url: FLOW });
    expect(res.meta.notes).toMatch(/linked body: the section has no loops at z = 0\.00 m, from a slice of the GLB file “Hull\.glb” \(the body spans z = 0\.20 m to 1\.40 m, and the plane at z = 0\.00 m is below it\), so no body/);
  });

  it("a file that isn't a readable GLB is no body, the same everywhere; one with no content here is transient", async () => {
    const bad = await acquireSection({ url: FILE, repo: fakeRepo({ [FILE]: fileDoc(new Uint8Array([1, 2, 3, 4, 5])) }) });
    expect(bad).toMatchObject({ ok: false, transient: false });
    expect(bad.error).toMatch(/“Hull\.glb” can't be read as a GLB/);
    const empty = await acquireSection({ url: FILE, repo: fakeRepo({ [FILE]: fileDoc(undefined) }) });
    expect(empty).toMatchObject({ ok: false, transient: true });
    expect(empty.error).toMatch(/has no content here/);
  });

  it("lists the file (only) as the flow's dependency, keyed by its heads; its contents aren't in the fingerprint", async () => {
    const doc = flowDoc({ url: FILE, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 60 });
    const repo = fakeRepo({ [FILE]: fileDoc(prismGLB(transomWaterline())) });
    const fp = flowFingerprint(doc);
    const res = await sliceSource.build({ doc, params: { resolution: 20 }, repo, url: FLOW });
    expect(res.meta.notes).toMatch(/from a slice of the GLB file “Hull\.glb”/);
    expect(flowDependencies(doc)).toEqual([FILE]);
    expect(streamSource.dependencies(doc)).toEqual([FILE]);
    expect(flowFingerprint(doc)).toBe(fp);
  });
});

describe("the flow providers with a linked body", () => {
  const body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 80 };

  it("list the linked doc as a dependency, and put the link (not the hull) in the fingerprint", () => {
    const plain = flowDoc(null);
    const legacy = { ...plain };
    delete legacy.body;
    // a doc without a body hashes without a body key (seeds: only the count is read)
    const old = hashString(stableStringify({ freestream: plain.freestream, elements: plain.elements, domain: plain.domain, seeds: { count: plain.seeds.count } }));
    expect(flowFingerprint(plain)).toBe(old);
    expect(flowFingerprint(legacy)).toBe(old);
    expect(flowDependencies(plain)).toEqual([]);
    expect(flowDependencies(legacy)).toEqual([]);
    expect(streamSource.dependencies(legacy)).toEqual([]);

    const linked = flowDoc(body);
    expect(streamSource.dependencies(linked)).toEqual([HULL]);
    expect(sliceSource.dependencies(linked)).toEqual([HULL]);
    const fp = flowFingerprint(linked);
    expect(fp).not.toBe(old);
    expect(flowFingerprint(flowDoc({ ...body, model: "slender-body-3d" }))).not.toBe(fp);
    expect(flowFingerprint(flowDoc({ ...body, panels: 81 }))).not.toBe(fp);
    expect(flowFingerprint(flowDoc({ ...body, plane: { kind: "z", z: -0.2 } }))).not.toBe(fp);
    expect(flowFingerprint(flowDoc({ ...body, url: FLOW }))).not.toBe(fp);
  });

  it("slice: masks the hull exactly, keeps every value finite, and says which path the section came by", async () => {
    getRegistry("scene:source").register(meshProvider());
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const doc = flowDoc(body);
    const res = await sliceSource.build({ doc, params: { resolution: 80 }, repo, url: FLOW });
    expect(res.kind).toBe("glb");
    expect(res.meta.notes).toMatch(/body: Waterplane \(2D panels\), \d+ source panels on 1 loop at z = 0\.00 m, from a mesh slice of Test hull's build \(default params\)/);
    expect(res.meta.notes).toMatch(/inside bodies masked/);
    const parsed = parseGLB(res.glb);
    const prim = parsed.json.meshes[0].primitives[0];
    for (const a of ["_SPEED", "_CP", "COLOR_0", "POSITION"]) for (const v of readAccessor(parsed.json, parsed.bin, prim.attributes[a])) expect(Number.isFinite(v)).toBe(true);
    // no drawn vertex inside the waterline (x 0…10, |y| < b(x))
    const pos = readAccessor(parsed.json, parsed.bin, prim.attributes.POSITION);
    const idx = readAccessor(parsed.json, parsed.bin, prim.indices);
    for (const v of idx) {
      const x = pos[v * 3];
      const y = -pos[v * 3 + 2];
      if (x > 0.1 && x < 9.9) expect(Math.abs(y) < halfBreadth(x) - 0.02).toBe(false); // crossings sit within 1/32 cell of the outline
    }
  });

  it("streamlines: planar in the waterplane model, 3D around the slender body, via the mesh slice", async () => {
    getRegistry("scene:source").register(meshProvider());
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const planar = await streamSource.build({ doc: flowDoc(body), params: { rakeRows: 2, rowSpacing: 0.5, seedCount: 8, tubes: false }, repo, url: FLOW });
    expect(planar.meta.notes).toMatch(/from a mesh slice of Test hull's build \(default params\)/);
    const p = parseGLB(planar.glb);
    const pos = readAccessor(p.json, p.bin, p.json.meshes[0].primitives[0].attributes.POSITION);
    const heights = new Set();
    for (let i = 1; i < pos.length; i += 3) heights.add(Math.round(pos[i] * 1000) / 1000);
    expect([...heights].sort()).toEqual([-0.5, 0]); // each row stays in its plane (glTF Y = z)

    const slender = await streamSource.build({ doc: flowDoc({ ...body, model: "slender-body-3d" }), params: { seedCount: 8, tubes: false }, repo, url: FLOW });
    expect(slender.meta.notes).toMatch(/Slender body \(3D\), \d+ line-source segments .* transom closed with dead water/);
    const q = parseGLB(slender.glb);
    const qpos = readAccessor(q.json, q.bin, q.json.meshes[0].primitives[0].attributes.POSITION);
    const qh = new Set();
    for (let i = 1; i < qpos.length; i += 3) qh.add(Math.round(qpos[i] * 1000) / 1000);
    expect(qh.size).toBeGreaterThan(3); // the body of revolution lifts and drops the flow
  });

  it("fail the build (keeping the last render, left stale) when this peer can't see the hull or has nothing to cut it", async () => {
    // a body-less GLB here would be recorded as fresh against the hull's heads, and every peer would keep it
    await expect(sliceSource.build({ doc: flowDoc(body), params: { resolution: 40 }, repo: fakeRepo({}), url: FLOW })).rejects.toThrow(
      /linked body isn't available here: couldn't load/,
    );
    await expect(
      streamSource.build({ doc: flowDoc(body), params: { seedCount: 4 }, repo: fakeRepo({ [HULL]: hullDoc() }), url: FLOW }),
    ).rejects.toThrow(/nothing installed here can build “test-hull” documents/);
    const r = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo: fakeRepo({}) });
    expect(r.transient).toBe(true);
  });

  it("degrade to the doc's own flow, with a note, when the link itself is unusable (the same on every peer)", async () => {
    const other = { ...flowDoc(null), "@patchwork": { type: "flow-field" } };
    const res = await sliceSource.build({ doc: flowDoc(body), params: { resolution: 30 }, repo: fakeRepo({ [HULL]: other }), url: FLOW });
    expect(res.meta.notes).toMatch(/linked body not applied: a flow field can't be the body of another flow field/);
    const self = await streamSource.build({ doc: flowDoc({ ...body, url: FLOW }), params: { seedCount: 4 }, repo: fakeRepo({}), url: FLOW });
    expect(self.meta.notes).toMatch(/linked body not applied: a flow can't be linked to itself/);
  });

  it("a body-less doc builds exactly as before (no repo needed)", async () => {
    const doc = flowDoc(null);
    const a = await sliceSource.build({ doc, params: { resolution: 30 } });
    const legacy = { ...doc };
    delete legacy.body;
    const b = await sliceSource.build({ doc: legacy, params: { resolution: 30 } });
    expect(Array.from(a.glb)).toEqual(Array.from(b.glb));
    expect(a.meta.notes).not.toMatch(/body/);
  });
});
