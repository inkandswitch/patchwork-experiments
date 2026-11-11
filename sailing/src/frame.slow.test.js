// Sailing a hull drawn bow along +X: the stock hull a quarter turn round
// sails bow first, at the stock sloop's speed (seconds of sailing each: the
// slow tier).
import { describe, it, expect, afterEach } from "vitest";
import { STAND } from "./ship.js";
import { layOutShip, headTo } from "./layout.js";
import { placement } from "./parts.js";
import { createSeaView } from "./sea-view.js";
import { createSim } from "./sim.js";
import { SHIP } from "./traits.js";
import { emptyScene, fakeDrop, fakeNode, fakeWorld } from "./test/fakes.js";
import { near, quarter, rigSail, stated, turned } from "./test/frame-hulls.js";


// ─── sailing her ────────────────────────────────────────────────────────────

/**
 * The template's sloop, on a reach. `turned`: her hull is the quarter-turned
 * one, and everything aboard is put back on her as the parts bin would put
 * it (squared to her frame), so her body is where the stock one's is.
 */
async function sloop({ turned: isTurned = false, yaw = headTo(45 - 90) } = {}) {
  const doc = emptyScene();
  const hull = await layOutShip(
    fakeDrop(doc).ctx,
    { wind: { speed: 7, from: 45 }, seed: 3 },
  );
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), wheel: byName("Wheel"), windlass: byName("Windlass"), mast: byName("Mast") };
  // either hull is a drawing of its own (a stated bow, or turned a quarter), not
  // the stock hull's file: an imported model, with no key in doc.assets, so the
  // rig's stock contract is taken by neither (rig-contract.js, the gate)
  doc.objects[hull].sourceUrl = `automerge:${isTurned ? "turnedHull" : "statedHull"}`;
  const content = {
    [hull]: { loaded: true, ...(isTurned ? turned : stated), root: fakeNode() },
    [ids.rig]: { loaded: true, box: null, extras: rigSail, root: fakeNode({ Sail: fakeNode() }) },
  };
  doc.objects[hull].transform.rotation = [0, yaw, 0];
  if (isTurned) {
    // her model's +X is her bow: the hull object turns a quarter less, so her body heads where the stock one's does
    doc.objects[hull].transform.rotation = [0, yaw + Math.PI / 2, 0];
    // and each part aboard is put on her again, at its stand on her, as the bin would (squared to her frame)
    const part = { Mast: "mast", Wheel: "wheel", Windlass: "windlass", Ladder: "ladder", Mainsheet: "mainsheet", "Port jib winch": "winches" };
    for (const o of Object.values(doc.objects)) {
      if (o.parent !== hull) continue;
      o.transform = placement(doc, { parent: hull, transform: { position: quarter(STAND[part[o.name]]) } }, part[o.name], turned).transform;
    }
  }
  return { doc, ids, content };
}

/** A view that simulates: the sea and the ships, as play.js ticks them. */
function play(api) {
  const ctx = {};
  ctx.sea = createSeaView(api);
  ctx.sim = createSim(api, ctx);
  api.loop((dt, now) => {
    ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator());
    ctx.sim.tick(dt);
  });
  return ctx;
}

// two sloops sailed a while each: seconds, and more with the suite running beside it
describe("sailing a hull drawn bow along +X", { timeout: 60_000 }, () => {
  let w;
  afterEach(() => w?.done());

  async function run(isTurned, seconds = 30) {
    const { doc, ids, content } = await sloop({ turned: isTurned });
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const trace = [];
    for (let i = 0; i < seconds; i++) {
      w.tick(1 / 30, 30);
      trace.push(a.sim.read(ids.hull));
    }
    const m = w.view("A").api.worldOf(ids.hull);
    const held = w.holds.get(ids.hull).transform;
    const rig = w.holds.get(ids.rig).transform;
    w.done();
    w = null;
    return { trace, m, held, rig, doc, ids };
  }

  it("sails bow first, at the stock sloop's speed, and her boom swings about her mast", async () => {
    const stock = await run(false);
    const turnedRun = await run(true);
    const last = (r) => r.trace.at(-1);
    expect(last(stock).speed).toBeGreaterThan(1.5);
    // the same ship: the same speed, heading and heel all the way
    for (let i = 0; i < stock.trace.length; i++) {
      expect(turnedRun.trace[i].speed).toBeCloseTo(stock.trace[i].speed, 2);
      expect(turnedRun.trace[i].heading).toBeCloseTo(stock.trace[i].heading, 2);
      expect(turnedRun.trace[i].heel).toBeCloseTo(stock.trace[i].heel, 2);
    }
    // bow first: she moves along her model's +X (the stock one along its −Z)
    const along = (m, axis, v) => (m[axis * 4] * v[0] + m[axis * 4 + 2] * v[2]) / Math.hypot(m[axis * 4], m[axis * 4 + 2]) / Math.hypot(v[0], v[2]);
    expect(along(turnedRun.m, 0, last(turnedRun).velocity)).toBeGreaterThan(0.95);
    expect(-along(stock.m, 2, last(stock).velocity)).toBeGreaterThan(0.95);
    // the boom swung about the rig's own Y, on top of how it hangs from the (squared) mast
    expect(Math.abs(last(turnedRun).boom)).toBeGreaterThan(0.1);
    for (const r of [stock, turnedRun]) {
      expect(r.rig.rotation[1]).toBeCloseTo(last(r).boom, 3);
      expect(r.rig.rotation[0]).toBeCloseTo(0, 6);
      expect(r.rig.rotation[2]).toBeCloseTo(0, 6);
    }
  });

  it("is written down as her hull object, and a successor carries on from it as the same ship", async () => {
    const { doc, ids, content } = await sloop({ turned: true });
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 30, 12 * 30);
    const held = structuredClone(w.holds.get(ids.hull).transform);
    const before = a.sim.read(ids.hull);
    w.leave("A"); // a bye: A writes her down and lets go
    // the doc has her hull object where it was held, and her body's motion: along her heading, her model's +X
    near(doc.objects[ids.hull].transform.position, held.position, 2);
    near(doc.objects[ids.hull].transform.rotation, held.rotation, 3);
    const m = w.view("B").api.worldOf(ids.hull);
    const v = doc.objects[ids.hull].traits[SHIP].motion.velocity;
    expect((m[0] * v[0] + m[2] * v[2]) / Math.hypot(m[0], m[2]) / Math.hypot(v[0], v[2])).toBeGreaterThan(0.9);
    // B takes over from there: no jump, the same heading and way
    w.tick(1 / 30, 2);
    expect(b.sim.simulating()).toBe(true);
    const after = b.sim.read(ids.hull);
    expect(after.heading).toBeCloseTo(before.heading, 1);
    expect(Math.abs(after.speed - before.speed)).toBeLessThan(0.3);
    near(w.holds.get(ids.hull).transform.position.map((x) => x / 10), held.position.map((x) => x / 10), 0);
  });

  it("when her model says which way is forward only once it's loaded, her hull stays where it is", async () => {
    const { doc, ids, content } = await sloop({ turned: true });
    const loaded = content[ids.hull];
    content[ids.hull] = { loaded: false, box: null, extras: null, root: null };
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    w.tick(1 / 30, 30);
    const before = structuredClone(w.holds.get(ids.hull).transform);
    content[ids.hull] = loaded;
    w.tick(1 / 30, 1);
    const after = w.holds.get(ids.hull).transform;
    near(after.position, before.position, 0);
    expect(Math.abs(after.rotation[1] - before.rotation[1])).toBeLessThan(0.05);
    // and from then on her body is her model's +X: she heads where the stock sloop would
    w.tick(1 / 30, 30);
    expect(a.sim.read(ids.hull)).not.toBeNull();
  });

  it("an editor's move starts her at rest where she was put, her body level and heading her model's +X", async () => {
    const { doc, ids, content } = await sloop({ turned: true });
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    w.tick(1 / 30, 30);
    w.change((d) => {
      d.objects[ids.hull].transform.position = [40, 0, 40];
      d.objects[ids.hull].transform.rotation = [0, Math.PI / 2, 0]; // her model's +X toward −Z: bow north
    });
    w.tick(1 / 30, 1);
    const read = a.sim.read(ids.hull);
    expect(Math.hypot(...read.velocity)).toBeLessThan(0.3); // over the ground: the waves' orbits move the water under her
    // heading 0 is north (−Z)
    expect(Math.abs(Math.atan2(Math.sin(read.heading), Math.cos(read.heading)))).toBeLessThan(0.02);
    const held = w.holds.get(ids.hull).transform;
    expect(held.position[0]).toBeCloseTo(40, 1);
    expect(held.rotation[1]).toBeCloseTo(Math.PI / 2, 2);
  });
});
