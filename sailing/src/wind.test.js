import { describe, it, expect } from "vitest";
import { createWind, downwind, prng, seedOf, valueNoise } from "./wind.js";

const deg = (r) => (r * 180) / Math.PI;

describe("direction", () => {
  it("a wind from 0 blows toward +Z, from 90 toward −X, from 180 toward −Z, from 270 toward +X", () => {
    const at = (from) => createWind({ speed: 10, from, gustiness: 0 }).at(0, 0, 0);
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    expect(near(at(0), [0, 10])).toBe(true);
    expect(near(at(90), [-10, 0])).toBe(true);
    expect(near(at(180), [0, -10])).toBe(true);
    expect(near(at(270), [10, 0])).toBe(true);
    expect(downwind(45).map((v) => +v.toFixed(6))).toEqual([-0.707107, 0.707107]);
  });

  it("with no gusts, is the base wind everywhere and always", () => {
    const w = createWind({ speed: 7, from: 33, gustiness: 0 });
    const a = w.at(0, 0, 0);
    expect(w.at(500, -300, 1000)).toEqual(a);
  });
});

describe("gusts", () => {
  const w = createWind({ speed: 10, from: 60, seed: 4, gustiness: 0.3 });
  const [dx, dz] = downwind(60);

  it("average out to the base wind over time", () => {
    let s = 0, vx = 0, vz = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = w.at(0, 0, i * 1.1);
      s += Math.hypot(v[0], v[1]);
      vx += v[0];
      vz += v[1];
    }
    expect(s / n / 10).toBeGreaterThan(0.97);
    expect(s / n / 10).toBeLessThan(1.03);
    expect((vx * dx + vz * dz) / Math.hypot(vx, vz)).toBeGreaterThan(0.999);
  });

  it("vary speed by up to ±30% and direction by up to ~10° at gustiness 0.3, and do vary", () => {
    let lo = Infinity, hi = 0, veer = 0;
    for (let i = 0; i < 5000; i++) {
      const v = w.at(i * 13.7, -i * 7.1, i * 2.3);
      const s = Math.hypot(v[0], v[1]);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      veer = Math.max(veer, Math.abs(deg(Math.atan2(v[0] * dz - v[1] * dx, v[0] * dx + v[1] * dz))));
    }
    expect(lo).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(hi).toBeLessThanOrEqual(13 + 1e-9);
    expect(hi - lo).toBeGreaterThan(2.5);
    expect(veer).toBeLessThanOrEqual(10.5);
    expect(veer).toBeGreaterThan(4);
  });

  it("are smooth: a tenth of a second or a metre changes little", () => {
    const a = w.at(100, 200, 50);
    const b = w.at(100, 200, 50.1);
    const c = w.at(101, 200, 50);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.2);
    expect(Math.hypot(a[0] - c[0], a[1] - c[1])).toBeLessThan(0.2);
  });

  it("travel downwind with the wind: a gust here now is a gust downwind later", () => {
    // correlate the speed at p, t with the speed U·τ downwind of p at t + τ, and at p itself at t + τ
    const speed = (x, z, t) => Math.hypot(...w.at(x, z, t)) - 10;
    const tau = 15;
    let carried = 0, still = 0, norm = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 37.3, z = -i * 11.9, t = i * 3.7;
      const s = speed(x, z, t);
      carried += s * speed(x + dx * 10 * tau, z + dz * 10 * tau, t + tau);
      still += s * speed(x, z, t + tau);
      norm += s * s;
    }
    expect(carried / norm).toBeGreaterThan(0.6);
    expect(carried).toBeGreaterThan(still * 1.5);
  });

  it("are deterministic: a seed is a wind", () => {
    const a = createWind({ speed: 8, from: 10, seed: "x" });
    const b = createWind({ speed: 8, from: 10, seed: "x" });
    const c = createWind({ speed: 8, from: 10, seed: "y" });
    expect(a.at(12, 34, 56)).toEqual(b.at(12, 34, 56));
    expect(a.at(12, 34, 56)).not.toEqual(c.at(12, 34, 56));
  });

  it("write into an out array", () => {
    const out = [0, 0];
    expect(w.at(1, 2, 3, out)).toBe(out);
  });
});

describe("a calm", () => {
  it("is calm, gusts or not", () => {
    const w = createWind({ speed: 0, from: 90, gustiness: 1 });
    for (let i = 0; i < 50; i++) expect(w.at(i * 10, i, i * 3)).toEqual([0, 0]);
    expect(createWind().at(0, 0, 0)).toEqual([0, 0]);
  });
});

describe("noise and seeds", () => {
  it("value noise stays in [−1, 1] and is continuous", () => {
    for (let i = 0; i < 1000; i++) {
      const v = valueNoise(i * 0.137, i * 0.071, i * 0.013, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(valueNoise(2.0, 3.0, 4.0, 1) - valueNoise(2.0 + 1e-6, 3.0, 4.0, 1))).toBeLessThan(1e-4);
  });

  it("seeds: numbers and strings, never zero; prng in [0, 1)", () => {
    expect(seedOf(0)).toBe(1);
    expect(seedOf("a")).toBe(seedOf("a"));
    expect(seedOf("a")).not.toBe(seedOf("b"));
    const r = prng(3);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
