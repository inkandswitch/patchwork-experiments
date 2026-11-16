// The copies sailing keeps of the rig contract (naval/contract/v1), and its
// copy of naval's windage rules (windage.js).
//
// 1. test/rig-contract/ holds naval's schema, validator, reference consumer
//    (compose.js) and five valid fixtures, copied byte for byte, never
//    linked (CLAUDE.md: every package stands alone). Each copy is held to
//    the sha256 it had when copied (naval at 7d473f91), so an edit to a copy
//    shows here. A change in naval doesn't (sailing stands alone): when
//    naval's contract moves, re-copy all of them and rewrite this table.
// 2. windage.js is naval's rules, held to what naval states with them: from
//    each fixture's own rig, sails and loads it states the fixture's rig
//    elements (§3.13) to the fixture's 9 digits, and its mast section from
//    the mast's length. The hull's element is stated from the fixture's
//    mean freeboard (its frontal area over its beam: the fixture carries no
//    sheer), so that row holds the area and centre rules, and meanFreeboard
//    is held on its own to the trapezoid rule's finite cases.
// 3. elementForce, the one force law the physics flies, is compose.js's
//    §6.1 windage force: at a finite table of states, each fixture's
//    elements one at a time add exactly elementForce's Fh and −Fx, at the
//    element's centre (x, z + zPerSinHeel·sin φ), to compose's surge, sway
//    and yaw.
// 4. sailing's physics carries §6.1's windage by construction: at every
//    unflagged predicted point of the five fixtures, the windage in her
//    wrench (agreement-harness sailingWindage: the wrench in the point's
//    wind less in air moving with her, her sails stowed) is compose's
//    (composeWindage: compose with the elements less without them, taken to
//    her centre of gravity), surge, sway, roll and yaw, to 1e-6 of her
//    weight (moments: of her weight × LWL).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WINDAGE_SOURCE, contractElement, elementForce, hullElement, mastSection, meanFreeboard, planOf, rigElements } from "./windage.js";
import { composer } from "./test/rig-contract/compose.js";
import { composeWindage, contractShip, sailingWindage, stateAt, unflagged } from "./test/agreement-harness.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import catalina from "./test/rig-contract/catalina-30.json";
import j24 from "./test/rig-contract/j24.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "test", "rig-contract");

/** naval/contract/v1's files, as copied (sha256 of the bytes). */
const COPIES = {
  "schema.json": "2d59af720e1415982e0792f0b1b6fde8587e1a145cd72585c002b26518e4de8a",
  "validate.js": "e038e01a4572c633caa6eccc3250158ae313adb80e0d84da4aa6d9201a5a9ca0",
  "compose.js": "81b71eddb6e9f4fa3ce53d0736f0f84c84d923d116e2147f84960628e6948138",
  "sloop-12m.json": "ecd398203b47d8becb9ca8b9cee0258c8e9b614eabad4660b1c1615d8b083b72",
  "catalina-30.json": "f5379d5394cd80122a1abe551aaef51b6e41cb02e21392e3ada9fd7e7782295c",
  "j24.json": "2f1d31ca6a1912c9269d17647ee328c707fb12707459bd0133b617ac00ee48ab",
  "laser-ilca7.json": "ceb4057ab14522abcd87ad077a1dd777c2858687109be9dedf7e555cd05d8b3d",
  "cuvature-first-guess.json": "12d79796aec07211eaf3ca6083ecdfe30e47d401ef3409ea2051d373af7ba784",
};

describe("the contract's files are naval's, to the byte", () => {
  for (const [file, sha] of Object.entries(COPIES)) {
    it(file, () => {
      expect(createHash("sha256").update(readFileSync(join(DIR, file))).digest("hex")).toBe(sha);
    });
  }
});

const FIXTURES = { "sloop-12m": sloop, "cuvature-first-guess": cuvature, "catalina-30": catalina, j24, "laser-ilca7": laser };

/** The fixture's 9 significant digits. */
const close = (got, want) => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(want)));
const sameElement = (got, want) => {
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const k of ["id", "shape"]) expect(got[k]).toBe(want[k]);
  for (const k of ["areaFrontM2", "areaSideM2", "sidePerSinHeelM2", "cdFront", "cdSide", "zPerSinHeelM"]) close(got[k], want[k]);
  got.atM.forEach((v, i) => close(v, want.atM[i]));
};

describe("windage.js states each fixture's elements from its own rig and loads (§3.13)", () => {
  for (const [name, c] of Object.entries(FIXTURES)) {
    it(name, () => {
      expect(c.windage.source).toBe(WINDAGE_SOURCE);
      const r = c.rig;
      expect(mastSection(r.mast.lengthM)).toBeCloseTo(r.mast.sectionM, 9);
      const rig = rigElements({ plan: planOf(r, c.sails), mastWidthM: r.mast.sectionM, rm30Nm: c.loads?.rm30Nm ?? null, chainplateBaseM: c.loads?.chainplateBaseM ?? null }).map(contractElement);
      // the hull's, on a sheer at the fixture's mean freeboard (the area it states over its beam)
      const want = c.windage.elements.find((e) => e.id === "hull");
      const fb = want.areaFrontM2 / c.hull.beamM;
      const hull = contractElement(hullElement({ loa: c.hull.loaM, beam: c.hull.beamM, stemX: c.hull.stemheadM[0], sternX: c.hull.sternM[0], sheerAt: () => fb }));
      const got = [hull, ...rig];
      expect(got.map((e) => e.id)).toEqual(c.windage.elements.map((e) => e.id));
      got.forEach((e, i) => sameElement(e, c.windage.elements[i]));
    });
  }
});

describe("meanFreeboard: the trapezoid rule over the LOA, below the water counting nothing, a station without a sheer left out", () => {
  const n = 40;
  for (const [name, sheerAt, sternX, stemX, want] of [
    ["a level sheer", () => 1.2, -6, 6, 1.2],
    ["a straight sheer (exact)", (x) => 1 + 0.1 * x, -5, 5, 1],
    ["a parabola (the rule's own error, 1/(6n²))", (x) => x * x, 0, 1, 1 / 3 + 1 / (6 * n * n)],
    ["half below the water, the kink on a station", (x) => x, -1, 1, 0.25],
    ["no sheer at the ends", (x) => (Math.abs(x) >= 6 ? NaN : 2), -6, 6, 2],
    ["no sheer anywhere", () => NaN, -6, 6, 0],
  ]) {
    it(`${name}: ${want}`, () => {
      expect(meanFreeboard(sheerAt, sternX, stemX, n)).toBeCloseTo(want, 12);
    });
  }
});

describe("elementForce is compose's §6.1 windage, element by element", () => {
  const RAD = Math.PI / 180;
  const state = { V: 2, leewayDeg: 3, rudderDeg: 0 };
  const twsMs = 8;
  for (const [name, c] of Object.entries(FIXTURES)) {
    const set = c.sets.find((x) => x.trimmed);
    const bare = composer({ ...c, windage: { ...c.windage, elements: [] } });
    for (const e of c.windage.elements) {
      const one = composer({ ...c, windage: { ...c.windage, elements: [e] } });
      for (const twaDeg of [0, 45, 90, 135, 180]) {
        for (const heelDeg of [0, 20]) {
          it(`${name} ${e.id}, TWA ${twaDeg}°, heel ${heelDeg}°`, () => {
            // §6.1's apparent wind, in the heeled sail plane
            const g = twaDeg * RAD;
            const ax = twsMs * Math.cos(g) + state.V, ay = twsMs * Math.sin(g);
            const aws = Math.hypot(ax, ay);
            const b = (Math.atan2(ay, ax) / RAD - state.leewayDeg) * RAD, p = heelDeg * RAD;
            const betaEDeg = Math.atan2(Math.sin(b) * Math.cos(p), Math.cos(b)) / RAD;
            const awsE = aws * Math.hypot(Math.cos(b), Math.sin(b) * Math.cos(p));
            const be = betaEDeg * RAD;
            const [fh, aft] = elementForce(e, awsE * Math.sin(be), awsE * Math.cos(be), Math.sin(p), c.sailModel.rhoAirKgM3);
            const f = { fx: -aft, fh, x: e.atM[0], z: e.atM[2] + e.zPerSinHeelM * Math.sin(p) };
            const at = { set, flat: 1, twsMs, twaDeg };
            const s = { ...state, heelDeg };
            const A = one.forcesAt(at, s), B = bare.forcesAt(at, s);
            const cp = Math.cos(p), sp = Math.sin(p);
            const tol = (v) => 1e-9 * Math.max(1, Math.abs(v));
            for (const [got, want] of [
              [A.surge - B.surge, f.fx],
              [A.sway - B.sway, -f.fh * cp],
              [A.yaw - B.yaw, -f.fh * cp * f.x + f.fx * f.z * sp],
            ]) expect(Math.abs(got - want)).toBeLessThanOrEqual(tol(want));
          });
        }
      }
    }
  }
});

describe("sailing's physics carries §6.1's windage: at every unflagged predicted point, its windage is compose's", () => {
  for (const [name, c] of Object.entries(FIXTURES)) {
    it(name, () => {
      const ship = contractShip(c);
      const W = c.loading.massKg * 9.80665;
      const WL = W * c.hull.lwlM;
      const points = unflagged(c);
      expect(points.length).toBeGreaterThan(10);
      for (const p of points) {
        const got = sailingWindage(ship, stateAt(ship, c, p));
        const want = composeWindage(c, p);
        // windage is there to compare: never nothing on both sides
        expect(Math.abs(want.surge) + Math.abs(want.sway)).toBeGreaterThan(0.1);
        for (const k of ["surge", "sway"]) expect(Math.abs(got[k] - want[k]) / W, `${p.twsKn} kn ${p.twaDeg}° ${k}: ${got[k]} vs ${want[k]}`).toBeLessThan(1e-6);
        for (const k of ["roll", "yaw"]) expect(Math.abs(got[k] - want[k]) / WL, `${p.twsKn} kn ${p.twaDeg}° ${k}: ${got[k]} vs ${want[k]}`).toBeLessThan(1e-6);
      }
    });
  }
});
