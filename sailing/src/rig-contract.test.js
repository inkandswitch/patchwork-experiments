// The rig aid's contract read into sailing (rig-contract.js), and the
// physics' wrench: finite cases, each one mechanism. The fixtures are the
// rig package's valid contract fixtures, copied (test/rig-contract/).
import { describe, it, expect } from "vitest";
import { RIG_FORMAT, bodyRig, checkSource, contractSerial, rigContract, rigFrame, rigSpecParts, toBody, toContract } from "./rig-contract.js";
import { frameFromAxes, frameMatrix, frameOf, glbFrame, shipFrame } from "./body.js";
import { specFor, specKey } from "./sim.js";
import { ADDED_MASS, SUBSTEP, createShip } from "./physics.js";
import { buildHull } from "./hull-model.js";
import { apply, rotateQ } from "./frames.js";
import { SAIL, SHIP } from "./traits.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const near = (a, b, d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));
const viaRig = (contract, o = {}) => ({ rig: { matrix: null, sail: null, contract, ...o.rig }, hullUrl: o.hullUrl ?? null });

describe("the contract's frame in the body's", () => {
  it("forward is the bow (−z), port is −x, up is up", () => {
    expect(toBody([1, 0, 0])).toEqual([0, 0, -1]);
    expect(toBody([0, 1, 0])).toEqual([-1, 0, 0]);
    expect(toBody([0, 0, 1])).toEqual([0, 1, 0]);
    expect(toBody([2, 3, 4], 2)).toEqual([-6, 8, -4]);
    expect(toContract(toBody([1.5, -0.25, 7], 3), 3)).toEqual([1.5, -0.25, 7]);
  });

  it("a camber hull's frame (bow +X, up +Y, the waterplane below her origin) puts her body on her waterline, bow first", () => {
    const f = rigFrame(cuvature);
    const m = frameMatrix(f);
    const h = cuvature.frame.design.sourceWaterplaneZM; // the waterplane's height in her glTF
    near(apply(m, [0, 0, 0]), [0, h, 0]);
    // her bow (body −z) is the glTF's +X, her deck up +Y, her starboard (body +x) +Z
    near(apply(m, [0, 0, -1]).map((v, i) => v - apply(m, [0, 0, 0])[i]), [1, 0, 0]);
    near(apply(m, [0, 1, 0]).map((v, i) => v - apply(m, [0, 0, 0])[i]), [0, 1, 0]);
    near(apply(m, [1, 0, 0]).map((v, i) => v - apply(m, [0, 0, 0])[i]), [0, 0, 1]);
    // the same turn body.js gives a GLB that says its bow is +X
    near(f.rotation, frameFromAxes([1, 0, 0]).rotation);
  });

  it("a contract point lands where the hull's glTF point is: through the frame, the body's and the glTF's agree", () => {
    const m = frameMatrix(rigFrame(cuvature));
    const keelTip = cuvature.appendages[0].cornersM.tipLE;
    // contract → glTF by inverse(glbToFrame): (x, z + h, −y) for camber's axes
    const h = cuvature.frame.design.sourceWaterplaneZM;
    // (the frame is tidied to 1e-9)
    near(apply(m, toBody(keelTip)), [keelTip[0], keelTip[2] + h, -keelTip[1]], 7);
  });

  it("frameOf: the contract's frame over the GLB's guess, the trait's over both", () => {
    const glb = { extras: { ship: { forward: [0, 0, 1], origin: [0, 5, 0] } }, box: null };
    expect(frameOf({}, glb)).toEqual(glbFrame(glb));
    expect(frameOf({}, glb, cuvature)).toEqual(rigFrame(cuvature));
    expect(frameOf({ frame: { position: [1, 2, 3] } }, glb, cuvature)).toEqual({ position: [1, 2, 3], rotation: rigFrame(cuvature).rotation });
  });

  it("shipFrame finds the contract on her sail station's GLB, and only there", () => {
    const snapshot = (rigTraits) => ({
      ids: ["h", "r"],
      objects: { h: { traits: { [SHIP]: {} } }, r: { parent: "h", traits: rigTraits } },
      parents: new Map([["r", "h"]]),
    });
    const api = (sc, rigExtras) => ({ scene: () => sc, content: (id) => (id === "r" ? { extras: rigExtras } : null) });
    expect(shipFrame(api(snapshot({ [SAIL]: {} }), { rig: cuvature }), "h")).toEqual(rigFrame(cuvature));
    // a stock rig (no contract): her own frame, as before
    expect(shipFrame(api(snapshot({ [SAIL]: {} }), { sail: {} }), "h")).toEqual(frameOf({}, null));
    // not a sail station: not her rig
    expect(shipFrame(api(snapshot({}), { rig: cuvature }), "h")).toEqual(frameOf({}, null));
  });
});

describe("reading a contract", () => {
  it("reads v1 with a frame, a mass and a hull; nothing else", () => {
    expect(rigContract(sloop)).toBe(sloop);
    expect(rigContract(null)).toBeNull();
    expect(rigContract({ ...sloop, format: "something-else" })).toBeNull();
    expect(rigContract({ ...sloop, version: 2 })).toBeNull();
    expect(rigContract({ ...sloop, frame: { ...sloop.frame, glbToFrame: [1, 0, 0] } })).toBeNull();
    expect(rigContract({ ...sloop, loading: { ...sloop.loading, massKg: 0 } })).toBeNull();
    expect(RIG_FORMAT).toBe(sloop.format);
  });

  it("checks the hull she's on against the one the rig was designed on", () => {
    const url = cuvature.source.hull.url;
    expect(checkSource(cuvature, url)).toEqual([]);
    expect(checkSource(cuvature, `${url}#someheads`)).toEqual([]);
    expect(checkSource(cuvature, null)).toEqual([]);
    expect(checkSource(cuvature, "automerge:another")).toHaveLength(1);
    expect(checkSource(cuvature, "automerge:another")[0]).toMatch(/another hull/);
    expect(checkSource(sloop, "automerge:any")[0]).toMatch(/synthetic hull/);
  });

  it("puts the whole contract in her body frame: CG, crew to windward, foils, sails, leads", () => {
    const r = bodyRig(sloop);
    expect(r.massKg).toBe(8000);
    near(r.cgM, toBody(sloop.loading.cgM));
    // gyradii in body axes: [pitch, yaw, roll] from the contract's [roll, pitch, yaw]
    const [roll, pitch, yaw] = sloop.loading.gyradiiM;
    expect(r.gyradiiM).toEqual([pitch, yaw, roll]);
    // the crew's station is on the contract's port side (y > 0): the body's −x
    expect(r.crew.stations[0].atM[0]).toBeCloseTo(-sloop.loading.crew.armM, 9);
    const keel = r.appendages.find((a) => a.id === "keel");
    near(keel.qcM, toBody(sloop.appendages[0].qcM));
    expect(r.appendages.find((a) => a.id === "rudder").maxDeg).toBe(35);
    const jib = r.sails.find((s) => s.id === "jib");
    expect(jib.sheeting.lead.port[0]).toBeLessThan(0);
    expect(jib.sheeting.lead.starboard[0]).toBeGreaterThan(0);
    near(r.sets[0].ceM, toBody(sloop.sets[0].ceM));
    // the bow's waterline ending is forward (−z)
    expect(r.hull.bowZM).toBeLessThan(r.hull.sternZM);
  });
});

describe("a spec from a contract (specFor's rig path)", () => {
  const spec = specFor(null, undefined, 1, viaRig(sloop));

  it("her waterline, beam, draft and freeboard, her mass and her CG's height are the contract's", () => {
    expect(spec.length).toBeCloseTo(sloop.hull.lwlM, 9);
    expect(spec.beam).toBeCloseTo(sloop.hull.beamM, 9);
    expect(spec.draft).toBeCloseTo(-sloop.appendages[0].cornersM.tipLE[2], 9);
    expect(spec.freeboard).toBeCloseTo(sloop.hull.stemheadM[2], 9);
    expect(spec.mass).toBe(sloop.loading.massKg);
    expect(spec.cg).toBeCloseTo(sloop.loading.cgM[2], 12);
    // the middle of her waterline (mid-LWL is the contract's x = 0 here)
    near(spec.center, [0, -(sloop.hull.xFwdM + sloop.hull.xAftM) / 2]);
  });

  it("her sail is the lumped sail (§6.8), her keel and rudder at their quarter chords", () => {
    near(spec.sail.tack, toBody(sloop.lumpedSail.tackM));
    expect(spec.sail).toMatchObject({ area: sloop.lumpedSail.areaM2, luff: sloop.lumpedSail.luffM, foot: sloop.lumpedSail.footM });
    const [keel, rudder] = sloop.appendages;
    expect(spec.keel).toEqual({ area: keel.areaM2, depth: -keel.qcM[2], z: -keel.qcM[0] });
    expect(spec.rudder.area).toBe(rudder.areaM2);
    near(spec.rudder.at, toBody(rudder.qcM));
    expect(spec.rig.name).toBe(sloop.name);
  });

  it("a hull with no keel in her contract has none", () => {
    const noKeel = { ...laser, appendages: laser.appendages.filter((a) => a.id !== "keel") };
    expect(specFor(null, undefined, 1, viaRig(noKeel)).keel.area).toBe(0);
  });

  it("the trait's overrides still win", () => {
    const s = specFor(null, { mass: 1234, sail: { area: 10 } }, 1, viaRig(sloop));
    expect(s.mass).toBe(1234);
    expect(s.sail.area).toBe(10);
    expect(s.sail.luff).toBe(sloop.lumpedSail.luffM);
  });

  it("at twice her drawn size: lengths ×2, mass ×8, and a warning that the tables don't scale", () => {
    const s = specFor(null, undefined, 2, viaRig(sloop));
    expect(s.length).toBeCloseTo(2 * sloop.hull.lwlM, 9);
    expect(s.mass).toBeCloseTo(8 * sloop.loading.massKg, 6);
    expect(s.rig.warnings.some((w) => /drawn size/.test(w))).toBe(true);
    expect(spec.rig.warnings).toEqual([]);
  });

  it("warns when the rig is moved off the identity, or put on a hull it wasn't designed on", () => {
    const moved = specFor(null, undefined, 1, viaRig(sloop, { rig: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1] } }));
    expect(moved.rig.warnings.some((w) => /isn't where its contract put it/.test(w))).toBe(true);
    const other = specFor(null, undefined, 1, viaRig(cuvature, { hullUrl: "automerge:not-cuvature" }));
    expect(other.rig.warnings.some((w) => /another hull/.test(w))).toBe(true);
  });

  it("no contract (or one sailing can't read): the spec is exactly the one without", () => {
    const content = { box: { min: [-1.9, -1.9, -6], max: [1.9, 1.2, 6] }, extras: {} };
    expect(specFor(content, undefined, 1, { rig: { matrix: null, sail: null, contract: { ...sloop, version: 9 } } })).toEqual(specFor(content));
  });

  it("is keyed by name, not stringified whole: equal contracts share a key, a different scale doesn't", () => {
    const key = specKey(spec);
    expect(key.length).toBeLessThan(2000);
    expect(specKey(specFor(null, undefined, 1, viaRig(structuredClone(sloop))))).toBe(key);
    expect(specKey(specFor(null, undefined, 2, viaRig(sloop)))).not.toBe(key);
    expect(contractSerial(cuvature)).not.toBe(contractSerial(sloop));
    // the same spec object every frame: converted once
    expect(rigSpecParts(sloop, 1)).toBe(rigSpecParts(sloop, 1));
  });

  it("floats at her contract's mass", () => {
    for (const c of [sloop, cuvature, laser]) {
      const s = specFor(null, undefined, 1, viaRig(c));
      expect(buildHull(s).restVolume * 1025).toBeCloseTo(c.loading.massKg, 3);
    }
  });
});

describe("ship.wrench: the forces at a state, without stepping", () => {
  const ship = createShip();
  const calm = { heightAt: () => 0, velocityAt: () => [0, 0, 0] };
  const beam = { water: calm, wind: { at: () => [-8, 0] } }; // from starboard
  const under = { ...ship.rest(), velocity: [0, 0, -3] };
  const controls = { sail: 1, sheet: 0.4, rudder: 0.2 };
  const pose = (s) => ({ position: s.position, quaternion: s.quaternion, t: s.t });
  const motion = (s) => ({ velocity: s.velocity, spin: s.spin });

  it("afloat on her lines in a calm, still: she's in balance", () => {
    const w = ship.wrench(pose(ship.rest()), {}, {}, { water: calm });
    expect(Math.abs(w.force[1]) / w.weight).toBeLessThan(1e-9);
    for (const k of [0, 2]) expect(Math.abs(w.force[k])).toBeLessThan(1e-9);
    for (const k of [0, 1, 2]) expect(Math.abs(w.torque[k]) / (w.weight * ship.spec.length)).toBeLessThan(1e-9);
  });

  it("is what step integrates: her centre of gravity's velocity changes by it over one substep", () => {
    const w = ship.wrench(pose(under), motion(under), controls, beam);
    const next = ship.step(under, controls, beam, SUBSTEP);
    const m = ship.spec.mass;
    // upright and heading −Z, her body axes are the world's; afloat on her lines, all of her is in
    const dv = w.force.map((f, i) => (f / (m * (1 + ADDED_MASS[i]))) * SUBSTEP);
    const arm = rotateQ(next.quaternion, w.cg.map((v, i) => v - under.position[i]));
    const W = next.spin;
    const vcg = next.velocity.map((v, i) => v + [W[1] * arm[2] - W[2] * arm[1], W[2] * arm[0] - W[0] * arm[2], W[0] * arm[1] - W[1] * arm[0]][i]);
    const got = vcg.map((v, i) => v - under.velocity[i]);
    const scale = Math.hypot(...dv);
    expect(scale).toBeGreaterThan(1e-4);
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - dv[i])).toBeLessThan(1e-6 * scale);
  });

  it("puts the boom at its goal, wherever its swing has got to", () => {
    const a = ship.wrench(pose(under), motion(under), controls, beam);
    const b = ship.wrench({ ...pose(under) }, motion(under), controls, beam);
    expect(ship.wrench({ ...pose(under), boom: 1.2 }, motion(under), controls, beam)).toEqual(a);
    expect(b).toEqual(a);
    // a beam wind from starboard, the sheet at 0.4: out to port, at the sheet's limit
    expect(a.boom).toBeCloseTo(-(10 + 75 * 0.4) * (Math.PI / 180), 9);
  });

  it("leaves no trace: stepping after a wrench is stepping without one", () => {
    const s = { ...under, boom: 0.3 };
    const plain = ship.step(s, controls, beam, 0.5);
    ship.wrench(pose(s), motion(s), { ...controls, sheet: 1 }, beam);
    expect(ship.step(s, controls, beam, 0.5)).toEqual(plain);
  });

  it("the rudder turns her the way the helm says: + bow to starboard", () => {
    const yaw = (rudder) => ship.wrench(pose(under), motion(under), { ...controls, rudder }, beam).torque[1];
    // a turn toward +X from −Z is a negative rotation about +Y
    expect(yaw(0.5)).toBeLessThan(yaw(0));
    expect(yaw(-0.5)).toBeGreaterThan(yaw(0));
  });
});
