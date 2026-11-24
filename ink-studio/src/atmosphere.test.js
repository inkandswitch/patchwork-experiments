import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as toolkit from "./generated/toolkit.js";
import { loadScene } from "./load-scene.js";
import { inkAtmosphere, turn } from "./atmosphere.js";

const example = async (main) => {
  const files = { [main]: readFileSync(new URL(`../vendor/ink-studio/examples/${main}`, import.meta.url), "utf8") };
  const scene = await loadScene(toolkit, { kind: "js", main, files });
  return scene.build(scene.seed);
};

describe("turn", () => {
  it("turns by the rotation and ignores scale", () => {
    // 90° about y, scaled 3: +x goes to -z
    const m = [0, 0, -3, 0, 0, 3, 0, 0, 3, 0, 0, 0, 5, 6, 7, 1];
    const d = turn(m, [1, 0, 0]);
    expect(d[0]).toBeCloseTo(0);
    expect(d[2]).toBeCloseTo(-1);
  });
});

describe("inkAtmosphere", () => {
  it("gives a world without a sky its background, flat, and no sun", async () => {
    const w = await example("sculpt.js");
    expect(inkAtmosphere(toolkit, w, 0)).toEqual({ sky: { top: "#080b10", horizon: "#080b10", bottom: "#080b10" } });
  });
  it("samples a sky environment: hex colours, a unit sun", async () => {
    const a = inkAtmosphere(toolkit, await example("weather-front.js"), 2);
    for (const k of ["top", "horizon", "bottom"]) expect(a.sky[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect(Math.hypot(...a.sun.direction)).toBeCloseTo(1);
    expect(a.sun.intensity).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // plain JSON, as an ambient must be
  });
});

import { waterObjects } from "./atmosphere.js";
describe("waterObjects", () => {
  it("makes one box per water body, its origin the surface, attached to the ink object", () => {
    const world = { water: { media: [{ id: "bay", kind: "water", bounds: { min: [-12, -2, -22], max: [17, -0.13, 11] } }] } };
    const [o] = waterObjects(world, "ink1");
    expect(o.parent).toBe("ink1");
    expect(o.transform.position).toEqual([2.5, -0.13, -5.5]);
    expect(o.traits.water.size).toEqual([29, 1.87, 33]);
    expect(o.sourceUrl).toBeNull();
  });
  it("makes none for a dry world", () => {
    expect(waterObjects({}, "x")).toEqual([]);
  });
});
