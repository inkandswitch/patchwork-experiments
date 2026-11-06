import { describe, it, expect } from "vitest";
import { createOcean, pmSea, waveComponents, whitecapCoverage } from "./ocean.js";
import { downwind } from "./wind.js";

const G = 9.81;
const sea10 = createOcean({ wind: { speed: 10, from: 0 }, seed: 3 });

/** a seeded stream of numbers in [0, 1), so the tests sample the same points every run */
function stream(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

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
      const sea = createOcean({ wind: { speed: 12, from: 30 }, seed: 9, scale });
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

  it("measured over many samples, have the spectrum's significant wave height, scaled by `scale`", () => {
    for (const [speed, scale] of [
      [10, 1],
      [10, 0.5],
      [6, 1],
    ]) {
      const sea = createOcean({ wind: { speed, from: 45 }, seed: 11, scale });
      const r = stream(5);
      let s1 = 0, s2 = 0;
      const n = 6000;
      for (let i = 0; i < n; i++) {
        const h = sea.heightAt(r() * 3000, r() * 3000, r() * 2000);
        s1 += h;
        s2 += h * h;
      }
      const variance = s2 / n - (s1 / n) ** 2;
      const hs = 4 * Math.sqrt(variance);
      expect(hs / sea.stats.hs).toBeGreaterThan(0.9);
      expect(hs / sea.stats.hs).toBeLessThan(1.1);
      expect(sea.stats.hs).toBeCloseTo(pmSea(speed).hs * scale, 9);
    }
  });

  it("travel downwind, whichever way the wind comes from", () => {
    for (const from of [0, 90, 225, 300]) {
      const sea = createOcean({ wind: { speed: 9, from }, seed: 2 });
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

  it("a crest moves downwind: the height pattern a moment later is the same pattern shifted downwind", () => {
    // a long-crested sea (one wave) makes the shift exact; the full sea's peak wave dominates the same way
    const sea = createOcean({ wind: { speed: 10, from: 90 }, seed: 4 });
    const big = sea.components.reduce((a, c) => (c.amp > a.amp ? c : a));
    expect(big.dir[0] * downwind(90)[0] + big.dir[1] * downwind(90)[1]).toBeGreaterThan(0.7);
    const c = big.omega / big.k; // phase speed
    // correlate h(x, t) with h(x + c·dt·d, t + dt) and with h(x − c·dt·d, t + dt)
    const r = stream(8);
    const dt = 2;
    let fwd = 0, back = 0;
    for (let i = 0; i < 400; i++) {
      const x = r() * 500, z = r() * 500, t = r() * 100;
      const h = sea.heightAt(x, z, t);
      const [wx, wz] = downwind(90);
      fwd += h * sea.heightAt(x + wx * c * dt, z + wz * c * dt, t + dt);
      back += h * sea.heightAt(x - wx * c * dt, z - wz * c * dt, t + dt);
    }
    expect(fwd).toBeGreaterThan(back);
    expect(fwd).toBeGreaterThan(0);
  });

  it("are a function of the seed: the same seed is the same sea, another is another", () => {
    const a = createOcean({ wind: { speed: 8, from: 10 }, seed: "harbour" });
    const b = createOcean({ wind: { speed: 8, from: 10 }, seed: "harbour" });
    const c = createOcean({ wind: { speed: 8, from: 10 }, seed: "open sea" });
    expect(a.components).toEqual(b.components);
    expect(a.heightAt(12.5, -40, 33)).toBe(b.heightAt(12.5, -40, 33));
    expect(a.components).not.toEqual(c.components);
    expect(a.heightAt(12.5, -40, 33)).not.toBe(c.heightAt(12.5, -40, 33));
  });

  it("a calm is flat and still", () => {
    for (const wind of [{ speed: 0, from: 0 }, {}, { speed: -3 }]) {
      const sea = createOcean({ wind, seed: 1 });
      expect(sea.components).toEqual([]);
      expect(sea.heightAt(10, 20, 5)).toBe(0);
      expect(sea.normalAt(10, 20, 5)).toEqual([0, 1, 0]);
      expect(sea.velocityAt(10, -1, 20, 5)).toEqual([0, 0, 0]);
      expect(sea.sampleAt(10, 20, 5)).toEqual([0, 0, 1, 0]);
      expect(sea.stats.hs).toBe(0);
      expect(sea.stats.whitecaps).toBe(0);
    }
  });
});

describe("heightAt", () => {
  it("is the height of the Gerstner surface point that really lies over (x, z)", () => {
    // push rest points through the waves (the shader's forward map), then ask for the height where they landed
    const sea = createOcean({ wind: { speed: 12, from: 200 }, seed: 6, scale: 1.5 });
    const r = stream(2);
    const p = [0, 0, 0, 0];
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const t = r() * 1000;
      sea.displaced(r() * 400 - 200, r() * 400 - 200, t, p);
      worst = Math.max(worst, Math.abs(sea.heightAt(p[0], p[2], t) - p[1]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("differs from the naive sum at the same rest point (the inversion matters)", () => {
    const sea = createOcean({ wind: { speed: 12, from: 0 }, seed: 6 });
    const r = stream(4);
    const p = [0, 0, 0, 0];
    let diff = 0;
    for (let i = 0; i < 200; i++) {
      const x = r() * 300, z = r() * 300, t = r() * 100;
      diff = Math.max(diff, Math.abs(sea.heightAt(x, z, t) - sea.displaced(x, z, t, p)[1]));
    }
    expect(diff).toBeGreaterThan(0.05);
  });

  it("is fast enough for a few hundred buoyancy samples a step", () => {
    const sea = createOcean({ wind: { speed: 12, from: 0 }, seed: 1 });
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 3000; i++) s += sea.heightAt(i * 0.31, i * 0.17, 5 + i * 0.001);
    const per = (performance.now() - t0) / 3000;
    expect(Number.isFinite(s)).toBe(true);
    // a few µs each in practice; generous for a busy CI machine
    expect(per).toBeLessThan(0.1);
  });
});

describe("normalAt", () => {
  const sea = createOcean({ wind: { speed: 11, from: 120 }, seed: 12 });

  it("is a unit vector, pointing up", () => {
    const r = stream(3);
    for (let i = 0; i < 200; i++) {
      const n = sea.normalAt(r() * 500, r() * 500, r() * 100);
      expect(Math.hypot(...n)).toBeCloseTo(1, 9);
      expect(n[1]).toBeGreaterThan(0.3);
    }
  });

  it("agrees with finite differences of heightAt", () => {
    const r = stream(7);
    const e = 1e-3;
    for (let i = 0; i < 100; i++) {
      const x = r() * 500, z = r() * 500, t = r() * 100;
      const dx = (sea.heightAt(x + e, z, t) - sea.heightAt(x - e, z, t)) / (2 * e);
      const dz = (sea.heightAt(x, z + e, t) - sea.heightAt(x, z - e, t)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      const n = sea.normalAt(x, z, t);
      expect(n[0]).toBeCloseTo(-dx / l, 4);
      expect(n[1]).toBeCloseTo(1 / l, 4);
      expect(n[2]).toBeCloseTo(-dz / l, 4);
    }
  });

  it("writes into an out array without allocating, and sampleAt gives height and normal at once", () => {
    const out = [0, 0, 0];
    expect(sea.normalAt(3, 4, 5, out)).toBe(out);
    const s = [0, 0, 0, 0];
    expect(sea.sampleAt(3, 4, 5, s)).toBe(s);
    expect(s[0]).toBe(sea.heightAt(3, 4, 5));
    expect(s.slice(1)).toEqual(out);
  });
});

describe("velocityAt", () => {
  const sea = createOcean({ wind: { speed: 10, from: 0 }, seed: 5 });

  it("at the surface, is the surface's own motion", () => {
    const r = stream(9);
    const p0 = [0, 0, 0, 0], p1 = [0, 0, 0, 0];
    const h = 1e-4;
    for (let i = 0; i < 50; i++) {
      const x0 = r() * 300, z0 = r() * 300, t = r() * 100;
      // a surface particle's velocity, by finite difference of the forward map
      sea.displaced(x0, z0, t - h, p0);
      sea.displaced(x0, z0, t + h, p1);
      const v = [(p1[0] - p0[0]) / (2 * h), (p1[1] - p0[1]) / (2 * h), (p1[2] - p0[2]) / (2 * h)];
      const at = sea.displaced(x0, z0, t, [0, 0, 0, 0]);
      const got = sea.velocityAt(at[0], at[1], at[2], t);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(v[k], 3);
    }
  });

  it("dies away with depth, and above the water is the surface's", () => {
    const x = 40, z = -70, t = 12;
    const h = sea.heightAt(x, z, t);
    const mag = (v) => Math.hypot(...v);
    const top = mag(sea.velocityAt(x, h, z, t));
    expect(top).toBeGreaterThan(0.1);
    expect(mag(sea.velocityAt(x, h - 5, z, t))).toBeLessThan(top);
    expect(mag(sea.velocityAt(x, h - 60, z, t))).toBeLessThan(top * 0.05);
    expect(sea.velocityAt(x, h + 3, z, t)).toEqual(sea.velocityAt(x, h, z, t));
  });

  it("writes into an out array", () => {
    const out = [9, 9, 9];
    expect(sea.velocityAt(1, -1, 2, 3, out)).toBe(out);
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
