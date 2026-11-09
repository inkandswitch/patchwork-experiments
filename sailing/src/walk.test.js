// Walking's pure helpers and its numbers. The walking itself is walker.js
// over a navmesh (walker.test.js, navmesh.test.js).
import { describe, it, expect } from "vitest";
import { BODY, DECK, look, lookDir, wishVelocity } from "./walk.js";
import { NAV, apexOf, navParams } from "./navmesh.js";

const FORWARD = { forward: 1, strafe: 0 };

describe("the keys and the mouse", () => {
  it("forward is -z at yaw 0, and diagonal is no faster", () => {
    const [x, z] = wishVelocity(FORWARD, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-BODY.walk);
    const [dx, dz] = wishVelocity({ forward: 1, strafe: 1 }, 0);
    expect(Math.hypot(dx, dz)).toBeCloseTo(BODY.walk);
  });

  it("looks about without turning over", () => {
    expect(look(0, 0, 0, -1e6).pitch).toBeLessThan(Math.PI / 2);
    expect(lookDir(0, 0)[2]).toBeCloseTo(-1);
  });
});

describe("the deck's numbers (DESIGN.md's table)", () => {
  it("DECK carries the navmesh's parameters", () => {
    expect(navParams(DECK)).toEqual(NAV);
  });

  it("the step sits in the gap: above the cockpit's rise (0.546), below the lifeline beside the deck (0.61)", () => {
    expect(DECK.step).toBeGreaterThan(0.546);
    expect(DECK.step).toBeLessThan(0.61);
  });

  it("a jump clears the lifelines (0.625 over the deck beside them) and never reaches the windlass's top (0.68)", () => {
    const apex = apexOf(DECK);
    expect(apex).toBeCloseTo(0.661, 3);
    expect(apex).toBeGreaterThan(0.625);
    expect(apex).toBeLessThan(0.68);
  });
});
