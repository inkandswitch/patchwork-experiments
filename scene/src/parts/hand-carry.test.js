import { describe, it, expect } from "vitest";
import { createCarry, flipMatrix, landingFor, localTransform, rotateAbout, snapCandidates, tablePoint, translate, worldBox, yawOfMatrix } from "./hand-carry.js";
import { composeMatrix } from "../transform.js";

const I = composeMatrix({});
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
// a 0.2 × 0.1 × 0.2 piece, sitting on its base
const BOX = { min: [-0.1, 0, -0.1], max: [0.1, 0.1, 0.1] };
// looking straight down at (x, z)
const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });
const ground = () => null; // nothing to hit: the ground

describe("hand-carry maths", () => {
  it("turns about a world axis through the origin, keeping the translation", () => {
    const m = composeMatrix({ position: [1, 2, 3] });
    const r = rotateAbout(m, [0, 1, 0], Math.PI / 2);
    expect(close(r.slice(12, 15), [1, 2, 3])).toBe(true);
    expect(yawOfMatrix(r)).toBeCloseTo(Math.PI / 2);
    expect(close(r, composeMatrix({ position: [1, 2, 3], rotation: [0, Math.PI / 2, 0] }))).toBe(true);
  });

  it("flips about its own length: up turns down", () => {
    const f = flipMatrix(I);
    expect(f[5]).toBeCloseTo(-1);
    expect(f[10]).toBeCloseTo(1); // still pointing the same way along its length
    expect(flipMatrix(f)[5]).toBeCloseTo(1);
  });

  it("boxes a body box in world, and decomposes under a parent", () => {
    const m = composeMatrix({ position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const b = worldBox({ min: [0, 0, 0], max: [1, 1, 2] }, m);
    expect(b.min.map((v) => +v.toFixed(9))).toEqual([1, 0, -2]);
    expect(b.max.map((v) => +v.toFixed(9))).toEqual([5, 2, 0]);
    const parent = composeMatrix({ position: [0, 1, 0] });
    const t = localTransform(parent, translate(I, [2, 1, 0]));
    expect(t.position).toEqual([2, 0, 0]);
    expect(localTransform(null, m).scale).toBeCloseTo(2);
  });

  it("puts connectors in world, turned and scaled with their object, and only where the tags fit", () => {
    const m = composeMatrix({ position: [5, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const c = snapCandidates(
      [
        { id: "board", matrix: m, snapRadius: 0.5, connectors: [{ position: [1, 0, 0], yaw: 0, tags: [] }, { position: [0, 0, 1], yaw: null, tags: ["card"] }] },
        { id: "nothing", matrix: I, snapRadius: null, connectors: [{ position: [0, 0, 0], tags: [] }] }, // no radius: no snapping
      ],
      [],
    );
    expect(c).toHaveLength(1);
    expect(c[0].objectId).toBe("board");
    expect(close(c[0].world, [5, 0, -2])).toBe(true);
    expect(c[0].radius).toBeCloseTo(1);
    expect(c[0].yaw).toBeCloseTo(Math.PI / 2);
    expect(snapCandidates([{ id: "board", matrix: m, snapRadius: 0.5, connectors: [{ position: [0, 0, 1], tags: ["card"] }] }], ["card"])).toHaveLength(1);
  });

  it("finds the table: the first object hit, else the ground, else nothing", () => {
    expect(tablePoint(down(1, 2), ground)).toEqual({ point: [1, 0, 2], id: null });
    expect(tablePoint(down(1, 2), () => ({ id: "t", point: [1, 0.5, 2] }))).toEqual({ point: [1, 0.5, 2], id: "t" });
    expect(tablePoint({ origin: [0, 1, 0], dir: [0, 1, 0] }, ground)).toBe(null); // the sky
  });

  it("lands on the ground, on the highest surface under the footprint, or on a connector (not with Alt)", () => {
    const W = composeMatrix({ position: [0, 0.3, 0] });
    let land = landingFor({ W, box: BOX, ray: down(2, 3), raycast: ground });
    expect(land.delta.map((v) => +v.toFixed(9))).toEqual([2, -0.3, 3]);
    expect(land.snapped).toBe(false);
    expect(land.on).toBe(null);
    expect(land.radius).toBeCloseTo(0.1);
    expect(land.lift).toBeCloseTo(0.05);
    // a block under one corner of the footprint, 0.4 high: it rests on that
    const block = (origin) => (origin[0] > 2 && origin[2] > 3 && origin[1] > 1 ? { id: "block", point: [origin[0], 0.4, origin[2]] } : null);
    land = landingFor({ W, box: BOX, ray: down(2, 3), raycast: block });
    expect(land.rest).toBeCloseTo(0.4);
    expect(land.on).toBe("block");
    expect(land.delta[1]).toBeCloseTo(0.1);
    // a connector nearby takes it there; Alt places it where it is
    const snaps = [{ world: [2.2, 0, 3.1], yaw: 1, radius: 0.5, objectId: "board" }];
    land = landingFor({ W, box: BOX, ray: down(2, 3), snaps, raycast: ground });
    expect(land.snapped).toBe(true);
    expect(land.spot).toEqual([2.2, 0, 3.1]);
    expect(land.yaw).toBe(1);
    expect(land.on).toBe("board");
    expect(landingFor({ W, box: BOX, ray: down(2, 3), snaps, raycast: ground, alt: true }).snapped).toBe(false);
    // looking at the sky: nowhere to land
    expect(landingFor({ W, box: BOX, ray: { origin: [0, 1, 0], dir: [0, 1, 0] }, raycast: ground })).toBe(null);
  });

  it("keeps the grab offset in plan", () => {
    const land = landingFor({ W: I, box: BOX, ray: down(1, 1), offset: [0.05, -0.05], raycast: ground });
    expect(land.spot.map((v) => +v.toFixed(9))).toEqual([1.05, 0, 0.95]);
  });

  it("carries: floats while moving, puts down without the lift", () => {
    const c = createCarry({ id: "a", W: I, box: BOX, raycast: ground });
    const land = c.move(down(1, 0));
    expect(c.state.W[13]).toBeCloseTo(land.lift);
    expect(c.state.W[12]).toBeCloseTo(1);
    const W = c.put();
    expect(close(W.slice(12, 15), [1, 0, 0])).toBe(true);
  });

  it("turns to a connector's yaw, and Q/E-style turns about the vertical", () => {
    const snaps = [{ world: [1, 0, 0], yaw: Math.PI / 2, radius: 0.5, objectId: "board" }];
    const c = createCarry({ id: "a", W: I, box: BOX, snaps, raycast: ground });
    c.move(down(1.1, 0));
    expect(yawOfMatrix(c.state.W)).toBeCloseTo(Math.PI / 2);
    expect(c.state.W[12]).toBeCloseTo(1);
    // off the connector, a turn stays
    const d = createCarry({ id: "a", W: I, box: BOX, raycast: ground });
    d.move(down(3, 3));
    d.turn(Math.PI / 4);
    expect(yawOfMatrix(d.state.W)).toBeCloseTo(Math.PI / 4);
    expect(d.state.W[12]).toBeCloseTo(3); // re-landed at the same pointer
  });

  it("Alt toggles snapping for the same pointer", () => {
    const snaps = [{ world: [1, 0, 0], yaw: null, radius: 0.5, objectId: "board" }];
    const c = createCarry({ id: "a", W: I, box: BOX, snaps, raycast: ground });
    expect(c.move(down(1.2, 0)).snapped).toBe(true);
    expect(c.alt(true).snapped).toBe(false);
    expect(c.state.W[12]).toBeCloseTo(1.2);
    expect(c.alt(false).snapped).toBe(true);
    expect(c.state.W[12]).toBeCloseTo(1);
  });

  it("turns face up where a landing rule asks, and back over when it leaves", () => {
    const faceDown = flipMatrix(I);
    const asked = [];
    const landing = (id, p, hitId) => (asked.push([id, hitId]), p[0] > 2 ? { faceUp: true } : null);
    const c = createCarry({ id: "card", W: faceDown, box: BOX, raycast: ground, landing });
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0); // still face down
    c.move(down(3, 0));
    expect(c.state.W[5]).toBeGreaterThan(0); // turned up for you
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0); // and back
    expect(asked[0]).toEqual(["card", null]);
    // F: it's up to you now; nothing turns it any more
    c.flip();
    expect(c.state.W[5]).toBeGreaterThan(0);
    c.move(down(3, 0));
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeGreaterThan(0);
  });

  it("is not turned by a rule that already held where it was picked up", () => {
    const c = createCarry({ id: "card", W: flipMatrix(I), box: BOX, raycast: ground, landing: () => ({ faceUp: true }) });
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0);
  });

  it("has nothing to put down before it moved", () => {
    expect(createCarry({ id: "a", W: I, box: BOX, raycast: ground }).put()).toBe(null);
  });
});
