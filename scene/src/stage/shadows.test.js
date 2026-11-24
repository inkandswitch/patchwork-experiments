import { describe, it, expect } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { SHADOW_CAP, castShadows, fitShadow, ladderRadius, lightBasis, shadowFocus, shadowFrame } from "./shadows.js";

/** Rounded, and without -0, for comparing vectors. */
const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SUN = [0.45, 1, 0.6].map((v, _, a) => v / Math.hypot(...a));

describe("the sun's shadow frame", () => {
  it("the light's axes are three's lookAt axes, also for a sun straight overhead", () => {
    for (const d of [[0.6, 0.64, 0.48], [0, 1, 0], [-0.3, 0.2, -0.932737905308882]]) {
      const dir = d.map((v) => v / Math.hypot(...d));
      const cam = new PerspectiveCamera();
      cam.position.set(...dir.map((v) => v * 10));
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      const { x, y } = lightBasis(dir);
      expect(r6(x)).toEqual(r6([e[0], e[1], e[2]]));
      expect(r6(y)).toEqual(r6([e[4], e[5], e[6]]));
    }
  });

  it("covers what's near the focus, nearest first, as long as it fits the cap; a box bigger than the cap is a backdrop", () => {
    const main = { min: [-2, 0, -6], max: [2, 15, 6] };
    const near = { min: [10, 0, 0], max: [11, 2, 1] };
    const far = { min: [38, 0, 0], max: [39, 2, 1] };
    const other = { min: [-46, 0, 0], max: [-45, 2, 1] };
    const beyond = { min: [60, 0, 100], max: [180, 30, 220] };
    const ground = { min: [-4000, -50, -4000], max: [4000, 300, 4000] };
    // out of reach, and a backdrop: the main box alone sets it
    const f = shadowFocus([beyond, ground, main], [0, 2, 0]);
    expect(f.center).toEqual([0, 7.5, 0]);
    expect(f.radius).toBeCloseTo(0.5 * Math.hypot(4, 15, 12));
    // a neighbour that fits joins; one that would push it past the cap doesn't
    const joined = shadowFocus([other, far, main, near], [0, 2, 0]);
    expect(joined.center[0]).toBeCloseTo(4.5);
    expect(joined.radius).toBeLessThanOrEqual(SHADOW_CAP);
    expect(shadowFocus([other, far, main, near], [0, 2, 0], { cap: 32 }).center[0]).toBeCloseTo(18.5);
    expect(shadowFocus([other, far, main, near], [0, 2, 0], { cap: 100 }).center[0]).toBeCloseTo(-3.5);
    // looking at something wider than the cap on its own: the cap sphere about the focus
    expect(shadowFocus([main, beyond], [120, 10, 160])).toEqual({ center: [120, 10, 160], radius: SHADOW_CAP });
    expect(shadowFocus([], [0, 0, 0])).toBeNull();
  });

  it("the radius ladder holds the texel still across small changes, and the cap is a step of it", () => {
    expect(ladderRadius(10)).toBeGreaterThanOrEqual(10);
    expect(ladderRadius(10)).toBeLessThan(10 * 1.19);
    expect(ladderRadius(9.9)).toBe(ladderRadius(10.0));
    expect(ladderRadius(8)).toBe(8);
    expect(ladderRadius(SHADOW_CAP)).toBe(SHADOW_CAP);
  });

  it("the frame's centre lands on whole texels along the light's axes, its biases are a texel and a half in metres", () => {
    const { x, y } = lightBasis(SUN);
    const at = [1.234, 5.678, -3.21];
    const f = shadowFrame({ center: at, radius: 16 }, SUN, 2048);
    expect(f.texel).toBeCloseTo(32 / 2048);
    for (const axis of [x, y, SUN]) {
      const k = dot(f.target, axis) / f.texel;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      // never more than half a texel per axis from where it was asked for
      expect(Math.abs(dot(f.target.map((v, i) => v - at[i]), axis))).toBeLessThanOrEqual(f.texel / 2 + 1e-9);
    }
    // the light stands 2r out along the sun; the sphere lies between near and far
    expect(r6(f.position)).toEqual(r6(f.target.map((v, i) => v + SUN[i] * 32)));
    expect(f.near).toBeLessThanOrEqual(f.radius);
    expect(f.far).toBeGreaterThanOrEqual(3 * f.radius);
    expect(f.normalBias).toBeCloseTo(1.5 * f.texel);
    // the depth bias is one texel of depth in three's normalised units
    expect(-f.bias * (f.far - f.near)).toBeCloseTo(f.texel);
  });

  it("a frame that moves less than a texel stays put; one that moves moves by whole texels (no crawl)", () => {
    const a = shadowFrame({ center: [0, 0, 0], radius: 16 }, SUN);
    expect(shadowFrame({ center: [0.003, 0.002, -0.001], radius: 16 }, SUN).target).toEqual(a.target);
    const { x, y } = lightBasis(SUN);
    for (let i = 1; i <= 20; i++) {
      const c = shadowFrame({ center: [i * 0.0137, 0, i * -0.009], radius: 16 }, SUN);
      for (const axis of [x, y]) {
        const k = (dot(c.target, axis) - dot(a.target, axis)) / a.texel;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      }
    }
  });

  it("fitting keeps its key while the frame lands in the same place, and keeps a radius until what's needed outgrows it or shrinks under 60% of it", () => {
    const box = (r) => ({ min: [-r, -r, -r], max: [r, r, r] });
    const first = fitShadow([box(1)], [0, 0, 0], SUN);
    expect(first.frame.radius).toBe(ladderRadius(Math.sqrt(3)));
    // a hair's move of the focus: the same frame
    expect(fitShadow([box(1)], [0.001, 0, 0], SUN, first.frame.radius).key).toBe(first.key);
    // a little smaller: the kept radius holds; much smaller: a new one
    expect(fitShadow([box(0.8)], [0, 0, 0], SUN, first.frame.radius).frame.radius).toBe(first.frame.radius);
    expect(fitShadow([box(0.3)], [0, 0, 0], SUN, first.frame.radius).frame.radius).toBeLessThan(first.frame.radius);
    // bigger than kept: a new one
    expect(fitShadow([box(2)], [0, 0, 0], SUN, first.frame.radius).frame.radius).toBeGreaterThan(first.frame.radius);
    expect(fitShadow([], [0, 0, 0], SUN)).toBeNull();
  });

  it("every mesh casts and receives, except that a sheet saying receiveShadow: false only casts", () => {
    const solid = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const sheet = new Mesh(new BoxGeometry(1, 1, 0), new MeshBasicMaterial());
    sheet.userData.receiveShadow = false;
    solid.add(sheet);
    castShadows(solid, true);
    expect([solid.castShadow, solid.receiveShadow, sheet.castShadow, sheet.receiveShadow]).toEqual([true, true, true, false]);
    castShadows(solid, false);
    expect([solid.castShadow, solid.receiveShadow, sheet.castShadow, sheet.receiveShadow]).toEqual([false, false, false, false]);
  });
});
