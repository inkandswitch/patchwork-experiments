// The runner: what it keeps of the solver's input, and (where gmsh and
// CalculiX are installed) one real run, start to finish, against theory.
// Machines without the solvers skip the real run; probes/validate.mjs is the
// full set.

import { deckOutline } from "./runner.mjs";
import { findGmsh, findCcx } from "./tools.mjs";
import { box } from "../src/test/shapes.js";

describe("deckOutline", () => {
  it("cuts a long list to its first lines and a count, and leaves short ones whole", () => {
    const deck = ["*HEADING", "a bar", "*NODE, NSET=NALL", ...Array.from({ length: 40 }, (_, i) => `${i + 1}, 0, 0, 0`), "*MATERIAL, NAME=M1", "*ELASTIC", "2e11, 0.3", "*STEP", "*STATIC", "*END STEP", ""].join("\n");
    const lines = deckOutline(deck, 6).split("\n");
    expect(lines.slice(0, 3)).toEqual(["*HEADING", "a bar", "*NODE, NSET=NALL"]);
    expect(lines.slice(3, 9)).toEqual(Array.from({ length: 6 }, (_, i) => `${i + 1}, 0, 0, 0`));
    expect(lines[9]).toBe("** … 34 more lines");
    expect(lines.slice(10, 13)).toEqual(["*MATERIAL, NAME=M1", "*ELASTIC", "2e11, 0.3"]);
    // every keyword line survives, in order
    expect(lines.filter((l) => l.startsWith("*") && !l.startsWith("**"))).toEqual(deck.split("\n").filter((l) => l.startsWith("*")));
  });
  it("what it adds is a comment to CalculiX", () => {
    const out = deckOutline(["*NODE", ...Array.from({ length: 30 }, (_, i) => `${i}`)].join("\n"));
    expect(out.split("\n").filter((l) => l.includes("more lines")).every((l) => l.startsWith("**"))).toBe(true);
  });
});

const solvers = (() => {
  try {
    return { gmsh: findGmsh(), ccx: findCcx() };
  } catch {
    return null;
  }
})();

describe.skipIf(!solvers)("a real run (gmsh and CalculiX are here)", () => {
  it("a steel cantilever: meshed on its own faces, solved, and right", { timeout: 120_000 }, async () => {
    const { localRun, faceFacing } = await import("../probes/lib.mjs");
    const L = 0.1, w = 0.01, P = 100, E = 200e9, nu = 0.3;
    const r = await localRun({
      title: "cantilever",
      triangles: box(L, w, w),
      cores: 2,
      setup: (part) => ({
        material: { name: "Steel", E: { value: 200, unit: "GPa" }, nu, density: { value: 7850, unit: "kg/m³" }, yield: { value: 250, unit: "MPa" } },
        mesh: { size: "coarse", order: 2 },
        supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
        loads: { a: { name: "Tip", kind: "force", faces: [faceFacing(part, [1, 0, 0])], magnitude: { value: P, unit: "N" }, direction: [0, -1, 0] } },
      }),
    });
    expect(r.run.status, r.run.error ?? "").toBe("done");
    expect(r.run.stages.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(r.run.mesh.method).toBe("faces");
    const s = r.run.summary;
    const I = w ** 4 / 12, G = E / (2 * (1 + nu)), kappa = (10 * (1 + nu)) / (12 + 11 * nu);
    const theory = (P * L ** 3) / (3 * E * I) + (P * L) / (kappa * w * w * G);
    expect(Math.abs(s.displacement.max / theory - 1)).toBeLessThan(0.03);
    expect(s.reactions[0].force[1]).toBeCloseTo(P, 6);
    expect(s.balance).toBeLessThan(1e-8);
    expect(s.adrift).toBeLessThan(1e-5);
    expect(s.mass).toBeCloseTo(7850 * L * w * w, 6);
    // the results a scene draws: the skin, with stress and movement at its points
    expect(r.layer.positions.length / 3).toBeGreaterThan(100);
    expect(Object.keys(r.layer.fields).sort()).toEqual(["ux", "uy", "uz", "vm"]);
    expect(r.run.recipe.deck).toMatch(/\*STATIC/);
  });
});
