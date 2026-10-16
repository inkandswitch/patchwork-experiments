// Ported from the old patchwork-slicer (GLB reading), plus the kit encoder's units.
import { describe, it, expect } from "vitest";
import { parseGlb } from "./glb-read.js";
import { resolveUnits, maxExtent, toPrintSpace } from "./units.js";
import { openEdges } from "./mesh.js";
import { bounds } from "./stl.js";
import { buildToolpaths } from "./toolpaths.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { boxGlb } from "./test/models.js";

// A hand-built GLB with no asset.extras (a "foreign" GLB), optionally translated by its node.
function rawBoxGlb({ extras, translation } = {}) {
  const w = 0.04, h = 0.03, d = 0.02;
  const V = [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0], [0, 0, d], [w, 0, d], [w, h, d], [0, h, d]];
  const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  const pos = new Float32Array(V.flat());
  const idx = new Uint16Array(I);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength + 2);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: "2.0", extras },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: I.length, type: "SCALAR" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  const js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  const jb = new Uint8Array(js.length + pad).fill(0x20);
  jb.set(js);
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  const o = 20 + jb.length;
  dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
  return out;
}

describe("glb", () => {
  it("reads indexed triangles and applies node transforms", () => {
    const { tris } = parseGlb(rawBoxGlb({ translation: [1, 2, 3] }));
    expect(tris.length / 9).toBe(12);
    const b = bounds(tris);
    expect(b.min[0]).toBeCloseTo(1); expect(b.min[1]).toBeCloseTo(2); expect(b.min[2]).toBeCloseTo(3);
  });

  it("converts Y-up metres to Z-up millimetres", () => {
    const { tris, units } = parseGlb(rawBoxGlb());
    expect(units).toBe(null);
    const u = resolveUnits({ kind: "glb", fileUnits: units, settings: { glbUnit: "auto" }, extent: maxExtent(tris) });
    expect(u).toMatchObject({ unit: "m", source: "guess", guessed: true });
    const b = bounds(toPrintSpace(tris, u.unit, u.up));
    expect(b.max[0] - b.min[0]).toBeCloseTo(40, 3); // x
    expect(b.max[1] - b.min[1]).toBeCloseTo(20, 3); // was z
    expect(b.max[2] - b.min[2]).toBeCloseTo(30, 3); // was y (height)
  });

  it("honours asset.extras.units", () => {
    const { tris, units } = parseGlb(rawBoxGlb({ extras: { units: "mm" } }));
    expect(units).toBe("mm");
    expect(resolveUnits({ kind: "glb", fileUnits: units, settings: { glbUnit: "auto" }, extent: maxExtent(tris) })).toMatchObject({ unit: "mm", source: "file", guessed: false });
  });

  it("reads the kit encoder's GLBs as metres, whatever their size", () => {
    const g = parseGlb(boxGlb(10, 2, 3)); // a 10 m hull is still metres
    expect(g.units).toBe("m");
    const u = resolveUnits({ kind: "glb", fileUnits: g.units, settings: { glbUnit: "auto" }, extent: maxExtent(g.tris) });
    expect(u).toMatchObject({ unit: "m", guessed: false });
    const b = bounds(toPrintSpace(g.tris, u.unit, u.up));
    expect(b.max[0] - b.min[0]).toBeCloseTo(10000, 1);
  });

  it("detects watertight vs open meshes", () => {
    const { tris } = parseGlb(rawBoxGlb());
    expect(openEdges(tris)).toBe(0);
    expect(openEdges(tris.slice(0, tris.length - 9))).toBeGreaterThan(0);
  });

  it("rejects non-GLB input clearly", () => {
    expect(() => parseGlb(new Uint8Array(100))).toThrow(/Not a GLB/);
  });

  it("slices a parsed GLB end to end", async () => {
    const { tris } = parseGlb(rawBoxGlb());
    const tp = await buildToolpaths(toPrintSpace(tris, "m", "y"), { ...DEFAULT_SETTINGS });
    expect(tp.layers.length).toBe(150);
    expect(tp.layers[75].rings.length).toBe(3);
  });
});
