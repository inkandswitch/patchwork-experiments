// createSim on a stage, the cases that sail her for many seconds of
// simulated time (the slow tier): the rest are in sim.test.js.
import { describe, it, expect, afterEach } from "vitest";
import { DEPTH, SLACK } from "./sim.js";
import { ANCHOR, SHIP } from "./traits.js";
import { fakeWorld } from "./test/fakes.js";
import { heldAt, play, sloop } from "./test/sim-stage.js";
import { headTo } from "./layout.js";

describe("createSim on a stage", () => {
  let w;
  afterEach(() => w?.done());

  it("one view simulates: it holds the hull as the wind pushes it, and the other follows", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 1);
    expect(a.sim.simulating()).toBe(true);
    expect(b.sim.simulating()).toBe(false);
    expect(doc.claims.sim.session).toBe("A");
    expect(w.holds.get(ids.hull).session).toBe("A");

    const start = [...doc.objects[ids.hull].transform.position];
    w.tick(1 / 60, 8 * 60);
    const p = heldAt(w, ids.hull).position;
    expect(Math.hypot(p[0] - start[0], p[2] - start[2])).toBeGreaterThan(1);
    // every hold is the simulator's: the hull, the boom, the wheel
    for (const id of [ids.hull, ids.rig, ids.wheel]) expect(w.holds.get(id)?.session).toBe("A");
    // the boom swings with the wind, as read
    expect(heldAt(w, ids.rig).rotation[1]).toBeCloseTo(a.sim.read(ids.hull).boom, 3);
    // the follower reads the same ship, streamed
    const ra = a.sim.read(ids.hull);
    const rb = b.sim.read(ids.hull);
    expect(rb).not.toBeNull();
    expect(rb.speed).toBeGreaterThan(0.3);
    // (streamed at 5 Hz: up to 200 ms behind a ship that's gathering way)
    expect(Math.abs(rb.speed - ra.speed)).toBeLessThan(0.35);
    // and runs the sea's clock at the moment its poses are drawn (on this fake stage, as they come)
    expect(b.sea.clock()).toBeCloseTo(a.sea.clock(), 1);
    // the physics' time is the sea's
    expect(a.sea.clock()).toBeGreaterThan(7.9);
  });

  it("writes the ship to the doc now and then, not every frame", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    let writes = 0;
    let last = JSON.stringify(doc.objects[ids.hull].transform);
    for (let i = 0; i < 25 * 60; i++) {
      w.tick(1 / 60);
      const now = JSON.stringify(doc.objects[ids.hull].transform);
      if (now !== last) writes++;
      last = now;
    }
    expect(writes).toBeGreaterThanOrEqual(2);
    expect(writes).toBeLessThanOrEqual(4);
    expect(doc.objects[ids.hull].traits[SHIP].motion.velocity).toHaveLength(3);
  }, 30_000); // 25 s of her at 60 Hz: about 4.5 s alone, more beside the rest of the suite

  it("the station holder's input reaches the physics: hard to starboard turns her to starboard", async () => {
    const headingAfter = async (angle) => {
      const { doc, ids, content } = await sloop();
      w = fakeWorld(doc, { content });
      const a = play(w.join("A"));
      const bApi = w.join("B");
      const b = play(bApi);
      w.tick(1 / 60, 3 * 60);
      expect(bApi.claim(ids.wheel, "station")).toBeTypeOf("function");
      b.sim.input(ids.wheel, { angle });
      w.tick(1 / 60, 1);
      // the simulator reads it from B's presence
      expect(a.sim.value(ids.wheel).angle).toBe(angle);
      const h0 = a.sim.read(ids.hull).heading;
      w.tick(1 / 60, 6 * 60);
      const h = a.sim.read(ids.hull).heading;
      w.done();
      return Math.atan2(Math.sin(h - h0), Math.cos(h - h0));
    };
    const straight = await headingAfter(0);
    const turned = await headingAfter(1);
    expect(turned - straight).toBeGreaterThan(0.15);
    w = null;
  });

  it("lets the anchor go under the bow, writes where it lies, and holds her to it", async () => {
    const { doc, ids, content } = await sloop({ down: true, yaw: headTo(45) });
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    w.tick(1 / 60, 1);
    const at = doc.objects[ids.windlass].traits[ANCHOR].at;
    expect(at[1]).toBe(-DEPTH);
    // the anchor itself lies there, held in the hull's frame
    expect(w.holds.get(ids.anchor)?.session).toBe("A");
    w.tick(1 / 60, 20 * 60);
    const p = heldAt(w, ids.hull).position;
    expect(Math.hypot(p[0] - at[0], p[2] - at[2])).toBeLessThan(DEPTH + SLACK + 12);
    // weighed: the spot is forgotten and the anchor hangs at the bow again
    w.change((d) => (d.objects[ids.windlass].traits[ANCHOR].down = false));
    w.tick(1 / 60, 1);
    expect(doc.objects[ids.windlass].traits[ANCHOR].at).toBeUndefined();
    expect(w.holds.has(ids.anchor)).toBe(false);
  });
});
