// The comparison: every screened figure in a row, a column per subject, with
// its difference from the baseline. Pure (no DOM); the view draws what this
// returns and formats only the Figures in it (figures.js formatFigure).
//
// The catalogue below fixes each row's unit. A subject's figure under a row
// must have that unit (else this throws: a programming error, which the
// tests exercise over every fixture subject), so a Δ is always between
// like quantities.

import { deltaFigure, isFigure } from "./figures.js";

/** Rows by group, in reading order: [id, label, unit, needs]. needs "design": only a subject with a rig design has it. */
export const CATALOGUE = Object.freeze([
  {
    id: "particulars",
    title: "Particulars",
    rows: [
      ["loa", "LOA", "length"],
      ["lwl", "LWL", "length"],
      ["bwl", "BWL", "length"],
      ["tc", "Tc, canoe body", "length"],
      ["draft", "Draft T", "length", "design"],
      ["volume", "∇", "volume"],
      ["displacement", "Δ", "mass"],
      ["wsa", "Wetted surface (canoe body)", "area"],
      ["aw", "Waterplane area Aw", "area"],
      ["lcb", "LCB (% LWL, + fwd of mid)", "percent"],
      ["lcf", "LCF (% LWL, + fwd of mid)", "percent"],
      ["cb", "Cb", "ratio"],
      ["cp", "Cp", "ratio"],
      ["cm", "Cm", "ratio"],
      ["cw", "Cw", "ratio"],
      ["halfEntrance", "Half angle of entrance", "angle"],
      ["dL", "D/L", "ratio"],
      ["slenderness", "LWL / ∇^⅓", "ratio"],
      ["saD", "SA/D", "ratio", "design"],
      ["ballastRatio", "Ballast ratio", "percent", "design"],
    ],
  },
  {
    id: "stability",
    title: "Stability",
    rows: [
      ["kmt", "KMt (limiting KG, GMt > 0)", "length"],
      ["kn30", "KN at 30°", "length"],
      ["kn60", "KN at 60°", "length"],
      ["kn90", "KN at 90°", "length"],
      ["gm", "GMt", "length", "design"],
      ["gzMax", "GZ max", "length", "design"],
      ["heelAtMax", "Heel at GZ max", "angle", "design"],
      ["avs", "AVS", "angle", "design"],
      ["area30", "Area under GZ to 30°", "lengthRad", "design"],
      ["area40", "Area under GZ to 40°", "lengthRad", "design"],
      ["rm30", "RM at 30°", "moment", "design"],
      ["sheerImmersion", "Sheer immersion", "angle", "design"],
    ],
  },
  {
    id: "resistance",
    title: "Resistance (upright)",
    rows: [
      ["r25", "R at Fn 0.25", "force"],
      ["rw25", "R/W at Fn 0.25", "ratio"],
      ["r35", "R at Fn 0.35", "force"],
      ["rw35", "R/W at Fn 0.35", "ratio"],
      ["r45", "R at Fn 0.45", "force"],
      ["rw45", "R/W at Fn 0.45", "ratio"],
    ],
  },
  {
    id: "balance",
    title: "Balance",
    rows: [
      ["lead", "Lead (% LWL)", "percent", "design"],
      ["refHelm", "Rudder at the reference point", "angle", "design"],
    ],
  },
  {
    id: "performance",
    title: "Performance",
    rows: [
      ["refSpeed", "Speed at the reference point", "speed", "design"],
      ["refHeel", "Heel at the reference point", "angle", "design"],
      ["beatVmg", "Best upwind VMG", "speed", "design"],
      ["runVmg", "Best downwind VMG", "speed", "design"],
    ],
  },
].map((g) => Object.freeze({ ...g, rows: Object.freeze(g.rows.map(([id, label, unit, needs = "hull"]) => Object.freeze({ id, label, unit, needs }))) })));

/** Every row id, in order. */
export const ROW_IDS = Object.freeze(CATALOGUE.flatMap((g) => g.rows.map((r) => r.id)));

/** What no screen here can tell you, whatever the subject: said every time, so its absence never reads as "fine". */
export const NOT_SCREENED = Object.freeze([
  "Mesh and table convergence: hydrostatic and stability figures are read off the hull's mesh and table as built, and none is checked against a finer one (their badge says “not graded”, not “in range”).",
  "Added resistance and motions in waves (no seakeeping model yet).",
  "Stability criteria (ISO 12217-2 STIX, AVS by design category): not yet assessed.",
  "Structure and scantlings (ISO 12215-5): not assessed.",
  "Loading conditions from camber's weight book: the design's own loading (or the hull at its design waterline) is used.",
  "Free-surface wave patterns, spray and transom ventilation: these need CFD or a tank.",
  "Displacement motorboat resistance (Holtrop): not yet; the DSYHS and Savitsky fits are for sailing yachts and planing forms.",
]);

/**
 * The comparison table.
 * @param {{ id: string, label: string, kind?: "hull"|"design", state: "pending"|"ready"|"error", result?: { ok: boolean, figures: Record<string, object>, why?: string }, error?: string }[]} columns
 * @param {string|null} baselineId
 * @returns {{ columns: object[], groups: { id, title, rows: { id, label, unit, cells: { figure: object|null, delta: object|null, missing?: string }[] }[] }[], cantTell: object[], notScreened: string[] }}
 */
export function compare(columns, baselineId) {
  const base = columns.find((c) => c.id === baselineId) ?? null;
  const figuresOf = (c) => (c.state === "ready" && c.result?.ok ? c.result.figures : null);
  const baseFigs = base ? figuresOf(base) : null;
  const missingWhy = (c, row) => {
    if (c.state === "pending") return "screening…";
    if (c.state === "error") return c.error ?? "can't be screened";
    if (!c.result?.ok) return c.result?.why ?? "can't be screened";
    if (row.needs === "design" && c.kind === "hull") return "needs a rig design";
    return "not screened";
  };
  const groups = [];
  for (const g of CATALOGUE) {
    const rows = [];
    for (const row of g.rows) {
      const cells = columns.map((c) => {
        const figs = figuresOf(c);
        const f = figs?.[row.id] ?? null;
        if (f && !isFigure(f)) throw new TypeError(`${c.label}: ${row.id} isn't a Figure`);
        if (f && f.unit !== row.unit) throw new TypeError(`${c.label}: ${row.id} is in ${f.unit}, its row in ${row.unit}`);
        if (!f) return { figure: null, delta: null, missing: missingWhy(c, row) };
        const b = c.id !== baselineId ? (baseFigs?.[row.id] ?? null) : null;
        return { figure: f, delta: b ? deltaFigure(f, b) : null };
      });
      if (cells.some((x) => x.figure)) rows.push({ id: row.id, label: row.label, unit: row.unit, cells });
    }
    if (rows.length) groups.push({ id: g.id, title: g.title, rows });
  }
  const cantTell = [];
  for (const [i, c] of columns.entries()) {
    for (const g of groups)
      for (const row of g.rows) {
        const f = row.cells[i].figure;
        // listed: a figure the screen couldn't give, or one graded outside its method's range.
        // An ungraded figure isn't (NOT_SCREENED says, once, what nothing grades).
        if (!f || ((f.envelope === "inside" || f.envelope === "ungraded") && f.value !== null)) continue;
        cantTell.push({
          subjectId: c.id,
          subject: c.label,
          rowId: row.id,
          row: row.label,
          envelope: f.value === null ? "unavailable" : f.envelope,
          method: f.method,
          reason: f.value === null ? f.why : (f.outOfRange ?? []).map((o) => `${o.label} outside ${o.min}–${o.max}`).join("; ") || f.note || `${f.envelope} its fitted range`,
        });
      }
  }
  return {
    columns: columns.map((c) => ({ id: c.id, label: c.label, kind: c.kind ?? null, state: c.state, baseline: c.id === baselineId, error: c.state === "error" ? (c.error ?? null) : c.result && !c.result.ok ? (c.result.why ?? null) : null })),
    groups,
    cantTell,
    notScreened: [...NOT_SCREENED],
  };
}
