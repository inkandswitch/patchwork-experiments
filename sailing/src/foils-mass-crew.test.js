// Plan item 9, one mechanism per case: a rig contract's keel and rudder as
// planforms (§6.4: their own aspect, sweep, stall and quarter chord, the
// keel's downwash on the rudder, the rudder's travel, the wet part of the
// span), her centre of gravity where the contract's roll-up put it, her
// inertia from its gyradii, and the crew's moment to windward (§6.6). The
// fixtures are the rig package's (test/rig-contract/); compose.js is its
// reference consumer of §6, copied.
import { describe, it, expect } from "vitest";
import { createShip } from "./physics.js";
import { planformAspect, planformCD, planformCL, planformSlope } from "./physics-foils.js";
import { buildHull, SLOOP } from "./hull-model.js";
import { toBody } from "./rig-contract.js";
import { contractShip, heelQuat } from "./test/agreement-harness.js";
import { foilCL as contractCL, helmbold } from "./test/rig-contract/compose.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import catalina from "./test/rig-contract/catalina-30.json";
import j24 from "./test/rig-contract/j24.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const RAD = Math.PI / 180;
const G = 9.81; // physics.js's
const FIXTURES = { sloop, cuvature, catalina, j24, laser };
const LEVEL = [0, 0, 0, 1];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const closeRel = (got, want, rel, floor = 1e-9) => got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(rel * Math.max(floor, Math.hypot(...want))));

/**
 * The same ship with only these of her contract's foils (by id) lifting:
 * the others' area is zero, so they still float her (item 10's appendage
 * buoyancy) but carry no force. Without her resistance table too, so each
 * foil carries its own induced drag: with the table, induced drag is the
 * whole side force's, at her LCB (hull-resistance.test.js), and wouldn't
 * come apart foil by foil.
 */
const withFoils = (ship, ids) => createShip({ ...ship.spec, rig: { ...ship.spec.rig, resistance: null, appendages: ship.spec.rig.appendages.map((a) => (ids.includes(a.id) ? a : { ...a, areaM2: 0 })) } });

/** What the foils `ids` add to her wrench at a state: force and torque about her CG. */
function foilsOf(ship, ids, pose, motion, controls = {}, env = {}) {
  const a = withFoils(ship, ids).wrench(pose, motion, { sail: 0, ...controls }, env);
  const b = withFoils(ship, []).wrench(pose, motion, { sail: 0, ...controls }, env);
  return { force: sub(a.force, b.force), torque: sub(a.torque, b.torque), cg: a.cg };
}

/** Moving ahead at V with leeway λ (deg): sliding to port, as on starboard tack (body = world, heading −Z). */
const ahead = (V, lamDeg) => ({ velocity: [-Math.sin(lamDeg * RAD) * V, 0, -Math.cos(lamDeg * RAD) * V], spin: [0, 0, 0] });
const atRest = { position: [0, 0, 0], quaternion: LEVEL };

describe("a planform's lift and drag (physics-foils.js) are §6.4's", () => {
  it("at every fixture's keel and rudder, upright and heeled, up to the stall: compose.js's CL to round-off", () => {
    for (const c of Object.values(FIXTURES)) {
      for (const f of c.appendages) {
        const sec2 = 1 + Math.tan(f.sweepHalfDeg * RAD) ** 2;
        // the contract's own upright slope, to the fixture's 9 digits
        expect(planformSlope(planformAspect(f.arGeom, f.endPlateFactor, 1), sec2)).toBeCloseTo(f.liftSlope, 6);
        for (const heel of [0, 20, 40]) {
          const aspect = planformAspect(f.arGeom, f.endPlateFactor, Math.cos(heel * RAD));
          const slope = planformSlope(aspect, sec2);
          expect(slope).toBeCloseTo(helmbold(aspect, f.sweepHalfDeg), 12);
          for (const a of [0.5, 2, 5, 10, 14.9, 15]) {
            expect(planformCL(a * RAD, slope, f.stallDeg * RAD)).toBeCloseTo(contractCL(f, a, heel).cl, 12);
          }
        }
      }
    }
  });

  it("the hull is an end plate that works less as she heels: k = 2 doubles the aspect upright, none on her side", () => {
    expect(planformAspect(1.5, 2, 1)).toBe(3);
    expect(planformAspect(1.5, 2, 0)).toBe(1.5);
    expect(planformAspect(1.5, 1, 1)).toBe(1.5);
  });

  it("stalls: at 15° it's 2^-⅛ of a·15°; by 25° a flat plate's 0.8·sin 2α, but never more than at the stall; none square on; backwards the same", () => {
    const stall = 15 * RAD;
    for (const a of [2, 5]) {
      const atStall = (a * stall) / 2 ** 0.125;
      expect(planformCL(stall, a, stall)).toBeCloseTo(atStall, 12);
      expect(planformCL(25 * RAD, a, stall)).toBeCloseTo(Math.min(atStall, 0.8 * Math.sin(50 * RAD)), 12);
      // never past the contract's CLmax = a·stall, anywhere
      for (let d = 0; d <= 180; d += 0.5) expect(planformCL(d * RAD, a, stall)).toBeLessThanOrEqual(a * stall + 1e-12);
      expect(planformCL(Math.PI / 2, a, stall)).toBeCloseTo(0, 12);
      expect(planformCL(Math.PI - 8 * RAD, a, stall)).toBeCloseTo(planformCL(8 * RAD, a, stall), 12);
    }
    // a high-aspect foil drops to the plate's: stalling costs it lift
    expect(planformCL(25 * RAD, 5, stall)).toBeLessThan(planformCL(stall, 5, stall));
  });

  it("drag: its friction plus its own induced drag cl²/(π·AR); four times the friction backwards; a plate's broadside", () => {
    expect(planformCD(5 * RAD, 0.4, 3, 0.01)).toBeCloseTo(0.01 + 0.16 / (3 * Math.PI), 12);
    expect(planformCD(Math.PI, 0, 3, 0.01)).toBeCloseTo(0.04, 12);
    expect(planformCD(Math.PI / 2, 0, 3, 0.01)).toBeCloseTo(1.21, 12);
  });
});

describe("a contract's keel and rudder in the physics", () => {
  const ship = contractShip(sloop);
  const keel = sloop.appendages.find((a) => a.id === "keel");
  const rudder = sloop.appendages.find((a) => a.id === "rudder");

  it("the keel acts at its MAC's quarter chord, not under her centre of buoyancy", () => {
    const f = foilsOf(ship, ["keel"], atRest, ahead(3, 4));
    const arm = sub(toBody(keel.qcM), ship.cg);
    closeRel(f.torque, cross(arm, f.force), 1e-9);
    // and that is a different place: over a metre forward of her CB
    expect(Math.abs(toBody(keel.qcM)[2] - buildHull(ship.spec).cb[2])).toBeGreaterThan(1);
    // it holds her up to windward (+x here): the lift is across her slide to port
    expect(f.force[0]).toBeGreaterThan(0);
  });

  it("the rudder acts at its own quarter chord, and its lift is §6.4's at δ", () => {
    const V = 3;
    const f = foilsOf(ship, ["rudder"], atRest, ahead(V, 0), { rudder: 0.2 });
    closeRel(f.torque, cross(sub(toBody(rudder.qcM), ship.cg), f.force), 1e-9);
    // + rudder: the trailing edge to starboard, so the force at the stern is to port (−x)
    const d = 0.2 * 35;
    const lift = 0.5 * 1025 * V * V * rudder.areaM2 * contractCL(rudder, d, 0).cl;
    // the flow is straight aft, so the lift is all across it: to port
    expect(-f.force[0]).toBeCloseTo(lift, 6);
    expect(lift).toBeGreaterThan(0);
  });

  it("the keel's downwash: at leeway, the rudder behind it lifts as at α_k(1 − dε/dα), a little more than half", () => {
    const V = 3, lam = 4;
    const both = foilsOf(ship, ["keel", "rudder"], atRest, ahead(V, lam));
    const keelOnly = foilsOf(ship, ["keel"], atRest, ahead(V, lam));
    const rudderOnly = foilsOf(ship, ["rudder"], atRest, ahead(V, lam));
    const behind = both.force[0] - keelOnly.force[0];
    const alone = rudderOnly.force[0];
    const kc = contractCL(keel, lam, 0);
    const dEps = kc.slope / (Math.PI * kc.arEff);
    const want = contractCL(rudder, lam * (1 - dEps), 0).cl / contractCL(rudder, lam, 0).cl;
    expect(dEps).toBeGreaterThan(0.3);
    expect(behind / alone).toBeCloseTo(want, 3);
    // the same sign: the downwash takes from the rudder's lift, it doesn't reverse it
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeLessThan(alone);
  });

  it("no leeway, no downwash: the rudder's turn is the same behind the keel as alone; nor going astern", () => {
    const helm = { rudder: 0.3 };
    const behind = sub(foilsOf(ship, ["keel", "rudder"], atRest, ahead(3, 0), helm).force, foilsOf(ship, ["keel"], atRest, ahead(3, 0), helm).force);
    closeRel(behind, foilsOf(ship, ["rudder"], atRest, ahead(3, 0), helm).force, 1e-9);
    const astern = { velocity: [-Math.sin(4 * RAD) * 1.5, 0, 1.5], spin: [0, 0, 0] };
    const behindAstern = sub(foilsOf(ship, ["keel", "rudder"], atRest, astern).force, foilsOf(ship, ["keel"], atRest, astern).force);
    closeRel(behindAstern, foilsOf(ship, ["rudder"], atRest, astern).force, 1e-9);
  });

  it("stalls past 15°: the keel's lift (square to the flow) grows to 15° of leeway, gains nothing by 25°, and is gone sideways", () => {
    const lift = (deg) => {
      const f = foilsOf(ship, ["keel"], atRest, ahead(2, deg)).force;
      const u = [Math.sin(deg * RAD), 0, Math.cos(deg * RAD)]; // the flow past her, body
      const along = f[0] * u[0] + f[2] * u[2];
      return Math.hypot(f[0] - along * u[0], f[2] - along * u[2]);
    };
    expect(lift(15)).toBeGreaterThan(lift(10));
    expect(lift(25)).toBeLessThanOrEqual(lift(15) * (1 + 1e-9));
    expect(lift(90)).toBeLessThan(1e-6 * lift(15));
  });

  it("the rudder's travel is the contract's: the Laser's full helm is 30°, the sloop's 35°", () => {
    const l = contractShip(laser);
    expect(l.spec.rudder.maxDeg).toBe(30);
    expect(ship.spec.rudder.maxDeg).toBe(35);
    const at35 = createShip({ ...l.spec, rudder: { ...l.spec.rudder, maxDeg: 35 } });
    const m = ahead(2, 0);
    closeRel(l.wrench(atRest, m, { rudder: 1 }).torque, at35.wrench(atRest, m, { rudder: 30 / 35 }).torque, 1e-9);
  });

  it("wet as far as its span is under the surface: half of it, half the force, at the wet half's quarter chord", () => {
    const c = keel.cornersM;
    const q = (le, te) => le.map((v, i) => v + 0.25 * (te[i] - v));
    const root = toBody(q(c.rootLE, c.rootTE)), tip = toBody(q(c.tipLE, c.tipTE)), qc = toBody(keel.qcM);
    const surface = (h) => ({ water: { heightAt: () => h, velocityAt: (x, y, z, t, out = [0, 0, 0]) => ((out[0] = out[1] = out[2] = 0), out) } });
    const full = foilsOf(ship, ["keel"], atRest, ahead(3, 4), {}, surface(1));
    const half = foilsOf(ship, ["keel"], atRest, ahead(3, 4), {}, surface((root[1] + tip[1]) / 2));
    closeRel(half.force, full.force.map((v) => v / 2), 1e-9);
    const at = tip.map((v, i) => v + 0.5 * (qc[i] - v));
    closeRel(half.torque, cross(sub(at, ship.cg), half.force), 1e-9);
    const dry = foilsOf(ship, ["keel"], atRest, ahead(3, 4), {}, surface(tip[1] - 0.01));
    expect(Math.hypot(...dry.force)).toBe(0);
  });
});

describe("a contract's boat flies only its own planforms", () => {
  // spec.keel and spec.rudder (the lumped foils a stock ship flies) are
  // derived from the same appendages, so flying both would count them twice
  const lumpless = (ship) => createShip({ ...ship.spec, keel: { ...ship.spec.keel, area: 0 }, rudder: { ...ship.spec.rudder, area: 0 } });
  const notComputed = (c) => ({ ...c, resistance: { ...c.resistance, status: "not-computed" } });
  const SPEEDS = [0.03, 0.0499, 0.0501, 0.5, 3];

  it("with or without her resistance table, at every speed, the lumped keel and rudder add nothing", () => {
    for (const c of Object.values(FIXTURES)) {
      for (const contract of [c, notComputed(c)]) {
        const ship = contractShip(contract);
        expect(ship.spec.keel.area + ship.spec.rudder.area).toBeGreaterThan(0); // they're there to be flown
        const bare = lumpless(ship);
        for (const V of SPEEDS) {
          const motion = ahead(V, 5);
          const a = ship.wrench(atRest, motion, { sail: 0, rudder: 0.3 }, {});
          const b = bare.wrench(atRest, motion, { sail: 0, rudder: 0.3 }, {});
          expect(a.force).toEqual(b.force);
          expect(a.torque).toEqual(b.torque);
        }
      }
    }
  });

  it("(and the probe can see them: on the stock sloop they're her keel and rudder)", () => {
    const s = createShip();
    const a = s.wrench(atRest, ahead(3, 5), { sail: 0, rudder: 0.3 }, {});
    const b = lumpless(s).wrench(atRest, ahead(3, 5), { sail: 0, rudder: 0.3 }, {});
    expect(Math.abs(a.force[0] - b.force[0])).toBeGreaterThan(100);
  });

  it("so her side force is continuous through 0.05 m/s, where the contract's induced drag starts", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = contractShip(c);
      const side = (V) => ship.wrench(atRest, ahead(V, 5), { sail: 0 }, {}).force[0];
      expect(Math.abs(side(0.0501) / side(0.0499) - 1)).toBeLessThan(0.01);
    }
  });
});

describe("her mass properties are the contract's", () => {
  it("her centre of gravity is the roll-up's, not pinned over her centre of buoyancy, so she trims", () => {
    const ship = contractShip(cuvature);
    const cb = buildHull(ship.spec).cb;
    closeRel(ship.cg, toBody(cuvature.loading.cgM), 1e-12);
    // her CB is the contract's LCB now (item 10), 4 cm forward of the roll-up's CG; the columns put it 6.5 cm
    expect(ship.cg[2] - cb[2]).toBeGreaterThan(0.03);
    const w = ship.wrench(atRest, {}, { sail: 0 });
    // weight aft of buoyancy: the stern goes down (+ about body x is bow up)
    expect(w.torque[0]).toBeGreaterThan(0);
  });

  it("her inertia is m·k² from the contract's gyradii, body [pitch, yaw, roll]", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = contractShip(c);
      const [roll, pitch, yaw] = c.loading.gyradiiM;
      closeRel(ship.inertia, [pitch, yaw, roll].map((k) => c.loading.massKg * k * k), 1e-12);
    }
  });

  it("the stock sloop's inertia is still the thinned box plus the mast", () => {
    const s = createShip();
    const { mass: m, length: L, beam: B, draft, freeboard, sail } = SLOOP;
    const hb = draft + freeboard;
    const y0 = sail.tack[1] - SLOOP.cg, y1 = y0 + sail.luff;
    const mast = 0.03 * m * ((y1 ** 3 - y0 ** 3) / (3 * sail.luff));
    closeRel(s.inertia, [(m * 0.8 * (hb * hb + L * L)) / 12 + mast, (m * 0.8 * (B * B + L * L)) / 12, (m * (B * B + hb * hb)) / 12 + mast], 1e-12);
  });
});

describe("the crew's moment (§6.6)", () => {
  const ship = contractShip(j24);
  const crew = j24.loading.crew;
  const fromStarboard = { wind: { at: (x, z, t, out = [0, 0]) => ((out[0] = -8), (out[1] = 0), out) } };
  const fromPort = { wind: { at: (x, z, t, out = [0, 0]) => ((out[0] = 8), (out[1] = 0), out) } };
  const heeled = (deg) => ({ position: [0, 0, 0], quaternion: heelQuat(deg) }); // + to port

  it("out to windward: the wind from starboard and heeled to port, all the way out at their arm, righting her by m·g·arm·cos φ", () => {
    const w = ship.wrench(heeled(10), {}, {}, fromStarboard);
    expect(w.crew).toBe(1);
    const inboard = ship.wrench({ ...heeled(10), crew: 0 }, {}, {}, fromStarboard);
    // + about +z heels her further to port: the crew's moment is the other way
    expect(w.torque[2] - inboard.torque[2]).toBeCloseTo(-crew.massKg * G * crew.armM * Math.cos(10 * RAD), 6);
    for (const k of [0, 1]) expect(w.torque[k]).toBeCloseTo(inboard.torque[k], 9);
    closeRel(w.force, inboard.force, 1e-12);
  });

  it("switch sides with the wind: from port, heeled to starboard, they sit to port", () => {
    expect(ship.wrench(heeled(-10), {}, {}, fromPort).crew).toBe(-1);
  });

  it("come in as she comes upright: none upright, half at 1.5° to leeward, none heeled to windward", () => {
    expect(ship.wrench(heeled(0), {}, {}, fromStarboard).crew).toBe(0);
    expect(ship.wrench(heeled(1.5), {}, {}, fromStarboard).crew).toBeCloseTo(Math.sin(1.5 * RAD) / Math.sin(3 * RAD), 12);
    expect(ship.wrench(heeled(-5), {}, {}, fromStarboard).crew).toBe(0);
  });

  it("cross over no faster than their arm a second: tacked onto port, half-way in half a second, across in a few", () => {
    const sailing = { sail: 1, sheet: 0.4 };
    let s = { ...ship.rest(), crew: 1 };
    s = ship.step(s, sailing, fromPort, 0.5);
    expect(s.crew).toBeGreaterThanOrEqual(0.5 - 1e-9);
    for (let i = 0; i < 4 * 30; i++) s = ship.step(s, sailing, fromPort, 1 / 30);
    expect(s.crew).toBeLessThan(-0.5);
  });

  it("which side the contract drew the station on doesn't matter (§3.4's y > 0 is port): only the arm does", () => {
    const mirrored = { ...j24, loading: { ...j24.loading, crew: { ...crew, stations: crew.stations.map((st) => ({ ...st, atM: [st.atM[0], -st.atM[1], st.atM[2]] })) } } };
    const a = ship.wrench(heeled(10), {}, {}, fromStarboard);
    expect(contractShip(mirrored).wrench(heeled(10), {}, {}, fromStarboard)).toEqual(a);
  });

  it("a stock ship has no crew: nothing in her state, wrench or readings", () => {
    const s = createShip();
    const st = s.step(s.rest(), { sail: 1 }, fromStarboard, 0.5);
    expect("crew" in st).toBe(false);
    expect("crew" in s.wrench(heeled(10), {}, {}, fromStarboard)).toBe(false);
    expect("crew" in s.read(st, { sail: 1 }, fromStarboard)).toBe(false);
  });
});
