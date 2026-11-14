import { describe, it, expect } from "vitest";
import { partsOf, waterPlanes, defaultParts, hullTriangles, toModelFrame } from "./parts.js";

// three parts: a "hull" box crossing z = 0, a "mast" wholly above, and a
// "Water" square 100 m across at z = 0.2
const tri = (a, b, c) => [...a, ...b, ...c];
const box = (x0, x1, z0, z1) => [tri([x0, -1, z0], [x1, -1, z0], [x1, 1, z1]), tri([x0, -1, z0], [x1, 1, z1], [x0, 1, z1])].flat();
const water = [tri([-50, -50, 0.2], [50, -50, 0.2], [50, 50, 0.2]), tri([-50, -50, 0.2], [50, 50, 0.2], [-50, 50, 0.2])].flat();
const tris = Float64Array.from([...box(0, 10, -1, 1), ...box(4, 5, 1, 15), ...water]);
const ranges = [
  { name: "Hull", from: 0, to: 2 },
  { name: "Mast", from: 2, to: 4 },
  { name: "Water", from: 4, to: 6 },
];

describe("a model's parts", () => {
  const parts = partsOf(tris, ranges);
  it("measures each part", () => {
    expect(parts.map((p) => p.name)).toEqual(["Hull", "Mast", "Water"]);
    expect(parts[0]).toMatchObject({ triangles: 2, min: [0, -1, -1], max: [10, 1, 1], flat: false });
    expect(parts[2].flat).toBe(true);
  });
  it("knows a water plane, and never makes it hull", () => {
    expect(waterPlanes(parts).map((p) => p.name)).toEqual(["Water"]);
    expect(defaultParts(parts, 0.2)).toEqual(["Hull"]);
  });
  it("takes only what reaches the waterline by default", () => {
    expect(defaultParts(parts, 0)).toEqual(["Hull"]);
    // a waterline below everything: nothing reaches it, so all but the water
    expect(defaultParts(parts, -5)).toEqual(["Hull", "Mast"]);
  });
  it("joins a part drawn in several pieces", () => {
    const p = partsOf(tris, [{ name: "A", from: 0, to: 1 }, { name: "A", from: 1, to: 2 }]);
    expect(p).toHaveLength(1);
    expect(p[0].triangles).toBe(2);
  });
});

describe("the default hull, on a model shaped like Jim's Daysailor", () => {
  // the parts and extents of the real file (x and z, metres), rounded
  const P = (name, x0, x1, z0, z1) => ({ name, triangles: 1, min: [x0, -1, z0], max: [x1, 1, z1], flat: false });
  const daysailor = [
    P("Hull Bottom", 0.43, 10.55, -2.38, 0.05),
    P("Mast", 4.48, 5.92, -0.09, 13.9),
    P("Topsides", 0, 11.3, 0.03, 0.91),
    P("Deck::Cockpit", 6.29, 9.49, 0.25, 0.66),
    P("Tiller", 8.36, 9.41, 0.29, 0.59),
    P("Deck Hardware", 5.37, 9.96, 0.32, 0.81),
    P("ASail", -1.68, 9.96, 0.32, 13.76),
    P("Deck", 0.1, 11.22, 0.62, 0.85),
    P("Dodger::Canvas", 4.83, 6.7, 0.72, 1.4),
    P("Mainsail", 4.84, 8.72, 1.73, 13.71),
  ];
  it("is the hull's own skin: bottom (with its keel and rudder), topsides and deck", () => {
    expect(defaultParts(daysailor, 0)).toEqual(["Hull Bottom", "Topsides", "Deck"]);
  });
});

describe("the analysis frame", () => {
  it("turns a bow-to-−x model round and puts its waterline at z = 0", () => {
    const t = hullTriangles(tris, ranges, ["Hull"], { bow: "-x", waterZ: 0.2 });
    expect(t.length).toBe(18);
    expect(Array.from(t.slice(0, 3))).toEqual([-0, 1, -1.2]);
    // and back again
    expect(toModelFrame([t[0], t[1], t[2]], { bow: "-x", waterZ: 0.2 })).toEqual([0, -1, -1]);
  });
  it("leaves a bow-to-+x model as it is", () => {
    expect(Array.from(hullTriangles(tris, ranges, ["Hull"]).slice(0, 9))).toEqual(Array.from(tris.slice(0, 9)));
  });
});
