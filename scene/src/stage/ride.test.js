import { describe, it, expect } from "vitest";
import { createRides, rideFrame, rideMove } from "./ride.js";
import { composeMatrix } from "../transform.js";

const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);
const at = (position, yaw = 0, extra = {}) => composeMatrix({ position, rotation: [extra.roll ?? 0, yaw, extra.pitch ?? 0] });

describe("a ride's maths", () => {
  it("reads where an object is and which way it heads", () => {
    const f = rideFrame(at([1, 2, 3], 0.4));
    expect(r6(f.p)).toEqual([1, 2, 3]);
    expect(f.yaw).toBeCloseTo(0.4);
  });

  it("moves a point by the shift, the turn about the vertical through where it was, and the rise", () => {
    const last = { p: [0, 0, 0], yaw: 0 };
    const now = { p: [1, 0.5, 0], yaw: Math.PI / 2 };
    // +Z one metre out, turned a quarter (+Z → +X), then shifted
    expect(r6(rideMove(last, now)([0, 2, 1]))).toEqual([2, 2.5, 0]);
    expect(r6(rideMove(last, now, { turn: false })([0, 2, 1]))).toEqual([1, 2.5, 1]);
    expect(r6(rideMove(last, now, { rise: false })([0, 2, 1]))).toEqual([2, 2, 0]);
  });

  it("turns the short way across ±π", () => {
    const m = rideMove({ p: [0, 0, 0], yaw: Math.PI - 0.1 }, { p: [0, 0, 0], yaw: -Math.PI + 0.1 });
    // a turn of +0.2, not −6.08
    const p = m([0, 0, 1]);
    expect(p[0]).toBeCloseTo(Math.sin(0.2));
    expect(p[2]).toBeCloseTo(Math.cos(0.2));
  });
});

describe("rides", () => {
  const cam = { position: [0, 2, 5], target: [0, 1, 0] };

  it("follows the delta since the last frame, starting from the frame it first sees", () => {
    const rides = createRides();
    let m = at([0, 0, 0]);
    rides.add("hull");
    expect(rides.step({ worldOf: () => m, held: false, ...cam })).toBe(null); // the baseline
    m = at([2, 0.3, 0]);
    const out = rides.step({ worldOf: () => m, held: false, ...cam });
    expect(r6(out.position)).toEqual([2, 2.3, 5]);
    expect(r6(out.target)).toEqual([2, 1.3, 0]);
    // not moved: nothing to do
    expect(rides.step({ worldOf: () => m, held: false, ...cam })).toBe(null);
  });

  it("rides a point of the object: that point's shift, the turn about it; the first baseline can be given", () => {
    const rides = createRides();
    // a table 2 m up the mast-less hull, rolled: its top moves sideways though the origin doesn't
    const start = at([0, 0, 0]);
    rides.add("hull", { at: [0, 2, 0] }, start);
    const rolled = at([0, 0, 0], 0, { roll: 0.1 });
    const out = rides.step({ worldOf: () => rolled, held: false, position: [0, 3, 1], target: [0, 2, 0] });
    // the point [0, 2, 0] rolled about X by 0.1: y = 2 cos, z = 2 sin; the camera goes with it
    expect(out.target[1]).toBeCloseTo(2 * Math.cos(0.1));
    expect(out.target[2]).toBeCloseTo(2 * Math.sin(0.1));
    expect(out.position[2] - out.target[2]).toBeCloseTo(1);
  });

  it("never follows roll or pitch", () => {
    const rides = createRides();
    let m = at([0, 0, 0]);
    rides.add("hull");
    rides.step({ worldOf: () => m, held: false, ...cam });
    m = at([0, 0, 0], 0, { roll: 0.2, pitch: 0.1 });
    const out = rides.step({ worldOf: () => m, held: false, ...cam });
    expect(out === null || r6(out.position).join() === r6(cam.position).join()).toBe(true);
  });

  it("the latest applies, a fallback only when nothing else rides; leaving one re-baselines the next", () => {
    const rides = createRides();
    const worlds = { ship: at([0, 0, 0]), table: at([0, 1, 0]) };
    const worldOf = (id) => worlds[id];
    const offShip = rides.add("ship", { fallback: true, turn: false });
    expect(rides.current().id).toBe("ship");
    const offTable = rides.add("table");
    expect(rides.current().id).toBe("table");
    // a fallback added later still gives way
    const offOther = rides.add("other", { fallback: true });
    expect(rides.current().id).toBe("table");
    offOther();
    rides.step({ worldOf, held: false, ...cam });
    worlds.table = at([1, 1, 0]);
    expect(r6(rides.step({ worldOf, held: false, ...cam }).position)).toEqual([1, 2, 5]);
    offTable();
    // the ship's ride starts from this frame: the table's move isn't followed twice
    worlds.ship = at([5, 0, 0]);
    expect(rides.step({ worldOf, held: false, ...cam })).toBe(null);
    worlds.ship = at([6, 0, 0]);
    expect(r6(rides.step({ worldOf, held: false, ...cam }).position)).toEqual([1, 2, 5]);
    offShip();
    expect(rides.current()).toBe(null);
    expect(rides.step({ worldOf, held: false, ...cam })).toBe(null);
  });

  it("is skipped while the camera is held, and starts again from where the object is then", () => {
    const rides = createRides();
    let m = at([0, 0, 0]);
    rides.add("hull");
    rides.step({ worldOf: () => m, held: false, ...cam });
    m = at([3, 0, 0]);
    expect(rides.step({ worldOf: () => m, held: true, ...cam })).toBe(null);
    m = at([4, 0, 0]);
    // one metre since the last frame it saw (held), not four
    expect(r6(rides.step({ worldOf: () => m, held: false, ...cam }).position)).toEqual([1, 2, 5]);
  });

  it("an object that's gone moves nothing, and is a new baseline when it's back", () => {
    const rides = createRides();
    let m = at([0, 0, 0]);
    rides.add("hull");
    rides.step({ worldOf: () => m, held: false, ...cam });
    expect(rides.step({ worldOf: () => null, held: false, ...cam })).toBe(null);
    m = at([9, 0, 0]);
    expect(rides.step({ worldOf: () => m, held: false, ...cam })).toBe(null);
  });
});

describe("rides that wait their turn", () => {
  it("a fallback asked for while another applies starts from where its object is when it comes to apply", () => {
    const rides = createRides();
    const worlds = { table: at([0, 1, 0]), ship: at([0, 0, 0]) };
    const worldOf = (id) => worlds[id];
    const cam = { position: [0, 2, 5], target: [0, 1, 0] };
    const offTable = rides.add("table", {}, worlds.table);
    rides.add("ship", { fallback: true }, worlds.ship); // its baseline: here
    worlds.ship = at([50, 0, 0]);
    worlds.table = at([50, 1, 0]);
    rides.step({ worldOf, held: false, ...cam });
    offTable();
    // the ship's 50 m happened while the table's ride applied: not followed again
    expect(rides.step({ worldOf, held: false, ...cam })).toBe(null);
  });
});
