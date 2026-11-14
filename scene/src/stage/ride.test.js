import { describe, it, expect } from "vitest";
import { createRides, rideFrame, rideMove, upOf, wholeMove } from "./ride.js";
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

  it("the body's ride is the only one while it is set; else the latest base ride; leaving one re-baselines the next", () => {
    const rides = createRides();
    const worlds = { ship: at([0, 0, 0]), table: at([0, 1, 0]), other: at([0, 0, 0]) };
    const worldOf = (id) => worlds[id];
    const offShip = rides.add("ship", { turn: false });
    expect(rides.current().id).toBe("ship");
    rides.body({ id: "table" });
    expect(rides.current().id).toBe("table");
    // a base ride added later still gives way to the body's
    const offOther = rides.add("other");
    expect(rides.current().id).toBe("table");
    offOther();
    rides.step({ worldOf, held: false, ...cam });
    worlds.table = at([1, 1, 0]);
    expect(r6(rides.step({ worldOf, held: false, ...cam }).position)).toEqual([1, 2, 5]);
    rides.body(null);
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
  it("a base ride asked for while the body's applies starts from where its object is when it comes to apply", () => {
    const rides = createRides();
    const worlds = { table: at([0, 1, 0]), ship: at([0, 0, 0]) };
    const worldOf = (id) => worlds[id];
    const cam = { position: [0, 2, 5], target: [0, 1, 0] };
    rides.body({ id: "table" }, worlds.table);
    rides.add("ship", {}, worlds.ship); // its baseline: here
    worlds.ship = at([50, 0, 0]);
    worlds.table = at([50, 1, 0]);
    rides.step({ worldOf, held: false, ...cam });
    rides.body(null);
    // the ship's 50 m happened while the table's ride applied: not followed again
    expect(rides.step({ worldOf, held: false, ...cam })).toBe(null);
  });
});

describe("a ride that tilts (a seat rolls with its table)", () => {
  const [make, frame, up, whole] = [createRides, rideFrame, upOf, wholeMove];
  const rot = (roll, yaw, at = [0, 0, 0]) => {
    // Rz(roll) then Ry(yaw), column-major, at `at`
    const cr = Math.cos(roll), sr = Math.sin(roll), cy = Math.cos(yaw), sy = Math.sin(yaw);
    // R = Ry · Rz
    const r = [cy * cr, sr, -sy * cr, -cy * sr, cr, sy * sr, sy, 0, cy];
    return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, at[0], at[1], at[2], 1];
  };
  it("moves the camera and its target with the object whole, and gives its up, for every roll and turn in a finite set", () => {
    for (const roll of [-0.35, -0.1, 0, 0.1, 0.35])
      for (const yaw of [0, 0.5, -1.2])
        for (const at of [[0, 0, 0], [3, 0.7, -2]]) {
          const rides = make();
          const m0 = rot(0, 0, [1, 0, 0]);
          rides.body({ id: "t", tilt: true, at }, m0);
          const m1 = rot(roll, yaw, [1, 0.2, 0]);
          const cam = { position: [1, 1.2, 0.8], target: [1, 0.7, 0] };
          const out = rides.step({ worldOf: () => m1, held: false, ...cam });
          if (roll === 0 && yaw === 0) {
            // only the shift: still moved whole
            expect(out.up.map((v) => +v.toFixed(12))).toEqual([0, 1, 0]);
          }
          // the camera's point in the object's frame is the same before and after
          const into = (m, q) => whole(frame(m), frame(rot(0, 0, [0, 0, 0])))(q);
          const before = into(m0, cam.position);
          const after = into(m1, out.position);
          for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 9);
          expect(out.up.map((v, i) => Math.abs(v - up(m1)[i]) < 1e-12).every(Boolean)).toBe(true);
          expect(rides.tilts()).toBe(true);
        }
  });
  it("a ride that doesn't tilt never gives an up", () => {
    const rides = make();
    rides.body({ id: "t", at: [0, 0, 0] }, rot(0, 0));
    const out = rides.step({ worldOf: () => rot(0.3, 0.2, [0, 0.1, 0]), held: false, position: [0, 1, 1], target: [0, 0, 0] });
    expect(out.up).toBeUndefined();
    expect(rides.tilts()).toBe(false);
  });
});
