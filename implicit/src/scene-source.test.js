import { describe, expect, it } from "vitest";
import source, { onMainThread, runJob } from "./scene-source.js";
import { parseGLB } from "./mesh/glb.js";
import { fingerprintDoc } from "./doc.js";

const doc = {
  "@patchwork": { type: "implicit-surface" },
  title: "Test ball",
  source: "sphere(0.2)",
  bounds: { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.3] },
  notes: "",
};

describe("implicit-mesh provider", () => {
  it("fingerprints exactly what build() reads", () => {
    const fp = source.fingerprint(doc);
    expect(fp).toBe(fingerprintDoc({ ...doc }));
    expect(source.fingerprint({ ...doc, notes: "changed" })).toBe(fp);
    expect(source.fingerprint({ ...doc, source: "sphere(0.21)" })).not.toBe(fp);
    expect(source.fingerprint({ ...doc, bounds: { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.31] } })).not.toBe(fp);
    expect(source.fingerprint({ ...doc, title: "Renamed" })).not.toBe(fp);
    expect(source.fingerprint({})).toMatch(/^v\d+:[0-9a-f]{14}$/);
  });

  it("builds a GLB (main-thread fallback when there is no Worker)", async () => {
    const r = await source.build({ doc, params: { resolution: 24, smoothNormals: true } });
    expect(r.kind).toBe("glb");
    expect(r.glb).toBeInstanceOf(Uint8Array);
    const { json } = parseGLB(r.glb);
    expect(json.meshes[0].name).toBe("Test ball");
    expect(r.meta.bounds.max[1]).toBeCloseTo(0.2, 1);
    expect(r.meta.notes).toMatch(/triangles/);
  });

  it("writes the surface finish as a PBR material, and none for matte", async () => {
    const matte = parseGLB((await source.build({ doc, params: { resolution: 16 } })).glb).json;
    expect(matte.materials).toBeUndefined();
    const metal = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "metal" } })).glb).json;
    const m = metal.materials[metal.meshes[0].primitives[0].material].pbrMetallicRoughness;
    expect(m.metallicFactor).toBe(1);
    expect(m.roughnessFactor).toBeLessThan(0.5);
    expect(m.baseColorFactor).toEqual([1, 1, 1, 1]); // white, so the scene's colour tints it
    const satin = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "satin" } })).glb).json;
    expect(satin.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    // an unknown finish is matte, not an error
    const odd = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "velvet" } })).glb).json;
    expect(odd.materials).toBeUndefined();
  });

  it("uses defaults for missing params and does not mutate the doc", async () => {
    const frozen = structuredClone(doc);
    Object.freeze(frozen.bounds.min);
    Object.freeze(frozen.bounds.max);
    Object.freeze(frozen.bounds);
    Object.freeze(frozen);
    const r = await runJob(
      { source: frozen.source, bounds: frozen.bounds, resolution: 16, name: frozen.title },
      { useWorker: false },
    );
    expect(r.stats.resolution).toBe(16);
    await expect(source.build({ doc: frozen, params: {} })).resolves.toMatchObject({ kind: "glb" });
  });

  it("rejects with a positioned message for a broken source", async () => {
    await expect(onMainThread({ source: "sphere(1", bounds: doc.bounds })).rejects.toThrow(/line 1, col 7/);
  });

  it("falls back to the main thread when the worker cannot start", async () => {
    const saved = globalThis.Worker;
    globalThis.Worker = class {
      constructor() {
        throw new Error("blocked by CSP");
      }
    };
    try {
      const r = await runJob({ source: "sphere(0.1)", bounds: doc.bounds, resolution: 12 });
      expect(r.stats.triangles).toBeGreaterThan(0);
    } finally {
      globalThis.Worker = saved;
    }
  });
});
