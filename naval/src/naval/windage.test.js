// windage.js against hand arithmetic: ORC's elements (VPP Documentation 2023,
// §5.3, Table 5.10, eqs. 5.27–5.33) on one plain boat, and the two ways an
// element meets the air at the four angles where the answer is exact.

import { describe, it, expect } from "vitest";
import { windageElements, elementForce, windageForces, meanFreeboard, wireDiameter, mastSection, WINDAGE_RULES } from "./windage.js";

const RHO = 1.225;
// a 10 m boat, 3 m beam, sheer 1 m above the water all along; a 14 m mast (partners at deck, 1 m) with P 11, BAS 1.5, I 12
const plan = { type: "masthead", rakeDeg: 0, P: 11, BAS: 1.5, I: 12, sails: [{ id: "main" }, { id: "jib" }], mast: { heightM: 14, partners: [4, 1] } };
const boat = { plan, loa: 10, beam: 3, stemX: 10, sternX: 0, sheerAt: () => 1, mastLengthM: 14, rm30Nm: 20000, chainplateBaseM: 1 };
const byId = (els) => Object.fromEntries(els.map((e) => [e.id, e]));

describe("the elements: ORC's areas, coefficients and centres", () => {
  it("the mean freeboard (eq. 5.27's fb) is the sheer's mean over the LOA", () => {
    expect(meanFreeboard(() => 1.2, 0, 10)).toBeCloseTo(1.2, 12);
    expect(meanFreeboard((x) => 0.8 + 0.04 * x, 0, 10)).toBeCloseTo(1.0, 12); // linear: its middle
    expect(meanFreeboard((x) => x - 5, 0, 10)).toBeCloseTo(1.25, 12); // below the water counts as none: max(0, x − 5) averages 1.25
  });

  it("the hull: frontal fb·B, side fb·LOA growing by 0.75·(B/2)·LOA per sin φ (eq. 5.28), Cd 0.816, at 0.66·(fb + B·sin φ), mid-LOA", () => {
    const h = byId(windageElements(boat)).hull;
    expect(h).toMatchObject({ shape: "body", areaFrontM2: 3, areaSideM2: 10, sidePerSinHeelM2: 0.75 * 1.5 * 10, cdFront: 0.816, cdSide: 0.816, zPerSinHeelM: 0.66 * 3 });
    expect(h.at[0]).toBe(5);
    expect(h.at[1]).toBeCloseTo(0.66, 12);
  });

  it("the mast: beside the main's luff (BAS to BAS + P) at 0.4 / 0.6, the rest bare at 0.8, each at its middle", () => {
    const e = byId(windageElements(boat));
    const w = mastSection(14);
    expect(e["mast-sail"]).toMatchObject({ shape: "spar", lengthM: 11, widthM: w, cdFront: 0.4, cdSide: 0.6 });
    expect(e["mast-sail"].areaFrontM2).toBeCloseTo(11 * w, 12);
    expect(e["mast-sail"].at[1]).toBeCloseTo(1 + 1.5 + 5.5, 12);
    // bare: 0–1.5 and 12.5–14 above the partners, 3 m in all, its centre their length-weighted middle (0.75 and 13.25 → 7)
    expect(e["mast-bare"]).toMatchObject({ lengthM: 3, cdFront: 0.8, cdSide: 0.8 });
    expect(e["mast-bare"].at[1]).toBeCloseTo(1 + 7, 12);
  });

  it("the rigging: four stays of the cap shroud's diameter, I × 4·d (eqs. 5.31–5.32), Cd 1.0 × 1.2 (eq. 5.33), at half I", () => {
    const r = byId(windageElements(boat)).rigging;
    const d = wireDiameter(20000 / 1);
    // the cap shroud breaks at 2.5 × the chainplate load at a nominal 1 GPa: π·d²/4 · 1e9 = 2.5 · 20 kN
    expect((Math.PI * d * d) / 4 * WINDAGE_RULES.wireStressPa).toBeCloseTo(2.5 * 20000, 6);
    // ORC's width 2·D, D the one wire holding the four stays' steel: D = √4·d = 2·d, so 4·d
    const steel = 4 * ((Math.PI * d * d) / 4); // four stays' cross-section
    const D = Math.sqrt((4 * steel) / Math.PI); // eq. 5.31's square root: one wire of that section
    expect(r).toMatchObject({ shape: "spar", lengthM: 12, cdFront: 1.2, cdSide: 1.2 });
    expect(r.widthM).toBeCloseTo(2 * D, 12); // eq. 5.31's factor of 2
    expect(r.widthM).toBeCloseTo(4 * d, 12);
    expect(r.areaFrontM2).toBeCloseTo(12 * 4 * d, 12);
    expect(r.at[1]).toBeCloseTo(1 + 6, 12);
    // 6 mm 1×19 316 breaks at about 28 kN: the rule's d for that load
    expect(wireDiameter(28.3e3 / 2.5)).toBeCloseTo(0.006, 4);
  });

  it("a cat rig has no rigging; no righting moment, no rigging", () => {
    expect(byId(windageElements({ ...boat, plan: { ...plan, type: "cat" } })).rigging).toBeUndefined();
    expect(byId(windageElements({ ...boat, rm30Nm: null })).rigging).toBeUndefined();
  });
});

describe("how an element meets the air: exact at head-on, abeam, astern, and a round spar from every side", () => {
  const q = 0.5 * RHO * 10 * 10;
  const body = { shape: "body", areaFrontM2: 3, areaSideM2: 10, sidePerSinHeelM2: 11.25, cdFront: 0.816, cdSide: 0.816, at: [5, 0.66], zPerSinHeelM: 1.98 };
  const spar = { shape: "spar", areaFrontM2: 2, areaSideM2: 2, sidePerSinHeelM2: 0, cdFront: 0.4, cdSide: 0.6, at: [4, 8], zPerSinHeelM: 0 };
  const f = (e, beta, heel = 0) => elementForce(e, { awsE: 10, betaEDeg: beta, heelDeg: heel, rho: RHO });

  it("the hull by cross flow: its frontal area takes the head wind, its side the beam wind, nothing across", () => {
    expect(f(body, 0).fx).toBeCloseTo(-q * 0.816 * 3, 9);
    expect(f(body, 0).fh).toBeCloseTo(0, 9);
    expect(f(body, 90).fx).toBeCloseTo(0, 9);
    expect(f(body, 90).fh).toBeCloseTo(q * 0.816 * 10, 9);
    expect(f(body, 180).fx).toBeCloseTo(q * 0.816 * 3, 9); // from astern it pushes her ahead
    // 45°: each area takes the flow normal to it, half its head
    expect(f(body, 45).fx).toBeCloseTo(-q * 0.816 * 3 * 0.5, 9);
    expect(f(body, 45).fh).toBeCloseTo(q * 0.816 * 10 * 0.5, 9);
  });

  it("heeled 30°, the hull's side grows by 0.75·(B/2)·LOA·sin φ and its centre rises 0.66·B·sin φ (ORC's)", () => {
    expect(f(body, 90, 30).fh).toBeCloseTo(q * 0.816 * (10 + 11.25 * 0.5), 9);
    expect(f(body, 90, 30).z).toBeCloseTo(0.66 + 1.98 * 0.5, 12);
  });

  it("a spar's drag is along the flow, its Cd the front's head-on and the side's abeam; a round bare spar's the same from every side", () => {
    expect(f(spar, 0).fx).toBeCloseTo(-q * 2 * 0.4, 9);
    expect(f(spar, 90).fh).toBeCloseTo(q * 2 * 0.6, 9);
    const round = { ...spar, cdFront: 0.8, cdSide: 0.8 };
    for (const b of [0, 15, 30, 45, 60, 75, 90, 135, 180]) {
      const r = f(round, b);
      expect(Math.hypot(r.fx, r.fh)).toBeCloseTo(q * 2 * 0.8, 9);
      expect(Math.atan2(r.fh, -r.fx) * (180 / Math.PI)).toBeCloseTo(b, 9); // along the apparent wind
    }
  });

  it("the sums are the elements' sums; a wind from the other side mirrors the heel force", () => {
    const w = windageForces([body, spar], { awsE: 10, betaEDeg: 40, heelDeg: 0, rho: RHO });
    expect(w.drive).toBeCloseTo(f(body, 40).fx + f(spar, 40).fx, 12);
    expect(w.heel).toBeCloseTo(f(body, 40).fh + f(spar, 40).fh, 12);
    for (const e of [body, spar]) {
      expect(f(e, -40).fh).toBeCloseTo(-f(e, 40).fh, 12);
      expect(f(e, -40).fx).toBeCloseTo(f(e, 40).fx, 12);
    }
  });
});
