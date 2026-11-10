// The comparison over fixture subjects, the study doc's invariants, and a
// subject resolved through the hull link (real size, never a render).
// Deterministic: fixed subjects, every case enumerated.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compare, CATALOGUE, ROW_IDS, NOT_SCREENED } from "./compare.js";
import { screenSubject } from "./screen.js";
import { figure, isFigure, UNITS, worstEnvelope, combineProvenance } from "./figures.js";
import { normalizeStudy, addSubject, removeSubject, setBaseline, setHeads, nextSubjectId, newStudy } from "./doc.js";
import { subjectFor, resolveSubject } from "./subjects.js";
import { FIXTURES, fixtureDoc } from "../fixtures/index.js";
import { meshFromGlb } from "../link/hull-link.js";
import { CHARTROOM_SOURCE } from "../link/chartroom-link.js";
import { getRegistry, resetRegistries } from "../test/patchwork-plugins-stub.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const glb = (name) => new Uint8Array(readFileSync(here(`../test/fixtures/camber/${name}.glb`)));

describe("the catalogue", () => {
  it("has unique row ids, each in a known unit", () => {
    expect(new Set(ROW_IDS).size).toBe(ROW_IDS.length);
    for (const g of CATALOGUE) for (const r of g.rows) expect(UNITS).toContain(r.unit);
  });
});

describe("compare: two designs and a hull, every cell", () => {
  let cols;
  beforeAll(async () => {
    const cat = screenSubject({ doc: fixtureDoc(FIXTURES.find((f) => f.id === "catalina-30").fixture) });
    const j24 = screenSubject({ doc: fixtureDoc(FIXTURES.find((f) => f.id === "j24").fixture) });
    const hull = screenSubject({ doc: null, linked: { status: "ready", mesh: await meshFromGlb(glb("narrow-transom")), chip: "nt" } });
    cols = [
      { id: "s1", label: "Catalina 30", kind: "design", state: "ready", result: cat },
      { id: "s2", label: "J/24", kind: "design", state: "ready", result: j24 },
      { id: "s3", label: "Narrow transom", kind: "hull", state: "ready", result: hull },
    ];
  }, 120_000);

  it("Δ against the baseline: none on the baseline itself, exactly f − base elsewhere, the worse envelope, the weaker provenance", () => {
    for (const baseline of ["s1", "s2", "s3"]) {
      const c = compare(cols, baseline);
      expect(c.columns.map((x) => x.baseline)).toEqual(cols.map((x) => x.id === baseline));
      const bi = cols.findIndex((x) => x.id === baseline);
      let n = 0;
      for (const g of c.groups)
        for (const row of g.rows)
          for (const [i, cell] of row.cells.entries()) {
            const b = row.cells[bi].figure;
            if (i === bi || !cell.figure || !b) {
              expect(cell.delta).toBeNull();
              continue;
            }
            n++;
            expect(isFigure(cell.delta)).toBe(true);
            expect(cell.delta.unit).toBe(row.unit);
            if (cell.figure.value !== null && b.value !== null) expect(cell.delta.value).toBe(cell.figure.value - b.value);
            else expect(cell.delta.value).toBeNull();
            expect(cell.delta.envelope).toBe(worstEnvelope(cell.figure.envelope, b.envelope));
            expect(cell.delta.provenance).toBe(combineProvenance(cell.figure.provenance, b.provenance));
          }
      expect(n).toBeGreaterThan(0);
    }
  });

  it("a hull-only subject's design rows say they need a rig design; rows nobody has are left out", () => {
    const c = compare(cols, "s1");
    const design = new Set(CATALOGUE.flatMap((g) => g.rows).filter((r) => r.needs === "design").map((r) => r.id));
    for (const g of c.groups)
      for (const row of g.rows) {
        const cell = row.cells[2];
        if (design.has(row.id)) expect(cell).toEqual({ figure: null, delta: null, missing: "needs a rig design" });
        else expect(cell.figure).not.toBeNull();
      }
    const hullOnly = compare([cols[2]], "s3");
    expect(hullOnly.groups.flatMap((g) => g.rows).every((r) => !design.has(r.id))).toBe(true);
    expect(hullOnly.groups.map((g) => g.id)).toEqual(["particulars", "stability", "resistance"]);
  });

  it("pending and failed subjects: every cell says so; nothing breaks the others' Δ", () => {
    const c = compare([...cols.slice(0, 2), { id: "p", label: "pending", state: "pending" }, { id: "e", label: "broken", state: "error", error: "link the hull itself" }], "s1");
    for (const row of c.groups.flatMap((g) => g.rows)) {
      expect(row.cells[2]).toMatchObject({ figure: null, missing: "screening…" });
      expect(row.cells[3]).toMatchObject({ figure: null, missing: "link the hull itself" });
    }
    expect(c.columns[3].error).toBe("link the hull itself");
  });

  it("a figure in the wrong unit for its row, or not a Figure at all, is a programming error", () => {
    const wrong = { ...cols[0], result: { ...cols[0].result, figures: { ...cols[0].result.figures, loa: figure({ value: 1, unit: "area", method: "x", cite: "", provenance: "given" }) } } };
    expect(() => compare([wrong], "s1")).toThrow(/loa is in area/);
    const bare = { ...cols[0], result: { ...cols[0].result, figures: { ...cols[0].result.figures, loa: 9.1 } } };
    expect(() => compare([bare], "s1")).toThrow(/isn't a Figure/);
  });

  it("'What the screen can't tell you' lists exactly the figures outside their envelope or unavailable, and the fixed list", () => {
    const c = compare(cols, "s1");
    const want = [];
    for (const [i, col] of cols.entries())
      for (const row of c.groups.flatMap((g) => g.rows)) {
        const f = row.cells[i].figure;
        if (f && (f.envelope !== "inside" || f.value === null)) want.push(`${col.id}/${row.id}`);
      }
    expect(c.cantTell.map((x) => `${x.subjectId}/${x.rowId}`)).toEqual(want);
    expect(want.length).toBeGreaterThan(0); // the DSYHS extrapolations at least
    for (const x of c.cantTell) expect(x.reason).toBeTruthy();
    expect(c.notScreened).toEqual([...NOT_SCREENED]);
  });
});

describe("the study doc", () => {
  const H = (u) => ({ url: `automerge:${u}`, heads: null });
  it("normalizeStudy keeps its invariants over every malformed case", () => {
    expect(normalizeStudy(null)).toEqual({ version: 1, title: "Study", baseline: null, subjects: [], notes: "" });
    const s = normalizeStudy({
      title: "T",
      baseline: "gone",
      subjects: [
        { id: "s1", label: "a", hull: H("a"), design: null },
        { id: "s1", label: "dup", hull: H("b") }, // duplicate id: dropped
        { id: "s2", hull: null, design: null }, // neither: dropped
        { id: "s3", design: { url: "automerge:d", heads: ["h1", "h2"] } }, // design only: kept, label defaults
        { id: "s4", hull: { url: "automerge:c", heads: [] } }, // empty heads: follow latest
        { id: "", hull: H("x") }, // no id: dropped
        "junk",
      ],
    });
    expect(s.subjects.map((x) => x.id)).toEqual(["s1", "s3", "s4"]);
    expect(s.baseline).toBe("s1"); // a dangling baseline falls to the first
    expect(s.subjects[1]).toEqual({ id: "s3", label: "s3", hull: null, design: { url: "automerge:d", heads: ["h1", "h2"] } });
    expect(s.subjects[2].hull.heads).toBeNull();
  });

  it("the change helpers: ids never reused, the baseline always a subject's, heads set and cleared", () => {
    const d = newStudy();
    expect(addSubject(d, { label: "A", hull: H("a") })).toBe("s1");
    expect(d.baseline).toBe("s1");
    expect(addSubject(d, { label: "B", hull: H("b") })).toBe("s2");
    setBaseline(d, "s2");
    setBaseline(d, "nope");
    expect(d.baseline).toBe("s2");
    removeSubject(d, "s2");
    expect(d.baseline).toBe("s1");
    expect(nextSubjectId(d)).toBe("s2");
    expect(addSubject(d, { label: "C", hull: H("c") })).toBe("s2");
    removeSubject(d, "s1");
    expect(addSubject(d, { label: "D", hull: H("d") })).toBe("s3");
    setHeads(d, "s3", "hull", ["x"]);
    expect(d.subjects.find((s) => s.id === "s3").hull.heads).toEqual(["x"]);
    setHeads(d, "s3", "hull", null);
    expect(d.subjects.find((s) => s.id === "s3").hull.heads).toBeNull();
    setHeads(d, "s3", "design", ["y"]); // it has none: nothing to pin
    expect(d.subjects.find((s) => s.id === "s3").design).toBeNull();
    expect(() => addSubject(d, { label: "E" })).toThrow();
    expect(JSON.stringify(d)).not.toMatch(/undefined/);
    expect(normalizeStudy(d)).toEqual(d);
  });
});

describe("subjects: what a dropped doc becomes, and a subject resolved at real size", () => {
  const GLB = glb("narrow-transom");
  const U = { hull: "automerge:hu11111111111111111111111", rig: "automerge:r1g1111111111111111111111", render: "automerge:rend111111111111111111111", study: "automerge:stu11111111111111111111111" };
  const docs = {
    [U.hull]: { "@patchwork": { type: "camber-hull" }, title: "Narrow transom" },
    [U.rig]: { "@patchwork": { type: "rig-design" }, ...fixtureDoc(FIXTURES[0].fixture), title: "Sloop on NT", hull: { ...fixtureDoc(FIXTURES[0].fixture).hull, link: { url: U.hull, frame: { bow: "+X", up: "+Y" } } } },
    [U.render]: { "@patchwork": { type: "scene-render" }, title: "Narrow transom", parent: U.hull, params: { size: "length", lengthMeters: 15 } },
    [U.study]: { "@patchwork": { type: "naval-study" }, title: "S" },
  };
  const views = [];
  const handle = (url, doc, heads = ["live"]) => ({ url, doc: () => doc, heads: () => heads, on() {}, off() {}, view: (h) => (views.push([url, h]), handle(url, doc, h)) });
  const repo = { find: async (u) => (docs[u] ? handle(u, docs[u]) : Promise.reject(new Error("unknown"))) };
  beforeEach(() => {
    resetRegistries();
    views.length = 0;
    getRegistry("scene:source").register({ id: "camber-hull-surface", name: "Camber hull", supportedDatatypes: ["camber-hull"], params: [{ key: "size", default: "document" }], load: async () => ({ build: async ({ params }) => (expect(params).toEqual({ size: "document" }), { glb: GLB }) }) });
  });

  it("subjectFor: a hull, a design (with its linked hull), and refusals", () => {
    expect(subjectFor(docs[U.hull], U.hull)).toEqual({ ok: true, subject: { label: "Narrow transom", hull: { url: U.hull, heads: null }, design: null } });
    expect(subjectFor(docs[U.rig], U.rig)).toEqual({ ok: true, subject: { label: "Sloop on NT", hull: { url: U.hull, heads: null }, design: { url: U.rig, heads: null } } });
    expect(subjectFor(docs[U.render], U.render).error).toMatch(/stretched to 15 m by the scene, not a hull: link the hull itself/);
    expect(subjectFor(docs[U.study], U.study).ok).toBe(false);
    expect(subjectFor(undefined, U.hull).ok).toBe(false);
  });

  it("resolves a design on its hull at pinned heads: views at those heads, the hull built with default params", async () => {
    const r = await resolveSubject({ id: "s1", label: "x", hull: { url: U.hull, heads: ["h0"] }, design: { url: U.rig, heads: ["d0"] } }, { repo, getRegistry });
    expect(r.ok).toBe(true);
    expect(views).toEqual([[U.rig, ["d0"]], [U.hull, ["h0"]]]);
    expect(r.live).toEqual([]); // pinned: nothing to follow
    expect(r.used).toMatchObject({ hull: { url: U.hull, heads: ["h0"], table: null }, design: { url: U.rig, heads: ["d0"] } });
    expect(r.job).toMatchObject({ type: "screen", linked: { status: "ready" } });
    expect(r.job.doc.hull.link.url).toBe(U.hull);
    expect(r.chip).toMatch(/built by Camber hull \(its default params, at its own size\)/);
  });

  it("follows the latest when unpinned; a design screened on another subject hull says so", async () => {
    const other = "automerge:hu22222222222222222222222";
    docs[other] = { "@patchwork": { type: "camber-hull" }, title: "Another" };
    const r = await resolveSubject({ id: "s1", label: "x", hull: { url: other, heads: null }, design: { url: U.rig, heads: null } }, { repo, getRegistry });
    expect(r.ok).toBe(true);
    expect(r.live.map((h) => h.url)).toEqual([U.rig, other]);
    expect(r.used.hull.heads).toEqual(["live"]);
    expect(r.job.doc.hull.link.url).toBe(other);
    expect(r.warnings.join(" ")).toMatch(/linked to another hull/);
  });

  it("the hull's chartroom:source table rides along, and the job carries it to the worker", async () => {
    const upright = JSON.parse(readFileSync(here("../test/chartroom/upright-box.json"), "utf8"));
    getRegistry(CHARTROOM_SOURCE).register({ id: "camber-hull-chartroom", name: "Camber", supportedDatatypes: ["camber-hull"], load: async () => ({ fingerprint: () => "fp", hydrostaticTable: () => upright, marineGeometry: () => null }) });
    const r = await resolveSubject({ id: "s1", label: "x", hull: { url: U.hull, heads: null }, design: null }, { repo, getRegistry });
    expect(r.used.hull).toMatchObject({ table: "chartroom", fingerprint: "fp" });
    expect(r.job.linked.mesh.table).toBe(upright);
    expect(r.job.linked.tableSource).toBe("Camber");
  });

  it("refuses a render as a subject's hull, for good (not retried)", async () => {
    const r = await resolveSubject({ id: "s1", label: "x", hull: { url: U.render, heads: null }, design: null }, { repo, getRegistry });
    expect(r).toMatchObject({ ok: false, transient: false });
    expect(r.error).toMatch(/link the hull itself/);
  });

  it("a host that can't open a pinned version says so, for good", async () => {
    const flat = { find: async (u) => ({ ...handle(u, docs[u]), view: undefined }) };
    const r = await resolveSubject({ id: "s1", label: "x", hull: { url: U.hull, heads: ["h0"] }, design: null }, { repo: flat, getRegistry });
    expect(r).toMatchObject({ ok: false, transient: false });
    expect(r.error).toMatch(/pinned version/);
  });
});
