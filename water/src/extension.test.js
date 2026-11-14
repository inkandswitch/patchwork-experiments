// The water extension on a fake view of linked stages (test/fake-view.js):
// W3 (at most one surface, the outermost's), W10 (the same water for two
// boats in a harbour), W11 (no water holds still, never the wrong water), and
// what it offers (waterValue). Every configuration is enumerated; nothing is
// randomized.
import { afterEach, describe, expect, it } from "vitest";
import golden from "./test/golden.json";
import water, { TRAIT, WAVES, waterExtent, waterValue } from "./extension.js";
import { fakeView, placement, surfaces, waves } from "./test/fake-view.js";
import { createSurface } from "./surface.js";

const sea = (name) => golden.seas.find((s) => s.name === name);
const H_SEA = sea("Harbour");
const A_SEA = sea("Ship at sea");
const B_SEA = sea("Ship at anchor");
const wet = (s, level = 0) => ({ doc: { title: s.name, traits: { [TRAIT]: { level } } }, extensions: [waves(s.components, { seed: s.seed, wind: s.wind }), water] });
const dry = (title) => ({ doc: { title, traits: {} }, extensions: [] });
// the harbour's link poses (WATER.md, "Which doc holds what")
const AT_A = placement(0, [-40, 0, 0]);
const AT_B = placement((30 * Math.PI) / 180, [40, 0, 0]);
const mulM = (A, B) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k];
  return o;
};

let v = null;
afterEach(() => {
  v?.dispose();
  v = null;
});

describe("what a doc offers (waterValue)", () => {
  it("its level, and the last contributor's waves whole; none is flat water at the level", () => {
    expect(waterValue({ level: 1.5 }, [])).toEqual({ v: 1, level: 1.5, components: [] });
    expect(waterValue({}, [{ id: "x", value: { components: [{ amp: 1 }], look: { seed: 3 } } }, { id: "y", value: { components: [{ amp: 2 }] } }])).toEqual({ v: 1, level: 0, components: [{ amp: 2 }] });
    expect(waterValue({ level: "high" }, [{ id: "x", value: { nope: 1 } }])).toEqual({ v: 1, level: 0, components: [] });
  });

  it("the extent holds every crest and trough about the level", () => {
    const e = waterExtent(H_SEA.components, 2);
    const amp = H_SEA.components.reduce((s, c) => s + c.amp, 0);
    expect(e.max[1]).toBeCloseTo(2 + amp + 0.5, 12);
    expect(e.min[1]).toBeCloseTo(2 - amp - 0.5, 12);
    const w = createSurface(H_SEA.components);
    for (const x of [-100, 0, 37.5]) for (const t of [0, 13.37, 1e4]) expect(Math.abs(w.heightAt(x, x / 2, t))).toBeLessThan(amp + 0.5);
  });
});

/** The configurations W3 names: [label, specs (outermost first), does the outermost offer water]. */
function configurations() {
  return [
    ["one boat alone", [wet(A_SEA)], true],
    ["a dry room alone", [dry("Room")], false],
    ["one boat in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }], true],
    ["two boats in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }], true],
    ["one boat in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }], false],
    ["two boats in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }], false],
    ["a boat two links deep in a harbour", [wet(H_SEA), { ...dry("Shed"), matrix: AT_B }, { ...wet(A_SEA), matrix: mulM(AT_B, AT_A) }], true],
    ["a boat mirrored in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }, { ...wet(A_SEA), matrix: AT_B, drawn: true }], true],
    ["a boat linked into another boat", [wet(B_SEA), { ...wet(A_SEA), matrix: AT_A }], true],
  ];
}

describe("at most one surface (W3): one when the outermost offers water, else none; only the outermost sets an extent", () => {
  for (const [label, specs, offers] of configurations())
    it(label, () => {
      v = fakeView(specs);
      for (let i = 0; i < 3; i++) v.frame();
      expect(surfaces(v)).toBe(offers ? 1 : 0);
      for (const s of v.stages) {
        if (s.n === 0 && offers) expect(s.extent).not.toBeNull();
        else expect(s.extentSets).toBe(0);
      }
      // the one drawn is the outermost's waves, at its level
      if (offers) {
        const drawn = v.stages[0].instances.at(-1).debug.surface;
        expect(drawn).not.toBeNull();
        expect(v.stages[0].groups.find((g) => g.children.length).position.y).toBe(specs[0].doc.traits[TRAIT].level);
      }
    });

  it("the outermost's water going away takes the surface and the extent with it", () => {
    v = fakeView(configurations()[2][1]);
    v.frame();
    expect(surfaces(v)).toBe(1);
    delete v.stages[0].doc.traits[TRAIT];
    v.frame();
    expect(surfaces(v)).toBe(0);
    expect(v.stages[0].extent).toBeNull();
  });
});

describe("the same water for two boats (W10)", () => {
  it("one view computing the harbour and both boats: each boat's reader, mapped to harbour coordinates, is the harbour's own, over 600 frames × a 5×5 grid", () => {
    v = fakeView([{ ...wet(H_SEA), t: 1000 }, { ...wet(A_SEA), matrix: AT_A, t: 3 }, { ...wet(B_SEA), matrix: AT_B, t: 77.5 }]);
    const reader = (n) => v.stages[n].instances.at(-1).water;
    const toHarbour = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
    const fromHarbour = (M, p) => {
      // a level placement's inverse: rotate back about Y, after the translation
      const x = p[0] - M[12], z = p[2] - M[14];
      return [M[0] * x + M[2] * z, p[1] - M[13], M[8] * x + M[10] * z];
    };
    const GRID = [-60, -30, 0, 30, 60];
    let worst = 0;
    let frames = 0;
    for (let f = 0; f < 600; f++) {
      v.frame(1 / 60);
      frames++;
      const H = reader(0);
      for (const [n, M] of [[1, AT_A], [2, AT_B]]) {
        const R = reader(n);
        const tOwn = v.stages[n].clock.t;
        for (const x of GRID)
          for (const z of GRID) {
            const p = fromHarbour(M, [x, 0, z]);
            const hOwn = R.heightAt(p[0], p[2], tOwn);
            const hHarbour = toHarbour(M, [p[0], hOwn, p[2]])[1];
            worst = Math.max(worst, Math.abs(hHarbour - H.heightAt(x, z, v.stages[0].clock.t)));
          }
      }
    }
    expect(frames).toBe(600);
    expect(worst).toBeLessThan(1e-9);
  });

  it("each boat's own waves are never the ones she reads in a harbour (the mutation: give A her own water)", () => {
    v = fakeView([wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }]);
    v.frame();
    const R = v.stages[1].instances.at(-1).water;
    expect(R.components).toEqual(H_SEA.components);
    expect(R.components).not.toEqual(A_SEA.components);
  });
});

describe("no water holds still, never the wrong water (W11)", () => {
  for (const [label, specs] of [
    ["one boat in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }]],
    ["two boats in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }]],
    // the outermost has the trait but this view lacks its water package: nothing of it runs there, so nothing is offered
    ["the outermost's water package missing", [{ doc: { title: "Harbour", traits: { [TRAIT]: { level: 0 } } }, extensions: [waves(H_SEA.components)] }, { ...wet(A_SEA), matrix: AT_A }]],
  ])
    it(`${label}: every boat's reader is null for 600 frames`, () => {
      v = fakeView(specs);
      for (let f = 0; f < 600; f++) {
        v.frame();
        for (const s of v.stages.slice(1)) expect(s.instances.at(-1).water).toBeNull();
      }
    });
});

describe("a reason for time to pass", () => {
  it("registers one process with no state wherever it runs and acts; none in a drawn stage", () => {
    v = fakeView([wet(H_SEA), { ...wet(A_SEA), matrix: AT_A, drawn: true }]);
    expect(v.stages[0].processes).toBe(1);
    expect(v.stages[1].processes).toBe(0);
  });

  it("a tilted link: no reader there, and it says so once", () => {
    const tilt = (5 * Math.PI) / 180;
    const M = [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1];
    v = fakeView([wet(H_SEA), { ...wet(A_SEA), matrix: M }]);
    for (let f = 0; f < 3; f++) v.frame();
    expect(v.stages[1].instances.at(-1).water).toBeNull();
    expect(v.stages[1].notices).toEqual(["Tilted: no water here"]);
  });

  it(`its waves come only from its own stage's ${WAVES}`, () => {
    v = fakeView([wet(H_SEA)]);
    v.frame();
    expect(v.stages[0].instances.at(-1).ambient().water.components).toEqual(H_SEA.components);
  });
});
