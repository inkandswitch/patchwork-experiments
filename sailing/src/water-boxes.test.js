// probes/water-boxes.mjs, the boxes a publisher frames for bodies of water
// (a probe's module, tested here because vitest runs src/). Finite cases.
import { describe, it, expect } from "vitest";
import { corners, matrixOf, specPoints } from "../probes/frame.mjs";
import { drawnTop, waterBoxes } from "../probes/water-boxes.mjs";

const close = (a, b, eps = 1e-6) => a.length === b.length && a.every((p, i) => p.every((v, j) => Math.abs(v - b[i][j]) <= eps));
const T = (position = [0, 0, 0], yaw = 0, scale = 1) => ({ position, rotation: [0, yaw, 0], scale });
const mast = { url: "automerge:mast", hint: { bounds: { min: [-0.1, 0, -0.1], max: [0.1, 14, 0.1] } } };
const obj = (name, extra) => ({ name, sourceUrl: null, providerId: null, parent: null, visible: true, transform: T(), ...extra });

describe("waterBoxes", () => {
  it("a basin: its size from its floor up to the top of what its doc draws (a mast stepped at 1.4 m: 15.4)", () => {
    const doc = { assets: { mast }, objects: { basin: obj("Basin", { traits: { water: { size: [30, 3, 30] } } }), m: obj("Mast", { sourceUrl: mast.url, transform: T([0, 1.4, 0]) }) } };
    expect(drawnTop(doc)).toBeCloseTo(15.4, 9);
    const [b] = waterBoxes(doc);
    expect(b).toMatchObject({ id: "basin", kind: "size" });
    expect(b.lid).toBeCloseTo(15.4, 9);
    expect(close(b.points, corners([-15, -3, -15], [15, 15.4, 15]))).toBe(true);
    expect(b.spec).toBe("0,6.2,0:30,18.4,30@0");
  });

  it("open water's clip, turned and placed, carried by a link at 1:25; its spec is the same box", () => {
    const sea = obj("Sea", { transform: T([43.5, 0, -83.2], -Math.PI / 4), traits: { water: { clip: [116.2, 11, 223.2] }, "sailing.sea": {} } });
    const doc = { assets: { mast }, objects: { sea, m: obj("Mast", { sourceUrl: mast.url, transform: T([0, 2, 0]) }) } };
    const link = matrixOf(T([1, 0, 2], 0.5, 0.04));
    const [b] = waterBoxes(doc, link);
    expect(b.kind).toBe("clip");
    expect(b.lid).toBeCloseTo(16, 9);
    // the box in the doc carried by the link: link · sea (multiplied out here)
    const sea4 = matrixOf(sea.transform);
    const both = [0, 1, 2, 3].flatMap((col) => [0, 1, 2, 3].map((row) => [0, 1, 2, 3].reduce((s, k) => s + link[k * 4 + row] * sea4[col * 4 + k], 0)));
    expect(close(b.points, corners([-58.1, -11, -111.6], [58.1, 16, 111.6], both))).toBe(true);
    // not where the link alone would put it: the sea's own place counts
    expect(close(b.points, corners([-58.1, -11, -111.6], [58.1, 16, 111.6], link))).toBe(false);
    expect(b.spec).toBe("43.5,2.5,-83.2:116.2,27,223.2@-45");
    expect(b.yaw).toBe(-45);
    expect(close(specPoints(b.spec, link), b.points)).toBe(true);
  });

  it("a scaled body: its scale multiplies the box and the lid is measured in its own units", () => {
    const doc = { assets: { mast }, objects: { b: obj("Tank", { transform: T([0, 1, 0], 0, 2), traits: { water: { size: [4, 1, 6] } } }), m: obj("Mast", { sourceUrl: mast.url, transform: T([0, 1, 0]) }) } };
    const [b] = waterBoxes(doc);
    // the top is 15; the surface at 1; 14 m over it is 7 of its own units
    expect(b.lid).toBeCloseTo(7, 9);
    expect(close(b.points, corners([-2, -1, -3], [2, 7, 3], matrixOf(T([0, 1, 0], 0, 2))))).toBe(true);
    expect(b.spec).toBe("0,7,0:8,16,12@0");
  });

  it("no box for: a clip beside a size (the size's), a bad size (clip or none) or clip, a tilted body, a hidden one, a doc drawing nothing has lid 0", () => {
    const cases = [
      [{ water: { size: [10, 2, 10], clip: [50, 5, 50] } }, {}, ["size:10"]],
      [{ water: { size: [10, 0, 10] } }, {}, []],
      // a bad size is no water (water/src/bodies.js shapeOf), clip or none
      [{ water: { size: [10, 0, 10], clip: [50, 5, 50] } }, {}, []],
      [{ water: { size: [10, 2, 10, 4] } }, {}, []],
      [{ water: { clip: [50, -5, 50] } }, {}, []],
      [{ water: { clip: "big" } }, {}, []],
      [{ water: {} }, {}, []],
      [{ water: { clip: [50, 5, 50] } }, { transform: { position: [0, 0, 0], rotation: [0.1, 0, 0], scale: 1 } }, []],
      [{ water: { clip: [50, 5, 50] } }, { transform: { position: [0, 0, 0], rotation: [0, 0, -0.1], scale: 1 } }, []],
      [{ water: { clip: [50, 5, 50] } }, { visible: false }, []],
      [{ water: { clip: [50, 5, 50] } }, {}, ["clip:50"]],
    ];
    for (const [traits, extra, want] of cases) {
      const got = waterBoxes({ assets: {}, objects: { w: obj("W", { traits, ...extra }) } });
      expect(got.map((b) => `${b.kind}:${Math.max(...b.points.map((p) => p[0])) * 2}`), JSON.stringify([traits, extra])).toEqual(want);
      for (const b of got) expect(b.lid).toBe(0);
    }
  });
});
