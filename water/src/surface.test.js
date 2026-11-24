// W1's golden half: water's evaluator, given the components sailing's
// spectrum made, answers every query on the golden grid exactly as sailing's
// ocean.js does (src/test/golden.json, a verbatim copy of sailing's
// src/test/ocean-golden.json, which sailing's own test pins its ocean.js to).
import { describe, expect, it } from "vitest";
import { createSurface } from "./surface.js";
import { createOcean, pmSea } from "./test/spectrum.js";

const G = 9.81;
const downwind = (from) => {
  const a = ((Number(from) || 0) * Math.PI) / 180;
  return [-Math.sin(a), Math.cos(a)];
};
/** a seeded stream of numbers in [0, 1), so the tests sample the same points every run */
function stream(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

import golden from "./test/golden.json";
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : a === b);

describe("water's surface against the golden file", () => {
  it("covers the seas W1 names", () => {
    expect(golden.seas.map((s) => s.name)).toEqual(["Ship at sea", "Ship at anchor", "Cadboro Bay", "calm", "Harbour"]);
    expect(golden.seas.every((s) => s.samples.length === 64)).toBe(true);
  });
  for (const sea of golden.seas)
    it(`${sea.name}: every query on the grid, bit for bit`, () => {
      const o = createSurface(sea.components);
      let bad = 0;
      for (const s of sea.samples) {
        const { x, z, t } = s;
        if (!same(o.heightAt(x, z, t), s.height)) bad++;
        if (!same(o.sampleAt(x, z, t, [0, 0, 0, 0]), s.sample)) bad++;
        if (!same(o.normalAt(x, z, t, [0, 0, 0]), s.normal)) bad++;
        if (!same([-1, 0.5].map((y) => o.velocityAt(x, y, z, t, [0, 0, 0])), s.velocity)) bad++;
        if (!same(o.displaced(x, z, t, [0, 0, 0, 0]), s.displaced)) bad++;
      }
      expect(bad).toBe(0);
    });
});

// The evaluator's own properties (moved here with it from sailing's
// ocean.js): on seas made by a copy of sailing's spectrum (test/spectrum.js).
// The sample points come from a fixed seeded sequence, the same every run.
describe("the surface's waves", () => {
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
});

