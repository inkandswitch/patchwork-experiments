// Ported from the old patchwork-slicer: the slicing engine end to end.
import { describe, it, expect } from "vitest";
import { parseStl } from "./stl.js";
import { buildToolpaths } from "./toolpaths.js";
import { generateGcode } from "./gcode.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { hexPrism, toBinaryStl } from "./test/models.js";

describe("slicer", () => {
  it("round-trips binary STL", () => {
    const t = hexPrism(20, 10);
    expect(parseStl(toBinaryStl(t)).length).toBe(t.length);
  });

  it("reads ASCII STL", () => {
    const text = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    expect(Array.from(parseStl(new TextEncoder().encode(text)))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("slices a hex prism into the right layers with closed walls", async () => {
    const tp = await buildToolpaths(hexPrism(20, 10), { ...DEFAULT_SETTINGS });
    expect(tp.layers.length).toBe(50);
    expect(tp.size[2]).toBeCloseTo(10);
    const L = tp.layers[25];
    expect(L.rings.length).toBe(3);
    expect(L.rings[0].length).toBe(1);
    expect(L.sparse.length).toBeGreaterThan(0);
    expect(tp.layers[0].solid.length).toBeGreaterThan(0);
    expect(tp.layers[0].sparse.length).toBe(0);
  });

  it("honours a first layer height separate from the layer height", async () => {
    const tp = await buildToolpaths(hexPrism(20, 10), { ...DEFAULT_SETTINGS, layerHeight: 0.1, firstLayerHeight: 0.3 });
    expect(tp.layers[0].z).toBeCloseTo(0.3);
    expect(tp.layers[1].z).toBeCloseTo(0.4);
    expect(tp.layers.length).toBe(98);
  });

  it("emits G-code with plausible extrusion", async () => {
    const s = { ...DEFAULT_SETTINGS };
    const tp = await buildToolpaths(hexPrism(20, 10), s);
    const g = generateGcode(tp, s);
    expect(g.gcode).toContain(";LAYER:49");
    expect(g.gcode).toContain("M104 S0");
    expect(g.gcode).toContain(`M104 S${s.nozzleTemp}`);
    // hex prism volume ~ 2.598*r^2*h = 10392 mm^3 at 15% infill + walls; filament should be a few grams
    expect(g.grams).toBeGreaterThan(3);
    expect(g.grams).toBeLessThan(15);
    expect(g.time).toBeGreaterThan(300);
  });

  it("rejects models larger than the bed, pointing at units and scale", async () => {
    await expect(buildToolpaths(hexPrism(400, 10), { ...DEFAULT_SETTINGS })).rejects.toThrow(/build volume.*Scale/);
  });
});
