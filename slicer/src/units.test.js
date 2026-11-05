import { describe, it, expect } from "vitest";
import { fitScale, maxExtent, resolveUnits, toPrintSpace } from "./units.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { boxTris } from "./test/models.js";

const s = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });

describe("units resolution", () => {
  it("a scene render is metres, Y up, whatever the settings say", () => {
    expect(resolveUnits({ kind: "render", settings: s({ glbUnit: "mm", stlUnit: "in" }), extent: 10 })).toMatchObject({ unit: "m", up: "y", source: "render", guessed: false });
  });

  it("a 10 m render slices as 10 m, not 10 mm", () => {
    const u = resolveUnits({ kind: "render", settings: s(), extent: 10 });
    const t = toPrintSpace(boxTris(10, 1, 1), u.unit, "z");
    expect(maxExtent(t)).toBeCloseTo(10000);
  });

  it("a GLB's own asset.extras.units beats the setting", () => {
    expect(resolveUnits({ kind: "glb", fileUnits: "mm", settings: s({ glbUnit: "m" }) })).toMatchObject({ unit: "mm", source: "file" });
    expect(resolveUnits({ kind: "glb", fileUnits: "metres", settings: s() })).toMatchObject({ unit: "m", source: "file" });
  });

  it("a GLB that doesn't say uses the setting, then a flagged guess", () => {
    expect(resolveUnits({ kind: "glb", settings: s({ glbUnit: "cm" }), extent: 50 })).toMatchObject({ unit: "cm", source: "setting", guessed: false });
    const big = resolveUnits({ kind: "glb", settings: s(), extent: 50 });
    expect(big).toMatchObject({ unit: "mm", source: "guess", guessed: true });
    expect(big.label).toMatch(/millimetres \(guessed/);
    expect(resolveUnits({ kind: "glb", settings: s(), extent: 0.3 })).toMatchObject({ unit: "m", guessed: true });
  });

  it("an STL is millimetres, Z up, unless the settings say otherwise", () => {
    expect(resolveUnits({ kind: "stl", settings: s(), extent: 5000 })).toMatchObject({ unit: "mm", up: "z", source: "setting", guessed: false });
    expect(resolveUnits({ kind: "stl", settings: s({ stlUnit: "in", stlUp: "y" }) })).toMatchObject({ unit: "in", up: "y" });
  });

  it("toPrintSpace applies scale and the Y-up → Z-up turn", () => {
    const t = toPrintSpace(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), "m", "y", 0.5);
    expect(Array.from(t).map((v) => Math.round(v) + 0)).toEqual([0, 0, 0, 500, 0, 0, 0, 0, 500]);
  });

  it("fitScale fits the bed with a margin and reads well", () => {
    const k = fitScale([10000, 2000, 3000], { bedX: 325, bedY: 320, bedZ: 325 });
    expect(k).toBeLessThanOrEqual(0.0309);
    expect(k).toBeGreaterThan(0.03);
    expect(String(k).length).toBeLessThan(8);
  });
});
