// A hull modelled another way round sails as the sloop does: the stock hull
// drawn a quarter turn round (bow along +X, as camber draws one), with
// extras.ship.forward saying so, gets the same spec, sails bow first, and
// makes the same speed; and the rig you place is what drives her.
import { describe, it, expect, afterEach } from "vitest";
import { encodeGLB } from "./glb.js";
import { STAND, partGLB, partMeshes } from "./ship.js";
import { layOutShip, headTo } from "./layout.js";
import { PIECES, placement } from "./parts.js";
import { frameOf, placeIn } from "./body.js";
import { createSeaView } from "./sea-view.js";
import { createSim, specFor } from "./sim.js";
import { SLOOP, createShip } from "./physics.js";
import { SAIL, SHIP } from "./traits.js";
import { fakeNode, fakeWorld } from "./test/fakes.js";

/** What the stage would read off a GLB: the box of its positions, and the scene's extras. */
function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }
  return { box: { min, max }, extras: json.scenes[0].extras ?? {} };
}

/** The stock hull a quarter turn round: her bow (−Z) along +X, her starboard (+X) along +Z, saying so. */
function turnedHull() {
  const turn = (a) => {
    if (!a) return a;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) {
      out[i] = -a[i + 2];
      out[i + 1] = a[i + 1];
      out[i + 2] = a[i];
    }
    return out;
  };
  const meshes = partMeshes("hull").map((m) => ({ ...m, primitives: m.primitives.map((p) => ({ ...p, positions: turn(p.positions), normals: turn(p.normals) })) }));
  const stock = readGLB(partGLB("hull").bytes).extras.ship;
  return encodeGLB({ meshes, extras: { ship: { ...stock, forward: [1, 0, 0], up: [0, 1, 0] } } });
}

const stockHull = readGLB(partGLB("hull").bytes);
const turned = readGLB(turnedHull());
// the stock hull saying its bow is −Z: a stated bow puts her body's origin
// midships (her box's middle), as the turned one's, so the two are one ship
const stated = { ...stockHull, extras: { ...stockHull.extras, ship: { ...stockHull.extras.ship, forward: [0, 0, -1], up: [0, 1, 0] } } };
const rigSail = readGLB(partGLB("rig").bytes).extras;

const near = (a, b, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
function nearDeep(a, b, digits = 6) {
  if (typeof a === "number") return expect(a).toBeCloseTo(b, digits);
  if (Array.isArray(a)) return a.forEach((v, i) => nearDeep(v, b[i], digits));
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(a)) nearDeep(a[k], b[k], digits);
}

/** A point in the stock hull's frame, in the quarter-turned one's. */
const quarter = ([x, y, z]) => [-z, y, x];

describe("a hull drawn bow along +X", () => {
  it("states its bow, and its box is the stock one's turned", () => {
    expect(turned.extras.ship.forward).toEqual([1, 0, 0]);
    const { min, max } = stockHull.box;
    near(turned.box.min, [-max[2], min[1], min[0]], 4);
    near(turned.box.max, [-min[2], max[1], max[0]], 4);
  });

  it("gets the stock hull's spec, its rig squared to her as the bin puts it", () => {
    const specOf = (glb, step) => {
      const doc = { objects: { h: { traits: { [SHIP]: {} } } } };
      doc.objects.m = placement(doc, { parent: "h", transform: { position: step } }, "mast", glb);
      doc.objects.r = { parent: "m", transform: { position: PIECES.mast[1].at } };
      return specFor(glb, undefined, 1, { frame: frameOf({}, glb), rig: { matrix: placeIn(doc, "r", "h"), sail: rigSail.sail } });
    };
    nearDeep(specOf(turned, quarter(STAND.mast)), specOf(stated, STAND.mast));
  });
});

// ─── sailing her ────────────────────────────────────────────────────────────

/**
 * The template's sloop, on a reach. `turned`: her hull is the quarter-turned
 * one, and everything aboard is put back on her as the parts bin would put
 * it (squared to her frame), so her body is where the stock one's is.
 */
async function sloop({ turned: isTurned = false, yaw = headTo(45 - 90) } = {}) {
  const doc = { objects: {}, order: [], traits: {}, view: {}, dimensions: {} };
  let n = 0;
  const hull = await layOutShip(
    { repo: { create2: async () => ({ url: `automerge:f${++n}` }) }, change: (fn) => fn(doc), newId: (p) => `${p}${++n}` },
    { wind: { speed: 7, from: 45 }, seed: 3 },
  );
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), wheel: byName("Wheel"), windlass: byName("Windlass"), mast: byName("Mast") };
  const content = {
    [hull]: { loaded: true, ...(isTurned ? turned : stated), root: fakeNode() },
    [ids.rig]: { loaded: true, box: null, extras: rigSail, root: fakeNode({ Sail: fakeNode() }) },
  };
  doc.objects[hull].transform.rotation = [0, yaw, 0];
  if (isTurned) {
    // her model's +X is her bow: the hull object turns a quarter less, so her body heads where the stock one's does
    doc.objects[hull].transform.rotation = [0, yaw + Math.PI / 2, 0];
    // and each part aboard is put on her again, at its stand on her, as the bin would (squared to her frame)
    const part = { Mast: "mast", Wheel: "wheel", Windlass: "windlass", Ladder: "ladder" };
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

describe("sailing a hull drawn bow along +X", () => {
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

describe("the rig drives her", () => {
  const sc = (mastZ) => ({
    objects: { h: { traits: { [SHIP]: {} } }, m: { parent: "h", transform: { position: [0, 1.36, mastZ] } }, r: { parent: "m", transform: { position: [0, 1.45, 0.1] }, traits: { [SAIL]: {} } } },
  });
  const spec = (mastZ, scale = 1) => specFor(stockHull, undefined, scale, { rig: { matrix: placeIn(sc(mastZ), "r", "h"), sail: rigSail.sail } });

  it("the sail is the plan the rig's GLB states, where the rig is, at its scale", () => {
    const s = spec(-1.6);
    const { plan } = rigSail.sail;
    near(s.sail.tack, [0, 1.36 + 1.45 + plan.tack[1], -1.6 + 0.1 + plan.tack[2]], 6);
    expect(s.sail.area).toBeCloseTo(plan.area, 6);
    expect(s.sail.luff).toBeCloseTo(plan.luff, 6);
    // at twice the hull's scale, twice the lengths and four times the area
    expect(spec(-1.6, 2).sail.area).toBeCloseTo(4 * plan.area, 6);
    expect(spec(-1.6, 2).sail.tack[2]).toBeCloseTo(2 * s.sail.tack[2], 6);
  });

  it("the sloop's rig at its stand sails her exactly as SLOOP was tuned", () => {
    const doc = { objects: { h: { traits: { [SHIP]: {} } }, m: { parent: "h", transform: { position: STAND.mast } }, r: { parent: "m", transform: { position: PIECES.mast[1].at }, traits: { [SAIL]: {} } } } };
    const s = specFor(stockHull, undefined, 1, { rig: { matrix: placeIn(doc, "r", "h"), sail: rigSail.sail } });
    near(s.sail.tack, SLOOP.sail.tack, 6);
    expect(s.sail).toMatchObject({ area: SLOOP.sail.area, luff: SLOOP.sail.luff, foot: SLOOP.sail.foot });
    expect(s.sail).toEqual(specFor(stockHull).sail);
  });

  it("a rig that states no plan (filed before it had one) leaves her sail to her hull", () => {
    const { plan, ...old } = rigSail.sail;
    expect(specFor(stockHull, undefined, 1, { rig: { matrix: placeIn(sc(-1.6), "r", "h"), sail: old } }).sail).toEqual(specFor(stockHull).sail);
  });

  it("moving the mast aft moves her centre of effort aft: she carries more weather helm", () => {
    const fwd = createShip(spec(-2.5));
    const aft = createShip(spec(0.5));
    expect(aft.spec.sail.tack[2] - fwd.spec.sail.tack[2]).toBeCloseTo(3, 6);
    // on a beam reach with the helm amidships, the one with her mast aft rounds up into the wind faster
    const calm = { heightAt: () => 0, normalAt: () => [0, 1, 0], velocityAt: () => [0, 0, 0] };
    const env = { water: calm, wind: { at: () => [0, 8] } }; // from the north
    const turnOf = (ship) => {
      let s = ship.rest({ yaw: -Math.PI / 2 });
      for (let i = 0; i < 20 * 30; i++) s = ship.step(s, { sail: 1, sheet: 0.4, rudder: 0 }, env, 1 / 30);
      return ship.read(s, { sail: 1, sheet: 0.4 }, env).heading;
    };
    // heading east (π/2), rounding up is toward north (heading falls)
    expect(turnOf(aft)).toBeLessThan(turnOf(fwd));
  });

  it("the trait's spec overrides win over the rig and the GLB", () => {
    const s = specFor(stockHull, { sail: { area: 10 }, mass: 1234 }, 1, { rig: { matrix: placeIn(sc(-1.6), "r", "h"), sail: rigSail.sail } });
    expect(s.sail.area).toBe(10);
    expect(s.mass).toBe(1234);
    expect(s.sail.luff).toBeCloseTo(rigSail.sail.plan.luff, 6);
  });

  it("a hull's displacement is her mass, at her scale", () => {
    const glb = { box: stockHull.box, extras: { ship: { ...stockHull.extras.ship, displacement: 6500 } } };
    expect(specFor(glb).mass).toBe(6500);
    expect(specFor(glb, undefined, 2).mass).toBeCloseTo(6500 * 8, 6);
    // without one, the sloop's scaled to her size
    expect(specFor(stockHull).mass).toBeCloseTo(8000, 6);
  });
});
