// Who walk.people draws standing at a stand spot by its claim (DESIGN.md,
// "Presence under a body"): holder × the spot's trait, every case.

import { describe, it, expect } from "vitest";
import { standing } from "./people.js";

const deck = { transform: { position: [5, 1, -5], scale: 2 }, traits: { "walk.support": {} } };
const spot = (trait) => ({ parent: "deck", transform: { position: [1, 0, 0] }, traits: { "walk.stand": trait } });
const HOLDERS = {
  nobody: () => null,
  me: () => ({ session: "s-me", viewer: "viewer:me", mine: true }),
  someone: () => ({ session: "s-ana", viewer: "viewer:ana", mine: false }),
};
const TRAITS = {
  "no claim named": { at: [0, 0, 0.5] },
  'claim "stand"': { at: [0, 0, 0.5], claim: "stand" },
};

describe("standing: holder × stand spot", () => {
  for (const [holder, by] of Object.entries(HOLDERS))
    for (const [trait, t] of Object.entries(TRAITS)) {
      it(`${holder} × ${trait}`, () => {
        const scene = { objects: { deck, wheel: spot(t) } };
        const asked = [];
        const got = standing(scene, (id, kind) => (asked.push([id, kind]), by()), (on) => (on === "deck" ? 2 : 1));
        const drawn = holder === "someone" && t.claim === "stand";
        expect(asked).toEqual(t.claim ? [["wheel", "stand"]] : []);
        // drawn in the deck's frame, in metres (its scale 2): the spot at (1, 0, 0.5) of its units, facing its origin (forward)
        expect(got).toEqual(drawn ? [{ session: "s-ana", viewer: "viewer:ana", rec: { on: "deck", feet: [2, 0, 1], yaw: 0, pitch: 0 } }] : []);
      });
    }
  it("is 6 rows", () => expect(Object.keys(HOLDERS).length * Object.keys(TRAITS).length).toBe(6));
});
