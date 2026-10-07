import { describe, it, expect } from "vitest";
import { buildStreamlines, computeStreamlines, MAX_MESH_VERTICES, MAX_SEEDS_PER_ROW, MAX_RAKE_ROWS } from "./build-streamlines.js";
import { buildSlice, MAX_SLICE_RESOLUTION } from "./build-slice.js";
import { flowFingerprint, stableStringify } from "./fingerprint.js";
import { parseGLB, encodeGLB } from "./glb.js";
import { RANKINE_SEED, FlowFieldDatatype } from "./datatype.js";
import streamSource from "./scene-streamlines.js";
import sliceSource from "./scene-slice.js";
import { plugins } from "./index.js";

const seedDoc = () => {
  const d = {};
  FlowFieldDatatype.init(d);
  return d;
};

function accessorData(parsed, index) {
  const { json, bin } = parsed;
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const Ctor = acc.componentType === 5126 ? Float32Array : acc.componentType === 5123 ? Uint16Array : Uint32Array;
  return new Ctor(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + acc.count * comps * Ctor.BYTES_PER_ELEMENT));
}

describe("glb.js COLOR_0 extension", () => {
  it("writes colors as COLOR_0 and checks their length", () => {
    const glb = encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], colors: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] });
    const { json } = parseGLB(glb);
    const a = json.meshes[0].primitives[0].attributes;
    expect(json.accessors[a.COLOR_0]).toMatchObject({ type: "VEC3", componentType: 5126, count: 3 });
    expect(() => encodeGLB({ meshes: [{ positions: [0, 0, 0], colors: [1, 0] }] })).toThrow(/colors/);
    const rgba = encodeGLB({ meshes: [{ positions: [0, 0, 0], colors: { array: [1, 1, 1, 0.5], itemSize: 4 } }] });
    expect(parseGLB(rgba).json.accessors[1].type).toBe("VEC4");
  });
});

describe("flow-field-streamlines", () => {
  it("builds stream tubes with COLOR_0, _SPEED, _CP and normals, Y-up", async () => {
    const doc = seedDoc();
    const res = await streamSource.build({ doc, params: {} });
    expect(res.kind).toBe("glb");
    const parsed = parseGLB(res.glb);
    const mesh = parsed.json.meshes.find((m) => m.name === "Streamlines (tubes)");
    expect(mesh).toBeTruthy();
    const prim = mesh.primitives[0];
    expect(prim.mode).toBe(4);
    for (const k of ["POSITION", "NORMAL", "COLOR_0", "_SPEED", "_CP"]) expect(prim.attributes[k]).toBeTypeOf("number");
    const colors = accessorData(parsed, prim.attributes.COLOR_0);
    expect(colors.every((c) => c >= 0 && c <= 1)).toBe(true);
    // Y is up: the rake rows sit at doc z = 0, −0.6, −1.2, so glTF Y stays near that band,
    // while the domain's north–south extent (±6 m) is on Z
    const { min, max } = res.meta.bounds;
    expect(min[1]).toBeGreaterThan(-4.1);
    expect(max[1]).toBeLessThan(2);
    expect(max[2] - min[2]).toBeGreaterThan(8);
    expect(min[0]).toBeCloseTo(-6, 1);
    expect(res.meta.notes).toMatch(/45 streamlines/);
  });

  it("carries a legend for its colours", () => {
    const { json } = parseGLB(buildStreamlines(seedDoc(), { seedCount: 5, rakeRows: 1 }).glb);
    const legend = json.meshes[0].extras.legend;
    expect(legend).toMatchObject({ title: "Speed", unit: "m/s" });
    expect(legend.max).toBeGreaterThan(legend.min);
    expect(legend.stops[0]).toBe("#440154"); // viridis
  });

  it("lines mode is one LINES primitive", () => {
    const { glb } = buildStreamlines(seedDoc(), { tubes: false, seedCount: 5, rakeRows: 1 });
    const { json } = parseGLB(glb);
    const prim = json.meshes.find((m) => m.name === "Streamlines").primitives[0];
    expect(prim.mode).toBe(1);
    expect(prim.attributes.COLOR_0).toBeTypeOf("number");
  });

  it("seedCount 0 uses the document's seed count; a param overrides it", () => {
    const doc = seedDoc();
    doc.seeds.count = 7;
    expect(computeStreamlines(doc, { rakeRows: 1 }).seeds).toHaveLength(7);
    expect(computeStreamlines(doc, { rakeRows: 1, seedCount: 4 }).seeds).toHaveLength(4);
  });

  it("colours by Cp with an explicit range when asked", () => {
    const { range } = buildStreamlines(seedDoc(), { colorBy: "cp", autoRange: false, colorMin: -1, colorMax: 1, seedCount: 3 });
    expect(range).toEqual([-1, 1]);
  });

  it("does not mutate the doc", async () => {
    const doc = seedDoc();
    const before = stableStringify(doc);
    await streamSource.build({ doc, params: { seedCount: 3 } });
    expect(stableStringify(doc)).toBe(before);
  });

  it("survives an empty doc", async () => {
    const res = await streamSource.build({ doc: {}, params: {} });
    expect(parseGLB(res.glb).json.asset.version).toBe("2.0");
  });
});

describe("flow-field-slice", () => {
  it("builds a coloured horizontal grid with the body masked out", async () => {
    const doc = seedDoc();
    const masked = buildSlice(doc, { resolution: 44 });
    const open = buildSlice(doc, { resolution: 44, mask: false });
    const count = (r) => parseGLB(r.glb).json.accessors.find((a) => a.type === "SCALAR" && a.componentType !== 5126).count;
    expect(count(masked)).toBeLessThan(count(open));
    // hole ≈ body waterplane area (π/4 · 10 · 2.74 ≈ 21 m²) over a 22 × 12 m slice
    const frac = 1 - count(masked) / count(open);
    expect(frac).toBeGreaterThan(0.04);
    expect(frac).toBeLessThan(0.14);
    const parsed = parseGLB(masked.glb);
    const prim = parsed.json.meshes[0].primitives[0];
    expect(parsed.json.meshes[0].name).toBe("Slice z = 0 cm");
    for (const k of ["POSITION", "NORMAL", "COLOR_0", "_SPEED", "_CP"]) expect(prim.attributes[k]).toBeTypeOf("number");
    // flat at glTF Y = height
    const pos = parsed.json.accessors[prim.attributes.POSITION];
    expect(pos.min[1]).toBeCloseTo(0, 6);
    expect(pos.max[1]).toBeCloseTo(0, 6);
    const n = accessorData(parsed, prim.attributes.NORMAL);
    expect([n[0], n[1], n[2]]).toEqual([0, 1, 0]);
    const res = await sliceSource.build({ doc, params: { height: -1, resolution: 20 } });
    expect(res.meta.bounds.min[1]).toBeCloseTo(-1, 6);
  });

  it("is an unlit data plane with a legend, and fades the undisturbed flow when asked", () => {
    const plain = parseGLB(buildSlice(seedDoc(), { height: 0, resolution: 40 }).glb).json;
    const mat = plain.materials[plain.meshes[0].primitives[0].material];
    expect(mat.extensions?.KHR_materials_unlit).toEqual({});
    expect(plain.extensionsUsed).toContain("KHR_materials_unlit");
    expect(mat.alphaMode).toBeUndefined();
    const legend = plain.meshes[0].extras.legend;
    expect(legend.title).toMatch(/Cp/);
    expect(legend.min).toBeLessThan(0);
    expect(legend.max).toBeCloseTo(-legend.min);
    expect(legend.stops).toHaveLength(9);
    for (const c of legend.stops) expect(c).toMatch(/^#[0-9a-f]{6}$/);

    const r = buildSlice(seedDoc(), { height: 0, resolution: 40, fade: 0.8 });
    const parsed = parseGLB(r.glb);
    const prim = parsed.json.meshes[0].primitives[0];
    expect(parsed.json.materials[prim.material].alphaMode).toBe("BLEND");
    expect(parsed.json.accessors[prim.attributes.COLOR_0].type).toBe("VEC4");
    const rgba = accessorData(parsed, prim.attributes.COLOR_0);
    const cp = accessorData(parsed, prim.attributes._CP);
    let minA = 1, maxA = 0, strongest = 0, alphaAtStrongest = 0;
    for (let i = 0; i < cp.length; i++) {
      const a = rgba[i * 4 + 3];
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
      if (Math.abs(cp[i]) > strongest) { strongest = Math.abs(cp[i]); alphaAtStrongest = a; }
    }
    expect(minA).toBeCloseTo(0.2, 2); // the corners of the domain: undisturbed and at the edge
    expect(maxA).toBeCloseTo(1, 5);
    expect(alphaAtStrongest).toBeGreaterThan(0.9);
    expect(r.meta.notes).toMatch(/faded 80%/);
  });

  it("clips the mask along the body outline, not whole cells", () => {
    const r = buildSlice(seedDoc(), { height: 0, resolution: 60 });
    expect(r.grid.positions.length / 3).toBeGreaterThan(r.grid.gridVertices);
  });

  it("centres an auto Cp range on 0 for the diverging map", () => {
    const { range } = buildSlice(seedDoc(), { resolution: 20 });
    expect(range[0]).toBeCloseTo(-range[1], 9);
    expect(buildSlice(seedDoc(), { resolution: 20, colormap: "viridis" }).range[0]).not.toBeCloseTo(-buildSlice(seedDoc(), { resolution: 20, colormap: "viridis" }).range[1], 3);
  });

  it("clamps the height into the domain", () => {
    const { meta } = buildSlice(seedDoc(), { height: 99, resolution: 10, mask: false });
    expect(meta.bounds.max[1]).toBeCloseTo(4, 6);
  });
});

describe("fingerprint", () => {
  it("changes with the flow but not the title or key order", () => {
    const a = seedDoc();
    const fp = flowFingerprint(a);
    expect(streamSource.fingerprint(a)).toBe(fp);
    expect(sliceSource.fingerprint(a)).toBe(fp);
    const retitled = { ...a, title: "Something else" };
    expect(flowFingerprint(retitled)).toBe(fp);
    const reordered = { seeds: a.seeds, domain: a.domain, elements: { stern: a.elements.stern, bow: a.elements.bow }, freestream: a.freestream };
    expect(flowFingerprint(reordered)).toBe(fp);
    for (const change of [
      (d) => (d.freestream.speed = 3),
      (d) => (d.freestream.headingDeg = 5),
      (d) => (d.elements.bow.strength = 10),
      (d) => (d.elements.bow.position[1] = 0.1),
      (d) => (d.domain.max[0] = 20),
      (d) => (d.seeds.count = 3),
      (d) => (d.elements.extra = { kind: "vortex-line", position: [0, 0, 0], strength: 1 }),
    ]) {
      const d = JSON.parse(JSON.stringify(a));
      change(d);
      expect(flowFingerprint(d)).not.toBe(fp);
    }
  });
});

describe("plugins", () => {
  it("are structured-clone safe apart from load()", () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(() => structuredClone(meta)).not.toThrow();
    }
    const ids = plugins.filter((p) => p.type === "scene:source").map((p) => p.id);
    expect(ids).toEqual(["flow-field-streamlines", "flow-field-slice"]);
  });

  it("param defaults match what the builders assume", async () => {
    const { STREAMLINE_DEFAULTS } = await import("./build-streamlines.js");
    const { SLICE_DEFAULTS } = await import("./build-slice.js");
    const defaults = (id) => Object.fromEntries(plugins.find((p) => p.id === id).params.map((s) => [s.key, s.default]));
    expect(defaults("flow-field-streamlines")).toEqual({ ...STREAMLINE_DEFAULTS });
    expect(defaults("flow-field-slice")).toEqual({ ...SLICE_DEFAULTS });
  });

  it("load() resolves to the implementations", async () => {
    for (const p of plugins.filter((p) => p.type === "scene:source")) {
      const impl = await p.load();
      expect(typeof impl.build).toBe("function");
      expect(typeof impl.fingerprint).toBe("function");
    }
    const dt = await plugins[0].load();
    const d = {};
    dt.init(d);
    expect(d).toMatchObject(JSON.parse(JSON.stringify(RANKINE_SEED)));
    expect(d["@patchwork"]).toBeUndefined(); // the host stamps that
  });
});

describe("build size limits", () => {
  it("keeps the declared maxima in step with the clamps", () => {
    const byId = Object.fromEntries(plugins.map((p) => [p.id, p]));
    const param = (id, key) => byId[id].params.find((q) => q.key === key);
    expect(param("flow-field-slice", "resolution").max).toBe(MAX_SLICE_RESOLUTION);
    expect(param("flow-field-streamlines", "seedCount").max).toBe(MAX_SEEDS_PER_ROW);
    expect(param("flow-field-streamlines", "rakeRows").max).toBe(MAX_RAKE_ROWS);
  });

  it("caps the streamline mesh at the largest rake and finest step", () => {
    const params = { seedCount: 999, rakeRows: 99, step: 0.01, maxSteps: 5000 };
    const r = buildStreamlines(seedDoc(), params);
    const prim = parseGLB(r.glb).json;
    const pos = prim.accessors[prim.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.count).toBeLessThanOrEqual(MAX_MESH_VERTICES);
    expect(r.glb.byteLength).toBeLessThan(3.5e6);
    expect(r.meta.notes).toMatch(/thinned/);
    expect(r.lines.length).toBeGreaterThan(100);
  });

  it("clamps the slice resolution", () => {
    const r = buildSlice(seedDoc(), { resolution: 1000 });
    expect(r.grid.nx).toBeLessThanOrEqual(MAX_SLICE_RESOLUTION);
  });
});

