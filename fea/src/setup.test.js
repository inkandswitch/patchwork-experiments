import {
  defaultSetup, normalizeSetup, setupProblems, newId, newSupport, newLoad, listOf, elementSize, finerFaces, meshEstimate,
  readiness, solverModel, describeLoad, directionWord, readQuantity, MAX_MODES,
} from "./setup.js";
import { readPart } from "./part/faces.js";
import { box, plateWithHole, cylinder } from "./test/shapes.js";

/** A complete static setup: a wall, a pull, steel. */
const complete = () => ({
  ...defaultSetup(),
  supports: { a1: { name: "Wall", kind: "fixed", faces: [0] } },
  loads: { b1: { name: "Pull", kind: "force", faces: [5], magnitude: { value: 2, unit: "kN" }, direction: [1, 0, 0] } },
});

describe("normalizeSetup", () => {
  it("nothing given is the default setup, and nothing is said changed", () => {
    expect(normalizeSetup(undefined)).toEqual(defaultSetup());
    expect(setupProblems(undefined)).toEqual([]);
    expect(normalizeSetup(null)).toEqual(defaultSetup());
    expect(normalizeSetup("garbage")).toEqual(defaultSetup());
    expect(normalizeSetup({})).toEqual(defaultSetup());
    expect(setupProblems({})).toEqual([]);
    expect(setupProblems(defaultSetup())).toEqual([]);
  });

  it("the default is static, aluminium, coarse ten-node, six modes, the server's cores", () => {
    const d = defaultSetup();
    expect(d.analysis).toBe("static");
    expect(d.material.name).toBe("Aluminium 6061-T6");
    expect(d.mesh).toEqual({ size: "coarse", order: 2 });
    expect([d.modes, d.cores]).toEqual([6, 0]);
    // each call its own copy
    d.material.E.value = 1;
    expect(defaultSetup().material.E.value).toBe(68.9);
  });

  it("valid values survive untouched", () => {
    const raw = {
      analysis: "modal",
      material: { name: "Oak", E: { value: 11, unit: "GPa" }, nu: 0.35, density: { value: 0.75, unit: "g/cm³" }, yield: null },
      supports: { a: { name: "Floor", kind: "slide", faces: [3, 1] } },
      loads: {
        b: { name: "Push", kind: "force", faces: [2], magnitude: { value: 0, unit: "lbf" }, direction: [0, 0, -2] },
        c: { name: "Water", kind: "pressure", faces: [4], pressure: { value: -3, unit: "psi" } },
        d: { name: "Shake", kind: "gravity", acceleration: { value: 2, unit: "m/s²" }, direction: [1, 0, 0] },
      },
      mesh: { size: { value: 3, unit: "mm" }, order: 1 },
      modes: MAX_MODES,
      cores: 256,
    };
    const n = normalizeSetup(raw);
    expect(setupProblems(raw)).toEqual([]);
    expect(n).toEqual({ ...raw, supports: { a: { name: "Floor", kind: "slide", faces: [1, 3] } } });
  });

  it("is idempotent, and says nothing the second time", () => {
    const raws = [
      undefined,
      complete(),
      { analysis: "thermal", material: 7, supports: { x: { kind: "glued", faces: [1, 1, -2, 2.5, "3", 0] } }, loads: { y: { kind: "magic" }, z: { kind: "force" } }, mesh: { size: "huge", order: 3 }, modes: 0, cores: -1 },
      { material: { E: { value: -1, unit: "GPa" }, nu: 0.5, density: "heavy", yield: { value: 0, unit: "MPa" }, name: "  " } },
    ];
    for (const raw of raws) {
      const once = normalizeSetup(raw);
      expect(normalizeSetup(once)).toEqual(once);
      expect(setupProblems(once)).toEqual([]);
    }
  });

  it("an analysis it doesn't do", () => {
    expect(normalizeSetup({ analysis: "thermal" }).analysis).toBe("static");
    expect(setupProblems({ analysis: "thermal" })).toEqual(["the analysis “thermal” isn't one this does: static is used"]);
  });

  it("a material it can't read at all", () => {
    expect(normalizeSetup({ material: "steel" }).material).toEqual(defaultSetup().material);
    expect(setupProblems({ material: "steel" })).toEqual(["the material couldn't be read: the default is used"]);
  });

  it("each bad field of a material replaced and named; the good ones kept", () => {
    const raw = { material: { name: "  ", E: { value: -1, unit: "GPa" }, nu: 0.5, density: { value: 2, unit: "MPa" }, yield: { value: 0, unit: "MPa" } } };
    const m = normalizeSetup(raw).material;
    const d = defaultSetup().material;
    expect(m).toEqual({ name: "Custom material", E: d.E, nu: d.nu, density: d.density, yield: null });
    expect(setupProblems(raw)).toEqual([
      "the material's Young's modulus must be a positive value with its unit: 68.9 GPa is used",
      "the material's density must be a positive value with its unit: 2700 kg/m³ is used",
      "Poisson's ratio must be between −1 and 0.5: 0.33 is used",
      "the yield strength must be a positive value with its unit, or none: none is used",
    ]);
    // a material with only a good E keeps it
    expect(normalizeSetup({ material: { E: { value: 200, unit: "GPa" } } }).material.E).toEqual({ value: 200, unit: "GPa" });
  });

  it("a support of an unknown kind is fixed; its faces cleaned, without a word", () => {
    const raw = { supports: { s: { name: "Glue", kind: "glued", faces: [3, 1, 3, -1, 2.5, "4", 0] }, t: null, u: 5 } };
    expect(normalizeSetup(raw).supports).toEqual({ s: { name: "Glue", kind: "fixed", faces: [0, 1, 3] } });
    expect(setupProblems(raw)).toEqual(["the support “Glue” has a kind this doesn't know: it is taken as fixed"]);
  });

  it("a load of an unknown kind is left out; a force's bad size and direction replaced", () => {
    const raw = {
      loads: {
        a: { name: "Spell", kind: "magic" },
        b: { name: "Push", kind: "force", faces: [1], magnitude: { value: -5, unit: "N" }, direction: [0, 0, 0] },
        c: { kind: "pressure", faces: [2], pressure: 3 },
        d: { kind: "gravity", acceleration: { value: -1, unit: "g" }, direction: [0, NaN, 0] },
      },
    };
    const n = normalizeSetup(raw);
    expect(Object.keys(n.loads)).toEqual(["b", "c", "d"]);
    expect(n.loads.b).toEqual({ name: "Push", kind: "force", faces: [1], magnitude: { value: 100, unit: "N" }, direction: [0, -1, 0] });
    expect(n.loads.c).toEqual({ name: "Pressure", kind: "pressure", faces: [2], pressure: { value: 1, unit: "MPa" } });
    expect(n.loads.d).toEqual({ name: "Gravity", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] });
    expect(setupProblems(raw)).toEqual([
      "the load “Spell” has a kind this doesn't know: it is left out",
      "the force “Push” needs a size with its unit, not negative (turn its direction instead): 100 N is used",
      "the force “Push” needs a direction: down is used",
      "the pressure “c” needs a value with its unit: 1 MPa is used",
      "gravity “d” needs an acceleration with its unit: 1 g is used",
      "gravity “d” needs a direction: down is used",
    ]);
  });

  it("a mesh size or order it can't read, and modes and cores out of range", () => {
    const raw = { mesh: { size: { value: -2, unit: "mm" }, order: 3 }, modes: 41, cores: 2.5 };
    const n = normalizeSetup(raw);
    expect(n.mesh).toEqual({ size: "coarse", order: 2 });
    expect([n.modes, n.cores]).toEqual([6, 0]);
    expect(setupProblems(raw)).toEqual([
      "the mesh size must be coarse, medium, fine or a length: coarse is used",
      "the element order must be 1 or 2: 2 is used",
      `the number of modes must be a whole number from 1 to ${MAX_MODES}: 6 is used`,
      "the cores must be a whole number (0: the server's choice): 0 is used",
    ]);
    expect(normalizeSetup({ mesh: { size: "fine" } }).mesh).toEqual({ size: "fine", order: 2 });
  });

  it("names are trimmed and cut to 80 characters", () => {
    const n = normalizeSetup({ supports: { s: { name: `  ${"x".repeat(100)}  `, kind: "fixed", faces: [] } } });
    expect(n.supports.s.name).toBe("x".repeat(80));
  });

  it("what is given isn't changed", () => {
    const raw = complete();
    raw.supports.a1.faces = [3, 1];
    const copy = structuredClone(raw);
    normalizeSetup(raw);
    expect(raw).toEqual(copy);
    // and what comes out shares no arrays with it
    const n = normalizeSetup(raw);
    n.loads.b1.direction[0] = 9;
    expect(raw.loads.b1.direction[0]).toBe(1);
  });
});

describe("ids and lists", () => {
  it("newId sorts by time, then by chance", () => {
    const ids = [newId(1000, 0.99), newId(1001, 0), newId(1001, 0.5), newId(1700000000000, 0), newId(1700000000001, 0)];
    expect([...ids].sort()).toEqual(ids);
    expect(newId(5, 0)).toHaveLength(12);
    expect(newId(5, 0.9999999)).toBe("000000005zzz");
  });

  it("listOf: in the order things were made, with their ids", () => {
    expect(listOf({ b: { n: 2 }, a: { n: 1 } })).toEqual([{ id: "a", n: 1 }, { id: "b", n: 2 }]);
    expect(listOf(undefined)).toEqual([]);
  });

  it("newSupport and newLoad: what each kind needs, faces empty", () => {
    expect(newSupport()).toEqual({ name: "Fixed support", kind: "fixed", faces: [] });
    expect(newSupport("slide")).toEqual({ name: "Sliding support", kind: "slide", faces: [] });
    expect(newSupport("glued", "G")).toEqual({ name: "G", kind: "fixed", faces: [] });
    expect(newLoad()).toEqual({ name: "Force", kind: "force", faces: [], magnitude: { value: 100, unit: "N" }, direction: [0, -1, 0] });
    expect(newLoad("pressure").pressure).toEqual({ value: 1, unit: "MPa" });
    expect(newLoad("gravity")).toEqual({ name: "Gravity", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] });
    // and each passes normalizeSetup untouched
    const s = { ...defaultSetup(), supports: { a: newSupport() }, loads: { b: newLoad(), c: newLoad("pressure"), d: newLoad("gravity") } };
    expect(setupProblems(s)).toEqual([]);
    expect(normalizeSetup(s)).toEqual(s);
  });
});

describe("elementSize", () => {
  const at = (size, part) => elementSize({ mesh: { size } }, part);

  it("a beam: about its thickness (twice its volume over its skin)", () => {
    const p = readPart(box(1, 0.1, 0.1));
    const thin = (2 * p.volume) / p.area;
    expect(thin).toBeLessThan(p.diagonal / 12);
    expect(at("coarse", p)).toBeCloseTo(thin, 15);
    expect(at("medium", p)).toBeCloseTo(thin / 1.5, 15);
    expect(at("fine", p)).toBeCloseTo(thin / 2.25, 15);
  });

  it("a cube: a twelfth of its diagonal", () => {
    const p = readPart(box(1, 1, 1));
    expect(at("coarse", p)).toBeCloseTo(Math.sqrt(3) / 12, 15);
    expect(at("fine", p)).toBeCloseTo(Math.sqrt(3) / 12 / 2.25, 15);
  });

  it("a sliver: never finer than a sixtieth of its diagonal", () => {
    const p = readPart(box(1, 1, 0.001));
    expect((2 * p.volume) / p.area).toBeLessThan(p.diagonal / 60);
    expect(at("coarse", p)).toBeCloseTo(p.diagonal / 60, 15);
  });

  it("a length given is that length in metres, whatever the part", () => {
    expect(at({ value: 3, unit: "mm" }, readPart(box(1, 1, 1)))).toBeCloseTo(0.003, 15);
    expect(at({ value: 0.5, unit: "in" }, readPart(box(1, 1, 1)))).toBeCloseTo(0.0127, 15);
  });
});

describe("finerFaces", () => {
  it("a small hole gets elements that go round it in steps; a big one doesn't need them", () => {
    const small = readPart(plateWithHole(0.1, 0.06, 0.005, 0.002, 32));
    const h = elementSize({ mesh: { size: "coarse" } }, small);
    const out = finerFaces({ mesh: { size: "coarse" } }, small);
    const hole = small.faces.find((f) => f.radius);
    expect(out.length).toBe(1);
    expect(out[0].face).toBe(hole.id);
    expect(out[0].size).toBeCloseTo((2 * Math.PI * hole.radius) / 12, 15);
    expect(out[0].size).toBeLessThan(h);
    // finer presets go round in more steps
    expect(finerFaces({ mesh: { size: "fine" } }, small)[0]?.size ?? h).toBeLessThanOrEqual((2 * Math.PI * hole.radius) / 24 + 1e-15);
    const big = readPart(plateWithHole(0.1, 0.06, 0.005, 0.01, 32));
    expect(finerFaces({ mesh: { size: "coarse" } }, big)).toEqual([]);
  });

  it("only round faces: flat ones never, however small", () => {
    const p = readPart(box(1, 1, 0.001));
    expect(finerFaces({ mesh: { size: "fine" } }, p)).toEqual([]);
  });

  it("a length given: round faces counted at the medium preset's steps", () => {
    const p = readPart(cylinder(0.01, 0.05, 32));
    const out = finerFaces({ mesh: { size: { value: 10, unit: "mm" } } }, p);
    expect(out).toEqual([{ face: p.faces.find((f) => f.radius).id, size: expect.closeTo((2 * Math.PI * p.faces.find((f) => f.radius).radius) / 16, 15) }]);
    expect(finerFaces({ mesh: { size: { value: 1, unit: "mm" } } }, p)).toEqual([]);
  });
});

describe("meshEstimate", () => {
  it("fills the volume at the element size, never fewer than line the skin", () => {
    const p = readPart(box(1, 1, 1));
    const e = meshEstimate({ mesh: { size: { value: 0.1, unit: "m" }, order: 2 } }, p);
    expect(e.size).toBeCloseTo(0.1, 15);
    expect(e.elements).toBe(11000);
    expect(e.nodes).toBe(Math.round(11000 * 1.6));
    expect(e.unknowns).toBe(e.nodes * 3);
    expect(meshEstimate({ mesh: { size: { value: 0.1, unit: "m" }, order: 1 } }, p).nodes).toBe(2750);
    // a thin sheet: the skin decides
    const s = readPart(box(1, 1, 0.01));
    expect(meshEstimate({ mesh: { size: { value: 0.1, unit: "m" }, order: 1 } }, s).elements).toBe(Math.round(2.5 * (s.area / 0.01)));
  });
});

describe("readiness", () => {
  const part = readPart(box(0.1, 0.02, 0.03));

  it("a complete setup can run, with nothing to warn of", () => {
    expect(readiness(normalizeSetup(complete()), part)).toEqual({ blocking: [], warnings: [] });
  });

  it("no part: link one, and nothing else said", () => {
    expect(readiness(normalizeSetup(complete()), null)).toEqual({ blocking: ["link a part"], warnings: [] });
  });

  it("a part that isn't solid", () => {
    const open = readPart(box(1, 1, 1).slice(18));
    const r = readiness(normalizeSetup(complete()), open);
    expect(r.blocking[0]).toBe("the part can't be meshed: its surface isn't closed: 4 edges have a face on one side only");
  });

  it("no support; no load", () => {
    const s = normalizeSetup({ ...complete(), supports: {}, loads: {} });
    expect(readiness(s, part).blocking).toEqual(["add a support: with nothing holding it, the part would simply move away", "add a load: with nothing pushing on it, nothing happens"]);
  });

  it("a support or load with no faces picked", () => {
    const s = normalizeSetup({ ...complete(), supports: { a1: { name: "Wall", kind: "fixed", faces: [] } }, loads: { b1: { ...complete().loads.b1, faces: [] } } });
    expect(readiness(s, part).blocking).toEqual(["pick the faces the support “Wall” holds", "pick the faces the load “Pull” acts on"]);
  });

  it("faces the part doesn't have: one, or several", () => {
    const s = normalizeSetup({ ...complete(), supports: { a1: { name: "Wall", kind: "fixed", faces: [0, 9] } }, loads: { b1: { ...complete().loads.b1, faces: [7, 8] } } });
    expect(readiness(s, part).blocking).toEqual([
      "the support “Wall” is on a face the part doesn't have: pick it again",
      "the load “Pull” is on faces the part doesn't have: pick them again",
    ]);
  });

  it("a sliding support on a curved face", () => {
    const c = readPart(cylinder(0.01, 0.05, 32));
    const round = c.faces.find((f) => !f.flat).id, cap = c.faces.find((f) => f.flat).id;
    const s = normalizeSetup({ ...complete(), supports: { a1: { name: "Shaft", kind: "slide", faces: [round] }, a2: { name: "End", kind: "fixed", faces: [cap] } }, loads: { b1: { ...complete().loads.b1, faces: [cap] } } });
    expect(readiness(s, c).blocking).toEqual(["the sliding support “Shaft” needs flat faces: it is on a curved one"]);
  });

  it("warns: only sliding supports", () => {
    const s = normalizeSetup({ ...complete(), supports: { a1: { name: "Floor", kind: "slide", faces: [0] } } });
    const r = readiness(s, part);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual(["only sliding supports hold the part: between them they must stop it moving and turning every way, or the answer means nothing"]);
  });

  it("warns: a load only on fixed faces; not when it is on a sliding face or reaches a free one", () => {
    const onFixed = normalizeSetup({ ...complete(), loads: { b1: { ...complete().loads.b1, faces: [0] } } });
    expect(readiness(onFixed, part).warnings).toEqual(["the load “Pull” is only on fixed faces, which can't move: it does nothing"]);
    const partly = normalizeSetup({ ...complete(), loads: { b1: { ...complete().loads.b1, faces: [0, 5] } } });
    expect(readiness(partly, part).warnings).toEqual([]);
    const onSlide = normalizeSetup({ ...complete(), supports: { a1: { name: "W", kind: "fixed", faces: [0] }, a2: { name: "F", kind: "slide", faces: [5] } } });
    expect(readiness(onSlide, part).warnings).toEqual([]);
  });

  it("warns: a modal analysis ignores loads, and needs no support", () => {
    const s = normalizeSetup({ ...complete(), analysis: "modal", supports: {} });
    expect(readiness(s, part)).toEqual({ blocking: [], warnings: ["a modal analysis takes no account of the loads: it finds how the part rings on its own"] });
    expect(readiness(normalizeSetup({ analysis: "modal" }), part)).toEqual({ blocking: [], warnings: [] });
  });

  it("warns: no yield strength, in a static analysis only", () => {
    const material = { ...defaultSetup().material, yield: null };
    expect(readiness(normalizeSetup({ ...complete(), material }), part).warnings).toEqual(["the material has no yield strength, so no safety factor can be given"]);
    expect(readiness(normalizeSetup({ analysis: "modal", material }), part).warnings).toEqual([]);
  });

  it("gravity alone is a load, and needs no faces", () => {
    const s = normalizeSetup({ ...complete(), loads: { g: newLoad("gravity") } });
    expect(readiness(s, part)).toEqual({ blocking: [], warnings: [] });
  });
});

describe("solverModel", () => {
  const part = readPart(box(0.1, 0.02, 0.03));

  it("SI numbers, unit directions times the size", () => {
    const s = normalizeSetup({
      ...complete(),
      material: { name: "S", E: { value: 200, unit: "GPa" }, nu: 0.3, density: { value: 7.85, unit: "g/cm³" }, yield: { value: 36, unit: "ksi" } },
      loads: {
        b1: { name: "Down", kind: "force", faces: [5], magnitude: { value: 2, unit: "kN" }, direction: [0, -3, 0] },
        b2: { name: "P", kind: "pressure", faces: [3], pressure: { value: 2, unit: "bar" } },
        b3: { name: "G", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [3, 4, 0] },
      },
      mesh: { size: { value: 2, unit: "mm" }, order: 1 },
    });
    const m = solverModel(s, part);
    expect(m.analysis).toEqual({ kind: "static" });
    expect(m.material.E).toBe(200e9);
    expect(m.material.density).toBeCloseTo(7850, 10);
    expect(m.material.yield).toBeCloseTo(36 * 6894757.293168, 3);
    expect(m.material.nu).toBe(0.3);
    expect(m.supports).toEqual([{ id: "a1", name: "Wall", kind: "fixed", faces: [0] }]);
    expect(m.loads[0]).toEqual({ id: "b1", name: "Down", kind: "force", faces: [5], force: [0, -2000, 0] });
    expect(m.loads[1]).toEqual({ id: "b2", name: "P", kind: "pressure", faces: [3], pressure: 2e5 });
    expect(m.loads[2].acceleration.map((v) => v / 9.80665)).toEqual([expect.closeTo(0.6, 15), expect.closeTo(0.8, 15), 0]);
    expect(m.size).toBeCloseTo(0.002, 15);
    expect(m.order).toBe(1);
    expect(m.finer).toEqual([]);
  });

  it("a modal setup carries its modes; no yield is null", () => {
    const m = solverModel(normalizeSetup({ analysis: "modal", modes: 12, material: { ...defaultSetup().material, yield: null } }), part);
    expect(m.analysis).toEqual({ kind: "modal", modes: 12 });
    expect(m.material.yield).toBeNull();
  });
});

describe("describeLoad and directionWord", () => {
  it("a load in words", () => {
    expect(describeLoad({ kind: "force", faces: [1], magnitude: { value: 2, unit: "kN" }, direction: [0, -3, 0] })).toBe("2 kN down on 1 face");
    expect(describeLoad({ kind: "pressure", faces: [1, 2], pressure: { value: 1, unit: "MPa" } })).toBe("1 MPa on 2 faces");
    expect(describeLoad({ kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] })).toBe("1 g down");
    expect(describeLoad({ kind: "force", faces: [], magnitude: { value: 250, unit: "N" }, direction: [1, 0, 0] })).toBe("250 N along +x on 0 faces");
  });

  it("a direction in words", () => {
    expect(directionWord([0, 5, 0])).toBe("up");
    expect(directionWord([0, -1, 0])).toBe("down");
    expect(directionWord([-2, 0, 0])).toBe("along −x");
    expect(directionWord([0, 0, 1])).toBe("along +z");
    expect(directionWord([0, 0, -1])).toBe("along −z");
    expect(directionWord([1, 1, 0])).toBe("along (0.707, 0.707, 0)");
    // within 1.8° of an axis is that axis
    expect(directionWord([1, 0.03, 0])).toBe("along +x");
    expect(directionWord([1, 0.04, 0])).toBe("along (0.999, 0.04, 0)");
  });
});

describe("readQuantity", () => {
  it("a quantity, or a sentence with an example", () => {
    expect(readQuantity("3 mm", "length", "the size")).toEqual({ ok: true, value: { value: 3, unit: "mm" } });
    expect(readQuantity("3", "length", "the size")).toEqual({ ok: false, error: "the size needs a value with its unit (like “3 mm”), not \"3\"" });
  });
});
