// The copies sailing keeps of the rig contract (naval/contract/v1), and its
// copy of naval's windage rules (windage.js).
//
// 1. test/rig-contract/ holds naval's schema, validator, reference consumer
//    (compose.js) and five valid fixtures, copied byte for byte, never
//    linked (CLAUDE.md: every package stands alone). Each copy is held to
//    the sha256 it had when copied (naval at 7d473f91), so a drift either
//    way shows here: re-copy them all from naval and rewrite this table.
// 2. windage.js is naval's rules: from each fixture's own rig and loads it
//    states the fixture's own elements (§3.13), to the fixture's 9 digits.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WINDAGE_SOURCE, contractElement, hullElement, rigElements } from "./windage.js";
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
      const plan = { mast: { partners: [r.mast.partnersM[0], r.mast.partnersM[2]], heightM: r.mast.heightM }, rakeDeg: r.rakeDeg, BAS: r.BAS, P: r.P, I: r.I, type: r.type, sails: c.sails };
      const rig = rigElements({ plan, mastWidthM: r.mast.sectionM, rm30Nm: c.loads?.rm30Nm ?? null, chainplateBaseM: c.loads?.chainplateBaseM ?? null }).map(contractElement);
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
