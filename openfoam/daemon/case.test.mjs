// @vitest-environment node
import { describe, it, expect } from "vitest";
import { caseFiles, zeroFiles, f, inflowTurbulence } from "./case.mjs";
import { prepareHull } from "../src/hull/prepare.js";
import { boxTriangles } from "../src/test/box.js";
import { normalizeSetup, KNOT } from "../src/setup.js";

const info = prepareHull(boxTriangles()).info;

describe("numbers for OpenFOAM", () => {
  it("never writes a non-finite number", () => expect(() => f(NaN)).toThrow());
  it("writes −0 as 0", () => expect(f(-0)).toBe("0"));
});

describe("inflow turbulence", () => {
  it("is 1% intensity at an eddy-viscosity ratio of 10", () => {
    const t = inflowTurbulence(2, 1e-6);
    expect(Math.sqrt(t.k / 1.5) / 2).toBeCloseTo(0.01, 12);
    expect(t.nut / 1e-6).toBeCloseTo(10, 9);
  });
});

for (const mode of ["double-body", "free-surface"])
  describe(`a ${mode} case`, () => {
    const setup = normalizeSetup({ mode, speed: 3 * KNOT });
    const { files, geometry: g, patches } = caseFiles(setup, info, { cores: 4 });
    const zero = zeroFiles(g);
    it("has the files its solver reads", () => {
      const need = ["system/blockMeshDict", "system/snappyHexMeshDict", "system/controlDict", "system/fvSchemes", "system/fvSolution", "system/decomposeParDict", "constant/transportProperties", "constant/turbulenceProperties"];
      if (mode === "free-surface") need.push("system/setFieldsDict", "constant/g", "constant/hRef");
      for (const n of need) expect(files[n], n).toBeTruthy();
      expect(files["system/controlDict"]).toMatch(new RegExp(`application\\s+${mode === "free-surface" ? "interFoam" : "simpleFoam"};`));
      expect(files["system/decomposeParDict"]).toMatch(/numberOfSubdomains 4;/);
      expect(Object.keys(zero).sort()).toEqual(mode === "free-surface" ? ["0/U", "0/alpha.water", "0/k", "0/nut", "0/omega", "0/p_rgh"] : ["0/U", "0/k", "0/nut", "0/omega", "0/p"]);
    });
    it("gives every non-constraint patch a condition in every field", () => {
      const open = Object.entries(patches).filter(([, t]) => t === "patch").map(([p]) => p);
      for (const [name, text] of Object.entries(zero)) for (const p of [...open, "hull"]) expect(text, `${name} ${p}`).toMatch(new RegExp(`\\n    ${p}\\n    \\{`));
      // constraint patches come from setConstraintTypes
      for (const text of Object.values(zero)) expect(text).toMatch(/#includeEtc "caseDicts\/setConstraintTypes"/);
    });
    it("names in blockMesh exactly the patches the fields expect", () => {
      for (const p of Object.keys(patches)) expect(files["system/blockMeshDict"]).toMatch(new RegExp(`\\n    ${p} \\{ type ${patches[p]};`));
    });
    it("is a half model (the box is symmetric) with its symmetry plane at y = 0", () => {
      expect(g.half).toBe(true);
      expect(patches.midPlane).toBe("symmetryPlane");
      expect(g.dom.max[1]).toBe(0);
    });
    it("streams toward −x at the boat's speed", () => {
      expect(zero["0/U"]).toMatch(new RegExp(`internalField   uniform \\(${f(-3 * KNOT)} 0 0\\)`));
    });
    it("seeds streamlines in the water, ahead of the bow", () => {
      for (const p of g.seeds) {
        expect(p[0]).toBeGreaterThan(info.bounds.max[0]);
        expect(p[2]).toBeLessThan(0);
        expect(p[1]).toBeLessThanOrEqual(0);
      }
    });
    it("samples the surfaces the results reader expects", () => {
      const cd = files["system/controlDict"];
      for (const s of ["hull", "centreplane", "wake", mode === "free-surface" ? "freeSurface" : "waterplane"]) expect(cd).toMatch(new RegExp(`\\n        ${s} \\{`));
      expect(cd).toMatch(/legacy true/);
    });
  });
