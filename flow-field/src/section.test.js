import { describe, it, expect, beforeEach } from "vitest";
import { getRegistry, resetRegistries } from "@inkandswitch/patchwork-plugins";
import { acquireSection, sectionPathLabel, defaultParams } from "./section.js";
import streamSource from "./scene-streamlines.js";
import sliceSource from "./scene-slice.js";
import { flowFingerprint, flowDependencies, hashString, stableStringify } from "./fingerprint.js";
import { FlowFieldDatatype } from "./datatype.js";
import { parseGLB } from "./glb.js";
import { readAccessor } from "./mesh-section.js";
import { prismGLB, transomWaterline, halfBreadth } from "./test/hull-fixtures.js";

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

/** An exact section provider for "test-hull": the waterline, scaled by doc.scale. */
const exactProvider = (spy = {}) => ({
  type: "geometry:section",
  id: "test-hull-section",
  name: "Test hull section",
  supportedDatatypes: ["test-hull"],
  planes: ["waterline", "z"],
  async load() {
    return {
      section(doc, request) {
        spy.request = request;
        if (spy.throw) throw new Error("boom");
        const k = doc.scale ?? 1;
        return {
          frame: "floating",
          units: "m",
          plane: { kind: request.plane.kind, z: request.plane.z ?? 0 },
          loops: [{ points: transomWaterline().map(([x, y]) => [x * k, y * k]), closed: true }],
        };
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
  it("prefers an exact geometry:section provider, passing the plane", async () => {
    const spy = {};
    getRegistry("geometry:section").register(exactProvider(spy));
    getRegistry("scene:source").register(meshProvider());
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const r = await acquireSection({ url: HULL, plane: { kind: "z", z: -0.3 }, repo });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("exact");
    expect(r.providerId).toBe("test-hull-section");
    expect(spy.request).toEqual({ plane: { kind: "z", z: -0.3 } });
    expect(r.section.plane).toEqual({ kind: "z", z: -0.3 });
    expect(r.section.loops).toHaveLength(1);
    expect(sectionPathLabel(r)).toBe("exact section (Test hull section)");
  });

  it("falls back to slicing a scene:source build (default params) when there is no section provider, or it fails", async () => {
    const spy = {};
    getRegistry("scene:source").register(meshProvider(spy));
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const r = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("mesh");
    expect(spy.params).toEqual({ detail: 7 });
    expect(r.section.loops).toHaveLength(1);
    expect(sectionPathLabel(r)).toBe("mesh slice of Test hull");

    const broken = {};
    getRegistry("geometry:section").register(exactProvider({ throw: true, ...broken }));
    const again = await acquireSection({ url: HULL, plane: { kind: "waterline" }, repo });
    expect(again.path).toBe("mesh");
    expect(again.section.meta.notes).toMatch(/Test hull section failed \(boom\)/);
  });

  it("says why when there is nothing to cut a section with, or the link is bad", async () => {
    const repo = fakeRepo({ [HULL]: hullDoc(), [FLOW]: { ...flowDoc(null), "@patchwork": { type: "flow-field" } } });
    expect(await acquireSection({ url: HULL, plane: {}, repo })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no geometry:section or scene:source provider .*test-hull/),
    });
    expect((await acquireSection({ url: "automerge:missing", repo })).error).toMatch(/couldn't load/);
    expect((await acquireSection({ url: FLOW, repo })).error).toMatch(/can't be the body/);
    expect((await acquireSection({ url: FLOW, repo, selfUrl: FLOW })).error).toMatch(/itself/);
    // a flow provider is never used to build a body (it would recurse)
    getRegistry("scene:source").register({ type: "scene:source", id: "flow-field-slice", supportedDatatypes: ["flow-field", "test-hull"], load: async () => ({}) });
    expect((await acquireSection({ url: HULL, repo })).error).toMatch(/no geometry:section or scene:source/);
    expect(defaultParams([{ key: "a", default: 1 }, { key: "b", default: "x" }])).toEqual({ a: 1, b: "x" });
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
    getRegistry("geometry:section").register(exactProvider());
    const repo = fakeRepo({ [HULL]: hullDoc() });
    const doc = flowDoc(body);
    const res = await sliceSource.build({ doc, params: { resolution: 80 }, repo, url: FLOW });
    expect(res.kind).toBe("glb");
    expect(res.meta.notes).toMatch(/body: Waterplane \(2D panels\), \d+ source panels on 1 loop at z = 0\.00 m, from the exact section from Test hull section/);
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
    ).rejects.toThrow(/no geometry:section or scene:source provider/);
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
