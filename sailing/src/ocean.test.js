import { describe, it, expect } from "vitest";
import { pmSea, seaWaves, waveComponents, whitecapCoverage } from "./ocean.js";
import { downwind } from "./wind.js";

const G = 9.81;
const sea10 = seaWaves({ wind: { speed: 10, from: 0 }, seed: 3 });

// The spectrum (how a wind becomes waves). What the waves do once made is
// the water package's (its surface.test.js); sailing only makes them.
describe("the waves", () => {
  it("obey deep-water dispersion, ω² = g·k", () => {
    for (const c of sea10.components) expect(c.omega ** 2 / (G * c.k)).toBeCloseTo(1, 9);
  });

  it("are at most 32, with unit directions", () => {
    expect(sea10.components.length).toBeLessThanOrEqual(32);
    expect(sea10.components.length).toBeGreaterThan(8);
    for (const c of sea10.components) expect(Math.hypot(...c.dir)).toBeCloseTo(1, 9);
    expect(waveComponents({ speed: 10, from: 0 }, 1, 1, 100).length).toBe(32);
  });

  it("sharpen their crests but can never fold the surface: Σ Q·k·A < 1, Q ≤ 1", () => {
    for (const scale of [0.5, 1, 3]) {
      const sea = seaWaves({ wind: { speed: 12, from: 30 }, seed: 9, scale });
      const sum = sea.components.reduce((s, c) => s + c.steep * c.k * c.amp, 0);
      expect(sum).toBeLessThan(1);
      expect(sum).toBeGreaterThan(0.4 * Math.min(1, scale));
      for (const c of sea.components) expect(c.steep).toBeLessThanOrEqual(1);
    }
  });

  it("carry the spectrum's energy: Hs = 4·√m0, about 2 m in a 10 m/s wind", () => {
    const pm = pmSea(10);
    expect(pm.hs).toBeGreaterThan(1.5);
    expect(pm.hs).toBeLessThan(2.5);
    expect(sea10.stats.hs).toBeCloseTo(pm.hs, 9);
    // the components hold (nearly) all of it
    const m0 = sea10.components.reduce((s, c) => s + (c.amp * c.amp) / 2, 0);
    expect(m0 / pm.m0).toBeGreaterThan(0.99);
    expect(m0 / pm.m0).toBeLessThanOrEqual(1);
    // the peak's wavelength: about 80 m at 10 m/s
    expect(sea10.stats.peakWavelength).toBeGreaterThan(60);
    expect(sea10.stats.peakWavelength).toBeLessThan(110);
  });

  it("travel downwind, whichever way the wind comes from", () => {
    for (const from of [0, 90, 225, 300]) {
      const sea = seaWaves({ wind: { speed: 9, from }, seed: 2 });
      const [wx, wz] = downwind(from);
      let mx = 0, mz = 0;
      for (const c of sea.components) {
        mx += c.amp * c.amp * c.dir[0];
        mz += c.amp * c.amp * c.dir[1];
      }
      const l = Math.hypot(mx, mz);
      expect((mx * wx + mz * wz) / l).toBeGreaterThan(0.9);
    }
  });

  it("are a function of the seed: the same seed is the same sea, another is another", () => {
    const a = seaWaves({ wind: { speed: 8, from: 10 }, seed: "harbour" });
    const b = seaWaves({ wind: { speed: 8, from: 10 }, seed: "harbour" });
    const c = seaWaves({ wind: { speed: 8, from: 10 }, seed: "open sea" });
    expect(a.components).toEqual(b.components);
    expect(a.components).not.toEqual(c.components);
  });

  it("a calm has no waves", () => {
    for (const wind of [{ speed: 0, from: 0 }, {}, { speed: -3 }]) {
      const sea = seaWaves({ wind, seed: 1 });
      expect(sea.components).toEqual([]);
      expect(sea.stats.hs).toBe(0);
      expect(sea.stats.whitecaps).toBe(0);
    }
  });
});

describe("whitecaps", () => {
  it("none in a light or gentle breeze, a couple of percent in a strong one", () => {
    expect(whitecapCoverage(0)).toBe(0);
    expect(whitecapCoverage(5)).toBe(0);
    expect(whitecapCoverage(12)).toBeGreaterThan(0.01);
    expect(whitecapCoverage(12)).toBeLessThan(0.03);
    expect(whitecapCoverage(20)).toBeGreaterThan(whitecapCoverage(12));
  });
});
