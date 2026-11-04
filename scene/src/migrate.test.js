import { describe, it, expect } from "vitest";
import { migrateCore, needsCoreMigration } from "./migrate.js";
import { resolveLinks, worldMatrix } from "./hierarchy.js";
import { applyMatrix } from "./transform.js";

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });

/** World origins as the old shape had them: groups were parents with transforms. */
function oldWorlds(objects) {
  const parents = resolveLinks(objects, (id) => (objects[id]?.parent && objects[objects[id].parent] ? objects[id].parent : null));
  return Object.fromEntries(Object.keys(objects).map((id) => [id, applyMatrix(worldMatrix(objects, id, parents), [0, 0, 0])]));
}

describe("upgrading groups", () => {
  // vessel (group, down 0.7, turned) ─ body (group, at x 2, ×2) ─┬─ hull ── cleat (attached)
  //                                                               └─ deck
  // mast (object) ── rig (group, attached to the mast, up 3) ── flag
  const old = () => ({
    vessel: { kind: "group", name: "Vessel", parent: null, transform: T([0, -0.7, 0], [0, 0.5, 0]) },
    body: { kind: "group", name: "Body", parent: "vessel", transform: T([2, 0, 0], [0, 0, 0], 2) },
    hull: { name: "Hull", parent: "body", transform: T([1, 0, 0]) },
    cleat: { name: "Cleat", parent: "hull", transform: T([0, 1, 0]) },
    deck: { name: "Deck", parent: "body", transform: T() },
    mast: { name: "Mast", parent: null, transform: T([5, 0, 0]) },
    rig: { kind: "group", name: "Rig", parent: "mast", transform: T([0, 3, 0]) },
    flag: { name: "Flag", parent: "rig", transform: T([0, 1, 0]) },
  });

  it("files each object in its nearest group, attaches it to its nearest object, and keeps it where it was", () => {
    const d = { objects: old(), view: {} };
    const was = oldWorlds(d.objects);
    expect(needsCoreMigration(d)).toBe(true);
    migrateCore(d);
    expect(needsCoreMigration(d)).toBe(false);
    const o = d.objects;
    expect(o.vessel).toEqual({ kind: "group", name: "Vessel", group: null });
    expect(o.body).toEqual({ kind: "group", name: "Body", group: "vessel" });
    expect(o.hull).toMatchObject({ group: "body", parent: null });
    expect(o.cleat).toMatchObject({ group: "body", parent: "hull", transform: T([0, 1, 0]) }); // attached as it was: untouched
    expect(o.flag).toMatchObject({ group: "rig", parent: "mast" }); // the rig's lift baked in, still on the mast
    expect(o.rig).toEqual({ kind: "group", name: "Rig", group: null });
    for (const id of ["hull", "cleat", "deck", "mast", "flag"]) {
      applyMatrix(worldMatrix(o, id), [0, 0, 0]).forEach((v, i) => expect(v, id).toBeCloseTo(was[id][i], 9));
    }
  });

  it("is a no-op on the current shape, and the same on every peer", () => {
    const d = { objects: old(), view: {} };
    migrateCore(d);
    const again = JSON.parse(JSON.stringify(d));
    migrateCore(again);
    expect(again).toEqual(d);
    const other = { objects: old(), view: {} };
    migrateCore(other);
    expect(other).toEqual(d);
  });
});
