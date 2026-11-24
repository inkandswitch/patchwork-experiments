import { describe, expect, it } from "vitest";
import { modelOf, snapshotOf } from "./model.js";

const T = (position) => ({ position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] });

describe("the derived model (model.js)", () => {
  it("over every placement of three objects in two groups, nested or not: a group's members are what is in it at any depth", () => {
    const where = [null, "g1", "g2"];
    let cases = 0;
    for (const nested of [false, true])
      for (let k = 0; k < 27; k++) {
        const objects = { g1: { kind: "group" }, g2: { kind: "group", ...(nested ? { group: "g1" } : {}) } };
        const placed = ["a", "b", "c"].map((id, i) => [id, where[Math.floor(k / 3 ** i) % 3]]);
        for (const [id, g] of placed) objects[id] = { name: id, transform: T([0, 0, 0]), ...(g ? { group: g } : {}) };
        const inG = (id, g) => {
          for (let at = objects[id].group; at; at = objects[at].group) if (at === g) return true;
          return false;
        };
        const m = modelOf({ objects });
        for (const g of ["g1", "g2"]) expect([nested, k, g, m.members.get(g)]).toEqual([nested, k, g, placed.map(([id]) => id).filter((id) => inG(id, g))]);
        cases++;
      }
    expect(cases).toBe(54);
  });

  it("the snapshot is one frozen value per model; toLocal undoes world down a chain", () => {
    const d = { objects: { p: { name: "p", transform: T([1, 2, 3]) }, c: { name: "c", parent: "p", transform: T([0, 1, 0]) } } };
    const m = modelOf(d);
    const s = snapshotOf(m);
    expect(snapshotOf(m)).toBe(s);
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.world("c").slice(12, 15)).toEqual([1, 3, 3]);
    expect(s.toLocal("c", [1, 3, 3])).toEqual([0, 0, 0]);
    expect(s.d).toBe(d);
    expect(s.traits).toEqual({});
  });
});
