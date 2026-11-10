// The stock sloop's rig contract (stock-rig.js; DESIGN.md "Trim feedback",
// item 1), case by case: every field it computes re-derived by the rule the
// specification states, the rules themselves checked against the 12 m
// fixture the rig aid built, what it keeps held to that fixture, and the
// gates: old docs (rig@1) and other hulls stay on the plain path, exactly.
// The specification's validator is copied into test/rig-contract/ (as its
// reference consumer compose.js is).
import { describe, it, expect, vi, afterEach } from "vitest";
import { FIT, deckSurfaceAt, partGLB, partMeshes, rigDrawing, STAND } from "./ship.js";
import { JIB_CLEW_S, JIB_EASED_DEG, JIB_HEAD_DROP, LEAD_FURLS, STOCK_GLB_KEY, leadAt, lumpedSailOf, rollUp, stockContract } from "./stock-rig.js";
import KEPT from "./stock-rig-12m.js";
import { contractOn, keyFamily, rigContract, rigFrame, toBody, toContract } from "./rig-contract.js";
import { furledClew, reefed, sailSlope } from "./rig-sails.js";
import { rigSailCoeffs } from "./physics-foils.js";
import { meshVolumeBelow } from "./hull-model.js";
import { createShip } from "./physics.js";
import { controlsOf, createSim, specFor, specKey } from "./sim.js";
import { frameOf, glbFrame, placeIn } from "./body.js";
import { PIECES, fileKey } from "./parts.js";
import { JIB, SAIL, SHIP, jibTransform } from "./traits.js";
import { layOutShip, ANCHORAGE_AIR } from "./layout.js";
import { createSeaView } from "./sea-view.js";
import { windFrom } from "./test/agreement-harness.js";
import { helmBackSide } from "./stations.js";
import { trimModelOf, trimOf } from "./trim.js";
import { fakeDrop, fakeNode, fakeWorld } from "./test/fakes.js";
import { validate, errorText, polygonAreaCentroid } from "./test/rig-contract/validate.js";
import fixture from "./test/rig-contract/sloop-12m.json";

const DEG = Math.PI / 180;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = (a) => Math.hypot(...a);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (got, want, tol) => {
  expect(got).toHaveLength(want.length);
  got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(tol));
};

/** What the stage reads off a GLB: its positions' box and the scene's extras. */
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

// what a ship's rig can't vouch for, sim.js logs once per spec: none of these should
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
afterEach(() => warn.mockClear());

const drawing = rigDrawing();
const c = stockContract(drawing);
const main = c.sails.find((s) => s.id === "main");
const jib = c.sails.find((s) => s.id === "jib");
const hull = readGLB(partGLB("hull").bytes);
const rigGLB = readGLB(partGLB("rig").bytes).extras;
/** What a rig@1 file said: the same extras.sail (its plan), and no contract. */
const RIG1 = { sail: Object.fromEntries(Object.entries(rigGLB.sail).filter(([k]) => k !== "at")) };

/** The stock "Mast and sail" at its stand on the stock hull, as sim.js reads it (placeIn). */
const placed = (() => {
  const doc = {
    objects: {
      h: { traits: { [SHIP]: {} } },
      m: { parent: "h", transform: { position: STAND.mast } },
      r: { parent: "m", transform: { position: PIECES.mast[1].at }, traits: { [SAIL]: {} } },
    },
  };
  return placeIn(doc, "r", "h");
})();
const specOn = (extras, hullKey, o = {}) =>
  specFor(hull, undefined, 1, { frame: frameOf({}, hull), rig: { matrix: o.matrix ?? placed, sail: extras.sail, contract: extras.rig }, hullUrl: "automerge:hull", hullKey });

// Before the stock rig carried a contract, the stock hull with "Mast and sail" at its stand had this spec, exactly (sim.js specKey).
const OLD_KEY = '{"length":12,"beam":3.8,"draft":1.9,"freeboard":1.2,"mass":8000,"cg":-0.3,"center":[0,0],"sail":{"area":55,"luff":13,"foot":4.5,"tack":[0,1.4,-1.2]},"keel":{"area":2.5,"depth":1.2},"rudder":{"area":0.6,"at":[0,-0.8,5.2]}}';

describe("what the stock contract keeps is the 12 m fixture's", () => {
  it("the runtime copy (stock-rig-12m.js) is the fixture's, part for part", () => {
    expect(KEPT.hull).toEqual(fixture.hull);
    expect(KEPT.appendages).toEqual(fixture.appendages);
    expect(KEPT.resistance).toEqual(fixture.resistance);
    expect(KEPT.sailModel).toEqual(fixture.sailModel);
    expect(KEPT.loading).toEqual(fixture.loading);
    expect(KEPT.frame.design).toEqual(fixture.frame.design);
    expect(KEPT.hardpoints.rudderStock).toEqual(fixture.hardpoints.rudderStock);
    expect(KEPT.hardpoints.crewStations).toEqual(fixture.hardpoints.crewStations);
    for (const s of fixture.sails) expect(KEPT.models[s.id]).toEqual(s.model);
    expect(KEPT.reefFractions).toEqual(fixture.sails.find((s) => s.id === "main").reefs.map((r) => r.fraction));
    expect([KEPT.rules, KEPT.warnings, KEPT.source.statics]).toEqual([fixture.rules, fixture.warnings, fixture.source.statics]);
  });

  it("and the contract carries them as they are", () => {
    for (const k of ["hull", "appendages", "resistance", "sailModel"]) expect(c[k]).toEqual(fixture[k]);
    for (const s of c.sails) expect(s.model).toEqual(fixture.sails.find((f) => f.id === s.id).model);
    expect(c.rules).toBe(fixture.rules);
    expect(c.warnings).toEqual([]);
    expect(c.loading.gyradiiM).toEqual(fixture.loading.gyradiiM);
    expect(c.loading.crew).toEqual(fixture.loading.crew);
    expect(c.loading.righting).toEqual(fixture.loading.righting);
  });
});

describe("the stock contract is a valid patchwork-rig v1 contract", () => {
  it("sailing reads it, and the specification's validator passes it (structural and semantic)", () => {
    expect(rigContract(c)).toBe(c);
    const r = validate(c);
    expect(r.ok, errorText(r)).toBe(true);
  });

  it("the rig GLB carries it as extras.rig, beside the plain plan an old reader needs, and says where it stands on her", () => {
    expect(rigGLB.rig).toEqual(JSON.parse(JSON.stringify(c)));
    expect(rigGLB.sail.plan).toBeDefined();
    expect(rigGLB.sail.at).toEqual({ position: [...FIT.rig.position], rotation: [...FIT.rig.rotation] });
  });

  it("names the stock hull's family and how it was made, and states no VPP it didn't run", () => {
    expect(c.source.hull).toMatchObject({ kind: "synthetic", glbKey: STOCK_GLB_KEY });
    expect(c.source.generator).toBe("patchwork sailing stock-rig");
    expect(c.predicted).toMatchObject({ status: "not-computed", points: [], beat: [], run: [], reference: null });
    expect(c.loads).toBeNull();
    for (const s of c.sets) expect(s.trimmed).toBeNull();
  });
});

describe("the frame: her body frame is the contract's", () => {
  it("glbToFrame is p ↦ (−z, −x, y), so rigFrame is the identity and frameOf gives her the frame she had", () => {
    for (const p of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -2, 5]]) {
      const m = c.frame.glbToFrame;
      const got = [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
      near(got, [-p[2], -p[0], p[1]], 0);
    }
    expect(rigFrame(c)).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] });
    expect(frameOf({}, hull, c)).toEqual(glbFrame(hull));
    expect(c.frame.glbAxes).toEqual({ bow: "-Z", up: "+Y" });
  });
});

describe("the main swings about the rig object's own axis", () => {
  it("its tack is the gooseneck (the rig object's origin at its stand) and its luff the rig's Y", () => {
    near(toBody(main.tackM), FIT.rig.position, 1e-12);
    const luff = sub(toBody(main.headM), toBody(main.tackM));
    near([luff[0], luff[2]], [0, 0], 1e-12);
    expect(luff[1]).toBeCloseTo(drawing.main.head[1] - FIT.rig.position[1], 12);
    near(toBody(main.clewM), drawing.main.clew, 1e-12);
    // the boom: the gooseneck to its end, as drawn
    near(toBody(main.sheeting.boom.gooseneckM), FIT.rig.position, 1e-12);
    expect(main.sheeting.boom.lengthM).toBe(drawing.boom.length);
  });

  it("its outline is the drawn cloth's, on the centreplane", () => {
    expect(main.polygonM).toHaveLength(drawing.main.outline.length);
    main.polygonM.forEach((p, i) => near(toBody(p), [0, drawing.main.outline[i][1], drawing.main.outline[i][2]], 1e-12));
  });

  it("its reefs are rig-sails.js reefed at the fixture's fractions (the aid's rule)", () => {
    const body = { tackM: toBody(main.tackM), headM: toBody(main.headM), polygonM: main.polygonM.map((p) => toBody(p)), areaM2: main.areaM2, ceM: toBody(main.ceM), luffM: main.luffM };
    expect(main.reefs.map((r) => r.fraction)).toEqual([0.15, 0.3]);
    for (const r of main.reefs) {
      const want = reefed(body, r.fraction);
      expect(r.areaM2).toBe(want.area);
      expect(r.luffM).toBe(want.luff);
      near(toBody(r.ceM), [0, want.ce[1], want.ce[2]], 1e-12);
    }
  });
});

describe("the jib: a 100% blade on her drawn forestay", () => {
  const t = toBody(jib.tackM), h = toBody(jib.headM), cl = toBody(jib.clewM);
  const stayTop = drawing.forestay.to;

  it("its tack is the forestay's foot, the stay's and the hardpoint's", () => {
    near(t, drawing.forestay.from, 1e-12);
    expect(c.hardpoints.forestayTackM).toEqual(jib.tackM);
    expect(c.rig.standing.find((s) => s.id === "forestay").fromM).toEqual(jib.tackM);
  });

  it(`its head is on the forestay, ${JIB_HEAD_DROP} m down from its top`, () => {
    expect(len(sub(stayTop, h))).toBeCloseTo(JIB_HEAD_DROP, 12);
    expect(len(cross(sub(stayTop, t), sub(h, t)))).toBeLessThan(1e-9);
  });

  it("its clew is at the fixture's own proportion up the luff, LP = J aft of it", () => {
    // the fixture's (c − t)·l/|l|²
    const f = fixture.sails.find((s) => s.id === "jib");
    const fl = sub(f.headM, f.tackM);
    const fs = sub(f.clewM, f.tackM).reduce((a, v, i) => a + v * fl[i], 0) / fl.reduce((a, v) => a + v * v, 0);
    expect(Math.abs(fs - JIB_CLEW_S)).toBeLessThan(5e-5); // the fixture's, to four places
    const l = sub(h, t);
    const s = sub(cl, t).reduce((a, v, i) => a + v * l[i], 0) / l.reduce((a, v) => a + v * v, 0);
    expect(s).toBeCloseTo(JIB_CLEW_S, 12);
    // LP: the clew's distance from the luff
    const lp = len(cross(sub(cl, t), l)) / len(l);
    expect(lp).toBeCloseTo(c.rig.J, 12);
    expect(c.rig.LP).toBe(c.rig.J);
    expect(c.rig.J).toBeCloseTo(Math.abs(drawing.forestay.from[2] - drawing.mast.step[2]), 12);
  });

  it("it is sheeted from the family's least angle out to JIB_EASED_DEG (its head twisting open past the family's 30°), with the wing, and furls as the doc says (none)", () => {
    expect(jib.sheeting).toMatchObject({ minDeg: 7, maxDeg: JIB_EASED_DEG, wing: jib.model.wing, boom: null });
    expect(jib.model.sheet).toEqual([7, 30]); // the family's own, as the fixture has it
    expect(jib.furl).toBe(0);
    expect(jib.reefs).toEqual([]);
  });
});

describe("every jib state its sheet can reach: on a beam reach some setting draws and all the way out it luffs (finite cases)", () => {
  // TWA 90° in 7 m/s on flat water, the helmsman holding her course, the main sheeted as she'd sail
  // (0.5, 0.6), a minute to settle; the jib's trim on the last read
  const ship = createShip(specOn(rigGLB, "sailing/hull@2"));
  const k = trimModelOf(jib);
  const DEG_ = Math.PI / 180;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const env = { water: { heightAt: () => 0, normalAt: () => [0, 1, 0], velocityAt: () => [0, 0, 0] }, wind: { at: () => [0, 7] } };
  function settle(sheet, jibSheet, twa = 90) {
    const course = twa * DEG_;
    let s = ship.rest({ yaw: -course });
    const c = { sail: 1, sheet, jibSheet, furl: 0, rudder: 0 };
    let d = null;
    for (let i = 0; i < 60 * 30; i++) {
      d = ship.read(s, c, env);
      c.rudder = Math.max(-1, Math.min(1, 2 * wrap(course - d.heading) + 4 * s.spin[1]));
      s = ship.step(s, c, env, 1 / 30);
    }
    return trimOf(ship.read(s, c, env).sails.find((x) => !x.main), k);
  }
  for (const main of [0.5, 0.6]) {
    it(`the main at ${main}: the jib at 0.6 draws; at 1 (${JIB_EASED_DEG}°) it luffs`, () => {
      expect(settle(main, 0.6).state).toBe("drawing");
      expect(settle(main, 1).state).toBe("luffing");
    });
  }
});

describe("each sail's area, CE, lift slope and coefficients by §3.6 and §6.2", () => {
  for (const id of ["main", "jib"]) {
    it(`the ${id}'s area and CE are its polygon's, and each reef's are its own`, () => {
      const s = c.sails.find((x) => x.id === id);
      const { area, centroid } = polygonAreaCentroid(s.polygonM);
      expect(Math.abs(s.areaM2 - area)).toBeLessThan(1e-9);
      near(s.ceM, centroid, 1e-9);
      for (const r of s.reefs) {
        const g = polygonAreaCentroid(r.polygonM);
        expect(Math.abs(r.areaM2 - g.area)).toBeLessThan(1e-9);
        near(r.ceM, g.centroid, 1e-9);
      }
    });

    it(`the ${id}'s luff, foot, aspect ratio and lift slope (Helmbold on 2·luff²/area)`, () => {
      const s = c.sails.find((x) => x.id === id);
      expect(s.luffM).toBeCloseTo(len(sub(s.headM, s.tackM)), 12);
      expect(s.footM).toBeCloseTo(len(sub(s.clewM, s.tackM)), 12);
      expect(s.ar).toBeCloseTo((2 * s.luffM * s.luffM) / s.areaM2, 12);
      expect(s.liftSlope).toBe(sailSlope(s.luffM, s.areaM2));
    });

    it(`the ${id}'s coeffs are rigSailCoeffs at δ = 0 on the fixture's α grid, to 1e−9`, () => {
      const s = c.sails.find((x) => x.id === id);
      expect(s.coeffs.alphaDeg).toEqual(fixture.sails.find((f) => f.id === id).coeffs.alphaDeg);
      const out = [0, 0];
      s.coeffs.alphaDeg.forEach((a, i) => {
        rigSailCoeffs(out, s.model, s.liftSlope, a, 0, c.sailModel.cnExp);
        expect(Math.abs(s.coeffs.cl[i] - out[0])).toBeLessThan(1e-9);
        expect(Math.abs(s.coeffs.cd[i] - out[1])).toBeLessThan(1e-9);
      });
    });
  }
});

describe("the sets and the rig's dimensions (§3.6, §3.7, §6.3)", () => {
  it("full, reef1, reef2: area-weighted CEs, heM = 1.1 × the masthead's height above the waterline, ARe = heM²/A", () => {
    expect(c.sets.map((s) => [s.id, s.reef])).toEqual([["full", -1], ["reef1", 0], ["reef2", 1]]);
    const parts = [[main, jib], [main.reefs[0], jib], [main.reefs[1], jib]];
    c.sets.forEach((set, i) => {
      const a = parts[i].reduce((x, p) => x + p.areaM2, 0);
      expect(set.areaM2).toBeCloseTo(a, 12);
      const ce = [0, 1, 2].map((k) => parts[i].reduce((x, p) => x + p.areaM2 * p.ceM[k], 0) / a);
      near(set.ceM, ce, 1e-12);
      expect(set.heM).toBeCloseTo(1.1 * c.hardpoints.mastheadM[2], 12);
      expect(set.are).toBeCloseTo((set.heM * set.heM) / set.areaM2, 12);
    });
  });

  it("a masthead rig: I to the forestay's top, J, P the main's luff, E its foot, BAS the gooseneck over the deck", () => {
    expect(c.rig.type).toBe("masthead");
    expect(c.rig.I).toBeCloseTo(drawing.forestay.to[1] - drawing.mast.step[1], 12);
    expect(c.rig.P).toBe(main.luffM);
    expect(c.rig.E).toBe(main.footM);
    expect(c.rig.BAS).toBeCloseTo(1.45, 12);
    expect(c.rig.designer.areaM2).toBeCloseTo(0.5 * c.rig.P * c.rig.E + 0.5 * c.rig.I * c.rig.J, 12);
    expect(c.rig.actual).toEqual({ areaM2: c.sets[0].areaM2, ceM: c.sets[0].ceM });
  });

  it("the mainsheet's boom end is 0.95·E aft of the gooseneck, over the drawn traveller's ends", () => {
    const b = toBody(c.hardpoints.mainsheet.boomM);
    expect(b[2] - FIT.rig.position[2]).toBeCloseTo(0.95 * c.rig.E, 12);
    expect(b[1]).toBeCloseTo(FIT.rig.position[1], 12);
    near(c.hardpoints.mainsheet.travellerM.map((p) => toBody(p)).flat(), drawing.traveller.flat(), 1e-12);
    // [port, starboard]: port is the contract's y > 0
    expect(c.hardpoints.mainsheet.travellerM[0][1]).toBeGreaterThan(0);
  });
});

describe("the jib's leads follow §3.9's rule", () => {
  it("the rule reproduces the 12 m fixture's own leads (its flat deck at z 1.2), every furl, both sides", () => {
    const f = fixture.sails.find((s) => s.id === "jib");
    const body = { tackM: toBody(f.tackM), headM: toBody(f.headM), clewM: toBody(f.clewM) };
    for (const side of fixture.hardpoints.jibLeads) {
      const sign = side.side === "port" ? -1 : 1;
      for (const lead of side.leads) near(toContract(leadAt(body, lead.furl, sign, 7, () => 1.2)), lead.atM, 1e-6);
    }
  });

  it(`hers: at 7° from the tack in plan, on the line from the luff's middle through the clew, on her drawn deck, at furl ${LEAD_FURLS.join(", ")}`, () => {
    const body = { tackM: toBody(jib.tackM), headM: toBody(jib.headM), clewM: toBody(jib.clewM) };
    const mid = toBody(jib.tackM).map((v, i) => (v + toBody(jib.headM)[i]) / 2);
    for (const side of c.hardpoints.jibLeads) {
      const sign = side.side === "port" ? -1 : 1;
      expect(side.leads.map((l) => l.furl)).toEqual([...LEAD_FURLS]);
      for (const { furl, atM } of side.leads) {
        const p = toBody(atM);
        // 7° off the centreline from the tack, on this side
        expect(Math.sign(p[0])).toBe(sign);
        expect(Math.atan2(Math.abs(p[0]), p[2] - body.tackM[2]) / DEG).toBeCloseTo(7, 9);
        // in plan along her, and in height, on the line from the luff's middle through the furled clew
        const clew = furledClew(body, furl);
        const t = (p[2] - mid[2]) / (clew[2] - mid[2]);
        expect(t).toBeGreaterThan(1);
        expect(p[1]).toBeCloseTo(mid[1] + t * (clew[1] - mid[1]), 9);
        // put down on what's drawn there
        expect(p[1]).toBeCloseTo(deckSurfaceAt(p[0], p[2]), 9);
      }
      // the track runs from the foremost lead to the aftmost
      const xs = side.leads.map((l) => l.atM[0]);
      expect(side.trackFromM[0]).toBe(Math.max(...xs));
      expect(side.trackToM[0]).toBe(Math.min(...xs));
    }
    expect(jib.sheeting.lead).toEqual({ port: c.hardpoints.jibLeads[0].leads[0].atM, starboard: c.hardpoints.jibLeads[1].leads[0].atM });
  });
});

describe("the lumped sail (§6.8) and the CG roll-up (§3.4)", () => {
  it("the rule reproduces the 12 m fixture's own lumped sail from its sails", () => {
    const sails = fixture.sails.map((s) => ({ area: s.areaM2, ce: toBody(s.ceM), tack: toBody(s.tackM) }));
    const l = lumpedSailOf(sails, toBody(fixture.rig.boom.gooseneckM)[1], fixture.lumpedSail.ceHeightFrac);
    const f = fixture.lumpedSail;
    expect(l.area).toBeCloseTo(f.areaM2, 6);
    expect(l.luff).toBeCloseTo(f.luffM, 5);
    expect(l.foot).toBeCloseTo(f.footM, 5);
    near(toContract(l.tack), f.tackM, 1e-6);
    near(toContract(l.ce), f.ceM, 1e-6);
  });

  it("hers: the sails' area and CE, the foot three times their swing arm, the tack at the boom's height", () => {
    const L = c.lumpedSail;
    expect(L.areaM2).toBe(c.sets[0].areaM2);
    near(L.ceM, c.sets[0].ceM, 1e-12);
    const arm = (main.areaM2 * (main.tackM[0] - main.ceM[0]) + jib.areaM2 * (jib.tackM[0] - jib.ceM[0])) / L.areaM2;
    expect(L.footM).toBeCloseTo(3 * arm, 12);
    expect(L.tackM[2]).toBeCloseTo(main.tackM[2], 12);
    expect(L.tackM[2] + L.ceHeightFrac * L.luffM).toBeCloseTo(L.ceM[2], 12);
    expect(L.tackM[0] - L.footM / 3).toBeCloseTo(L.ceM[0], 12);
  });

  it("the CG is the items' roll-up, exactly; only the rig's items moved, to where she draws them; the mass is the fixture's", () => {
    const { cgM } = rollUp(c.loading.items);
    near(c.loading.cgM, cgM, 1e-12);
    expect(c.loading.massKg).toBe(fixture.loading.massKg);
    const moved = new Set(["mast", "boom", "rigging", "sail-main", "sail-jib"]);
    c.loading.items.forEach((it, i) => {
      const f = fixture.loading.items[i];
      expect(it.massKg).toBe(f.massKg);
      if (!moved.has(it.id)) expect(it.atM).toEqual(f.atM);
    });
    const at = (id) => c.loading.items.find((it) => it.id === id).atM;
    expect(at("sail-main")).toEqual(main.ceM);
    expect(at("sail-jib")).toEqual(jib.ceM);
    near(at("mast"), toContract([0, drawing.mast.step[1] + drawing.mast.height / 2, drawing.mast.step[2]]), 1e-12);
  });
});

describe("which ships take it", () => {
  it("the stock hull (any sailing/hull@n) at her stand: the contract path, with nothing to warn about", () => {
    for (const key of ["sailing/hull@2", "sailing/hull@3", "sailing/hull@1"]) {
      const spec = specOn(rigGLB, key);
      expect(spec.rig).toBeDefined();
      expect(spec.rig.warnings).toEqual([]);
      expect(spec.mass).toBe(8000);
    }
    expect(keyFamily("sailing/hull@2")).toBe(STOCK_GLB_KEY);
  });

  it("the rig placed off her stand still flies the contract's places, and says so", () => {
    const moved = placed.map((v, i) => (i === 12 ? v + 0.5 : v));
    expect(specOn(rigGLB, "sailing/hull@2", { matrix: moved }).rig.warnings).toEqual([expect.stringMatching(/isn't where its contract put it/)]);
  });

  it("another hull (camber's, an imported one, a doc without files): not taken; the rig is the plain one, exactly as before", () => {
    for (const key of [null, "camber/cuvature@1", "sailing/hullish@1", "other/sailing/hull@2"]) {
      const spec = specOn(rigGLB, key);
      expect(spec.rig).toBeUndefined();
      expect(specKey(spec)).toBe(OLD_KEY);
    }
    expect(contractOn(c, "camber/cuvature@1")).toBeNull();
    // a rig-aid contract (no glbKey) is taken anywhere, as it was
    expect(contractOn(fixture, null)).toBe(fixture);
    expect(contractOn(fixture, "camber/cuvature@1")).toBe(fixture);
  });

  it("an old doc's rig@1 (extras without rig) on the stock hull: no contract, the same spec as before, key for key", () => {
    const spec = specOn(RIG1, "sailing/hull@2");
    expect(spec.rig).toBeUndefined();
    expect(specKey(spec)).toBe(OLD_KEY);
  });
});

describe("her drawn hull isn't the contract's (a known gap)", () => {
  it("below her waterline she displaces 9.38 m³ against the contract's 7.80 m³: outside drawnHull's 5%, so she floats on the synthetic hull", () => {
    const tris = [];
    for (const m of partMeshes("hull")) {
      for (const p of m.primitives) {
        const pos = p.positions, idx = p.indices;
        const n = idx ? idx.length : pos.length / 3;
        for (let i = 0; i < n; i++) {
          const v = 3 * (idx ? idx[i] : i);
          tris.push(pos[v], pos[v + 1], pos[v + 2]);
        }
      }
    }
    const v = meshVolumeBelow(Float64Array.from(tris));
    expect(v).toBeCloseTo(9.38, 2);
    expect(c.hull.volumeM3).toBeCloseTo(7.80, 2);
    expect(Math.abs(v / c.hull.volumeM3 - 1)).toBeGreaterThan(0.05);
    // and a synthetic contract never tries her mesh
    expect(specOn(rigGLB, "sailing/hull@2").rig.mesh).toBeNull();
  });
});

describe("head to wind (DESIGN.md, \"Leaving the anchor\"): no stable irons; backing the jib, the rudder going astern and leaving her alone, each in its pinned time", () => {
  // Flat water, from rest, the main up at the template's sheet, the jib where
  // the wind and its sheet put it (the sim's own start: no jib angle given).
  // She lies off the wind on her starboard bow (the wind on her port bow at
  // −off), so falling off is to port (heading −); the jib "backed" is held
  // to starboard, what B at the helm does with the wheel to port. Backed, the
  // times are pinned (±0.05 s): a strong moment, well off the equilibrium,
  // so they move only when the physics does, and each meets its target
  // (DESIGN.md: backed she's off in seconds). Without the jib she starts on
  // an unstable equilibrium and creeps off it, so those times are pinned to
  // a band (±5%): the helm reversed in sternway against the diagnosis'
  // 15–30 s estimate, a known gap; left alone, only that she falls off by
  // herself, and slower than with the helm reversed.
  const KN = 0.514444;
  const ship = createShip(specOn(rigGLB, "sailing/hull@2"));
  const air = (kn) => ({ wind: windFrom(kn * KN, 0) });
  function fallOff(v, offDeg, kn, seconds) {
    return fallOffFrom(ship.rest({ yaw: offDeg * DEG }), v, air(kn), seconds); // the jib where the wind and its sheet put it
  }
  function fallOffFrom(s0, v, env, seconds) {
    const controls = controlsOf(v, null, ship.spec);
    let s = s0;
    for (let i = 0; i <= seconds * 30; i++) {
      const d = ship.read(s, controls, env);
      if (Math.abs(d.heading) > 45 * DEG) return { past: i / 30, heading: d.heading / DEG };
      s = ship.step(s, controls, env, 1 / 30);
    }
    return { past: null, heading: NaN };
  }
  const JIB = { sheet: 0.5, held: null, furl: 0 };
  const UP = { sail: { raised: 1, sheet: 0.5 }, anchor: { down: false } };
  const BACKED = { ...UP, helm: { angle: -1 }, jib: { ...JIB, held: "starboard" } };
  const REVERSED = { ...UP, helm: { angle: 1 }, jib: JIB }; // the wheel to starboard: going astern, her bow goes to port
  const ALONE = { ...UP, helm: { angle: 0 }, jib: JIB };
  const pinned = (got, want, tol = 0.05) => {
    expect(got.past).not.toBeNull();
    expect(Math.abs(got.past - want)).toBeLessThan(tol);
    expect(got.heading).toBeLessThan(-45);
  };
  const BAND = 0.05; // of the time, either way: off an unstable equilibrium

  it("her canoe body's Munk moment is the same with the flow reversed, (u, v) → (−u, −v): ½ρ·LWL³·|N′v|·u·v, turning her broadside going ahead or astern", () => {
    // appendages off, so the rest of her moment is the side force's, which turns with the flow
    const sp = ship.spec;
    const bare = createShip({ ...sp, rig: { ...sp.rig, appendages: sp.rig.appendages.map((a) => ({ ...a, areaM2: 0, bulb: null })) } });
    const s0 = ship.rest({ yaw: 0 });
    const sf = sp.rig.hull.sideForce;
    const STOWED = { sail: 0, sheet: 0.5, furl: 1, rudder: 0 };
    // + bow to starboard; her bow is −z, her starboard +x
    const N = (u, v) => -bare.wrench({ position: s0.position, quaternion: s0.quaternion }, { velocity: [v, 0, -u], spin: [0, 0, 0] }, STOWED, {}).torque[1];
    for (const V of [0.3, 0.8]) {
      for (const lambda of [5, 15]) {
        const u = V * Math.cos(lambda * DEG), v = V * Math.sin(lambda * DEG);
        const ahead = N(u, v), astern = N(-u, -v);
        const even = (ahead + astern) / 2;
        const munk = -0.5 * 1025 * sf.lwlM ** 3 * Math.abs(sf.nv) * u * v; // bow away from the flow: to port, sliding to starboard
        expect(Math.abs(even / munk - 1)).toBeLessThan(0.005);
        // and what's left is odd: the side force's, small beside it
        expect(Math.abs(ahead - astern) / 2).toBeLessThan(Math.abs(munk) * 0.2);
        // going ahead it's §6.4's q·LWL³·N′v·sin λ times cos λ (compose.js has sin λ): agreement.slow.test.js's
        // KNOWN_GAPS note on cuvature's helm, checked here rather than only listed there
        const s64 = 0.5 * 1025 * V * V * sf.lwlM ** 3 * Math.abs(sf.nv) * Math.sin(lambda * DEG);
        expect(Math.abs(Math.abs(even) / s64 / Math.cos(lambda * DEG) - 1)).toBeLessThan(0.005);
      }
    }
  });

  it("drifting straight downwind at 0.45 m/s in 12 kn, at 1–15° off the wind either side, every rig falls off: no stable head-to-wind equilibrium", () => {
    const s0 = ship.rest({ yaw: 0 });
    const env = air(12);
    const RIGS = {
      "main only": { ...UP, helm: { angle: 0 }, jib: { ...JIB, furl: 1 } },
      "main and jib": ALONE,
      "sails down": { sail: { raised: 0, sheet: 0.5 }, anchor: { down: false }, helm: { angle: 0 }, jib: { ...JIB, furl: 1 } },
    };
    for (const [name, v] of Object.entries(RIGS)) {
      const controls = controlsOf(v, null, ship.spec);
      for (const th of [1, 3, 5, 10, 15, -1, -3, -5, -10, -15]) {
        // heading +th: her bow th to starboard of the wind's eye (the wind from −z), drifting +z
        const y = -th * DEG;
        const q = s0.quaternion, qy = [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
        const quaternion = [qy[3] * q[0] + qy[1] * q[2], qy[3] * q[1] + qy[1] * q[3], qy[3] * q[2] - qy[1] * q[0], qy[3] * q[3] - qy[1] * q[1]];
        const Nb = -ship.wrench({ position: s0.position, quaternion }, { velocity: [0, 0, 0.45], spin: [0, 0, 0] }, controls, env).torque[1];
        expect(Nb * th, `${name} at ${th}°: ${Nb.toFixed(1)} N·m`).toBeGreaterThan(0);
      }
    }
  });

  // measured 2026-11-09: the Munk moment as u·v; a made-fast jib backed to windward, or either side within its
  // zero-lift angle of dead ahead; the jib from where the wind and its sheet put it
  const TIMES = {
    // re-pinned 2026-11-09 for the stock jib's sheet easing to 60° (JIB_EASED_DEG; 45.2, 42.4, 34.7, 64.0 with the
    // free main at its zero lift alone): the luffing jib's free swing in sternway is no longer stopped at 30°
    12: { backed: { 0: 7.2, 1: 7.03, 2: 6.87, 5: 6.6 }, reversed: { 1: 48.4, 2: 45.77, 5: 38.5 }, alone: { 2: 70.8 } },
    6: { backed: { 1: 14.73, 2: 14.5, 5: 14.03 } },
  };
  for (const kn of [12, 6]) {
    for (const [off, t] of Object.entries(TIMES[kn].backed)) {
      it(`${kn} kn, ${off}° off: the jib backed to starboard, she falls off to port past 45° in ${t} s (target: within ${kn === 12 ? 10 : 18} s)`, () => {
        const got = fallOff(BACKED, Number(off), kn, 30);
        pinned(got, t);
        expect(got.past).toBeLessThan(kn === 12 ? 10 : 18);
      });
    }
  }
  it("B at the helm, 0–10° off either bow, the wheel to port, amidships or to starboard, the jib's sheet in, half or out: the side B makes it fast on backs it, and she turns past 45° the way the hint names, within 11 s", () => {
    // B's rule (stations.js helmBackSide) reads the jib's own air off her read, as the station does; held there, her
    // physics backs it (trim.js's "backed") from the first read, and her bow goes to the other side ("bow to …")
    const env = air(12);
    const k = trimModelOf(jib);
    const bad = [];
    for (const sheet of [0, 0.5, 1]) {
      for (const off of [-10, -5, -4, -2, -1, 0, 1, 2, 4, 5, 10]) {
        for (const wheel of [-1, 0, 1]) {
          const v = { ...UP, helm: { angle: wheel }, jib: { ...JIB, sheet } };
          const s0 = ship.rest({ yaw: off * DEG });
          const from = ship.read(s0, controlsOf(v, null, ship.spec), env).sails.find((x) => !x.main).from;
          const side = helmBackSide({ from, alpha0: k.alpha0, wheel });
          const held = { ...v, jib: { ...v.jib, held: side > 0 ? "starboard" : "port" } };
          const state = trimOf(ship.read(s0, controlsOf(held, null, ship.spec), env).sails.find((x) => !x.main), k).state;
          const got = fallOffFrom(s0, held, env, 11);
          if (state !== "backed" || got.past == null || Math.sign(got.heading) !== -side) bad.push({ sheet, off, wheel, side, state, ...got });
        }
      }
    }
    expect(bad).toEqual([]);
  });
  for (const [off, t] of Object.entries(TIMES[12].reversed)) {
    it(`12 kn, ${off}° off: the jib luffing, the wheel to starboard as she gathers sternway, her bow goes to port past 45° in ${t} s ±5% (estimate: 15–30 s; a known gap)`, () => {
      pinned(fallOff(REVERSED, Number(off), 12, 60), t, t * BAND);
    });
  }
  it(`12 kn, 2° off, left alone (the jib luffing, the wheel amidships): she drifts astern and falls off by herself past 45° in ${TIMES[12].alone[2]} s ±5%, slower than with the helm reversed`, () => {
    const got = fallOff(ALONE, 2, 12, 90);
    pinned(got, TIMES[12].alone[2], TIMES[12].alone[2] * BAND);
    expect(got.past).toBeGreaterThan(TIMES[12].reversed[2]);
  });
  it("12 kn, at anchor 20° off the wind, her sails down or the main up (the jib furled, as Ship at anchor has it): she pivots on her bow's rode and lies within 6° of head to wind", () => {
    const env = air(12);
    for (const sail of [{ raised: 0, sheet: 0.5 }, { raised: 1, sheet: 0.5 }]) {
      let s = ship.rest({ yaw: 20 * DEG });
      const anchor = { at: [s.position[0], -6, s.position[2] - ship.spec.length / 2 - 20], rode: 25 };
      const controls = { ...controlsOf({ helm: { angle: 0 }, sail, jib: { ...JIB, furl: 1 }, anchor: { down: true } }, null, ship.spec), anchor };
      let worst = 0;
      for (let i = 0; i <= 180 * 30; i++) {
        if (i > 90 * 30) worst = Math.max(worst, Math.abs(ship.read(s, controls, env).heading));
        s = ship.step(s, controls, env, 1 / 30);
      }
      expect(worst / DEG).toBeLessThan(6);
    }
  });
});

describe("on a stage: the stock sloop the templates lay out sails her contract; an old doc doesn't", () => {
  async function laidOut({ rigExtras }) {
    const doc = { objects: {}, order: [], traits: {}, view: {}, dimensions: {} };
    const { ctx } = fakeDrop(doc);
    const id = await layOutShip(ctx, { wind: { speed: 7, from: 45 }, seed: 3 });
    const rig = Object.keys(doc.objects).find((k) => doc.objects[k].name === "Boom and sail");
    doc.objects[rig].traits[SAIL].raised = 1;
    const content = {
      [id]: { loaded: true, box: hull.box, extras: hull.extras, root: fakeNode() },
      [rig]: { loaded: true, box: null, extras: rigExtras, root: fakeNode({ Sail: fakeNode() }) },
    };
    return { doc, id, rig, content };
  }

  for (const [name, rigExtras, contract] of [["rig@2", rigGLB, true], ["an old doc's rig@1", RIG1, false]]) {
    it(`${name}: ${contract ? "the contract path (her jib is read), no warnings" : "the plain path (no jib), as before"}`, async () => {
      const { doc, id, content } = await laidOut({ rigExtras });
      expect(Object.keys(doc.assets)).toContain(fileKey("hull"));
      const w = fakeWorld(doc, { content });
      const api = w.join("A");
      const ctx = {};
      ctx.sea = createSeaView(api);
      ctx.sim = createSim(api, ctx);
      api.loop((dt, now) => {
        ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator());
        ctx.sim.tick(dt);
      });
      w.tick(1 / 60, 120);
      const r = ctx.sim.read(id);
      expect(r).not.toBeNull();
      if (contract) expect(Number.isFinite(r.jib)).toBe(true);
      else expect(r.jib).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      w.done();
    });
  }

  it("rig@2: the simulator holds the Jib piece swung about its luff by her read's jib, streams each sail's trim, and the jib's trait reaches her physics", async () => {
    const { doc, id, content } = await laidOut({ rigExtras: rigGLB });
    const jib = Object.keys(doc.objects).find((k) => doc.objects[k].name === "Jib");
    const w = fakeWorld(doc, { content });
    const ctx = {};
    const api = w.join("A");
    ctx.sea = createSeaView(api);
    ctx.sim = createSim(api, ctx);
    api.loop((dt, now) => {
      ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator());
      ctx.sim.tick(dt);
    });
    w.tick(1 / 60, 60);
    let r = ctx.sim.read(id);
    const held = w.holds.get(jib)?.transform;
    expect(held).toBeTruthy();
    expect(held).toEqual(jibTransform(doc.objects[jib].transform, r.jib));
    expect(r.sails.map((x) => x.id)).toEqual(["main", "jib"]);
    for (const x of r.sails) for (const k of ["angle", "limit", "from", "alpha", "sheet", "area", "q"]) expect(Number.isFinite(x[k])).toBe(true);
    expect(ctx.sim.sailModels(id)).toEqual({ main: { alpha0: -4, stall: 18, width: 22, luffAt: 5, drawAt: 9.5, maxDeg: 85, wingFrom: null }, jib: { alpha0: -5, stall: 20, width: 30, luffAt: 5, drawAt: 10, maxDeg: JIB_EASED_DEG, wingFrom: 140 } });
    // furled away by its trait: no jib area
    w.change((d) => (d.objects[jib].traits[JIB].furl = 1));
    w.tick(1 / 60, 2);
    r = ctx.sim.read(id);
    expect(r.sails.find((x) => x.id === "jib").area).toBe(0);
    w.done();
  });
});
