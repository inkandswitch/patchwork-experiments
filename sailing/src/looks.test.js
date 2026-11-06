// What each view dresses for itself: floats on the waves, the sail's belly
// and how far it's raised. The pure maths, then createLooks on a fake stage.
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./ocean.js";
import { FLAT, boomToPort, createLooks, floatPose, fullness } from "./looks.js";
import { createSeaView } from "./sea-view.js";
import { FLOAT, SEA } from "./traits.js";
import { composeMatrix, fakeNode, fakeWorld } from "./test/fakes.js";

const DEG = Math.PI / 180;

describe("floating", () => {
  const sea = createOcean({ wind: { speed: 9, from: 30 }, seed: 4 });

  it("rides up and down with the water where it's moored", () => {
    const m = composeMatrix({ position: [5, 0, -7], rotation: [0, 0, 0] });
    for (const t of [0, 1.3, 4.2]) {
      const { offset } = floatPose(sea, m, t);
      expect(offset[1]).toBeCloseTo(sea.heightAt(5, -7, t), 6);
      expect(Math.abs(offset[0]) + Math.abs(offset[2])).toBeLessThan(1e-12);
    }
  });

  it("tilts with the slope, in its own frame, and not at all on a flat sea", () => {
    const flat = createOcean({ wind: { speed: 0, from: 0 } });
    expect(floatPose(flat, composeMatrix({ position: [1, 0, 1] }), 3).tilt.map(Math.abs)).toEqual([0, 0]);
    // turned half round, the same water tilts it the other way in its frame
    const t = 2.1;
    const a = floatPose(sea, composeMatrix({ position: [3, 0, 3] }), t).tilt;
    const b = floatPose(sea, composeMatrix({ position: [3, 0, 3], rotation: [0, Math.PI, 0] }), t).tilt;
    expect(b[0]).toBeCloseTo(-a[0], 6);
    expect(b[1]).toBeCloseTo(-a[1], 6);
    // scaled up, the same rise is fewer of its own units
    const big = floatPose(sea, composeMatrix({ position: [3, 0, 3], scale: 2 }), t);
    expect(big.offset[1]).toBeCloseTo(sea.heightAt(3, 3, t) / 2, 6);
  });
});

describe("the sail", () => {
  it("the boom is to port when the rig's aft axis points to the hull's port side, as drawn", () => {
    const hull = composeMatrix({ position: [0, 0, 0], rotation: [0, 1, 0] });
    const rig = (boom) => composeMatrix({ position: [0, 2, 0], rotation: [0, 1 + boom, 0] });
    expect(boomToPort(hull, rig(-0.5))).toBe(true);
    expect(boomToPort(hull, rig(0.5))).toBe(false);
    expect(boomToPort(hull, rig(0))).toBe(false);
  });

  it("is drawn full when the wind meets it, flat while it luffs, and between on the way", () => {
    // beam reach: wind from 90° to starboard, boom out 60° to port: drawing hard
    expect(fullness({ apparentWind: { angle: 90 * DEG }, boom: -60 * DEG })).toBe(1);
    // head to wind, the boom along the wind: flogging
    expect(fullness({ apparentWind: { angle: 2 * DEG }, boom: 1 * DEG })).toBe(FLAT);
    const mid = fullness({ apparentWind: { angle: 30 * DEG }, boom: -20 * DEG });
    expect(mid).toBeGreaterThan(FLAT);
    expect(mid).toBeLessThan(1);
    expect(fullness(null)).toBe(1);
  });
});

describe("createLooks", () => {
  let w;
  afterEach(() => w?.done());

  const object = (extra) => ({ name: "Object", parent: null, group: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });

  it("bobs what floats on the clock the sea is drawn at, and puts it back on dispose", () => {
    const doc = {
      objects: { buoy: object({ name: "Buoy", transform: { position: [8, 0, -20], rotation: [0, 0.3, 0], scale: 1 }, traits: { [FLOAT]: {} } }), rock: object({ name: "Rock" }) },
      order: ["buoy", "rock"],
      traits: { [SEA]: { wind: { speed: 8, from: 90 }, seed: 2, scale: 1 } },
      view: {},
    };
    const root = fakeNode();
    const rock = fakeNode();
    w = fakeWorld(doc, { content: { buoy: { loaded: true, root }, rock: { loaded: true, root: rock } } });
    const api = w.join("A");
    const sea = createSeaView(api);
    const looks = createLooks(api, { sea, sim: { ships: () => [] } });
    api.loop((dt, now) => {
      sea.tick(dt, now, false, null);
      looks.tick(dt);
    });
    w.tick(1 / 60, 45);
    const expected = floatPose(sea.ocean, api.worldOf("buoy"), sea.clock());
    expect(root.position.y).toBeCloseTo(expected.offset[1], 9);
    expect(root.rotation.x).toBeCloseTo(expected.tilt[0], 9);
    expect(root.position.y).not.toBe(0);
    expect(rock.position.y).toBe(0);
    looks.dispose();
    expect(root.position.y).toBe(0);
    expect(root.rotation.x).toBe(0);
  });
});
