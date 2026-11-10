// The Figure, its envelope grading and its formatter, and every figure the
// screen makes over the finite set of fixture subjects: the four published
// boats as designs (synthetic hulls) and camber's four test hulls alone
// (meshes at 12 m), plus the 12 m sloop on a camber hull. Exhaustive and
// deterministic: no random inputs.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  figure,
  isFigure,
  reviveFigure,
  gradeRange,
  gradeParams,
  worstEnvelope,
  combineProvenance,
  formatFigure,
  deltaFigure,
  ENVELOPES,
  PROVENANCES,
  UNITS,
  NEAR_FRACTION,
  FAR_COUNT,
} from "./figures.js";
import { screenSubject, dsyhsParamsOf, savitskyParams, RESIST_FN, DSYHS_FN, METHOD_VERSION } from "./screen.js";
import { CATALOGUE } from "./compare.js";
import { FIXTURES, fixtureDoc } from "../fixtures/index.js";
import { meshFromGlb } from "../link/hull-link.js";
import { envelope as dsyhsEnvelope, envelopeGrade, dsyhsHull } from "../naval/resistance.js";
import { buildTable } from "../naval/statics.js";
import { toHullFrame } from "../naval/hull-frame.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CAMBER = ["cuvature-kink-with-unmodified-pchip", "flat-bottom", "narrow-transom", "hull-default"];

const base = { value: 1.5, unit: "length", method: "m", cite: "c", envelope: "inside", provenance: "measured" };

describe("gradeRange: the one envelope rule, at its documented boundaries", () => {
  // [0, 4]: width 4, so "near" reaches 2 past either end (NEAR_FRACTION 0.5)
  const R = [0, 4];
  const cases = [
    [0, "inside"], // min, closed
    [4, "inside"], // max, closed
    [2, "inside"],
    [-2, "near"], // exactly half a width below
    [6, "near"], // exactly half a width above
    [-2 - 2 ** -40, "far"],
    [6 + 2 ** -40, "far"],
    [-1e-12, "near"],
    [Number.NaN, "far"],
    [Infinity, "far"],
    [-Infinity, "far"],
    [null, "far"],
    [undefined, "far"],
  ];
  it("NEAR_FRACTION is half the range's width", () => expect(NEAR_FRACTION).toBe(0.5));
  for (const [v, want] of cases) it(`${v} in [0, 4] is ${want}`, () => expect(gradeRange(v, ...R)).toBe(want));

  it("a one-sided range grades on its stated scale, and refuses to guess one", () => {
    // Savitsky's C_V ≥ 1 on a scale of 1: near down to 0.5
    expect(gradeRange(1, 1, Infinity, 1)).toBe("inside");
    expect(gradeRange(1e9, 1, Infinity, 1)).toBe("inside");
    expect(gradeRange(0.5, 1, Infinity, 1)).toBe("near");
    expect(gradeRange(0.5 - 2 ** -40, 1, Infinity, 1)).toBe("far");
    expect(() => gradeRange(0.5, 1, Infinity)).toThrow(RangeError);
    // inside never needs the scale
    expect(gradeRange(2, 1, Infinity)).toBe("inside");
  });

  it("gradeParams: every combination of three parameters' grades (27 cases): worst wins, three out is far", () => {
    const param = { inside: 2, near: -1, far: -5 }; // in [0, 4]
    let n = 0;
    for (const a of ENVELOPES)
      for (const b of ENVELOPES)
        for (const c of ENVELOPES) {
          const levels = [a, b, c];
          const g = gradeParams(levels.map((l, i) => ({ label: `p${i}`, value: param[l], min: 0, max: 4 })));
          const out = levels.filter((l) => l !== "inside").length;
          expect(g.envelope).toBe(out >= FAR_COUNT ? "far" : worstEnvelope(levels));
          expect(g.outOfRange.map((o) => o.label)).toEqual(levels.flatMap((l, i) => (l === "inside" ? [] : [`p${i}`])));
          n++;
        }
    expect(n).toBe(27);
  });

  it("worstEnvelope and combineProvenance: every pair (orders inside < near < far, given < measured < estimated)", () => {
    for (const [i, a] of ENVELOPES.entries()) for (const [j, b] of ENVELOPES.entries()) expect(worstEnvelope(a, b)).toBe(ENVELOPES[Math.max(i, j)]);
    for (const [i, a] of PROVENANCES.entries()) for (const [j, b] of PROVENANCES.entries()) expect(combineProvenance(a, b)).toBe(PROVENANCES[Math.max(i, j)]);
    expect(worstEnvelope()).toBe("inside");
    expect(combineProvenance()).toBe("given");
  });
});

describe("figure(): only Figures are made", () => {
  it("makes one, frozen", () => {
    const f = figure(base);
    expect(isFigure(f)).toBe(true);
    expect(Object.isFrozen(f)).toBe(true);
  });
  const bad = [
    ["an unknown unit", { unit: "furlongs" }],
    ["an unknown envelope", { envelope: "outside" }],
    ["an unknown provenance", { provenance: "derived" }],
    ["no method", { method: "" }],
    ["no cite", { cite: undefined }],
    ["a null without a why", { value: null }],
    ["inside with parameters out of range", { outOfRange: [{ label: "x", value: 9, min: 0, max: 1 }] }],
  ];
  for (const [what, patch] of bad) it(`refuses ${what}`, () => expect(() => figure({ ...base, ...patch })).toThrow(TypeError));
  it("a non-finite value is null, with its why (given or made)", () => {
    expect(figure({ ...base, value: Number.NaN, why: "no section" })).toMatchObject({ value: null, why: "no section" });
    expect(figure({ ...base, value: Infinity }).why).toMatch(/not a number/);
  });
  it("a why given with a number is dropped (a call can always pass one); a note is kept", () => {
    const f = figure({ ...base, why: "no waterplane", note: "hollow point" });
    expect(f.why).toBeUndefined();
    expect(f.note).toBe("hollow point");
  });
  it("a worker's figure survives structuredClone and is checked again", () => {
    const f = figure({ ...base, envelope: "near", outOfRange: [{ label: "Cp", value: 0.62, min: 0.519, max: 0.599 }] });
    const back = reviveFigure(structuredClone(f));
    expect(back).toEqual(f);
    expect(() => reviveFigure({ ...structuredClone(f), unit: "parsecs" })).toThrow(TypeError);
  });
  it("UNITS are the unit system's dimensions", () => expect(UNITS).toEqual(expect.arrayContaining(["length", "area", "volume", "mass", "angle", "ratio", "percent", "speed", "force", "moment", "lengthRad"])));
});

describe("formatFigure: the only way a number reaches the study's page", () => {
  it("refuses a bare number, a plain object and a broken figure", () => {
    for (const x of [1.5, "1.5", null, { value: 1.5 }, { ...base, envelope: "weird" }]) expect(() => formatFigure(x)).toThrow(TypeError);
  });
  it("gives the text in the reader's units, the badge and the hover", () => {
    const f = figure({ ...base, value: 0.3048, envelope: "far", outOfRange: [{ label: "Cp", value: 0.7, min: 0.519, max: 0.599 }] });
    const m = formatFigure(f, "metric");
    const i = formatFigure(f, "imperial");
    expect(m.text).toBe("0.305 m");
    expect(i.text).toMatch(/^1\.0+ ft$/);
    expect(m.badge).toBe("far");
    expect(m.title).toMatch(/Envelope: far/);
    expect(m.title).toMatch(/Cp 0\.7 \(fitted 0\.519–0\.599\)/);
  });
  it("one minus sign, a true one, for values and differences; none on what rounds to zero", () => {
    const pct = (value) => figure({ value, unit: "percent", method: "m", cite: "c", provenance: "given" });
    expect(formatFigure(pct(-0.092)).text).toBe("−9.2%");
    expect(formatFigure(pct(-0.092), "metric", { signed: true }).text).toBe("−9.2%");
    expect(formatFigure(pct(0.05), "metric", { signed: true }).text).toBe("+5.0%");
    for (const v of [-0.0001, 0, 0.0001]) for (const signed of [false, true]) expect(formatFigure(pct(v), "metric", { signed }).text).toBe("0.0%");
  });
  it("a null figure shows a dash and says why", () => {
    const f = figure({ ...base, value: null, why: "outside the table's coverage" });
    expect(formatFigure(f)).toMatchObject({ text: "—" });
    expect(formatFigure(f).title).toMatch(/Not screened: outside the table's coverage/);
  });
  it("a difference is signed, graded as the worse, sourced as the weaker", () => {
    const a = figure({ ...base, value: 2, envelope: "near", provenance: "estimated" });
    const b = figure({ ...base, value: 2.5 });
    const d = deltaFigure(a, b);
    expect(d).toMatchObject({ value: -0.5, unit: "length", envelope: "near", provenance: "estimated" });
    expect(formatFigure(d, "metric", { signed: true }).text).toBe("−0.500 m");
    expect(formatFigure(deltaFigure(b, a), "metric", { signed: true }).text).toBe("+0.500 m");
    expect(() => deltaFigure(a, figure({ ...base, unit: "area" }))).toThrow(TypeError);
    expect(deltaFigure(figure({ ...base, value: null, why: "x" }), b)).toMatchObject({ value: null, why: "this subject: x" });
  });
});

describe("the screen over every fixture subject", () => {
  const subjects = [];
  beforeAll(async () => {
    for (const f of FIXTURES) subjects.push({ name: f.id, kind: "design", job: { doc: fixtureDoc(f.fixture) } });
    for (const name of CAMBER) {
      const mesh = await meshFromGlb(new Uint8Array(readFileSync(here(`../test/fixtures/camber/${name}.glb`))));
      subjects.push({ name: `camber ${name}`, kind: "hull", job: { doc: null, linked: { status: "ready", mesh, chip: name } } });
    }
    const sloop = fixtureDoc(FIXTURES.find((f) => f.id === "sloop-12m").fixture);
    const mesh = await meshFromGlb(new Uint8Array(readFileSync(here("../test/fixtures/camber/narrow-transom.glb"))));
    subjects.push({ name: "12 m sloop on narrow-transom", kind: "design", job: { doc: { ...sloop, hull: { ...sloop.hull, link: { url: "automerge:hu11111111111111111111111", frame: { bow: "+X", up: "+Y" } } } }, linked: { status: "ready", mesh, chip: "narrow-transom" } } });
    for (const s of subjects) s.result = screenSubject(s.job);
  }, 120_000);

  const rowsFor = (kind) => CATALOGUE.flatMap((g) => g.rows).filter((r) => kind === "design" || r.needs === "hull");

  it("every subject but the hull with no floating waterline screens; that one says why", () => {
    for (const s of subjects) {
      if (s.name === "camber hull-default") {
        expect(s.result.ok).toBe(false);
        expect(s.result.why).toMatch(/give a displacement/);
        continue;
      }
      expect(s.result.ok, `${s.name}: ${s.result.why}`).toBe(true);
      expect(s.result.methodVersion).toBe(METHOD_VERSION);
      expect(s.result.kind).toBe(s.kind);
    }
  });

  it("each makes exactly its catalogue's rows, each a Figure in its row's unit", () => {
    for (const s of subjects.filter((x) => x.result.ok)) {
      const rows = rowsFor(s.kind);
      expect(Object.keys(s.result.figures).sort(), s.name).toEqual(rows.map((r) => r.id).sort());
      for (const r of rows) {
        const f = s.result.figures[r.id];
        expect(isFigure(f), `${s.name} ${r.id}`).toBe(true);
        expect(f.unit, `${s.name} ${r.id}`).toBe(r.unit);
      }
    }
  });

  it("is deterministic: the same subject screens to the same figures", () => {
    for (const s of subjects.slice(0, 2)) expect(JSON.stringify(screenSubject(s.job))).toBe(JSON.stringify(s.result));
  });

  it("particulars read off a mesh are measured; a synthetic hull's are estimated (or the doc's own word for a stated dimension)", () => {
    for (const s of subjects.filter((x) => x.result.ok)) {
      const F = s.result.figures;
      if (s.name.startsWith("camber")) for (const id of ["lwl", "bwl", "tc", "wsa", "aw", "cp", "kmt", "displacement"]) expect(F[id].provenance, `${s.name} ${id}`).toBe("measured");
      if (s.kind === "design" && !s.job.linked) for (const id of ["wsa", "aw", "cp", "cm", "kmt"]) expect(F[id].provenance, `${s.name} ${id}`).toBe("estimated");
    }
  });

  it("the resistance envelope is DSYHS's own grading of the hull plus the Froude number (and Savitsky's range when it planes)", () => {
    for (const s of subjects.filter((x) => x.result.ok)) {
      for (const fn of RESIST_FN) {
        const f = s.result.figures[`r${Math.round(fn * 100)}`];
        const labels = (f.outOfRange ?? []).map((o) => o.label);
        // Fn 0.25–0.45 is inside the table: never the reason
        expect(labels.includes("Fn (DSYHS table)")).toBe(false);
        if (!labels.some((l) => l.startsWith("Savitsky"))) {
          // displacement regime: exactly gradeParams over the hull's eight DSYHS parameters
          const n = s.job.doc ? null : s.job.linked;
          if (n) expect(f.envelope).toBe(gradeParams(dsyhsParamsOf(hullOf(s))).envelope);
        }
      }
      expect(s.result.figures.rw35.envelope).toBe(s.result.figures.r35.envelope);
    }
  });

  it("DSYHS: the study's grading agrees with the resistance module's own (envelopeGrade) on every screened hull", () => {
    for (const s of subjects.filter((x) => x.result.ok)) {
      const h = hullOf(s);
      expect(gradeParams(dsyhsParamsOf(h)).envelope, s.name).toBe(envelopeGrade(dsyhsEnvelope(dsyhsHull(h))).level);
    }
  });

  it("figures inside their envelope carry no out-of-range parameters; near or far ones name at least one", () => {
    for (const s of subjects.filter((x) => x.result.ok))
      for (const [id, f] of Object.entries(s.result.figures)) {
        if (f.envelope === "inside") expect(f.outOfRange, `${s.name} ${id}`).toBeUndefined();
        else if (!/^ref|Vmg$/.test(id)) expect(f.outOfRange?.length, `${s.name} ${id}`).toBeGreaterThan(0);
      }
  });

  it("the documented ranges: DSYHS's table spans Fn 0.15–0.75; Savitsky is C_V ≥ 1, 2–15°, λ ≤ 4", () => {
    expect(DSYHS_FN).toEqual({ min: 0.15, max: 0.75 });
    const p = savitskyParams({ cv: 1, tau: 2, lambda: 4 });
    expect(gradeParams(p).envelope).toBe("inside");
    expect(gradeParams(savitskyParams({ cv: 0.5, tau: 15, lambda: 4 })).envelope).toBe("near");
    expect(gradeParams(savitskyParams({ cv: 0.49, tau: 15, lambda: 4 })).envelope).toBe("far");
    expect(gradeParams(savitskyParams({ cv: 1, tau: 1.9, lambda: 4.1 })).envelope).toBe("near");
    expect(gradeParams(savitskyParams({ cv: 0.9, tau: 1.9, lambda: 4.1 })).envelope).toBe("far"); // three out
  });
});

// One statics engine per hull: a hull that brings its own Chartroom table (a camber hull's chartroom:source)
// has every upright figure the table carries read from it, and each Figure's method and source say which
// engine gave it. The table here is built from the hull's own mesh, with the wetted area left out as camber's
// exporter leaves it out, so the values must equal the mesh path's and only the sources differ.
describe("a hull with its own Chartroom table: every particular names its engine", () => {
  const PARTICULARS = ["loa", "lwl", "bwl", "tc", "volume", "displacement", "wsa", "aw", "lcb", "lcf", "cb", "cp", "cm", "cw", "halfEntrance", "dL", "slenderness", "kmt"];
  // what a hydrostatic table carries (table), what it has no field for (no-field), what this one leaves out
  // (not-here), and what is a table figure over a mesh one (mixed): all 18 particulars
  const SOURCE = {
    table: ["volume", "displacement", "aw", "kmt"],
    "no-field": ["loa", "lwl", "bwl", "tc", "cm", "halfEntrance"],
    "not-here": ["wsa"],
    mixed: ["lcb", "lcf", "cb", "cp", "cw", "dL", "slenderness"],
  };
  const TAG = { table: /\(the hull's own Chartroom table \(Camber\)\)$/, "no-field": /\(off the mesh: a hydrostatic table has no field for it\)$/, "not-here": /\(off the mesh: the hull's table states no wetted area\)$/, mixed: /\((the table's|∇ over) .*(mesh|waterline).*\)$/ };
  let own, plain, slid;
  beforeAll(async () => {
    const glb = new Uint8Array(readFileSync(here("../test/fixtures/camber/narrow-transom.glb")));
    const mesh = async (extra) => Object.assign(await meshFromGlb(glb), extra);
    const m0 = await mesh({});
    const job = (m, tableSource) => ({ doc: null, linked: { status: "ready", mesh: m, chip: "narrow-transom", tableSource } });
    plain = screenSubject(job(m0, null));
    // the floated volume an exact sample at every heel, as the mesh path's own table has it, so KN is the same reading
    const table = buildTable(toHullFrame(m0.triangles, { bow: "+X", up: "+Y" }), { heels: [0, 30, 60, 90], steps: 12, volumes: [plain.figures.volume.value], reference: { heelDeg: 0, trimDeg: 0, waterplaneOffsetM: 0 } });
    for (const r of table.table.rows) for (const x of r.samples) delete x.wettedAreaM2;
    own = screenSubject(job(await mesh({ table, tableFrame: "shared", tableName: "Camber" }), "Camber"));
    slid = screenSubject(job(await mesh({ table, tableFrame: "aligned", tableName: "Camber" }), "Camber"));
  }, 120_000);

  it("the catalogue of sources covers every particular exactly once", () => {
    expect(Object.values(SOURCE).flat().sort()).toEqual([...PARTICULARS].sort());
  });

  it("with the table: the screen says its statics are the hull's own, and each particular's method ends in its source", () => {
    expect(own.ok && own.tableSource).toBe("chartroom");
    for (const [kind, ids] of Object.entries(SOURCE))
      for (const id of ids) {
        const f = own.figures[id];
        expect(f.method, `${id} (${kind})`).toMatch(TAG[kind]);
        expect(f.provenance, id).toBe("measured");
        if (kind === "table" || kind === "mixed") expect(f.cite, id).toMatch(/the hull's own Chartroom table \(Camber\); naval\/src\/naval\/hull-form\.js tableUpright/);
        else expect(f.cite, id).toMatch(/mesh-hydro\.js uprightHydrostatics: the hull's mesh, cut at the waterplane its hydrostatic table floats it at$/);
      }
  });

  it("without one: the mesh is the engine, and no particular mentions a table in its method", () => {
    expect(plain.ok && plain.tableSource).toBe("mesh");
    for (const id of PARTICULARS) expect(plain.figures[id].method, id).not.toMatch(/table|off the mesh/);
  });

  it("the same hull through both engines reads the same, figure for figure (the table was built from this mesh)", () => {
    for (const id of Object.keys(plain.figures)) {
      const [a, b] = [plain.figures[id], own.figures[id]];
      expect(b.value === null, id).toBe(a.value === null);
      if (a.value !== null) expect(Math.abs(b.value - a.value), id).toBeLessThan(1e-6 * Math.max(1, Math.abs(a.value)));
      expect(b.envelope, id).toBe(a.envelope);
    }
  });

  it("a table nothing ties to the mesh's frame is slid onto its LCB: LCB is then the mesh's, and says so", () => {
    expect(slid.tableSource).toBe("chartroom");
    expect(slid.figures.lcb.method).toMatch(/\(off the mesh: the table is slid onto the mesh by its LCB/);
    expect(slid.figures.lcf.method).toMatch(TAG.mixed);
    expect(slid.figures.volume.method).toMatch(TAG.table);
  });
});

/** The hull's upright hydrostatics as the screen floated it: re-derived for the agreement checks. */
const hulls = new Map();
function hullOf(s) {
  if (!hulls.has(s)) {
    // the screen keeps nothing but Figures, so float the same hull the same way
    const { computeNumbers } = numbersMod;
    const { normalize } = docMod;
    const { bareDoc } = screenMod;
    const d = s.job.doc ? normalize(s.job.doc) : bareDoc();
    hulls.set(s, computeNumbers(d, { linked: d.hull.link ? s.job.linked : null }).form.hydro);
  }
  return hulls.get(s);
}
const numbersMod = await import("../numbers.js");
const docMod = await import("../doc.js");
const screenMod = await import("./screen.js");
