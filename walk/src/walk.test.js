import { describe, it, expect } from "vitest";
import { BODY, look, lookDir, wishVelocity } from "./walk.js";


describe("walking", () => {
  it("forward is -z at yaw 0, and diagonal is no faster", () => {
    const [x, z] = wishVelocity({ forward: 1, strafe: 0 }, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-BODY.walk);
    const [dx, dz] = wishVelocity({ forward: 1, strafe: 1 }, 0);
    expect(Math.hypot(dx, dz)).toBeCloseTo(BODY.walk);
  });

  it("looks about without turning over", () => {
    const l = look(0, 0, 0, -1e6);
    expect(l.pitch).toBeLessThan(Math.PI / 2);
    const d = lookDir(0, 0);
    expect(d[2]).toBeCloseTo(-1);
  });
});

describe("walk's traits' part (walk.spawn)", () => {
  it("declares every walk trait, so a doc that carries one calls for this package; Walk from here is on a spawn point, unless walking", async () => {
    const { plugins } = await import("./index.js");
    const spawn = plugins.find((p) => p.id === "walk.spawn");
    expect(spawn.traits).toEqual(["walk.spawn", "walk.support", "walk.moves", "walk.stand", "walk.ladder"]);
    for (const t of spawn.traits) expect([t, spawn.describes[t]?.on]).toEqual([t, "object"]);
    expect(plugins.find((p) => p.id === "walk").traits).toEqual(["*"]); // every stage offers the body (a boat linked into a harbour is boarded in her own)
    const { walkFromState } = await import("./spawn.js");
    const scene = { objects: { pad: { traits: { "walk.spawn": {} } }, crate: {} } };
    for (const body of ["look", "seat", "walk"])
      for (const target of ["pad", "crate", null, "gone"]) {
        const st = walkFromState(target, { scene, view: { body: { id: body } } });
        expect(!!st, `${body} ${target}`).toBe(target === "pad" && body !== "walk");
      }
  });
});
