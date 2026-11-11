// A hull modelled another way round sails as the sloop does: the stock hull
// drawn a quarter turn round (bow along +X, as camber draws one), with
// extras.ship.forward saying so, gets the same spec, sails bow first, and
// makes the same speed; and the rig you place is what drives her.
import { describe, it, expect } from "vitest";
import { STAND } from "./ship.js";
import { PIECES, placement } from "./parts.js";
import { frameOf, placeIn } from "./body.js";
import { specFor } from "./sim.js";
import { SLOOP, createShip } from "./physics.js";
import { SAIL, SHIP } from "./traits.js";
import { near, nearDeep, quarter, rigSail, stated, stockHull, turned } from "./test/frame-hulls.js";

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

// (sailing her, two sloops a while each: frame.slow.test.js)


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
