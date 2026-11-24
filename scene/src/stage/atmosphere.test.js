// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CLOUDS, LIGHTS, cleanAtmosphere, clearColourOf, cloudAt, lighting } from "./atmosphere.js";

describe("cleanAtmosphere", () => {
  it("checks colours and numbers, makes the sun's direction unit, and is null when nothing is usable", () => {
    expect(cleanAtmosphere(null)).toBeNull();
    expect(cleanAtmosphere({ weather: "rain" })).toBeNull();
    expect(cleanAtmosphere({ sky: { top: "blue" }, fog: { color: "#fff", near: 5, far: 2 }, exposure: -1 })).toBeNull();
    const a = cleanAtmosphere({ sky: { top: "#336699", bottom: 0x102030 }, fog: { far: 80 }, sun: { direction: [0, 3, 4], intensity: "2", shadows: 1 }, exposure: 0.5 });
    // a sky missing a colour takes a neighbour's
    expect(a.sky).toEqual({ top: "#336699", horizon: "#336699", bottom: "#102030" });
    // fog without a colour takes the horizon's, near defaults to 0
    expect(a.fog).toEqual({ color: "#336699", near: 0, far: 80 });
    // shadows only when exactly true
    expect(a.sun).toEqual({ direction: [0, 0.6, 0.8], color: "#ffffff", intensity: 2, shadows: false });
    expect(a.exposure).toBe(0.5);
    // fog with no colour of its own and no sky: none
    expect(cleanAtmosphere({ fog: { far: 80 } })).toBeNull();
  });

  it("a sun with no usable direction stands where the stage's key light does, at its intensity", () => {
    const k = Math.hypot(...LIGHTS.keyFrom);
    for (const sun of [{}, { direction: [0, 0, 0] }, { direction: [1, "x", 0] }, { direction: [1, 2] }]) {
      expect(cleanAtmosphere({ sun }).sun).toEqual({ direction: LIGHTS.keyFrom.map((v) => v / k), color: "#ffffff", intensity: LIGHTS.key, shadows: false });
    }
    expect(cleanAtmosphere({ sun: { intensity: -1 } }).sun.intensity).toBe(LIGHTS.key);
    expect(cleanAtmosphere({ sun: { intensity: 0 } }).sun.intensity).toBe(0);
  });

  it("takes clouds over a sky only, with a cover over 0, its numbers held to their ranges and defaulted", () => {
    const sky = { top: "#c4cacc", horizon: "#959ea1" };
    expect(cleanAtmosphere({ clouds: { cover: 1 } })).toBeNull();
    expect(cleanAtmosphere({ sky, clouds: { cover: 0 } }).clouds).toBeUndefined();
    expect(cleanAtmosphere({ sky, clouds: { cover: "x" } }).clouds).toBeUndefined();
    expect(cleanAtmosphere({ sky, clouds: { cover: 2, contrast: 9 } }).clouds).toEqual({ cover: 1, contrast: 0.5, scale: CLOUDS.scale, base: CLOUDS.base });
    expect(cleanAtmosphere({ sky, clouds: { cover: 0.35, contrast: 0.25, scale: 700, base: 1200 } }).clouds).toEqual({ cover: 0.35, contrast: 0.25, scale: 700, base: 1200 });
    expect(cleanAtmosphere({ sky, clouds: { cover: 0.5, scale: -1 } }).clouds).toBeUndefined();
  });
});

describe("cloudAt", () => {
  it("moves the sky's luminance by at most ±contrast, and below the horizon not at all (64 directions × 3 covers × 5 noise levels)", () => {
    const dirs = [];
    for (let a = 0; a < 8; a++)
      for (let e = 0; e < 8; e++) {
        const el = -0.6 + (e / 7) * 2.1, az = (a / 8) * Math.PI * 2;
        dirs.push([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]);
      }
    for (const cover of [0.35, 0.7, 1])
      for (const level of [0, 0.25, 0.5, 0.75, 1]) {
        const c = { cover, contrast: 0.2, scale: 600, base: 800 };
        for (const d of dirs) {
          const { factor, white } = cloudAt(d, c, () => level);
          expect(factor).toBeGreaterThanOrEqual(1 - c.contrast - 1e-12);
          expect(factor).toBeLessThanOrEqual(1 + c.contrast + 1e-12);
          expect(white).toBeGreaterThanOrEqual(0);
          expect(white).toBeLessThanOrEqual(0.6);
          if (d[1] <= 0) expect([factor, white]).toEqual([1, 0]);
          // at the horizon the sky is its gradient (the fog meets it there)
          if (Math.abs(d[1]) < 0.03) expect(factor).toBe(1);
        }
      }
  });
});

describe("lighting", () => {
  it("no atmosphere is exactly the stage's own lights", () => {
    expect(lighting(null)).toEqual({
      hemisphere: { intensity: LIGHTS.hemisphere, sky: "#ffffff", ground: "#3a3a3a" },
      key: { intensity: LIGHTS.key, color: "#ffffff", from: [...LIGHTS.keyFrom], shadows: false },
      headlight: LIGHTS.headlight,
      environment: LIGHTS.environment,
    });
  });

  it("a sun replaces the key light and dims the headlight to a third, a sky tints the sky light, exposure scales every light", () => {
    const l = lighting(cleanAtmosphere({ sky: { top: "#4080c0", bottom: "#806040" }, sun: { direction: [0, 1, 0], color: "#ffeecc", intensity: 2, shadows: true }, exposure: 2 }));
    expect(l.key).toEqual({ intensity: 4, color: "#ffeecc", from: [0, 1, 0], shadows: true });
    expect(l.headlight).toBeCloseTo((LIGHTS.headlight / 3) * 2);
    expect(l.hemisphere).toEqual({ intensity: LIGHTS.hemisphere * 2, sky: "#4080c0", ground: "#806040" });
    expect(l.environment).toBeCloseTo(LIGHTS.environment * 2);
  });

  it("what shows where nothing is drawn: fog's colour only with fog and no sky", () => {
    expect(clearColourOf(null)).toBeNull();
    expect(clearColourOf(cleanAtmosphere({ fog: { color: "#808080", far: 50 } }))).toBe("#808080");
    expect(clearColourOf(cleanAtmosphere({ sky: { top: "#336699" }, fog: { far: 50 } }))).toBeNull();
  });
});
