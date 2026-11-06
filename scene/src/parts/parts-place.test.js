// Where a part from the bin lands: upright at the point, turned to its
// connector, its parent or the viewer, in its parent's frame; snapping is the
// hand's: the nearest connector that takes it, within the object's reach.
import { describe, it, expect } from "vitest";
import { connectorFor, facingEye, partLanding } from "./parts-place.js";
import { composeMatrix, multiplyMatrices } from "../transform.js";

const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const worldOf = (land, parentMatrix) => multiplyMatrices(parentMatrix ?? composeMatrix({}), composeMatrix(land.at.transform));

describe("partLanding", () => {
  it("on the ground: at the point, under nothing, facing the viewer", () => {
    const land = partLanding({ point: [1, 0, 2], eye: [1, 5, 12] });
    expect(land.at.parent).toBe(null);
    expect(land.at.transform.position).toEqual([1, 0, 2]);
    // +Z toward the eye (straight along +Z here)
    expect(land.yaw).toBeCloseTo(0);
    expect(partLanding({ point: [0, 0, 0], eye: [5, 5, 0] }).yaw).toBeCloseTo(Math.PI / 2);
    expect(land.snapped).toBe(false);
  });

  it("on an object: under it, at the hit point in its frame, upright and turned its way", () => {
    // a hull turned 90° about Y, at (10, 0, 0), scaled 2
    const matrix = composeMatrix({ position: [10, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const land = partLanding({ point: [10, 1, -3], parent: { id: "hull", matrix, connectors: [] }, eye: [0, 10, 0] });
    expect(land.at.parent).toBe("hull");
    const W = worldOf(land, matrix);
    // where it was dropped, in the world
    expect(near(W.slice(12, 15), [10, 1, -3])).toBe(true);
    // world scale 1, upright (+Y up), and its +Z where the hull's is
    expect(Math.hypot(W[4], W[5], W[6])).toBeCloseTo(1);
    expect(W[5]).toBeCloseTo(1);
    expect(Math.atan2(W[8], W[10])).toBeCloseTo(Math.PI / 2);
    // in the hull's frame: half size, no turn
    expect(land.at.transform.scale).toBeCloseTo(0.5);
    expect(near(land.at.transform.rotation, [0, 0, 0])).toBe(true);
  });

  it("upright in the world on a tilted parent", () => {
    const matrix = composeMatrix({ rotation: [0.3, 0, 0.2] });
    const land = partLanding({ point: [0, 1, 0], parent: { id: "p", matrix } });
    const W = worldOf(land, matrix);
    expect(W[5]).toBeCloseTo(1);
  });

  it("a tagged part goes to the nearest connector that names its tag within reach, and turns its way", () => {
    const matrix = composeMatrix({ position: [0, 0, 0], rotation: [0, Math.PI, 0] });
    const connectors = [
      { position: [0, 1, 4], yaw: null, tags: ["mast"] },
      { position: [0, 1, -4], yaw: Math.PI / 2, tags: ["mast"] },
      { position: [0, 1, 0], yaw: null, tags: ["wheel"] },
    ];
    // dropped nearer the wheel's connector than the second mast step (at world z = +4): the wheel's doesn't take a mast
    const land = partLanding({ point: [0, 1, 1.5], parent: { id: "hull", matrix, connectors, snapRadius: 3 }, tags: ["mast"] });
    expect(land.snapped).toBe(true);
    expect(near(land.spot, [0, 1, 4])).toBe(true);
    // its yaw turned with the hull's (π + π/2)
    expect(Math.atan2(worldOf(land, matrix)[8], worldOf(land, matrix)[10])).toBeCloseTo(-Math.PI / 2);
    // out of reach, or Alt: where it was dropped; an object with no radius isn't snapped to (as the hand)
    expect(partLanding({ point: [0, 1, 1.5], parent: { id: "hull", matrix, connectors, snapRadius: 1 }, tags: ["mast"] }).snapped).toBe(false);
    expect(partLanding({ point: [0, 1, 1.5], parent: { id: "hull", matrix, connectors, snapRadius: 3 }, tags: ["mast"], free: true }).snapped).toBe(false);
    expect(partLanding({ point: [0, 1, 1.5], parent: { id: "hull", matrix, connectors }, tags: ["mast"] }).snapped).toBe(false);
  });

  it("a part without tags goes to an open connector only within reach, never to a tagged one", () => {
    const matrix = composeMatrix({});
    const connectors = [
      { position: [0, 0.04, 0], tags: [] },
      { position: [0.06, 0.04, 0], tags: [] },
      { position: [0.2, 0.04, 0], tags: ["mast"] },
    ];
    const parent = { id: "board", matrix, connectors, snapRadius: 0.042 };
    expect(partLanding({ point: [0.05, 0.04, 0.01], parent }).spot).toEqual([0.06, 0.04, 0]);
    // too far from either open one; the tagged one doesn't take it
    expect(partLanding({ point: [0.19, 0.04, 0], parent }).snapped).toBe(false);
  });
});

describe("connectorFor", () => {
  it("scales the reach with the object", () => {
    const connectors = [{ position: [1, 0, 0] }];
    expect(connectorFor({ matrix: composeMatrix({ scale: 1 }), connectors, snapRadius: 0.5 }, [1.8, 0, 0])).toBe(null);
    expect(connectorFor({ matrix: composeMatrix({ scale: 2 }), connectors, snapRadius: 0.5 }, [2.8, 0, 0])?.world).toEqual([2, 0, 0]);
  });
  it("facingEye: 0 straight overhead", () => {
    expect(facingEye([0, 5, 0], [0, 0, 0])).toBe(0);
  });
});
