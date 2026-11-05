// The provider metadata and the builds' clamps come from one table, and agree
// with how the scene host coerces params; seeds.plane is gone.
import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { STREAMLINE_PARAMS, SLICE_PARAMS, coerceParams, paramDefaults } from "./params.js";
import { streamlineParams } from "./build-streamlines.js";
import { sliceParams } from "./build-slice.js";
import { flowFingerprint } from "./fingerprint.js";
import { FlowFieldDatatype } from "./datatype.js";

const sources = plugins.filter((p) => p.type === "scene:source");

describe("provider metadata", () => {
  it("declares a top-level cost and an integer version, and a cost on every param", () => {
    expect(sources.map((p) => p.id).sort()).toEqual(["flow-field-slice", "flow-field-streamlines"]);
    for (const p of sources) {
      expect(p.cost).toBe("expensive");
      expect(p.version).toBe(2);
      for (const s of p.params) expect(["cheap", "expensive"], `${p.id}.${s.key}`).toContain(s.cost);
      expect(() => structuredClone({ ...p, load: undefined })).not.toThrow();
    }
    const byKey = (id) => Object.fromEntries(sources.find((p) => p.id === id).params.map((s) => [s.key, s]));
    expect(byKey("flow-field-streamlines").step.cost).toBe("expensive");
    expect(byKey("flow-field-streamlines").maxSteps.cost).toBe("expensive");
    expect(byKey("flow-field-slice").resolution.cost).toBe("expensive");
    expect(byKey("flow-field-slice").mask.cost).toBe("expensive");
  });

  it("is the very table the builds clamp with", () => {
    expect(sources.find((p) => p.id === "flow-field-streamlines").params).toBe(STREAMLINE_PARAMS);
    expect(sources.find((p) => p.id === "flow-field-slice").params).toBe(SLICE_PARAMS);
  });
});

describe("clamps and fallbacks agree with the metadata", () => {
  it("falls back to the declared defaults", () => {
    const junk = (specs) => Object.fromEntries(specs.map((s) => [s.key, s.kind === "boolean" ? undefined : "nonsense"]));
    expect(streamlineParams(junk(STREAMLINE_PARAMS))).toEqual(paramDefaults(STREAMLINE_PARAMS));
    expect(sliceParams(junk(SLICE_PARAMS))).toEqual(paramDefaults(SLICE_PARAMS));
    const p = streamlineParams({ tubeRadius: NaN, colorMax: null, rakeRows: "x" });
    expect(p.tubeRadius).toBe(0.05);
    expect(p.colorMax).toBe(3);
    expect(p.rakeRows).toBe(3);
  });

  it("clamps to the declared bounds, rounding integers like the host", () => {
    const lo = streamlineParams({ tubeRadius: 1e-4, step: 1e-4, maxSteps: 1, seedCount: -3, rakeRows: 0, hugLines: -1, seedHeight: -99, rowSpacing: -99 });
    expect(lo).toMatchObject({ tubeRadius: 0.005, step: 0.01, maxSteps: 10, seedCount: 0, rakeRows: 1, hugLines: 0, seedHeight: -10, rowSpacing: -5 });
    const hi = streamlineParams({ tubeRadius: 9, step: 9, maxSteps: 2e4, seedCount: 99, rakeRows: 99, hugLines: 99 });
    expect(hi).toMatchObject({ tubeRadius: 0.5, step: 1, maxSteps: 5000, seedCount: 40, rakeRows: 8, hugLines: 8 });
    expect(streamlineParams({ seedCount: 2.6 }).seedCount).toBe(3);
    expect(sliceParams({ resolution: 4 }).resolution).toBe(8);
    expect(sliceParams({ resolution: 1e4 }).resolution).toBe(160);
    expect(sliceParams({ fade: 2, height: -50 })).toMatchObject({ fade: 1, height: -10 });
    expect(sliceParams({ colorBy: "speed", colormap: "turbo", bodyModel: "slender-body-3d" })).toMatchObject({ colorBy: "speed", colormap: "turbo", bodyModel: "slender-body-3d" });
    expect(sliceParams({ colormap: "rainbow" }).colormap).toBe("auto");
  });

  it("is idempotent: clamped params clamp to themselves", () => {
    const once = coerceParams(STREAMLINE_PARAMS, { step: 0.001, maxSteps: 1e6, colorBy: "cp" });
    expect(coerceParams(STREAMLINE_PARAMS, once)).toEqual(once);
  });
});

describe("seeds.plane", () => {
  it("is no longer seeded, and an old doc's value doesn't change the fingerprint", () => {
    const d = {};
    FlowFieldDatatype.init(d);
    expect(d.seeds).toEqual({ count: 15 });
    const old = { ...d, seeds: { count: 15, plane: "upstream" } };
    expect(flowFingerprint(old)).toBe(flowFingerprint(d));
    expect(flowFingerprint({ ...d, seeds: { count: 16 } })).not.toBe(flowFingerprint(d));
  });
});
