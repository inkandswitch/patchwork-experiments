// Path keys (paths.js) and the frame choke point (scope.js, invariant I7),
// over finite cases: every id shape a doc might hold, every frame composed
// to depth 3 of a finite set of turns, shifts and scales.

import { describe, expect, it } from "vitest";
import { SEP, elementOf, keyOf, parseKey, samePath } from "./paths.js";
import { frameOf, hitIn, rayIn, scopeViewport, similarityOf } from "./scope.js";
import { applyMatrix, composeMatrix, multiplyMatrices } from "../transform.js";

const IDS = ["a", "o1x", "", "0", "12", `${SEP}x`, `${SEP}3${SEP}y`, `a${SEP}b`, "L/c7", " "];
const close = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

describe("path keys", () => {
  it("keyOf is injective and parseKey inverts it, for every stage and every id shape", () => {
    const seen = new Map();
    for (const n of [0, 1, 2, 10, 11])
      for (const id of IDS) {
        const k = keyOf(n, id);
        expect(parseKey(k)).toEqual({ n, id });
        expect(seen.has(k)).toBe(false);
        seen.set(k, [n, id]);
      }
    // the outermost stage's ordinary ids are their own keys
    for (const id of IDS.filter((x) => !x.startsWith(SEP))) expect(keyOf(0, id)).toBe(id);
    expect(parseKey(`${SEP}x${SEP}a`)).toBe(null);
    expect(parseKey(`${SEP}01${SEP}a`)).toBe(null);
    expect(parseKey(42)).toBe(null);
  });

  it("each stage sees its own element of a path, or nothing", () => {
    const path = ["L", "M", "c"];
    expect(elementOf(path, [])).toBe("L");
    expect(elementOf(path, ["L"])).toBe("M");
    expect(elementOf(path, ["L", "M"])).toBe("c");
    expect(elementOf(path, ["L", "M", "c"])).toBe(null);
    expect(elementOf(path, ["K"])).toBe(null);
    expect(elementOf(null, [])).toBe(null);
    expect(samePath(["a"], ["a"])).toBe(true);
    expect(samePath(["a"], ["a", "b"])).toBe(false);
    expect(samePath(null, null)).toBe(true);
  });
});

// every transform of a finite set: quarter and eighth turns about each axis, shifts, scales
const TURNS = [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 4, 0], [0, 0, -Math.PI / 2], [0.3, 1.1, -0.7]];
const SHIFTS = [[0, 0, 0], [10, 0, 0], [-1, 2.5, 3]];
const SCALES = [1, 2, 0.5];
const TRANSFORMS = TURNS.flatMap((rotation) => SHIFTS.flatMap((position) => SCALES.map((scale) => ({ position, rotation, scale }))));
const POINTS = [[0, 0, 0], [1, 0, 0], [0.2, -3, 4]];

/** Frames to depth 3: products of up to three transforms (every pair, and a sample of triples). */
function* frames() {
  for (const a of TRANSFORMS) yield composeMatrix(a);
  for (const a of TRANSFORMS) for (const b of TRANSFORMS.filter((_, i) => i % 7 === 0)) yield multiplyMatrices(composeMatrix(a), composeMatrix(b));
  for (const a of TRANSFORMS.filter((_, i) => i % 5 === 0)) for (const b of TRANSFORMS.filter((_, i) => i % 9 === 0)) for (const c of TRANSFORMS.filter((_, i) => i % 11 === 0)) yield multiplyMatrices(multiplyMatrices(composeMatrix(a), composeMatrix(b)), composeMatrix(c));
}

describe("I7: a stage's frame is a similarity, applied exactly", () => {
  it("points by the frame, directions and normals by its rotation, distances by its scale; in and out are inverse", () => {
    let n = 0;
    for (const m of frames()) {
      const f = frameOf(m);
      const { scale, rotation: r } = similarityOf(m);
      // the projection keeps a similarity as it is
      expect(close(f.matrix, m, 1e-9)).toBe(true);
      // the rotation is orthonormal, of determinant 1
      const col = (i) => [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(Math.abs(dot(col(i), col(j)) - (i === j ? 1 : 0))).toBeLessThan(1e-9);
      for (const p of POINTS) {
        expect(close(f.pointOut(p), applyMatrix(m, p))).toBe(true);
        expect(close(f.pointIn(f.pointOut(p)), p, 1e-8)).toBe(true);
        expect(close(f.dirIn(f.dirOut(p)), p, 1e-9)).toBe(true);
        // a direction turns as the difference of two points does, less the scale
        const d = f.dirOut(p);
        const q = f.pointOut(p).map((v, i) => (v - f.pointOut([0, 0, 0])[i]) / scale);
        expect(close(d, q, 1e-8)).toBe(true);
      }
      // a distance scales: two points' separation in and out
      const a = f.pointOut(POINTS[1]);
      const b = f.pointOut(POINTS[2]);
      expect(Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - f.lengthOut(Math.hypot(...POINTS[1].map((v, i) => v - POINTS[2][i]))))).toBeLessThan(1e-8);
      // a hit and a ray in the frame
      const hit = { id: "k", point: a, normal: f.dirOut([0, 1, 0]), distance: f.lengthOut(2) };
      const h = hitIn(f, hit, "mine");
      expect(h.id).toBe("mine");
      expect(close(h.point, POINTS[1], 1e-8)).toBe(true);
      expect(close(h.normal, [0, 1, 0], 1e-9)).toBe(true);
      expect(Math.abs(h.distance - 2)).toBeLessThan(1e-9);
      const ray = rayIn(f, { origin: a, dir: f.dirOut([0, 0, -1]) });
      expect(close(ray.origin, POINTS[1], 1e-8) && close(ray.dir, [0, 0, -1], 1e-9)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    // no frame: every conversion is the identity
    const id = frameOf(null);
    expect(id.pointIn([1, 2, 3])).toEqual([1, 2, 3]);
    expect(id.lengthOut(4)).toBe(4);
  });

  it("a stage's scope keys its ids, hangs its roots under the link, and converts every spatial answer through its frame", () => {
    const calls = [];
    const F = composeMatrix({ position: [10, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const objects = new Map([[keyOf(1, "card"), {}], ["host", {}]]);
    const vp = {
      ok: true,
      objects,
      poses: new Map(),
      applyDisplay: (k, o, parent) => calls.push(["display", k, parent]),
      worldOf: (k) => (k === keyOf(1, "card") ? multiplyMatrices(F, composeMatrix({ position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 })) : null),
      pick: () => ({ id: keyOf(1, "card"), point: applyMatrix(F, [1, 0, 0]), normal: [0, 1, 0], distance: 4 }),
      raycast: (o, d, opts) => (calls.push(["raycast", o, d, opts.far]), null),
      ride: (k) => (calls.push(["ride", k]), () => {}),
      worldLayer: (owner, opts) => (calls.push(["layer", owner, opts.under]), {}),
    };
    const sc = scopeViewport(vp, { n: 1, root: "L", frame: () => F, elementOf: (k) => (parseKey(k)?.n === 1 ? parseKey(k).id : null) });
    expect(sc.ids()).toEqual(["card"]);
    sc.applyDisplay("card", {}, null, null);
    sc.applyDisplay("child", {}, "card", null);
    expect(calls.slice(0, 2)).toEqual([["display", keyOf(1, "card"), "L"], ["display", keyOf(1, "child"), keyOf(1, "card")]]);
    // worldOf is in the stage's frame: the card at [1, 0, 0] of its root
    expect(close(sc.worldOf("card").slice(12, 15), [1, 0, 0], 1e-9)).toBe(true);
    const h = sc.pick(5, 5);
    expect(h.id).toBe("card");
    expect(close(h.point, [1, 0, 0], 1e-9)).toBe(true);
    expect(h.distance).toBeCloseTo(2, 9);
    sc.raycast([0, 0, 0], [0, 0, -1], { far: 3 });
    const rc = calls.find((c) => c[0] === "raycast");
    expect(close(rc[1], [10, 0, 0], 1e-9)).toBe(true);
    expect(rc[3]).toBeCloseTo(6, 9);
    sc.camera.ride(null);
    sc.worldLayer("seats");
    expect(calls.filter((c) => c[0] === "ride" || c[0] === "layer")).toEqual([["ride", "L"], ["layer", keyOf(1, "seats"), "L"]]);
    expect(sc.rideSpec({ id: null, at: [0, 0, 0] })).toEqual({ id: "L", at: [0, 0, 0] });
    // the outermost has no root: riding its root rides nothing
    const top = scopeViewport(vp, { n: 0 });
    expect(top.rideSpec({ id: null })).toBe(null);
  });
});
