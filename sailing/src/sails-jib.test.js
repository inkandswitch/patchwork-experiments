// Plan item 11's physics, one mechanism per case: a rig contract's sails
// each their own foil (§6.2–6.3: its family's coefficients, its own area,
// CE and lift slope, the air at its own CE; the headsails' upwash on the
// main, their blanketing and goose-winging, the rig's flattening and
// induced drag), the jib swinging about its tack within its sheet's travel
// and no closer than its lead's line, a backed jib held to windward, a reef
// lowering the main's CE, and getting out of irons by backing the jib. The
// fixtures are the rig package's (test/rig-contract/).
import { describe, it, expect } from "vitest";
import { createShip } from "./physics.js";
import { rigSailCoeffs } from "./physics-foils.js";
import { furled, reefed, rigSails, swungCE } from "./rig-sails.js";
import { contractShip, windFrom } from "./test/agreement-harness.js";
import { controlsOf } from "./sim.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import catalina from "./test/rig-contract/catalina-30.json";
import j24 from "./test/rig-contract/j24.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const DEG = Math.PI / 180;
const FIXTURES = { sloop, cuvature, catalina, j24, laser };
const KEELBOATS = { sloop, cuvature, catalina, j24 };
const REST = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
const STILL = { velocity: [0, 0, 0], spin: [0, 0, 0] };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (got, want, tol) => got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(tol));

const ships = new Map();
const shipOf = (c) => (ships.has(c) ? ships.get(c) : ships.set(c, contractShip(c)).get(c));

/**
 * What her sails alone do at rest, upright, heading −Z, in a steady wind of
 * `speed` from `fromDeg` (+ starboard): the wrench with `controls` less the
 * wrench with the main lowered and the jib furled (the hull and its windage
 * are the same in both). Body axes are the world's here.
 */
function sailsAt(c, controls, fromDeg, speed = 6, pose = {}) {
  const ship = shipOf(c);
  const env = { wind: windFrom(speed, fromDeg) };
  const up = ship.wrench({ ...REST, ...pose }, STILL, controls, env);
  const down = ship.wrench({ ...REST, ...pose }, STILL, { ...controls, sail: 0, furl: 1 }, env);
  return { force: sub(up.force, down.force), torque: sub(up.torque, down.torque), up, ship };
}

/** CL and CD of the rig from its sails' force, wind from β (deg) on the starboard side, q·A on the area set. */
function coefficientsOf(force, betaDeg, qA) {
  const drive = -force[2], heel = -force[0]; // forward, and to leeward (port)
  const sb = Math.sin(betaDeg * DEG), cb = Math.cos(betaDeg * DEG);
  return { cl: (drive * sb + heel * cb) / qA, cd: (heel * sb - drive * cb) / qA };
}

/** Sailing's controls for a set's trimmed sheets at whole β (the contract's table). */
function trimmedControls(c, set, b, flat = 1) {
  const t = set.trimmed;
  const main = c.sails.find((s) => s.id === "main");
  const jib = c.sails.find((s) => s.id === "jib");
  const reef = set.reef >= 0 ? main.reefs[set.reef] : null;
  const out = { sail: reef ? 1 - reef.fraction : 1, sheet: t.sheetsDeg.main[b] / main.sheeting.maxDeg, flat, rudder: 0 };
  if (jib) {
    const d = t.sheetsDeg.jib[b];
    out.furl = 0;
    if (d < 0) Object.assign(out, { jibBacked: true, jibSheet: (-d - 30) / 60 });
    else out.jibSheet = (d - jib.sheeting.minDeg) / (jib.sheeting.maxDeg - jib.sheeting.minDeg);
  }
  return out;
}

describe("one sail's coefficients (physics-foils.js rigSailCoeffs) are §6.2's", () => {
  it("every fixture sail's CL and CDv reproduce its contract table (α −30…120°, δ 0) to the fixtures' 9 digits", () => {
    const out = [0, 0];
    for (const c of Object.values(FIXTURES)) {
      for (const s of c.sails) {
        const t = s.coeffs;
        for (let i = 0; i < t.alphaDeg.length; i++) {
          rigSailCoeffs(out, s.model, s.liftSlope, t.alphaDeg[i], 0, c.sailModel.cnExp);
          expect(Math.abs(out[0] - t.cl[i])).toBeLessThan(1e-7);
          expect(Math.abs(out[1] - t.cd[i])).toBeLessThan(1e-7);
        }
      }
    }
  });

  it("easing: a main eased to 85° carries its whole ease.drag at zero lift, and less lift", () => {
    const m = sloop.sails[0].model;
    const a = [0, 0], b = [0, 0];
    rigSailCoeffs(a, m, 5, m.alpha0, 0);
    rigSailCoeffs(b, m, 5, m.alpha0, 85);
    expect(a[0]).toBe(0);
    expect(b[1] - a[1]).toBeCloseTo(m.ease.drag, 12);
    rigSailCoeffs(a, m, 5, 12, 0);
    rigSailCoeffs(b, m, 5, 12, 85);
    expect(b[0]).toBeLessThan(a[0]);
  });
});

describe("the sails together (physics.js) are §6.3's", () => {
  it("at the trimmed sheets, every set's CL and CD from the wrench are its trimmed table's (upwash, blanketing, goose-winging, induced drag)", () => {
    for (const c of Object.values(FIXTURES)) {
      for (const set of c.sets) {
        for (const b of [25, 30, 45, 60, 75, 90, 110, 130, 150, 170]) {
          const { force } = sailsAt(c, trimmedControls(c, set, b), b);
          expect(Math.abs(force[1])).toBeLessThan(1e-9);
          const qA = 0.5 * c.sailModel.rhoAirKgM3 * 36 * set.areaM2;
          const got = coefficientsOf(force, b, qA);
          const cl = set.trimmed.cl[b];
          expect(got.cl, `${c.name} ${set.id} β ${b}`).toBeCloseTo(cl, 6);
          expect(got.cd, `${c.name} ${set.id} β ${b}`).toBeCloseTo(set.trimmed.cdv[b] + (cl * cl) / (Math.PI * set.are), 6);
        }
      }
    }
  });

  it("flattening scales the rig's CL, and its induced drag as CL², not its viscous drag", () => {
    for (const c of Object.values(FIXTURES)) {
      const set = c.sets[0], b = 50, flat = 0.6;
      const { force } = sailsAt(c, trimmedControls(c, set, b, flat), b);
      const got = coefficientsOf(force, b, 0.5 * c.sailModel.rhoAirKgM3 * 36 * set.areaM2);
      const cl = flat * set.trimmed.cl[b];
      expect(got.cl).toBeCloseTo(cl, 6);
      expect(got.cd).toBeCloseTo(set.trimmed.cdv[b] + (cl * cl) / (Math.PI * set.are), 6);
    }
  });

  it("each sail pushes at its own CE, swung with its chord about its luff (the jib's about its tack, the main's about the gooseneck)", () => {
    for (const c of Object.values(KEELBOATS)) {
      const rs = rigSails(shipOf(c).spec.rig);
      const cg = shipOf(c).cg;
      for (const [id, controls] of [
        ["jib", { sail: 0, furl: 0, jibSheet: 0.5 }],
        ["main", { sail: 1, furl: 1, sheet: 0.3 }],
      ]) {
        const S = rs.sails.find((s) => s.id === id);
        const { force, torque, up } = sailsAt(c, controls, 70);
        const theta = id === "jib" ? up.jib : up.boom;
        expect(Math.abs(theta)).toBeGreaterThan(5 * DEG); // swung: the arm isn't the centreplane's
        const ce = swungCE([0, 0, 0], S, S.shape(0).ce, theta);
        const want = cross(sub(ce, cg), force);
        near(torque, want, 1e-9 * Math.hypot(...want));
      }
    }
  });

  it("each sail is in the air at its own CE: turning, the wind is sampled at the jib's and the main's", () => {
    const ship = shipOf(sloop);
    const rs = rigSails(ship.spec.rig);
    const seen = [];
    const wind = { at: (x, z, t, out = [0, 0]) => (seen.push([x, z]), (out[0] = 0), (out[1] = 6), out) };
    const w = ship.wrench(REST, { velocity: [0, 0, -2], spin: [0, 0.3, 0] }, { sail: 1, furl: 0, sheet: 0.4, jibSheet: 0.4 }, { wind });
    for (const S of rs.sails) {
      const ce = swungCE([0, 0, 0], S, S.shape(0).ce, S.main ? w.boom : w.jib);
      expect(seen.some(([x, z]) => Math.abs(x - ce[0]) < 1e-9 && Math.abs(z - ce[2]) < 1e-9), S.id).toBe(true);
    }
  });

  it("with the main lowered and no furl given, the jib rolls away with it: no sail, no force", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = shipOf(c);
      const d = ship.read(ship.rest(), { sail: 0, sheet: 0.5 }, { wind: windFrom(6, 60) });
      expect(d.sailForce).toBe(0);
    }
  });

  it("a contract without sails flies its lumped sail, as before (the boom no closer than 10°)", () => {
    const ship = shipOf(sloop);
    const bare = createShip({ ...ship.spec, rig: { ...ship.spec.rig, sails: [] } });
    const w = bare.wrench(REST, STILL, { sail: 1, sheet: 0 }, { wind: windFrom(6, 40) });
    expect(w.boom).toBeCloseTo(-10 * DEG, 12);
    expect(w.jib).toBeUndefined();
    const own = shipOf(sloop).wrench(REST, STILL, { sail: 1, sheet: 0 }, { wind: windFrom(6, 40) });
    expect(own.boom).toBe(-0); // the contract's main sheets to the centreline (a traveller)
  });
});

describe("the jib swings about its tack within its sheet's travel", () => {
  const jibAt = (controls, fromDeg, pose) => shipOf(sloop).wrench({ ...REST, ...pose }, STILL, { sail: 1, ...controls }, { wind: windFrom(6, fromDeg) }).jib / DEG;

  it("its least sheeting angle is its lead's line from the tack, on every fixture (§3.9)", () => {
    for (const c of Object.values(KEELBOATS)) {
      const j = c.sails.find((s) => s.id === "jib");
      for (const side of ["port", "starboard"]) {
        const L = j.sheeting.lead[side], T = j.tackM;
        expect(Math.atan2(Math.abs(L[1] - T[1]), T[0] - L[0]) / DEG).toBeCloseTo(j.sheeting.minDeg, 6);
      }
    }
  });

  it("hard in, close-hauled: at 7° to leeward; eased out on a reach: at 30°; halfway: 18.5°", () => {
    expect(jibAt({ jibSheet: 0 }, 40)).toBeCloseTo(-7, 9);
    expect(jibAt({ jibSheet: 1 }, 120)).toBeCloseTo(-30, 9);
    expect(jibAt({ jibSheet: 0.5 }, 60)).toBeCloseTo(-18.5, 9);
    expect(jibAt({ jibSheet: 0 }, -40)).toBeCloseTo(7, 9); // port tack: to starboard
  });

  it("inside its least angle it can't draw: within 7° of the wind it lies along it, luffing", () => {
    expect(jibAt({ jibSheet: 0 }, 4)).toBeCloseTo(-4, 6);
    expect(jibAt({ jibSheet: 0 }, 0)).toBeCloseTo(0, 9);
  });

  it("with no jib sheet given it's trimmed to the main's sheet angle, within its own travel", () => {
    expect(jibAt({ sheet: 0 }, 60)).toBeCloseTo(-7, 9);
    expect(jibAt({ sheet: 0.2 }, 60)).toBeCloseTo(-17, 9);
    expect(jibAt({ sheet: 1 }, 120)).toBeCloseTo(-30, 9);
  });

  it("it crosses over no faster than JIB_RATE (200°/s): a tenth of a second moves it 20°", () => {
    const ship = shipOf(sloop);
    const env = { wind: windFrom(6, 40) };
    const s0 = { ...ship.rest(), jib: 30 * DEG };
    const s1 = ship.step(s0, { sail: 1, jibSheet: 0 }, env, 0.1);
    expect(s1.jib / DEG).toBeCloseTo(30 - 20, 6);
  });

  it("furled, its clew slides along the LP line: area × (1 − furl), the luff kept, the CE toward the luff", () => {
    for (const c of Object.values(KEELBOATS)) {
      const S = rigSails(shipOf(c).spec.rig).sails.find((s) => s.id === "jib");
      const full = S.shape(0);
      for (const f of [0.1, 0.3, 0.6]) {
        const g = furled(S.source, f);
        expect(g.area / full.area).toBeCloseTo(1 - f, 7); // the contract's area is to 9 digits
        expect(g.luff).toBe(full.luff);
        const t = S.source.tackM;
        expect(g.ce[2] - t[2]).toBeLessThan(full.ce[2] - t[2]); // nearer the luff: forward
      }
    }
  });
});

describe("the sim's input carries the jib's controls (sim.js controlsOf)", () => {
  it("a jib value gives jibSheet, jibBacked and furl, clamped; without one there are none", () => {
    const spec = { freeboard: 1 };
    expect(controlsOf({ jib: { sheet: 2, backed: 1, furl: 0.25 } }, null, spec)).toMatchObject({ jibSheet: 1, jibBacked: true, furl: 0.25 });
    expect(controlsOf({ jib: { sheet: -1 } }, null, spec)).toMatchObject({ jibSheet: 0 });
    expect(Object.keys(controlsOf({ jib: {} }, null, spec))).toEqual(["rudder", "sail", "sheet", "anchor"]);
    expect(Object.keys(controlsOf({}, null, spec))).toEqual(["rudder", "sail", "sheet", "anchor"]);
  });
});

describe("a backed jib", () => {
  const w = (controls, fromDeg, pose) => shipOf(sloop).wrench({ ...REST, ...pose }, STILL, { sail: 1, jibBacked: true, ...controls }, { wind: windFrom(6, fromDeg) });

  it("is held to windward at its sheet's angle: 7° hard in, 30° eased", () => {
    expect(w({ jibSheet: 0 }, 40).jib / DEG).toBeCloseTo(7, 9);
    expect(w({ jibSheet: 1 }, 40).jib / DEG).toBeCloseTo(30, 9);
    expect(w({ jibSheet: 0 }, -40).jib / DEG).toBeCloseTo(-7, 9);
  });

  it("within 10° of dead ahead it stays on the side it's on; beyond, it goes to windward", () => {
    // where a tenth of a second (20° of swing) takes it from 7° on either side
    const after = (fromDeg, jibDeg) => shipOf(sloop).step({ ...shipOf(sloop).rest(), jib: jibDeg * DEG }, { sail: 1, jibBacked: true, jibSheet: 0 }, { wind: windFrom(6, fromDeg) }, 0.1).jib / DEG;
    expect(after(3, -7)).toBeCloseTo(-7, 9);
    expect(after(3, 7)).toBeCloseTo(7, 9);
    expect(after(-3, 7)).toBeCloseTo(7, 9);
    expect(after(15, -7)).toBeCloseTo(7, 9);
    expect(after(-15, 7)).toBeCloseTo(-7, 9);
  });

  it("from β 140° it's goose-winged: held out on the wing's travel, 30–90°", () => {
    expect(w({ jibSheet: 0 }, 160).jib / DEG).toBeCloseTo(30, 9);
    expect(w({ jibSheet: 1 }, 160).jib / DEG).toBeCloseTo(90, 9);
  });

  it("head to wind, backed to starboard it pushes the bow to port (and to starboard, backed to port)", () => {
    for (const c of Object.values(KEELBOATS)) {
      for (const side of [1, -1]) {
        // the jib alone: the main lowered, the jib kept out
        const { force, torque } = sailsAt(c, { sail: 0, furl: 0, jibBacked: true, jibSheet: 0 }, 0, 6, { jib: side * 7 * DEG });
        expect(Math.sign(force[0])).toBe(-side); // pushed away from the side it's held on
        expect(Math.sign(torque[1])).toBe(side); // + about +Y: the bow (−Z) to port (−X)
      }
    }
  });
});

describe("reefing the main", () => {
  it("geometrically, by its fraction of P, gives every fixture's reefs: area, CE, luff", () => {
    for (const c of Object.values(FIXTURES)) {
      const main = shipOf(c).spec.rig.sails.find((s) => s.id === "main");
      for (const r of main.reefs) {
        const g = reefed(main, r.fraction);
        expect(g.area).toBeCloseTo(r.areaM2, 6);
        near(g.ce, r.ceM, 1e-7);
        expect(g.luff).toBeCloseTo(r.luffM, 9);
      }
    }
  });

  it("lowers the height her main's force heels her at, to the reef's CE, as the wrench measures it", () => {
    for (const c of Object.values(FIXTURES)) {
      const ship = shipOf(c);
      const main = ship.spec.rig.sails.find((s) => s.id === "main");
      let last = Infinity;
      for (const f of [0, ...main.reefs.map((r) => r.fraction), 0.6]) {
        const { force, torque } = sailsAt(c, { sail: 1 - f, furl: 1, sheet: 0 }, 90);
        const height = -torque[2] / force[0]; // the roll moment over the side force: the CE's height above her CG
        const want = (f === 0 ? main.ceM : reefed(main, f).ce)[1] - ship.cg[1];
        expect(height).toBeCloseTo(want, 6);
        expect(height).toBeLessThan(last);
        last = height;
      }
    }
  });
});

describe("in irons (deterministic, flat water, 12 kn true wind dead ahead, from rest)", () => {
  /**
   * How long until her heading is more than 60° off the wind (s; null if
   * not within `seconds`), and which way she went then (deg, − to port).
   */
  function fallOff(c, controls, jib, { seconds = 30 } = {}) {
    const ship = shipOf(c);
    const env = { wind: windFrom(6.17, 0) };
    let s = { ...ship.rest(), jib };
    for (let i = 0; i <= seconds * 30; i++) {
      const d = ship.read(s, controls, env);
      if (Math.abs(d.heading) > 60 * DEG) return { past: i / 30, heading: d.heading / DEG };
      s = ship.step(s, controls, env, 1 / 30);
    }
    return { past: null, heading: NaN };
  }

  // The jib backed to starboard (it starts 7° out on that side) and the
  // rudder over to bear her away to port, the way the backed jib pushes her;
  // the control is the same with the jib sheeted on that side, not backed.
  // Measured 2026-11-09 (backed, then sheeted): the sloop 14.6 s, not within
  // 30 s; the J/24 6.5 s, 16.0 s; the Catalina 8.0 s, 21.0 s; cuvature 8.9 s,
  // 24.7 s. (With the rudder amidships the backed times are within 0.2 s of
  // these: the rudder does little with no way on, and going astern, as she
  // does in irons, it works backwards.)
  const BACKED = { sail: 1, sheet: 0.3, jibBacked: true, rudder: -1 };
  const SHEETED = { sail: 1, sheet: 0.3, rudder: -1 };
  const CASES = [
    ["the sloop", sloop, 20],
    ["the J/24", j24, 10],
    ["the Catalina 30", catalina, 12],
    ["cuvature", cuvature, 12],
  ];
  for (const [name, c, within] of CASES) {
    it(`${name}, jib backed to starboard and the rudder over to port, falls off to port past 60° within ${within} s, at least 1.5× sooner than with it sheeted`, () => {
      const backed = fallOff(c, BACKED, 7 * DEG);
      expect(backed.past).not.toBeNull();
      expect(backed.past).toBeLessThan(within);
      expect(backed.heading).toBeLessThan(-60); // to port, as the backed jib pushes her
      const sheeted = fallOff(c, SHEETED, 7 * DEG);
      // backing is what gets her out: sheeted, she sits in irons longer, or doesn't come out at all
      if (sheeted.past != null) expect(sheeted.past).toBeGreaterThanOrEqual(1.5 * backed.past);
    });
  }
});
